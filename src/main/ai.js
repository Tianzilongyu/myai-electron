'use strict';

/**
 * AI 请求客户端
 *
 * 全部在主进程发起，渲染层拿不到密钥。
 * 对外只暴露工厂 createAiClient()，依赖注入（providers / getApiKey），便于单测。
 */

const NO_DATA_TIMEOUT_MS = 90000;   // 流式请求 90 秒没有任何数据就放弃

/* reqId -> Set<AbortController>。多 AI 并行时一个 reqId 下同时挂着多个请求，
 * 只存单个 controller 的话，abort 只能停掉最后挂进去的那个。 */
const activeRequests = new Map();

function buildError(status, payload) {
  let detail = '';
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      detail = (parsed.error && (parsed.error.message || parsed.error.code)) || payload;
    } catch (e) {
      detail = payload;
    }
  } else if (payload && typeof payload === 'object') {
    detail = (payload.error && (payload.error.message || payload.error.code)) || JSON.stringify(payload);
  }
  const text = String(detail || '').slice(0, 300);
  if (status === 401 || status === 403) return `密钥无效或没有权限（HTTP ${status}）`;
  if (status === 429) return `请求太频繁或被限流（HTTP ${status}）`;
  if (status >= 500) return `服务商暂时不可用（HTTP ${status}）`;
  return `HTTP ${status}${text ? '：' + text : ''}`;
}

/* 用户点「停止」和看门狗超时都走 abort，各家抛出来的形态不统一，这里统一认 */
function isAbortError(e) {
  if (!e) return false;
  if (e.isAbort === true) return true;
  if (e.name === 'AbortError') return true;
  return /已停止生成|aborted/i.test(String(e.message || ''));
}

/* 各家 usage 字段名基本一致，统一成 { prompt, completion, total } */
function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const prompt = Number(raw.prompt_tokens || 0);
  const completion = Number(raw.completion_tokens || 0);
  const total = Number(raw.total_tokens || 0) || prompt + completion;
  if (!total) return null;
  return { prompt, completion, total, exact: true };
}

function looksLikeToolsUnsupported(msg) {
  const s = String(msg || '').toLowerCase();
  return /tools/.test(s) && /(unknown|unsupport|not support|invalid|invalid_request|extra|forbidden|不支持|无效)/.test(s);
}

/** 把流式的 SSE 分片解析成一条条 data: 行，跨 chunk 的半行由调用方持有 buffer */
function createSseParser(onPayload) {
  let buffer = '';
  return function push(chunkText) {
    buffer += chunkText;
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line || !line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let json;
      try {
        json = JSON.parse(payload);
      } catch (e) {
        continue;   // 半包或噪声，丢掉
      }
      onPayload(json);
    }
  };
}

function createAiClient({ providers, getApiKey, noDataTimeout = NO_DATA_TIMEOUT_MS }) {
  function resolveModel(providerId, requested, modelOverride) {
    return requested || modelOverride || providers[providerId].model;
  }

  function buildChatBody(providerId, msgs, opts = {}) {
    const provider = providers[providerId];
    const body = {
      model: resolveModel(providerId, opts.model, opts.modelOverride),
      messages: msgs,
      stream: Boolean(opts.stream),
    };
    if (typeof opts.temperature === 'number' && opts.temperature !== null) body.temperature = opts.temperature;
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    Object.assign(body, provider.thinkingParam(Boolean(opts.thinking)));
    // 深度思考模式下部分家不接受 temperature，直接不给
    if (opts.thinking && provider.thinkingDropsTemperature) delete body.temperature;
    if (opts.tools) body.tools = opts.tools;
    return body;
  }

  async function aiFetch(providerId, body, reqId, onChunk) {
    const provider = providers[providerId];
    if (!provider) throw new Error('未知的 AI 服务：' + providerId);

    const apiKey = getApiKey(providerId);
    if (!apiKey && !provider.optionalKey) {
      throw new Error(`${provider.name} 还没配置密钥，请到「设置」里填写`);
    }

    const controller = new AbortController();
    if (reqId) {
      let set = activeRequests.get(reqId);
      if (!set) { set = new Set(); activeRequests.set(reqId, set); }
      set.add(controller);
    }

    let watchdog = null;
    const armWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        controller.abort(new Error('等待模型响应超时（90 秒无任何数据）'));
      }, noDataTimeout);
    };
    armWatchdog();

    try {
      // 想拿到 token 用量，流式请求需要显式声明（本地 Ollama 不认这个字段）
      if (body.stream && provider.streamUsage !== false) {
        body.stream_options = { include_usage: true };
      }

      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const response = await fetch(`${provider.baseURL}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(buildError(response.status, text));
      }

      if (!body.stream) {
        const data = await response.json();
        if (data.error) throw new Error(String(data.error.message || data.error.code || '未知错误'));
        const choice = data.choices && data.choices[0];
        if (!choice) throw new Error('服务商返回内容为空');
        return {
          content: (choice.message && choice.message.content) || '',
          reasoning: (choice.message && choice.message.reasoning_content) || '',
          usage: normalizeUsage(data.usage),
          toolCalls: (choice.message && choice.message.tool_calls) || [],
          // 有些家不会返回 tool_calls 而是把参数写进 text，交给降级解析器处理
          rawText: (choice.message && choice.message.content) || '',
        };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let content = '';
      let reasoning = '';
      let usage = null;
      const toolCallBuf = new Map();   // index -> { id, name, arguments }

      const push = createSseParser((json) => {
        if (json.error) throw new Error(String(json.error.message || json.error.code || '未知错误'));
        if (json.usage) usage = normalizeUsage(json.usage) || usage;

        // 收尾那条只有 usage，没有 choices
        const choices = json.choices;
        if (!choices || choices.length === 0) return;
        const delta = choices[0] && choices[0].delta;
        if (!delta) return;
        if (delta.content) {
          content += delta.content;
          if (onChunk) onChunk({ type: 'content', text: delta.content });
        }
        if (delta.reasoning_content) {
          reasoning += delta.reasoning_content;
          if (onChunk) onChunk({ type: 'reasoning', text: delta.reasoning_content });
        }
        if (delta.reasoning) {
          reasoning += delta.reasoning;
          if (onChunk) onChunk({ type: 'reasoning', text: delta.reasoning });
        }
        // 工具调用是按增量一片片来的，要按 index 拼回去
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = typeof tc.index === 'number' ? tc.index : 0;
            const cur = toolCallBuf.get(idx) || { id: '', name: '', arguments: '' };
            if (tc.id) cur.id = tc.id;
            if (tc.function && tc.function.name) cur.name = tc.function.name;
            if (tc.function && tc.function.arguments) cur.arguments += tc.function.arguments;
            toolCallBuf.set(idx, cur);
          }
        }
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armWatchdog();
        push(decoder.decode(value, { stream: true }));
      }

      const toolCalls = [...toolCallBuf.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => ({
          id: v.id || `call_${Math.random().toString(36).slice(2, 9)}`,
          type: 'function',
          function: { name: v.name, arguments: v.arguments },
        }))
        .filter((c) => c.function.name);

      return { content, reasoning, usage, toolCalls, rawText: content };
    } finally {
      if (watchdog) clearTimeout(watchdog);
      if (reqId) {
        const set = activeRequests.get(reqId);
        if (set) {
          set.delete(controller);
          if (set.size === 0) activeRequests.delete(reqId);
        }
      }
    }
  }

  /** 同一个 reqId 下可能挂着多个请求（多 AI 并行），要全部停掉 */
  function abort(reqId) {
    let aborted = 0;
    const ids = reqId ? [reqId] : [...activeRequests.keys()];
    for (const id of ids) {
      const set = activeRequests.get(id);
      if (!set) continue;
      for (const controller of [...set]) {
        controller.abort(new Error('已停止生成'));
        aborted += 1;
      }
      activeRequests.delete(id);
    }
    return aborted;
  }

  return { aiFetch, buildChatBody, resolveModel, abort };
}

module.exports = {
  createAiClient,
  buildError,
  isAbortError,
  normalizeUsage,
  looksLikeToolsUnsupported,
  createSseParser,
  activeRequests,
  NO_DATA_TIMEOUT_MS,
};

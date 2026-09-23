'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

/* ==================================================================
 * 供应商注册表
 * 这里只放公开信息（地址、模型名），任何密钥都不落在这里。
 * ================================================================== */
const PROVIDERS = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    avatar: '🐳',
    color: '#4d6bfe',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-chat', 'deepseek-reasoner'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyHint: 'sk- 开头的一串字符',
    // 官方余额接口：GET /user/balance -> { balance_infos: [{ currency, total_balance }] }
    balance: {
      url: 'https://api.deepseek.com/user/balance',
      parse: (j) => {
        const list = Array.isArray(j && j.balance_infos) ? j.balance_infos : [];
        if (!list.length) throw new Error('返回里没有余额字段');
        return list.map((i) => ({ currency: i.currency || 'CNY', amount: Number(i.total_balance) || 0 }));
      },
    },
    // 官方：thinking:{type:'enabled'} + reasoning_effort；思考模式下不接受 temperature
    thinkingParam: (on) => (on ? { thinking: { type: 'enabled' }, reasoning_effort: 'high' } : { thinking: { type: 'disabled' } }),
    thinkingSupported: true,
    thinkingDropsTemperature: true,
  },
  zhipu: {
    id: 'zhipu',
    name: '智谱 GLM',
    avatar: '🧠',
    color: '#0f766e',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-plus', 'glm-4.6'],
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    keyHint: '形如 xxxxxxxx.yyyyyyyyyyyy',
    thinkingParam: (on) => (on ? { thinking: { type: 'enabled' } } : { thinking: { type: 'disabled' } }),
    thinkingSupported: true,
  },
  aliyun: {
    id: 'aliyun',
    name: '阿里 通义',
    avatar: '☁️',
    color: '#f59e0b',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
    keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key',
    keyHint: 'sk- 开头的一串字符',
    thinkingParam: (on) => (on ? { enable_thinking: true } : { enable_thinking: false }),
    thinkingSupported: true,
  },
  moonshot: {
    id: 'moonshot',
    name: 'Kimi（月之暗面）',
    avatar: '🌙',
    color: '#1f2937',
    baseURL: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    keyHint: 'sk- 开头的一串字符',
    // 官方余额接口：GET /v1/users/me/balance -> { data: { available_balance, currency } }
    balance: {
      url: 'https://api.moonshot.cn/v1/users/me/balance',
      parse: (j) => {
        const d = j && j.data;
        if (!d) throw new Error('返回里没有余额字段');
        const amount = Number(d.available_balance != null ? d.available_balance : (d.balance != null ? d.balance : d.total_balance));
        if (!Number.isFinite(amount)) throw new Error('余额字段无法解析');
        return [{ currency: d.currency || 'CNY', amount }];
      },
    },
    thinkingParam: () => ({}),
    thinkingSupported: false,   // 仅 k2-thinking 一类模型自带思考，普通模型传参无效
  },
  doubao: {
    id: 'doubao',
    name: '豆包（火山方舟）',
    avatar: '🫘',
    color: '#2563eb',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-1-5-pro-32k-250115',
    models: ['doubao-1-5-pro-32k-250115', 'doubao-1-5-lite-32k-250115', 'doubao-pro-32k-241215'],
    keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    keyHint: '模型名要填方舟控制台里的「接入点 ID」',
    thinkingParam: (on) => (on ? { thinking: { type: 'enabled' } } : { thinking: { type: 'disabled' } }),
    thinkingSupported: true,
  },
  siliconflow: {
    id: 'siliconflow',
    name: '硅基流动',
    avatar: '🔬',
    color: '#7c3aed',
    baseURL: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    models: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3', 'THUDM/glm-4-9b-chat'],
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    keyHint: 'sk- 开头的一串字符',
    // 官方余额接口：GET /v1/user/info -> { data: { balance, total_balance, currency } }
    balance: {
      url: 'https://api.siliconflow.cn/v1/user/info',
      parse: (j) => {
        const d = j && j.data;
        if (!d) throw new Error('返回里没有余额字段');
        const raw = d.balance != null ? d.balance : (d.total_balance != null ? d.total_balance : d.available_balance);
        const amount = Number(raw);
        if (!Number.isFinite(amount)) throw new Error('余额字段无法解析');
        return [{ currency: d.currency || 'CNY', amount }];
      },
    },
    thinkingParam: () => ({}),
    thinkingSupported: false,   // 取决于具体模型（R1 类自带），不伪装统一开关
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    avatar: '🌀',
    color: '#10a37f',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1'],
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk- 开头的一串字符',
    // OpenAI 用 reasoning_effort，仅 o 系列 / gpt-5 一类模型生效
    thinkingParam: (on) => (on ? { reasoning_effort: 'high' } : {}),
    thinkingSupported: true,
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama（本机）',
    avatar: '🦙',
    color: '#374151',
    baseURL: 'http://localhost:11434/v1',
    model: 'qwen2.5',
    models: ['qwen2.5', 'llama3.2', 'deepseek-r1', 'gemma2'],
    keyUrl: 'https://ollama.com/download',
    keyHint: '本机模型无需密钥，留空即可（需先启动 Ollama）',
    optionalKey: true,     // 不需要密钥
    allowCustomModel: true,
    streamUsage: false,    // 本地端点不认 stream_options
    thinkingParam: () => ({}),
    thinkingSupported: false,   // 取决于本地模型
  },

  /* ---- 以下为后加入的供应商，全部走 OpenAI 兼容协议 ---- */
  hunyuan: {
    id: 'hunyuan',
    name: '腾讯混元',
    avatar: '🐧',
    color: '#0052d9',
    baseURL: 'https://api.hunyuan.cloud.tencent.com/v1',
    model: 'hunyuan-turbos-latest',
    models: ['hunyuan-turbos-latest', 'hunyuan-t1-latest', 'hunyuan-standard', 'hunyuan-turbo'],
    keyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
    keyHint: '在腾讯云控制台创建的 API Key',
    allowCustomModel: true,
    thinkingParam: () => ({}),
    thinkingSupported: false,
  },
  spark: {
    id: 'spark',
    name: '讯飞星火',
    avatar: '✨',
    color: '#e1251b',
    baseURL: 'https://spark-api-open.xf-yun.com/v1',
    model: 'lite',
    models: ['lite', 'generalv3.5', 'generalv4', '4.0Ultra'],
    keyUrl: 'https://console.xfyun.cn/services/bm4',
    keyHint: '控制台里的 APIPassword（填在这里即可，不用拼 AppID）',
    allowCustomModel: true,
    thinkingParam: () => ({}),
    thinkingSupported: false,
  },
  qianfan: {
    id: 'qianfan',
    name: '百度千帆',
    avatar: '🔎',
    color: '#2932e1',
    baseURL: 'https://qianfan.baidubce.com/v2',
    model: 'ernie-speed-128k',
    models: ['ernie-speed-128k', 'ernie-4.0-8k', 'deepseek-v3'],
    keyUrl: 'https://console.bce.baidu.com/qianfan/ais/console/apiKey',
    keyHint: '模型名以千帆控制台为准，可以直接手填',
    allowCustomModel: true,
    thinkingParam: () => ({}),
    thinkingSupported: false,
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    avatar: '💎',
    color: '#4285f4',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'AI Studio 生成的 API Key',
    allowCustomModel: true,
    thinkingParam: () => ({}),
    thinkingSupported: false,
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    avatar: '⚡',
    color: '#f55036',
    baseURL: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'],
    keyUrl: 'https://console.groq.com/keys',
    keyHint: 'gsk_ 开头的一串字符',
    allowCustomModel: true,
    thinkingParam: () => ({}),
    thinkingSupported: false,
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    avatar: '🔀',
    color: '#6366f1',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash-001', 'deepseek/deepseek-chat'],
    keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'sk-or- 开头；一家 key 通吃上百个模型，模型名可直接手填',
    allowCustomModel: true,
    thinkingParam: () => ({}),
    thinkingSupported: false,
  },
  xai: {
    id: 'xai',
    name: 'xAI Grok',
    avatar: '🚀',
    color: '#111827',
    baseURL: 'https://api.x.ai/v1',
    model: 'grok-3',
    models: ['grok-3', 'grok-3-mini', 'grok-2-1212'],
    keyUrl: 'https://console.x.ai/',
    keyHint: 'xai- 开头；模型名以控制台为准',
    allowCustomModel: true,
    thinkingParam: () => ({}),
    thinkingSupported: false,
  },
};

const MAX_ATTACHMENT_CHARS = 60000;   // 单个附件送入模型的最大字符数
const NO_DATA_TIMEOUT_MS = 90000;     // 流式请求 90 秒没有任何数据就放弃

/* ==================================================================
 * 配置与会话的落盘存储
 * ================================================================== */
let configCache = null;

function dataFile(name) {
  return path.join(app.getPath('userData'), name);
}

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  fs.renameSync(tmp, file);
}

function defaultConfig() {
  return {
    version: 1,
    keys: {},
    prefs: {
      singleProvider: 'deepseek',
      modelOverrides: {},
      contextRounds: 6,
      thinkMode: false,
      skills: [],
      multi: { leader: 'deepseek', workers: ['zhipu'] },
      saveDir: '',
      sidebarCollapsed: true,
      tools: { enabled: false, allowCommand: false, searchProvider: 'ddg' },
      /* 对话参数：留空 / 为默认值时不发给模型，交给各家自己的默认行为 */
      temperature: 0.7,          // 0 ~ 1.5
      maxTokens: 0,              // 0 = 不限制，由模型决定
      requestChars: 60000,       // 单次请求携带的正文上限
      systemPrompt: '',          // 追加在内置提示词之后的自定义要求
      autoTitle: true,           // 用 AI 给会话起标题
      autoSaveFiles: true,       // 模型产出 [[SAVE:]] 时自动存盘
      /* 研发模式：默认关，工作目录默认空，自动批准默认关 —— 三个都得用户自己开 */
      agentMode: false,
      agentWorkDir: '',
      agentAutoApprove: false,
    },
  };
}

function getConfig() {
  if (configCache) return configCache;
  const loaded = readJson(dataFile('config.json'), null);
  const base = defaultConfig();
  if (!loaded) {
    configCache = base;
    return configCache;
  }
  configCache = {
    version: 1,
    keys: loaded.keys && typeof loaded.keys === 'object' ? loaded.keys : {},
    prefs: Object.assign(base.prefs, loaded.prefs || {}),
  };
  return configCache;
}

function saveConfig() {
  writeJsonAtomic(dataFile('config.json'), configCache);
}

/* 密钥用系统级加密（Windows DPAPI / macOS Keychain）保存 */
function encryptSecret(plain) {
  if (safeStorage.isEncryptionAvailable()) {
    return { enc: true, value: safeStorage.encryptString(String(plain)).toString('base64') };
  }
  return { enc: false, value: Buffer.from(String(plain), 'utf8').toString('base64') };
}

function decryptSecret(entry) {
  if (!entry || typeof entry.value !== 'string') return '';
  const buf = Buffer.from(entry.value, 'base64');
  if (entry.enc) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统不支持安全解密，请重新填写密钥');
    }
    return safeStorage.decryptString(buf);
  }
  return buf.toString('utf8');
}

function getApiKey(providerId) {
  const cfg = getConfig();
  const entry = cfg.keys[providerId];
  if (!entry) return '';
  try {
    return decryptSecret(entry);
  } catch (e) {
    throw new Error(`${PROVIDERS[providerId].name} 的密钥无法解密，请在设置中重新填写`);
  }
}

/* ==================================================================
 * AI 请求（全部在主进程发起，渲染层拿不到密钥）
 * ================================================================== */
// reqId -> Set<AbortController>。多 AI 并行时一个 reqId 下同时挂着多个请求，
// 只存单个 controller 的话，abort 只能停掉最后挂进去的那个。
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

async function aiFetch(providerId, body, reqId, onChunk) {
  const provider = PROVIDERS[providerId];
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
    }, NO_DATA_TIMEOUT_MS);
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
    let buffer = '';
    let content = '';
    let reasoning = '';
    let usage = null;
    const toolCallBuf = new Map();   // index -> { id, name, arguments }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      armWatchdog();
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;

        let json;
        try {
          json = JSON.parse(payload);
        } catch (e) {
          continue;
        }
        if (json.error) throw new Error(String(json.error.message || json.error.code || '未知错误'));
        if (json.usage) usage = normalizeUsage(json.usage) || usage;

        // 收尾那条只有 usage，没有 choices
        const choices = json.choices;
        if (!choices || choices.length === 0) continue;
        const delta = choices[0] && choices[0].delta;
        if (!delta) continue;
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
      }
    }

    const toolCalls = [...toolCallBuf.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => ({ id: v.id || `call_${Math.random().toString(36).slice(2, 9)}`, type: 'function', function: { name: v.name, arguments: v.arguments } }))
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

function resolveModel(providerId, requested) {
  const cfg = getConfig();
  const override = cfg.prefs.modelOverrides && cfg.prefs.modelOverrides[providerId];
  return requested || override || PROVIDERS[providerId].model;
}

/* ==================================================================
 * 工具调用主循环
 * 能走标准 function calling 就走；哪家用不了（报 tools 参数不支持），
 * 自动降级成「模型发一行文本指令、我们解析后执行」，保证每家都有能力。
 * ================================================================== */
function buildChatBody(providerId, msgs, opts) {
  const body = {
    model: resolveModel(providerId, opts.model),
    messages: msgs,
    stream: Boolean(opts.stream),
  };
  if (typeof opts.temperature === 'number' && opts.temperature !== null) body.temperature = opts.temperature;
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  Object.assign(body, PROVIDERS[providerId].thinkingParam(Boolean(opts.thinking)));
  // 深度思考模式下部分家不接受 temperature，直接不给
  if (opts.thinking && PROVIDERS[providerId].thinkingDropsTemperature) {
    delete body.temperature;
  }
  if (opts.tools) body.tools = opts.tools;
  return body;
}

function looksLikeToolsUnsupported(msg) {
  const s = String(msg || '').toLowerCase();
  return /tools/.test(s) && /(unknown|unsupport|not support|invalid|invalid_request|extra|forbidden|不支持|无效)/.test(s);
}

/* 同一个工具的 running -> done 只保留一条记录，界面上就不会重复堆叠 */
function mergeToolStep(steps, chunk) {
  // 一次工具调用会连发几条事件（running 空 -> running 带描述 -> done），
  // 只更新该工具「还在进行中」的那条；已经结束的再开一条，这样重复调用也分得开
  const idx = steps.findIndex((s) => s.name === chunk.name && s.status === 'running');
  if (idx !== -1) {
    steps[idx] = { name: chunk.name, status: chunk.status, summary: chunk.summary };
    return;
  }
  steps.push({ name: chunk.name, status: chunk.status, summary: chunk.summary });
}

async function runAgent(providerId, userMessages, opts, reqId, onEvent) {
  const msgs = userMessages.slice();
  const usageAcc = { prompt: 0, completion: 0, total: 0 };
  const toolSteps = [];                    // 用过的工具，最终一起回传给界面
  const track = (payload) => {
    if (payload && payload.type === 'tool') {
      mergeToolStep(toolSteps, payload);
      if (onEvent) onEvent(payload);
    } else if (onEvent && payload) {
      onEvent(payload);                    // 非流式下不应该有内容块，但保险透传
    }
  };
  let toolsOk = opts.useTools && PROVIDERS[providerId].tools !== false;
  let fallbackMode = false;
  let answer = { content: '', reasoning: '' };
  let lastRes = null;                  // 最后一轮的原始输出，兜底用

  // 研发模式：工具来回轮次大幅放开（普通问答 8 轮够了，自己干活 8 轮不够塞牙缝）
  const agentMode = Boolean(opts.agent);
  const maxRounds = agentMode ? AGENT_MAX_ROUNDS : TOOL_MAX_ROUNDS;
  const toolDefs = agentMode ? AGENT_TOOL_DEFS : TOOL_DEFS;
  const toolCtx = { autoApprove: Boolean(opts.autoApprove), workDir: opts.workDir || '' };

  // 告诉模型「你有这些能力」，否则它即使拿到 tools 也可能不用
  if (toolsOk) {
    let hint = agentMode ? AGENT_SYSTEM_HINT : TOOLS_SYSTEM_HINT;
    if (agentMode && toolCtx.workDir) {
      hint += `\n\n【本次任务的工作目录】${toolCtx.workDir}\n`
        + '所有相对路径都以它为基准；除非用户另有要求，不要到这个目录之外去创建或修改文件。';
    }
    msgs.push({ role: 'system', content: hint });
  }

  for (let round = 0; round < maxRounds; round++) {
    const isLast = round === maxRounds - 1;
    const sendTools = toolsOk && !fallbackMode && !isLast;

    let body = buildChatBody(providerId, msgs, Object.assign({}, opts, { tools: sendTools ? toolDefs : null }));

    let res;
    try {
      res = await aiFetch(providerId, body, reqId, track);
    } catch (e) {
      // 这家不认 tools 参数 -> 降级重来一次
      if (sendTools && looksLikeToolsUnsupported(e && e.message)) {
        toolsOk = false;
        fallbackMode = true;
        msgs.push({ role: 'system', content: FALLBACK_TOOL_HINT });
        body = buildChatBody(providerId, msgs, Object.assign({}, opts, { tools: null }));
        res = await aiFetch(providerId, body, reqId, track);
      } else {
        throw e;
      }
    }

    if (res.usage) {
      usageAcc.prompt += res.usage.prompt || 0;
      usageAcc.completion += res.usage.completion || 0;
      usageAcc.total += res.usage.total || 0;
    }
    lastRes = res;

    // 1) 标准 function calling
    if (res.toolCalls && res.toolCalls.length) {
      msgs.push({ role: 'assistant', content: res.content || '', tool_calls: res.toolCalls });
      for (const call of res.toolCalls) {
        let args = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch (e) { args = {}; }
        const out = await executeTool(call.function.name, args, track, toolCtx);
        msgs.push({ role: 'tool', tool_call_id: call.id, content: String(out) });
      }
      continue;
    }

    // 2) 降级模式：模型用一行文本下指令
    if (fallbackMode && !isLast) {
      const cmd = parseFallbackCommand(res.content);
      if (cmd) {
        const out = await executeTool(cmd.name, cmd.args, track, toolCtx);
        msgs.push({ role: 'assistant', content: res.content || '' });
        msgs.push({ role: 'user', content: `[工具返回]\n${out}\n\n如果需要继续用工具，按格式再输出一行指令；否则直接给出最终答案。` });
        continue;
      }
    }

    answer = { content: res.content || '', reasoning: res.reasoning || '' };
    break;
  }

  // 研发模式跑满轮次还没收尾：再问一次，让它把已完成的成果总结出来。
  // 否则用户会拿到一条空白回复，几十轮工具调用全白干。
  if (agentMode && !answer.content) {
    msgs.push({
      role: 'user',
      content: '工具调用轮次已用尽。请立刻停止调用工具，用中文总结：你已经完成了什么、改动了哪些文件、验证结果如何、还有什么没做完。',
    });
    try {
      const res = await aiFetch(providerId, buildChatBody(providerId, msgs, Object.assign({}, opts, { tools: null })), reqId, track);
      if (res.usage) {
        usageAcc.prompt += res.usage.prompt || 0;
        usageAcc.completion += res.usage.completion || 0;
        usageAcc.total += res.usage.total || 0;
      }
      answer = { content: res.content || '', reasoning: res.reasoning || '' };
    } catch (e) { /* 总结失败就退回最后一次输出，下面还有一道兜底 */ }
  }

  // 兜底：万一 8 轮全耗在工具调用上、最后一轮没落定答案，退回最后一次输出，
  // 否则用户会收到一条完全空白的回复
  if (!answer.content && lastRes) {
    answer = { content: lastRes.content || '', reasoning: lastRes.reasoning || '' };
  }

  return {
    content: answer.content,
    reasoning: answer.reasoning,
    usage: usageAcc.total ? Object.assign(usageAcc, { exact: true }) : null,
    tools: toolSteps.slice(),
  };
}

/* ==================================================================
 * AI 能力：联网搜索 + 本地访问（工具调用）
 *
 * 安全设计（用户可全盘，但仍然有硬底线）：
 *   1. 总开关默认关闭，必须由用户在设置里显式打开
 *   2. 系统目录 / 凭据目录一律硬拒绝，不随开关放开
 *   3. 写文件 / 删除 / 执行命令 三类操作每次都弹窗确认，且路径命令都给你看
 *   4. 命令另有黑名单，明显的毁灭性命令直接拒绝
 *   5. 所有动作记日志，可在设置里回看
 * ================================================================== */
const TOOL_MAX_ROUNDS = 8;          // 普通问答：单次提问最多来回几轮工具调用
const AGENT_MAX_ROUNDS = 40;        // 研发模式：自己干活要更多轮，不然项目写到一半就断了
const TOOL_OUTPUT_LIMIT = 12000;    // 单个工具返回给模型的最大字符
const TOOL_LOG_MAX = 200;

/* 本地遍历是在主进程里跑的，同步读目录会连界面一起冻住，
 * 所以改成异步，并且给「时间 + 节点数」双预算，防止在 C:\Users 这种大目录里跑没完 */
const SEARCH_TIME_BUDGET_MS = 8000;
const SEARCH_MAX_NODES = 20000;
const MAX_TOOL_READ_BYTES = 2 * 1024 * 1024;   // 搜内容时单文件最多读 2MB
const MAX_READ_BYTES = 20 * 1024 * 1024;       // read_file / 附件单个文件上限 20MB

const TOOL_DEFS = [
  { type: 'function', function: { name: 'web_search', description: '联网搜索。当你需要最新信息、实时数据、或训练数据里没有的内容时使用。', parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'web_fetch', description: '打开一个网页并读取它的正文（已去掉 HTML 标签）。', parameters: { type: 'object', properties: { url: { type: 'string', description: '完整网址' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'list_dir', description: '列出某个目录下的文件和子目录。', parameters: { type: 'object', properties: { path: { type: 'string', description: '目录绝对路径' }, max: { type: 'number', description: '最多返回多少条，默认 80' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'read_file', description: '读取本地文件内容。支持 txt/md/csv/json/代码等文本；docx/xlsx/pdf 会自动提取文本。', parameters: { type: 'object', properties: { path: { type: 'string', description: '文件绝对路径' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'search_files', description: '按文件名或内容在本地搜索。', parameters: { type: 'object', properties: { root: { type: 'string', description: '起始目录' }, keyword: { type: 'string', description: '文件名里的关键词' }, content: { type: 'string', description: '文件内容里要找的字符串（给了就搜内容）' }, max: { type: 'number', description: '最多返回多少条，默认 30' } }, required: ['root'] } } },
  { type: 'function', function: { name: 'write_file', description: '把内容写入本地文件（会覆盖已有文件，需要用户确认）。', parameters: { type: 'object', properties: { path: { type: 'string', description: '目标文件绝对路径' }, content: { type: 'string', description: '要写入的内容' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'delete_path', description: '删除本地文件或目录（需要用户确认）。', parameters: { type: 'object', properties: { path: { type: 'string', description: '要删除的绝对路径' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'run_command', description: '在用户电脑上执行一条命令（需要用户确认）。', parameters: { type: 'object', properties: { command: { type: 'string', description: '要执行的命令' }, cwd: { type: 'string', description: '工作目录，可选' } }, required: ['command'] } } },
];

/* ---------- 硬底线：这些地方任何情况下都不许碰 ---------- */
const BLOCKED_PATH_RE = [
  /^[A-Za-z]:[\\/]Windows[\\/]/i,
  /^[A-Za-z]:[\\/]Program Files/i,
  /^[A-Za-z]:[\\/]ProgramData/i,
  /^[A-Za-z]:[\\/]System Volume Information/i,
  /^[A-Za-z]:[\\/]Recovery/i,
  /^[A-Za-z]:[\\/]?$/i,                       // 盘根目录
  /^[/](System|etc|usr|bin|sbin|boot|dev|proc|var|lib)/i,
  /[\\/]\.ssh[\\/]?/i,
  /[\\/]\.aws[\\/]?/i,
  /[\\/]\.gnupg[\\/]?/i,
];

const BLOCKED_CMD_RE = [
  /rm\s+-rf\s+([/]|~|$)/i,
  /rmdir\s+\/s\s+\/q\s+[A-Za-z]:[\\/]?$/i,
  /^(format|mkfs|diskpart|fdisk)\b/i,
  /del\s+\/f\s+\/s\s+\/q\s+[A-Za-z]:[\\/]?$/i,
  /^(shutdown|poweroff|reboot|halt)\b/i,
  /\breg\s+delete\b/i,
  /\b(taskkill\s+\/f\s+\/im\s+(system|csrss|wininit|smss|lsass))/i,
  /:\(\)\{/,                                   // fork 炸弹
];

function isBlockedPath(p) {
  const norm = String(p || '').replace(/\//g, '\\');
  return BLOCKED_PATH_RE.some((re) => re.test(norm) || re.test(String(p || '')));
}

function isBlockedCommand(c) {
  return BLOCKED_CMD_RE.some((re) => re.test(String(c || '')));
}

/* ---------- 操作日志 ---------- */
const toolLog = [];

function appendToolLog(entry) {
  toolLog.unshift(Object.assign({ time: Date.now() }, entry));
  if (toolLog.length > TOOL_LOG_MAX) toolLog.length = TOOL_LOG_MAX;
}

/* ---------- 危险操作确认 ---------- */
async function confirmDangerous(title, detail) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const res = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['允许', '拒绝'],
    defaultId: 1,
    cancelId: 1,
    title: 'AI 想做一件有风险的事',
    message: title,
    detail: `${detail}\n\n这是 AI 通过工具调用发起的操作。确认无误再点「允许」。`,
  });
  return res.response === 0;
}

/* 研发模式下用户可勾选「工作目录内自动批准」，省掉重复弹窗。
 * 但只对工作目录内部的路径生效 —— 目录外一律照旧弹窗，
 * 而且黑名单命令、硬底线路径的拦截在它之前就跑完了，不受影响。 */
function insideWorkDir(workDir, target) {
  if (!workDir || !target) return false;
  const norm = (p) => String(p).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const root = norm(workDir);
  const t = norm(target);
  return t === root || t.startsWith(`${root}\\`);
}

async function askPermission(ctx, title, detail, target) {
  const auto = ctx && ctx.autoApprove;
  if (auto && insideWorkDir(ctx.workDir, target)) {
    appendToolLog({ tool: 'auto-approve', risk: 'high', result: '自动批准', summary: `（工作目录内自动批准）${title}` });
    return true;
  }
  const extra = auto
    ? '\n\n（你开了自动批准，但它只对工作目录内的路径生效，这次不在目录内，所以仍然问你）'
    : '';
  return confirmDangerous(title, `${detail}${extra}`);
}

/* ---------- 联网搜索 ---------- */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function ddgSearch(query) {
  const endpoints = ['https://html.duckduckgo.com/html/', 'https://lite.duckduckgo.com/lite/'];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' },
        body: `q=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const out = [];
      const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      const urls = [];
      let m;
      while ((m = linkRe.exec(html)) && out.length < 8) {
        let href = m[1];
        const uddg = /uddg=([^&]+)/.exec(href);
        if (uddg) href = decodeURIComponent(uddg[1]);
        const title = stripHtml(m[2]);
        if (title && href) { urls.push(href); out.push({ title, url: href }); }
      }
      // 摘要
      const snRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
      let i = 0;
      while ((m = snRe.exec(html)) && i < out.length) { out[i].snippet = stripHtml(m[1]).slice(0, 300); i += 1; }
      if (out.length) return out;
    } catch (e) { /* 换下一个端点 */ }
  }
  return [];
}

async function webSearch(query) {
  const cfg = getConfig();
  const t = (cfg.prefs && cfg.prefs.tools) || {};
  const provider = t.searchProvider || 'ddg';
  const key = getToolKey('search');

  if (provider === 'tavily' && key) {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: 8, search_depth: 'basic' }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`搜索接口返回 HTTP ${res.status}`);
    const j = await res.json();
    return (j.results || []).map((r) => ({ title: r.title, url: r.url, snippet: String(r.content || '').slice(0, 300) }));
  }
  if (provider === 'serper' && key) {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: query, num: 8 }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`搜索接口返回 HTTP ${res.status}`);
    const j = await res.json();
    return (j.organic || []).map((r) => ({ title: r.title, url: r.link, snippet: String(r.snippet || '').slice(0, 300) }));
  }
  if (provider === 'bing' && key) {
    const res = await fetch(`https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=8`, {
      headers: { 'Ocp-Apim-Subscription-Key': key, 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`搜索接口返回 HTTP ${res.status}`);
    const j = await res.json();
    return ((j.webPages && j.webPages.value) || []).map((r) => ({ title: r.name, url: r.url, snippet: String(r.snippet || '').slice(0, 300) }));
  }
  return ddgSearch(query);
}

/* ---------- 工具执行 ---------- */
function toolsEnabled() {
  const cfg = getConfig();
  return Boolean(cfg.prefs && cfg.prefs.tools && cfg.prefs.tools.enabled);
}

async function executeTool(name, args, onEvent, ctx = {}) {
  const emit = (status, summary) => { if (onEvent) onEvent({ type: 'tool', name, status, summary }); };

  // 总开关管的是「全部能力」，联网搜索也算在内。
  // 之前 web_search / web_fetch 在这道判定之前就 return 了，开关关着照样能联网。
  if (!toolsEnabled()) {
    emit('denied', '能力已关闭');
    return 'AI 能力已被用户关闭，联网搜索和本地访问都不能用。';
  }

  emit('running', '');

  try {
    /* 计划展示：不碰文件系统，纯粹把步骤推给界面，让用户看得见 AI 在干嘛 */
    if (name === 'set_plan') {
      const steps = (Array.isArray(args.steps) ? args.steps : [])
        .map((s) => String(s || '').trim()).filter(Boolean).slice(0, 20);
      if (!steps.length) return '计划为空，请给出具体步骤。';
      if (onEvent) onEvent({ type: 'plan', steps });
      appendToolLog({ tool: name, args: { steps }, risk: 'low', summary: `列出 ${steps.length} 步计划` });
      emit('done', `${steps.length} 步`);
      return `计划已展示给用户，共 ${steps.length} 步。按计划继续往下做。`;
    }

    if (name === 'web_search') {
      emit('running', `搜索「${args.query}」`);
      const results = await webSearch(String(args.query || ''));
      appendToolLog({ tool: name, args: { query: args.query }, risk: 'low', summary: `搜索「${args.query}」，返回 ${results.length} 条` });
      emit('done', `搜索到 ${results.length} 条`);
      if (!results.length) return '没有搜到结果，可以换个关键词再试。';
      return clipText(results.map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet || ''}`).join('\n\n'), TOOL_OUTPUT_LIMIT);
    }

    if (name === 'web_fetch') {
      emit('running', `打开 ${args.url}`);
      const res = await fetch(String(args.url), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) return `打开失败：HTTP ${res.status}`;
      const text = stripHtml(await res.text());
      appendToolLog({ tool: name, args: { url: args.url }, risk: 'low', summary: `读取网页 ${args.url}` });
      emit('done', '网页已读取');
      return clipText(text, TOOL_OUTPUT_LIMIT);
    }

    // ---- 以下都是本地操作，先过硬底线（总开关已在函数入口统一拦过） ----
    const target = String(args.path || args.root || args.cwd || '');

    if (name === 'list_dir') {
      if (isBlockedPath(target)) return `拒绝访问：${target} 属于受保护的系统位置。`;
      const max = Math.min(Math.max(parseInt(args.max, 10) || 80, 1), 300);
      const entries = await fs.promises.readdir(target, { withFileTypes: true });
      const lines = entries.slice(0, max).map((e) => `${e.isDirectory() ? '[目录]' : '[文件]'} ${e.name}`);
      appendToolLog({ tool: name, args: { path: target }, risk: 'low', summary: `列出目录 ${target}` });
      emit('done', `${lines.length} 项`);
      return clipText(lines.join('\n') || '（空目录）', TOOL_OUTPUT_LIMIT);
    }

    if (name === 'read_file') {
      if (isBlockedPath(target)) return `拒绝访问：${target} 属于受保护的系统位置。`;
      const text = await readFileContent(target);
      appendToolLog({ tool: name, args: { path: target }, risk: 'low', summary: `读取文件 ${target}` });
      emit('done', path.basename(target));
      return clipText(text, TOOL_OUTPUT_LIMIT);
    }

    if (name === 'search_files') {
      if (isBlockedPath(target)) return `拒绝访问：${target} 属于受保护的系统位置。`;
      const max = Math.min(Math.max(parseInt(args.max, 10) || 30, 1), 100);
      const hits = [];
      const keyword = String(args.keyword || '').toLowerCase();
      const needle = String(args.content || '');
      const TEXT_EXT = ['.txt', '.md', '.csv', '.json', '.js', '.ts', '.py', '.html', '.css', '.java', '.go', '.yml', '.yaml', '.log'];
      const deadline = Date.now() + SEARCH_TIME_BUDGET_MS;
      let visited = 0;
      const exhausted = () => hits.length >= max || visited >= SEARCH_MAX_NODES || Date.now() > deadline;
      const walk = async (dir, depth) => {
        if (depth > 4 || exhausted()) return;
        let items = [];
        try { items = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
        for (const it of items) {
          if (exhausted()) return;
          visited += 1;
          const full = path.join(dir, it.name);
          if (isBlockedPath(full)) continue;
          if (it.isDirectory()) { await walk(full, depth + 1); continue; }
          if (keyword && it.name.toLowerCase().includes(keyword)) { hits.push(full); continue; }
          if (needle && TEXT_EXT.includes(path.extname(it.name).toLowerCase())) {
            try {
              const st = await fs.promises.stat(full);
              if (st.size <= MAX_TOOL_READ_BYTES && (await fs.promises.readFile(full, 'utf8')).includes(needle)) {
                hits.push(full);
              }
            } catch (e) { /* 读不动就跳过 */ }
          }
        }
      };
      await walk(target, 0);
      const truncated = visited >= SEARCH_MAX_NODES || Date.now() > deadline;
      appendToolLog({ tool: name, args: { root: target, keyword, content: needle }, risk: 'low', summary: `在 ${target} 下搜到 ${hits.length} 个${truncated ? '（已到上限，提前停止）' : ''}` });
      emit('done', `${hits.length} 个结果`);
      return clipText(hits.join('\n') || '没有找到匹配项', TOOL_OUTPUT_LIMIT);
    }

    if (name === 'write_file') {
      if (isBlockedPath(target)) return `拒绝写入：${target} 属于受保护的系统位置。`;
      const ok = await askPermission(ctx, 'AI 想要写入文件', `目标：${target}\n内容长度：${String(args.content || '').length} 字符`, target);
      if (!ok) { appendToolLog({ tool: name, args: { path: target }, risk: 'high', result: '用户拒绝', summary: `写入 ${target}（已拒绝）` }); emit('denied', '用户拒绝'); return '用户拒绝了这个操作。'; }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, String(args.content || ''), 'utf8');
      appendToolLog({ tool: name, args: { path: target }, risk: 'high', result: '已执行', summary: `写入 ${target}` });
      emit('done', path.basename(target));
      return `已写入 ${target}`;
    }

    if (name === 'delete_path') {
      if (isBlockedPath(target)) return `拒绝删除：${target} 属于受保护的系统位置。`;
      const ok = await askPermission(ctx, 'AI 想要删除文件/目录', `目标：${target}`, target);
      if (!ok) { appendToolLog({ tool: name, args: { path: target }, risk: 'high', result: '用户拒绝', summary: `删除 ${target}（已拒绝）` }); emit('denied', '用户拒绝'); return '用户拒绝了这个操作。'; }
      fs.rmSync(target, { recursive: true, force: true });
      appendToolLog({ tool: name, args: { path: target }, risk: 'high', result: '已执行', summary: `删除 ${target}` });
      emit('done', path.basename(target));
      return `已删除 ${target}`;
    }

    if (name === 'run_command') {
      const cfg = getConfig();
      if (!cfg.prefs.tools.allowCommand) return '命令执行已被用户关闭。';
      const cmd = String(args.command || '');
      if (isBlockedCommand(cmd)) return `拒绝执行：这条命令在危险命令黑名单里。`;
      for (const p of String(cmd).match(/[A-Za-z]:[\\/][^\s"']*/g) || []) {
        if (isBlockedPath(p)) return `拒绝执行：命令里涉及受保护的系统位置 ${p}。`;
      }
      const ok = await askPermission(ctx, 'AI 想要执行一条命令', `命令：\n${cmd}\n\n工作目录：${args.cwd || '（默认）'}`, args.cwd || ctx.workDir);
      if (!ok) { appendToolLog({ tool: name, args: { command: cmd }, risk: 'high', result: '用户拒绝', summary: `执行命令（已拒绝）` }); emit('denied', '用户拒绝'); return '用户拒绝了这个操作。'; }
      const { exec } = require('child_process');
      const out = await new Promise((resolve) => {
        exec(cmd, { cwd: args.cwd || undefined, timeout: 60000, maxBuffer: 1024 * 1024 * 4, windowsHide: true },
          (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
      });
      appendToolLog({ tool: name, args: { command: cmd }, risk: 'high', result: out.err ? '失败' : '已执行', summary: `执行命令：${cmd.slice(0, 60)}` });
      emit('done', out.err ? '命令失败' : '命令完成');
      return clipText(`退出码：${out.err ? out.err.code : 0}\n${out.stdout}${out.stderr ? '\n[stderr]\n' + out.stderr : ''}`, TOOL_OUTPUT_LIMIT);
    }

    return `未知工具：${name}`;
  } catch (e) {
    emit('error', String((e && e.message) || e));
    return `工具执行出错：${(e && e.message) || e}`;
  }
}

/* ---------- 降级方案：模型不支持 tools 时，用文本指令让它自己发号 ---------- */
/* 工具可用时追加的系统说明：明确「你可以用」，并划清安全边界 */
const TOOLS_SYSTEM_HINT = `
你现在具备两类扩展能力，需要时主动使用，不要凭记忆编造：

1. 联网搜索：web_search 查最新信息，web_fetch 打开具体网页读正文。
   凡是涉及实时数据、新闻、价格、版本、时效性强的内容，先搜再答。
2. 本地访问：list_dir 列目录、read_file 读文件、search_files 搜文件、
   write_file 写文件、delete_path 删除、run_command 执行命令。
   写文件 / 删除 / 执行命令这三种会先弹窗让用户确认，用户拒绝就换个方案或如实说明。

规则：
- 用了工具就在回答里体现你查到了什么，不要声称你做了没做的事。
- 工具失败或被拒绝，如实告诉用户，不要伪造结果。
- 能用一次搜清楚的，不要反复搜。`.trim();

/* 研发模式（自主研发）：目标是「自己把一件事做完」，不是问用户下一步干嘛。
 * 这套提示的关键在三件事：先勘察再动手、每次写完整文件、跑完要验证。 */
const AGENT_SYSTEM_HINT = `
你现在处于「研发模式」，目标是**独立把一个任务从头做完**，不要每一步都回头问用户。

工作流（自己循环，不要等人推）：
1. 勘察：先用 list_dir / search_files / read_file 把现状摸清楚。
   给了工作目录就从那里开始；没给就用用户提到的路径，实在没有再问一次。
2. 计划：用 set_plan 把步骤列出来（3-8 条），用户能实时看到你在干什么。
3. 执行：一次做一件事。write_file 必须写**完整可运行的文件**，
   严禁出现「……」「其余部分类似」「// TODO 同上」这类占位。
   改已有文件时先 read_file 读原文，再整体重写，不要输出 diff 片段让用户自己拼。
4. 验证：能跑就跑（run_command），报错就读报错、改、再跑，最多自己重试几轮。
   没验证过就说「还没验证」，不许说「应该可以了」。
5. 汇报：最后用中文简短说明——改了哪些文件、怎么验证的、哪些假设需要用户确认、还剩什么没做。

铁律：
- 每个文件内容都要完整，一个文件一次输出，不要一次甩十个文件然后说「以此类推」。
- 命令失败要看错误原因，不要原样重试第二遍。
- 不确定的需求，按最合理的方案做完，然后在汇报里把假设讲清楚。
- 写文件 / 删除 / 执行命令会弹窗让用户确认。被拒绝就换方案或如实说明，不许绕开。
- 不要伪造运行结果，也不要声称做了没做的事。`.trim();

const TOOL_DEF_SET_PLAN = {
  type: 'function',
  function: {
    name: 'set_plan',
    description: '把接下来要做的步骤列出来展示给用户（研发模式）。开工前先调用一次，中途计划变了就再调用一次。',
    parameters: {
      type: 'object',
      properties: { steps: { type: 'array', items: { type: 'string' }, description: '步骤列表，每项一句话，3-8 条' } },
      required: ['steps'],
    },
  },
};
const AGENT_TOOL_DEFS = TOOL_DEFS.concat([TOOL_DEF_SET_PLAN]);

const FALLBACK_TOOL_HINT = `
你可以使用下列能力。需要用到时，**只输出一行指令**，不要输出其它内容：
  SEARCH: 关键词                    → 联网搜索
  FETCH: 网址                        → 打开网页读正文
  LIST: 目录路径                     → 列出目录
  READ: 文件路径                     → 读取文件
  FIND: 目录 | 关键词                → 搜索文件
  WRITE: 文件路径 ||| 内容            → 写文件（会先问用户）
  DELETE: 文件路径                   → 删除（会先问用户）
  RUN: 命令                          → 执行命令（会先问用户）
  PLAN: 步骤一 | 步骤二 | 步骤三      → 把计划展示给用户
不需要任何能力时，正常回答即可。`;

const FALLBACK_CMD_RE = /^\s*(SEARCH|FETCH|LIST|READ|FIND|WRITE|DELETE|RUN|PLAN)\s*:\s*([\s\S]+)$/i;

function parseFallbackCommand(text) {
  const m = FALLBACK_CMD_RE.exec(String(text || '').trim());
  if (!m) return null;
  const kind = m[1].toUpperCase();
  const rest = m[2].trim();
  if (kind === 'SEARCH') return { name: 'web_search', args: { query: rest } };
  if (kind === 'FETCH') return { name: 'web_fetch', args: { url: rest } };
  if (kind === 'LIST') return { name: 'list_dir', args: { path: rest } };
  if (kind === 'READ') return { name: 'read_file', args: { path: rest } };
  if (kind === 'FIND') { const [root, kw] = rest.split('|').map((s) => s.trim()); return { name: 'search_files', args: { root, keyword: kw || '' } }; }
  if (kind === 'WRITE') { const [p, c] = rest.split('|||').map((s) => (s || '').trim()); return { name: 'write_file', args: { path: p, content: c || '' } }; }
  if (kind === 'DELETE') return { name: 'delete_path', args: { path: rest } };
  if (kind === 'RUN') return { name: 'run_command', args: { command: rest } };
  if (kind === 'PLAN') {
    const steps = rest.split(/\s*\|\s*|\s*\n\s*/).map((s) => s.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
    return { name: 'set_plan', args: { steps } };
  }
  return null;
}

/* ==================================================================
 * 文件读取
 * ================================================================== */
function lazyRequire(name) {
  return require(name);
}

function clipText(text, limit) {
  if (typeof text !== 'string') return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n……（内容过长，已截取前 ${limit} 个字符）`;
}

async function readFileContent(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let text = '';

  // 先看大小和类型再读。原来是直接 readFileSync 全文进内存，
  // 一个几 GB 的日志/视频被当成文本读进来，整个应用会当场崩掉。
  try {
    const st = await fs.promises.stat(filePath);
    if (st.isDirectory()) return '（这是一个目录，不是文件）';
    if (st.size > MAX_READ_BYTES) {
      return `（文件过大：${(st.size / 1024 / 1024).toFixed(1)}MB，超过 ${MAX_READ_BYTES / 1024 / 1024}MB 上限，未读取）`;
    }
  } catch (e) {
    throw new Error(`无法访问文件：${(e && e.message) || e}`);
  }

  if (ext === '.docx') {
    const mammoth = lazyRequire('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    text = result.value;
  } else if (['.xlsx', '.xls', '.csv'].includes(ext)) {
    const XLSX = lazyRequire('xlsx');
    const workbook = XLSX.readFile(filePath, { cellDates: true });
    text = workbook.SheetNames
      .map((sheetName) => `【工作表：${sheetName}】\n${XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName])}`)
      .join('\n\n');
  } else if (ext === '.pdf') {
    const { PDFParse } = lazyRequire('pdf-parse');
    const dataBuffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: new Uint8Array(dataBuffer) });
    try {
      const result = await parser.getText();
      text = (result && result.text) || '';
      if (!text.trim() && Array.isArray(result && result.pages)) {
        text = result.pages.map((p) => p && p.text ? p.text : '').join('\n');
      }
    } finally {
      await parser.destroy().catch(() => {});
    }
    if (!text.trim()) text = '（这个 PDF 没有可提取的文字层，可能是扫描件或纯图片）';
  } else {
    text = fs.readFileSync(filePath, 'utf-8');
  }

  return clipText(text, MAX_ATTACHMENT_CHARS);
}

/* ==================================================================
 * 文件夹展开（拖进来的目录）
 *
 * 目录不能直接读成文本，所以展开成两样东西：
 *   1) 目录树 —— 让模型知道项目长什么样
 *   2) 关键文件内容 —— 按「先浅后小」挑一批文本文件塞进去
 * 同样是异步遍历 + 双预算（节点数 / 时间），别在大目录里跑没完。
 * ================================================================== */
const DIR_SKIP_NAMES = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', '.next', '.nuxt',
  '.venv', 'venv', 'env', '__pycache__', '.idea', '.vscode', '.cache', '.gradle',
  'coverage', '.pytest_cache', '.mypy_cache', 'target', 'bin', 'obj',
]);
const DIR_TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.json', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx',
  '.py', '.html', '.htm', '.css', '.scss', '.less', '.java', '.c', '.h', '.cpp', '.hpp',
  '.go', '.rs', '.rb', '.php', '.sh', '.bash', '.yml', '.yaml', '.toml', '.ini', '.cfg',
  '.csv', '.xml', '.sql', '.vue', '.svelte', '.swift', '.kt', '.gradle', '.env',
]);
const DIR_MAX_NODES = 6000;          // 遍历节点上限
const DIR_MAX_DEPTH = 8;             // 递归深度上限
const DIR_TIME_BUDGET_MS = 10000;    // 遍历时间上限
const DIR_MAX_TREE_LINES = 400;      // 目录树最多列多少行
const DIR_DEFAULT_FILES = 40;        // 默认附带多少个文件的正文
const DIR_DEFAULT_CHARS = 120000;    // 目录摘要总字数上限

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function collectDirEntries(root, opts = {}) {
  const maxNodes = Number(opts.maxNodes) || DIR_MAX_NODES;
  const maxDepth = Number(opts.maxDepth) || DIR_MAX_DEPTH;
  const deadline = Date.now() + (Number(opts.timeBudget) || DIR_TIME_BUDGET_MS);

  const files = [];
  const dirs = [];
  let nodes = 0;
  let truncated = false;
  let skippedDirs = 0;

  async function walk(absDir, relDir, depth) {
    if (depth > maxDepth || nodes > maxNodes || Date.now() > deadline) { truncated = true; return; }
    let entries = [];
    try { entries = await fs.promises.readdir(absDir, { withFileTypes: true }); } catch (e) { return; }
    if (relDir) dirs.push(relDir);

    // 目录名升序，输出稳定；噪音目录单独记一笔，让用户知道为什么少东西
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (nodes > maxNodes || Date.now() > deadline) { truncated = true; return; }
      nodes += 1;
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      const abs = path.join(absDir, ent.name);
      if (ent.isDirectory()) {
        if (DIR_SKIP_NAMES.has(ent.name) || ent.name.startsWith('.')) { skippedDirs += 1; continue; }
        await walk(abs, rel, depth + 1);
      } else if (ent.isFile()) {
        let size = 0;
        try { size = (await fs.promises.stat(abs)).size; } catch (e) { size = 0; }
        files.push({ rel, abs, size });
      }
    }
  }

  await walk(root, '', 0);
  return { files, dirs, truncated, skippedDirs, nodes };
}

async function buildDirectoryBrief(dirPath, opts = {}) {
  const maxFiles = Math.max(1, Number(opts.maxFiles) || DIR_DEFAULT_FILES);
  const maxChars = Math.max(2000, Number(opts.maxChars) || DIR_DEFAULT_CHARS);
  const { files, dirs, truncated, skippedDirs } = await collectDirEntries(dirPath, opts);

  const totalBytes = files.reduce((n, f) => n + f.size, 0);

  /* --- 目录树 --- */
  const lines = [];
  dirs.slice().sort().forEach((d) => lines.push(`${d}/`));
  files.slice().sort((a, b) => a.rel.localeCompare(b.rel))
    .forEach((f) => lines.push(`${f.rel}  (${fmtSize(f.size)})`));
  const treeLines = lines.slice(0, DIR_MAX_TREE_LINES);
  const treeTruncated = lines.length > treeLines.length;

  /* --- 挑一批文本文件读正文：先浅（层级少）后小 --- */
  const candidates = files
    .filter((f) => DIR_TEXT_EXT.has(path.extname(f.rel).toLowerCase()))
    .filter((f) => f.size > 0 && f.size <= MAX_TOOL_READ_BYTES)
    .sort((a, b) => (a.rel.split('/').length - b.rel.split('/').length) || (a.size - b.size));

  const picked = [];
  let used = 0;
  for (const f of candidates) {
    if (picked.length >= maxFiles) break;
    if (used + f.size > maxChars) break;
    let text = '';
    try { text = await readFileContent(f.abs); } catch (e) { continue; }
    if (!text.trim()) continue;
    if (used + text.length > maxChars) break;
    picked.push({ rel: f.rel, text });
    used += text.length;
  }

  const head = [
    `这是一个目录：${dirPath}`,
    `文件 ${files.length} 个 · 子目录 ${dirs.length} 个 · 合计 ${fmtSize(totalBytes)}`,
    skippedDirs ? `（已跳过 ${skippedDirs} 个依赖/构建/隐藏目录：node_modules、.git、dist 等）` : '',
    (truncated || treeTruncated) ? `（目录过大，只展示前 ${treeLines.length} 项）` : '',
    '',
    '【目录结构】',
  ].filter(Boolean).join('\n');

  const body = picked.map((f) => `\n【文件：${f.rel}】\n${f.text}`).join('\n');
  const tail = picked.length < candidates.length
    ? `\n\n（还有 ${candidates.length - picked.length} 个文本文件未展开，需要哪个请单独 read_file 读取其完整路径）`
    : '';

  return {
    content: `${head}\n${treeLines.join('\n')}\n${body}${tail}`,
    fileCount: files.length,
    dirCount: dirs.length,
    totalBytes,
    includedCount: picked.length,
    truncated: Boolean(truncated || treeTruncated),
  };
}

/* ==================================================================
 * 文件生成
 * ================================================================== */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mdToDocxParagraphs(content) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = lazyRequire('docx');
  const lines = content.split('\n');
  const paragraphs = [];
  let inCode = false;
  let codeBuffer = [];

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: codeBuffer.join('\n'), font: 'Consolas', size: 20 })],
          shading: { fill: 'F5F5F5' },
        }));
        codeBuffer = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuffer.push(line); continue; }
    if (line.startsWith('### ')) paragraphs.push(new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3 }));
    else if (line.startsWith('## ')) paragraphs.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2 }));
    else if (line.startsWith('# ')) paragraphs.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1 }));
    else if (line.match(/^[-*] /)) paragraphs.push(new Paragraph({ text: '• ' + line.slice(2) }));
    else if (line.match(/^\d+\. /)) paragraphs.push(new Paragraph({ text: line }));
    else if (line.trim() === '') paragraphs.push(new Paragraph({ text: '' }));
    else paragraphs.push(new Paragraph({ children: [new TextRun(line)] }));
  }
  return { Document, Packer, paragraphs };
}

function parseTable(content) {
  const lines = content.split('\n').filter((l) => l.trim());
  const rows = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (trimmed.match(/^\|[\s\-:|]+\|$/)) continue;
      rows.push(trimmed.slice(1, -1).split('|').map((c) => c.trim()));
    } else if (trimmed.includes(',')) {
      rows.push(trimmed.split(',').map((c) => c.trim()));
    } else {
      rows.push([trimmed]);
    }
  }
  return rows;
}

async function generatePptx(filePath, content) {
  const PptxGenJS = lazyRequire('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  const chunks = content.split(/\n(?=# )|\n---+\n/).filter((c) => c.trim());

  if (chunks.length === 0) {
    const slide = pptx.addSlide();
    slide.addText(content, { x: 0.5, y: 0.5, w: 9, h: 5, fontSize: 16 });
  } else {
    chunks.forEach((chunk) => {
      const lines = chunk.trim().split('\n');
      const slide = pptx.addSlide();
      const title = lines[0].replace(/^#+\s*/, '').trim();
      const body = lines.slice(1).join('\n').trim();
      slide.addText(title || '未命名', { x: 0.5, y: 0.4, w: 9, h: 1, fontSize: 28, bold: true, color: '1F2937' });
      if (body) {
        slide.addText(body, { x: 0.5, y: 1.6, w: 9, h: 4, fontSize: 16, color: '4B5563', valign: 'top', lineSpacingMultiple: 1.4 });
      }
    });
  }
  await pptx.writeFile({ fileName: filePath });
}

/* 生成 PDF 用：先转义再解析，避免 AI 输出里的标签被当成 HTML */
function mdToHtml(md) {
  let html = escapeHtml(md);
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => `<pre><code>${code.replace(/^\n/, '')}</code></pre>`);
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  html = html.split(/\n{2,}/).map((block) => {
    const t = block.trim();
    if (!t) return '';
    if (/^<(h[1-6]|ul|pre)/.test(t)) return t;
    return `<p>${t.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return html;
}

async function generatePDF(filePath, content) {
  const htmlContent = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; padding: 32px; line-height: 1.8; color: #1f2937; font-size: 14px; }
  h1 { font-size: 24px; border-bottom: 2px solid #4d6bfe; padding-bottom: 8px; margin: 20px 0 12px; }
  h2 { font-size: 20px; margin: 16px 0 10px; }
  h3 { font-size: 16px; margin: 12px 0 8px; }
  pre { background: #f5f5f5; padding: 12px; border-radius: 6px; white-space: pre-wrap; }
  code { font-family: Consolas, monospace; font-size: 13px; }
  ul { padding-left: 22px; }
  li { margin: 4px 0; }
</style></head><body>${mdToHtml(content)}</body></html>`;

  const tmpFile = path.join(app.getPath('temp'), `gen_${Date.now()}.html`);
  fs.writeFileSync(tmpFile, htmlContent, 'utf-8');

  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadFile(tmpFile);
    const pdfData = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'default' },
    });
    fs.writeFileSync(filePath, pdfData);
  } finally {
    win.close();
    try { fs.unlinkSync(tmpFile); } catch (e) { /* 清理失败可忽略 */ }
  }
}

async function generateFile(filePath, content) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx') {
    const { Document, Packer, paragraphs } = mdToDocxParagraphs(content);
    const doc = new Document({ sections: [{ children: paragraphs }] });
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);
    return;
  }
  if (ext === '.xlsx') {
    const XLSX = lazyRequire('xlsx');
    const ws = XLSX.utils.aoa_to_sheet(parseTable(content));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, filePath);
    return;
  }
  if (ext === '.pptx') { await generatePptx(filePath, content); return; }
  if (ext === '.pdf') { await generatePDF(filePath, content); return; }
  fs.writeFileSync(filePath, content, 'utf-8');
}

/* ==================================================================
 * 窗口
 * ================================================================== */
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 540,
    title: '我的 AI 助手',
    autoHideMenuBar: true,
    backgroundColor: '#f7f8fa',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // 禁止页面内跳转，外链交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* ==================================================================
 * IPC
 * ================================================================== */
/* 工具自己的密钥（搜索服务等），和 AI 密钥一样加密存 */
function setToolKey(name, value) {
  const cfg = getConfig();
  if (!cfg.toolKeys) cfg.toolKeys = {};
  const v = String(value || '').trim();
  if (!v) delete cfg.toolKeys[name];
  else cfg.toolKeys[name] = encryptSecret(v);
  saveConfig();
}

function getToolKey(name) {
  const cfg = getConfig();
  const entry = cfg.toolKeys && cfg.toolKeys[name];
  if (!entry) return '';
  try {
    return decryptSecret(entry) || '';
  } catch (e) {
    return '';
  }
}

/* 密钥末尾几位，用来在界面上证明「这把 key 真的存住了」，不暴露完整密钥 */
function keyTailOf(providerId) {
  const entry = getConfig().keys[providerId];
  if (!entry) return '';
  try {
    const plain = decryptSecret(entry);
    return plain ? plain.slice(-4) : '';
  } catch (e) {
    return '✗';   // 存得住但解不开，界面据此提示重填
  }
}

ipcMain.handle('config:get', () => {
  const cfg = getConfig();
  return {
    providers: Object.values(PROVIDERS).map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      color: p.color,
      model: (cfg.prefs.modelOverrides && cfg.prefs.modelOverrides[p.id]) || p.model,
      models: p.models,
      allowCustomModel: Boolean(p.allowCustomModel),
      optionalKey: Boolean(p.optionalKey),
      hasKey: Boolean(cfg.keys[p.id]),
      configured: Boolean(cfg.keys[p.id]) || Boolean(p.optionalKey),
      keyTail: keyTailOf(p.id),
      thinkingSupported: Boolean(p.thinkingSupported),
      keyUrl: p.keyUrl,
      keyHint: p.keyHint,
      balanceSupported: Boolean(p.balance),
      encrypted: safeStorage.isEncryptionAvailable(),
    })),
    prefs: cfg.prefs,
  };
});

/* ==================================================================
 * 余额查询
 * 只有官方开放了余额接口的才去查；其余的一律不去猜
 * （智谱的余额接口是内部抓包地址、火山和阿里要控制台鉴权，都不稳定，宁缺毋错）
 * ================================================================== */
const BALANCE_TIMEOUT_MS = 8000;

async function fetchProviderBalance(p) {
  const base = { id: p.id, name: p.name, color: p.color, supported: Boolean(p.balance) };
  let key = '';
  try {
    key = getApiKey(p.id);
  } catch (e) {
    return Object.assign(base, { ok: false, error: '密钥解不开，请重新填写' });
  }
  if (!key) return Object.assign(base, { ok: false, supported: false, error: '未配置密钥' });
  if (!p.balance) return Object.assign(base, { ok: false, supported: false, error: '该平台无公开余额接口' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BALANCE_TIMEOUT_MS);
  try {
    const res = await fetch(p.balance.url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 120);
      try {
        const j = JSON.parse(text);
        detail = (j.error && (j.error.message || j.error.code)) || j.message || detail;
      } catch (e) { /* 不是 JSON 就用原文 */ }
      throw new Error(`HTTP ${res.status} ${detail}`);
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error('返回的不是 JSON');
    }
    const accounts = p.balance.parse(json);
    return Object.assign(base, { ok: true, accounts });
  } catch (e) {
    return Object.assign(base, { ok: false, error: (e && e.message) || '查询失败' });
  } finally {
    clearTimeout(timer);
  }
}

/* provider 传了就只查这一家，不传就查全部 */
ipcMain.handle('balance:fetch', async (_e, { provider } = {}) => {
  const targets = provider
    ? (PROVIDERS[provider] ? [PROVIDERS[provider]] : [])
    : Object.values(PROVIDERS);
  const list = await Promise.all(targets.map(fetchProviderBalance));
  return { items: list, fetchedAt: Date.now() };
});

ipcMain.handle('config:set-key', (_e, { provider, key }) => {
  if (!PROVIDERS[provider]) return { success: false, error: '未知的 AI 服务' };
  const value = String(key || '').trim();
  if (!value) return { success: false, error: '密钥不能为空' };
  const cfg = getConfig();
  cfg.keys[provider] = encryptSecret(value);
  saveConfig();
  return { success: true };
});

ipcMain.handle('config:remove-key', (_e, { provider }) => {
  const cfg = getConfig();
  delete cfg.keys[provider];
  saveConfig();
  return { success: true };
});

ipcMain.handle('config:set-prefs', (_e, prefs) => {
  const cfg = getConfig();
  if (prefs && typeof prefs === 'object') {
    cfg.prefs = Object.assign(cfg.prefs, prefs);
    saveConfig();
  }
  return { success: true, prefs: cfg.prefs };
});

ipcMain.handle('tools:get', () => {
  const cfg = getConfig();
  const t = (cfg.prefs && cfg.prefs.tools) || {};
  return {
    prefs: { enabled: Boolean(t.enabled), allowCommand: Boolean(t.allowCommand), searchProvider: t.searchProvider || 'ddg' },
    searchKeyTail: getToolKey('search').slice(-4),
    log: toolLog.slice(0, 40),
  };
});

ipcMain.handle('tools:set-prefs', (_e, patch) => {
  const cfg = getConfig();
  cfg.prefs.tools = Object.assign({ enabled: false, allowCommand: false, searchProvider: 'ddg' }, cfg.prefs.tools || {}, patch || {});
  saveConfig();
  return { success: true, prefs: cfg.prefs.tools };
});

ipcMain.handle('tools:set-search-key', (_e, { key }) => {
  setToolKey('search', key);
  return { success: true };
});

/* 多 AI 模式下每个角色（总指挥 + 各个专家）也都要能用工具。
 * 和 ai:stream 走同一套 runAgent，只是不流式吐字；
 * 传了 reqId 就把工具过程实时推给渲染层，最终返回里也带 tools 步骤。 */
ipcMain.handle('ai:once', async (event, { provider: providerId, messages, model, temperature, maxTokens, thinking, reqId, agent, workDir, autoApprove }) => {
  if (!PROVIDERS[providerId]) throw new Error('未知的 AI 服务');
  if (!Array.isArray(messages)) throw new Error('消息格式不正确');

  const baseMessages = messages.map((m) => ({ role: m.role, content: String(m.content || '') }));
  const onEvent = reqId && event && event.sender && !event.sender.isDestroyed()
    ? (payload) => event.sender.send(`ai:chunk:${reqId}`, payload)
    : null;

  // 跟随总开关：用户关了就不给任何工具。
  // 之前这里写死 useTools: true，等于「设置里的开关对多 AI 完全无效」。
  try {
    return await runAgent(providerId, baseMessages, {
      model, temperature, maxTokens, thinking: Boolean(thinking), useTools: toolsEnabled(),
      agent: Boolean(agent), workDir: String(workDir || ''), autoApprove: Boolean(autoApprove),
    }, reqId || null, onEvent);
  } catch (e) {
    // 中止不当错误抛：渲染层据此区分「用户主动停」和「真出错」
    if (isAbortError(e)) return { content: '', reasoning: '', usage: null, tools: [], aborted: true };
    throw e;
  }
});

ipcMain.handle('ai:stream', async (event, { reqId, provider: providerId, messages, model, temperature, maxTokens, thinking, agent, workDir, autoApprove }) => {
  if (!reqId) throw new Error('缺少请求 ID');
  if (!PROVIDERS[providerId]) throw new Error('未知的 AI 服务');
  if (!Array.isArray(messages)) throw new Error('消息格式不正确');

  const baseMessages = messages.map((m) => ({ role: m.role, content: String(m.content || '') }));
  const send = (payload) => {
    if (!event.sender.isDestroyed()) event.sender.send(`ai:chunk:${reqId}`, payload);
  };

  try {
    const result = await runAgent(providerId, baseMessages,
      { model, temperature, maxTokens, thinking, stream: true, useTools: toolsEnabled(),
        agent: Boolean(agent), workDir: String(workDir || ''), autoApprove: Boolean(autoApprove) }, reqId, send);
    send({ type: 'done' });
    return { success: true, ...result };
  } catch (e) {
    const aborted = isAbortError(e);
    const message = aborted ? '已停止生成' : (e.message || '请求失败');
    send({ type: 'error', text: message });
    return { success: false, error: message, aborted };
  }
});

ipcMain.handle('ai:abort', (_e, { reqId }) => {
  // 同一个 reqId 下可能挂着多个请求（多 AI 并行），要全部停掉
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
  return { success: true, aborted };
});

ipcMain.handle('sessions:load', () => readJson(dataFile('sessions.json'), []));

ipcMain.handle('sessions:save', (_e, sessions) => {
  if (!Array.isArray(sessions)) return { success: false };
  writeJsonAtomic(dataFile('sessions.json'), sessions);
  return { success: true };
});

/* 关窗口时渲染层走 beforeunload，异步 invoke 来不及落盘（进程已经走了）。
 * 这条同步通道专门给「最后一刻保存」用，会短暂阻塞渲染进程，只在退出时调一次。 */
ipcMain.on('sessions:save-sync', (event, sessions) => {
  try {
    if (!Array.isArray(sessions)) {
      event.returnValue = { success: false, error: '数据格式不对' };
      return;
    }
    writeJsonAtomic(dataFile('sessions.json'), sessions);
    event.returnValue = { success: true };
  } catch (e) {
    event.returnValue = { success: false, error: (e && e.message) || '保存失败' };
  }
});

ipcMain.handle('file:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow || BrowserWindow.getFocusedWindow(), {
    properties: ['openFile'],
    filters: [
      { name: '办公文档', extensions: ['docx', 'pdf', 'txt', 'md', 'xlsx', 'xls', 'csv'] },
      { name: '代码文件', extensions: ['js', 'py', 'html', 'css', 'java', 'cpp', 'c', 'ts', 'json', 'xml', 'yml', 'yaml'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return { success: false };
  try {
    const filePath = result.filePaths[0];
    return { success: true, path: filePath, name: path.basename(filePath), content: await readFileContent(filePath) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('file:read', async (_e, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return { success: false, error: '路径无效' };
  try {
    return { success: true, path: filePath, name: path.basename(filePath), content: await readFileContent(filePath) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

/* 拖拽 / 附件的统一入口。文件和目录都从这里进，
 * 目录会被展开成「目录树 + 关键文件内容」，直接读会返回「这是个目录」，等于白拖。 */
ipcMain.handle('file:ingest', async (_e, payload) => {
  const filePath = payload && payload.path;
  if (typeof filePath !== 'string' || !filePath) return { success: false, error: '路径无效' };
  try {
    const st = await fs.promises.stat(filePath);
    if (st.isDirectory()) {
      const brief = await buildDirectoryBrief(filePath, {
        maxFiles: payload && payload.maxFiles,
        maxChars: payload && payload.maxChars,
      });
      return {
        success: true,
        isDir: true,
        path: filePath,
        name: path.basename(filePath) || filePath,
        content: brief.content,
        size: brief.totalBytes,
        fileCount: brief.fileCount,
        dirCount: brief.dirCount,
        includedCount: brief.includedCount,
        truncated: brief.truncated,
      };
    }
    return {
      success: true,
      isDir: false,
      path: filePath,
      name: path.basename(filePath),
      content: await readFileContent(filePath),
      size: st.size,
      fileCount: 1,
    };
  } catch (e) {
    return { success: false, error: (e && e.message) || '读取失败' };
  }
});

ipcMain.handle('file:pick-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow || BrowserWindow.getFocusedWindow(), {
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return { success: false, canceled: true };
  return { success: true, path: result.filePaths[0] };
});

ipcMain.handle('file:save', async (_e, { defaultName, content }) => {
  const cfg = getConfig();
  const dir = cfg.prefs.saveDir || app.getPath('desktop');
  const result = await dialog.showSaveDialog(mainWindow || BrowserWindow.getFocusedWindow(), {
    defaultPath: path.join(dir, defaultName || 'untitled.txt'),
    filters: [
      { name: 'Word 文档', extensions: ['docx'] },
      { name: 'Excel 表格', extensions: ['xlsx'] },
      { name: 'PPT 演示', extensions: ['pptx'] },
      { name: 'PDF 文档', extensions: ['pdf'] },
      { name: 'Markdown', extensions: ['md'] },
      { name: '文本文件', extensions: ['txt'] },
      { name: 'CSV 表格', extensions: ['csv'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePath) return { success: false, canceled: true };
  try {
    await generateFile(result.filePath, content);
    cfg.prefs.saveDir = path.dirname(result.filePath);
    saveConfig();
    return { success: true, path: result.filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('file:auto-save', async (_e, { fileName, content }) => {
  try {
    const desktopPath = app.getPath('desktop');
    const safeName = String(fileName || 'untitled.txt').replace(/[\\/:*?"<>|]/g, '_');
    let finalPath = path.join(desktopPath, safeName);
    if (fs.existsSync(finalPath)) {
      const ext = path.extname(safeName);
      const base = path.basename(safeName, ext);
      let counter = 1;
      while (fs.existsSync(finalPath)) {
        finalPath = path.join(desktopPath, `${base}_${counter}${ext}`);
        counter += 1;
      }
    }
    await generateFile(finalPath, content);
    return { success: true, path: finalPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('file:open-in-system', async (_e, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return { success: false };
  const err = await shell.openPath(filePath);
  return { success: !err, error: err || '' };
});

ipcMain.handle('file:show-in-folder', (_e, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return { success: false };
  shell.showItemInFolder(filePath);
  return { success: true };
});

ipcMain.handle('app:open-external', (_e, url) => {
  if (typeof url === 'string' && /^https?:/i.test(url)) {
    shell.openExternal(url);
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  dataDir: app.getPath('userData'),
}));

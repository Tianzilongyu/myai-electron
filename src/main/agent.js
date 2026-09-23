'use strict';

/**
 * 工具调用主循环
 *
 * 能走标准 function calling 就走；哪家用不了（报 tools 参数不支持），
 * 自动降级成「模型发一行文本指令、我们解析后执行」，保证每家都有能力。
 */

const TOOL_MAX_ROUNDS = 8;          // 普通问答：单次提问最多来回几轮工具调用
const AGENT_MAX_ROUNDS = 40;        // 研发模式：自己干活要更多轮，不然项目写到一半就断了

/** 同一个工具的 running -> done 只合并成一条记录，界面上就不会重复堆叠 */
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

function createAgentRunner({
  providers,
  aiClient,
  executeTool,
  TOOL_DEFS,
  AGENT_TOOL_DEFS,
  TOOLS_SYSTEM_HINT,
  AGENT_SYSTEM_HINT,
  FALLBACK_TOOL_HINT,
  parseFallbackCommand,
  looksLikeToolsUnsupported,
  getExtraToolDefs,
}) {
  async function runAgent(providerId, userMessages, opts = {}, reqId = null, onEvent = null) {
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

    let toolsOk = opts.useTools && providers[providerId].tools !== false;
    let fallbackMode = false;
    let answer = { content: '', reasoning: '' };
    let lastRes = null;                  // 最后一轮的原始输出，兜底用

    // 研发模式：工具来回轮次大幅放开（普通问答 8 轮够了，自己干活 8 轮不够塞牙缝）
    const agentMode = Boolean(opts.agent);
    const maxRounds = agentMode ? AGENT_MAX_ROUNDS : TOOL_MAX_ROUNDS;
    const baseDefs = agentMode ? AGENT_TOOL_DEFS : TOOL_DEFS;
    // MCP 工具在每次请求时动态取，新增/重连的服务器下一轮就生效
    const toolDefs = baseDefs.concat(getExtraToolDefs ? getExtraToolDefs() : []);
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

    const addUsage = (res) => {
      if (!res || !res.usage) return;
      usageAcc.prompt += res.usage.prompt || 0;
      usageAcc.completion += res.usage.completion || 0;
      usageAcc.total += res.usage.total || 0;
    };

    for (let round = 0; round < maxRounds; round++) {
      const isLast = round === maxRounds - 1;
      const sendTools = toolsOk && !fallbackMode && !isLast;

      let body = aiClient.buildChatBody(providerId, msgs, Object.assign({}, opts, { tools: sendTools ? toolDefs : null }));

      let res;
      try {
        res = await aiClient.aiFetch(providerId, body, reqId, track);
      } catch (e) {
        // 这家不认 tools 参数 -> 降级重来一次
        if (sendTools && looksLikeToolsUnsupported(e && e.message)) {
          toolsOk = false;
          fallbackMode = true;
          msgs.push({ role: 'system', content: FALLBACK_TOOL_HINT });
          body = aiClient.buildChatBody(providerId, msgs, Object.assign({}, opts, { tools: null }));
          res = await aiClient.aiFetch(providerId, body, reqId, track);
        } else {
          throw e;
        }
      }

      addUsage(res);
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
        const res = await aiClient.aiFetch(providerId, aiClient.buildChatBody(providerId, msgs, Object.assign({}, opts, { tools: null })), reqId, track);
        addUsage(res);
        answer = { content: res.content || '', reasoning: res.reasoning || '' };
      } catch (e) { /* 总结失败就退回最后一次输出，下面还有一道兜底 */ }
    }

    // 兜底：万一所有轮次全耗在工具调用上、最后一轮没落定答案，退回最后一次输出，
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

  return { runAgent };
}

module.exports = { createAgentRunner, mergeToolStep, TOOL_MAX_ROUNDS, AGENT_MAX_ROUNDS };

;(function (global) {
  'use strict';

  /** 一次性 AI 调用（多 AI 的每个角色、自动起标题都走这里） */
  const App = (global.App = global.App || {});

  async function callOnce(providerId, messages, options = {}) {
    const result = await App.bridge.api.ai.once({
      provider: providerId,
      messages,
      model: options.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      thinking: options.thinking,
      reqId: options.reqId || null,      // 传了就能实时收到工具过程
    });
    return {
      content: (result && result.content) || '',
      usage: (result && result.usage) || null,
      tools: (result && result.tools) || [],
      aborted: Boolean(result && result.aborted),
    };
  }

  async function callOnceWithRetry(providerId, messages, options = {}, retries = 1) {
    try {
      const res = await callOnce(providerId, messages, options);
      // 用户按了停止就别再重试了 —— 否则「停止」之后还会偷偷重跑一次
      return res;
    } catch (e) {
      if (App.bridge.isAbort(e)) throw App.bridge.abortError();
      if (retries > 0) {
        await new Promise((r) => global.setTimeout(r, 800));
        return callOnceWithRetry(providerId, messages, options, retries - 1);
      }
      throw e;
    }
  }

  App.ai = { callOnce, callOnceWithRetry };
})(typeof globalThis !== 'undefined' ? globalThis : this);

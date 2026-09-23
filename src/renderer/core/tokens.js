;(function (global) {
  'use strict';

  /** Token 统计：服务商给了 usage 就用真实的，没给就按字符估算 */
  const App = (global.App = global.App || {});

  /* 服务商没返回 usage 时的兜底估算：中日韩字符按 1 token，其余按 4 字符 1 token */
  function estimateTokens(text) {
    const s = String(text || '');
    if (!s) return 0;
    const cjk = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff]/g) || []).length;
    return Math.ceil(cjk + (s.length - cjk) / 4);
  }

  function usageOf(usage, promptText, completionText) {
    if (usage && usage.total) {
      return { prompt: usage.prompt || 0, completion: usage.completion || 0, total: usage.total, exact: true };
    }
    const prompt = estimateTokens(promptText);
    const completion = estimateTokens(completionText);
    return { prompt, completion, total: prompt + completion, exact: false };
  }

  function fmtTokens(n) {
    const v = Number(n) || 0;
    if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return String(v);
  }

  function emptyTokens() {
    return { prompt: 0, completion: 0, total: 0 };
  }

  function sessionTokens(session) {
    if (session && session.tokens) return session.tokens;
    const t = emptyTokens();
    if (session && Array.isArray(session.messages)) {
      session.messages.forEach((m) => {
        if (m && m.usage) {
          t.prompt += m.usage.prompt || 0;
          t.completion += m.usage.completion || 0;
          t.total += m.usage.total || 0;
        }
      });
    }
    return t;
  }

  function addSessionUsage(session, usage) {
    if (!session || !usage || !usage.total) return;
    if (!session.tokens) session.tokens = emptyTokens();
    session.tokens.prompt += usage.prompt || 0;
    session.tokens.completion += usage.completion || 0;
    session.tokens.total += usage.total || 0;
  }

  function updateTokenChip() {
    const dom = App.dom;
    if (!dom || !dom.tokenChipText) return;
    const t = sessionTokens(App.sessions.getActive());
    dom.tokenChipText.textContent = fmtTokens(t.total);
    dom.tokenChip.title = `本会话累计 ${t.total} tokens\n提示 ${t.prompt} · 补全 ${t.completion}\n点击查看明细`;
  }

  function buildTokenChip(usage) {
    if (!usage || !usage.total) return null;
    const el = global.document.createElement('div');
    el.className = 'msg-tokens';
    el.textContent = `提示 ${fmtTokens(usage.prompt)} · 补全 ${fmtTokens(usage.completion)}`
      + (usage.exact ? '' : '（估算）');
    el.title = usage.exact ? '服务商返回的实际用量' : '服务商未返回用量，这里按字符数估算';
    return el;
  }

  App.tokens = {
    estimateTokens,
    usageOf,
    fmtTokens,
    emptyTokens,
    sessionTokens,
    addSessionUsage,
    updateTokenChip,
    buildTokenChip,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

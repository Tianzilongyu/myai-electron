;(function (global) {
  'use strict';

  /**
   * 与主进程之间的桥
   *
   * 渲染层不持有任何密钥，也不接触 Node —— 一切都通过 preload 暴露的 window.api。
   * 这里统一做一次存在性检查，出问题给一句人话，而不是让后面每个调用各崩各的。
   */
  const App = (global.App = global.App || {});

  const api = global.api || null;

  App.bridge = {
    api,
    available: () => Boolean(api),
    fatalMessage: '预加载脚本未生效，请检查 preload.js 是否存在。',
  };

  /* 中止错误：单独一种类型，走到最上层时不再弹错误框 */
  function abortError() {
    const e = new Error('已停止生成');
    e.isAbort = true;
    return e;
  }

  function isAbort(e) {
    return Boolean(e && (e.isAbort === true
      || e.name === 'AbortError'
      || /已停止生成|aborted/i.test(String((e && e.message) || ''))));
  }

  App.bridge.abortError = abortError;
  App.bridge.isAbort = isAbort;
})(typeof globalThis !== 'undefined' ? globalThis : this);

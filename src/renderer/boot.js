;(function (global) {
  'use strict';
  /* 唯一的一句「启动」：所有模块都挂好了才跑。
   * 单独成文件是因为 CSP 里 script-src 'self' 不允许内联脚本。 */
  const App = global.App;
  if (App && App.app && typeof App.app.start === 'function') App.app.start();
})(typeof globalThis !== 'undefined' ? globalThis : this);

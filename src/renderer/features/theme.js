;(function (global) {
  'use strict';

  /**
   * 主题：浅色 / 深色 / 跟随系统
   *
   * 只在 <html> 上打一个 data-theme 标记，样式全部由 style.css 里
   * [data-theme="dark"] 的覆盖块承担，逻辑和样式彻底分开。
   */
  const App = (global.App = global.App || {});

  function systemPrefersDark() {
    try {
      return Boolean(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (e) {
      return false;
    }
  }

  function resolvedTheme() {
    const t = (App.state.prefs && App.state.prefs.theme) || 'system';
    if (t === 'dark') return 'dark';
    if (t === 'light') return 'light';
    return systemPrefersDark() ? 'dark' : 'light';
  }

  function apply() {
    const el = global.document && global.document.documentElement;
    if (el) el.setAttribute('data-theme', resolvedTheme());
  }

  function setTheme(value) {
    const v = value === 'dark' || value === 'light' ? value : 'system';
    App.sessions.savePrefs({ theme: v });
    apply();
  }

  /* 跟随系统时，系统切了深色/浅色，这里跟着变 */
  function bindSystemChange() {
    try {
      const mq = global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)');
      if (mq && typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', () => {
          const t = App.state.prefs && App.state.prefs.theme;
          if (!t || t === 'system') apply();
        });
      }
    } catch (e) { /* 环境不支持就算了 */ }
  }

  App.theme = { apply, setTheme, resolvedTheme, systemPrefersDark, bindSystemChange };
})(typeof globalThis !== 'undefined' ? globalThis : this);

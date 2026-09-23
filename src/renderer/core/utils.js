;(function (global) {
  'use strict';

  /** 无依赖的小工具：转义、提示、时间、体积、防抖节流 */
  const App = (global.App = global.App || {});

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const SAFE_URL_RE = /^(https?:\/\/|mailto:|tel:)/i;

  function sanitizeUrl(url) {
    const trimmed = String(url || '').trim();
    return SAFE_URL_RE.test(trimmed) ? trimmed : null;
  }

  /** 轻提示（替代 alert） */
  function toast(text, type = 'info', duration = 3200) {
    const wrap = App.dom && App.dom.toastWrap;
    if (!wrap) return;
    const el = global.document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = text;
    wrap.appendChild(el);
    global.requestAnimationFrame(() => el.classList.add('show'));
    global.setTimeout(() => {
      el.classList.remove('show');
      global.setTimeout(() => el.remove(), 220);
    }, duration);
  }

  function isToday(ts) {
    const d = new Date(ts || Date.now());
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }

  function formatTime(ts) {
    const d = new Date(ts || Date.now());
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (isToday(ts)) return hhmm;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm}`;
  }

  function hhmmOf(ts) {
    const t = new Date(ts || Date.now());
    return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  }

  /** 相对时间：刚刚 / N 分钟前 / 今天 HH:mm / 昨天 / M月D日 */
  function relativeTime(ts) {
    const t = Number(ts) || Date.now();
    const diff = Date.now() - t;
    if (diff < 0) return formatTime(t);
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (isToday(t)) return hhmmOf(t);
    if (diff < 172800000) return '昨天';
    return `${new Date(t).getMonth() + 1}月${new Date(t).getDate()}日`;
  }

  /** 完整日期时间，用作时间戳的悬浮提示 */
  function fullTime(ts) {
    const d = new Date(ts || Date.now());
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function fmtBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n <= 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  function getFileIcon(name) {
    const ext = String(name).split('.').pop().toLowerCase();
    if (['doc', 'docx'].includes(ext)) return '📘';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return '📗';
    if (['ppt', 'pptx'].includes(ext)) return '📙';
    if (ext === 'pdf') return '📕';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return '🖼️';
    if (['txt', 'md', 'log'].includes(ext)) return '📄';
    if (['js', 'py', 'html', 'css', 'java', 'cpp', 'c', 'ts', 'json'].includes(ext)) return '💻';
    return '📎';
  }

  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** 尾部防抖：连续触发只跑最后一次 */
  function debounce(fn, wait = 200) {
    let timer = null;
    return function debounced(...args) {
      const self = this;
      if (timer) global.clearTimeout(timer);
      timer = global.setTimeout(() => { timer = null; fn.apply(self, args); }, wait);
    };
  }

  /**
   * 时间节流（带尾帧）：高频回调最多每 wait 毫秒真正执行一次，
   * 并且保证最后一次一定会被执行 —— 流式渲染靠它避免「最后一帧丢掉」。
   */
  function throttleTrailing(fn, wait = 60) {
    let last = 0;
    let timer = null;
    return function throttled(...args) {
      const self = this;
      const now = Date.now();
      const remain = wait - (now - last);
      if (remain <= 0) {
        if (timer) { global.clearTimeout(timer); timer = null; }
        last = now;
        fn.apply(self, args);
        return;
      }
      if (!timer) {
        timer = global.setTimeout(() => {
          timer = null;
          last = Date.now();
          fn.apply(self, args);
        }, remain);
      }
    };
  }

  /** 让 textarea 跟着内容长高，但不超过 maxHeight */
  function autoGrowEl(el, maxHeight = 260) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }

  App.utils = {
    escapeHtml,
    sanitizeUrl,
    toast,
    isToday,
    formatTime,
    hhmmOf,
    relativeTime,
    fullTime,
    fmtBytes,
    getFileIcon,
    genId,
    debounce,
    throttleTrailing,
    autoGrowEl,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

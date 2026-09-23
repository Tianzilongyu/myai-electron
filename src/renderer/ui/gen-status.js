;(function (global) {
  'use strict';

  /** 生成中状态条：说清「现在在干什么、跑了多久、是不是停了」 */
  const App = (global.App = global.App || {});

  let genTimer = null;
  let genStartAt = 0;
  let genPhase = '';

  function fmtElapsed(ms) {
    const secs = ms / 1000;
    if (secs < 60) return `${secs.toFixed(1)} 秒`;
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m} 分 ${String(s).padStart(2, '0')} 秒`;
  }

  function renderGenStatus() {
    const el = App.dom.genStatus;
    if (!el) return;
    const elapsed = Date.now() - genStartAt;
    el.textContent = '';
    const dot = global.document.createElement('span');
    dot.className = 'gs-dot pulse';
    const phase = global.document.createElement('span');
    phase.textContent = genPhase;
    const time = global.document.createElement('span');
    time.className = 'gs-time';
    time.textContent = fmtElapsed(elapsed);
    el.append(dot, phase, time);
  }

  function show(phase) {
    const el = App.dom.genStatus;
    if (!el) return;
    genPhase = phase || '正在回答';
    genStartAt = Date.now();
    el.classList.remove('hidden', 'gs-stopped');
    renderGenStatus();
    if (genTimer) global.clearInterval(genTimer);
    genTimer = global.setInterval(renderGenStatus, 200);
  }

  function setPhase(phase) {
    if (!genPhase || genPhase === phase) return;
    genPhase = phase;
    const el = App.dom.genStatus;
    if (el && !el.classList.contains('hidden')) renderGenStatus();
  }

  function hide() {
    const el = App.dom.genStatus;
    if (genTimer) { global.clearInterval(genTimer); genTimer = null; }
    if (!el) return;
    el.classList.add('hidden');
    el.classList.remove('gs-stopped');
  }

  function stopped() {
    const el = App.dom.genStatus;
    if (genTimer) { global.clearInterval(genTimer); genTimer = null; }
    if (!el) return;
    el.classList.add('gs-stopped');
    el.classList.remove('hidden');
    el.textContent = '';
    const dot = global.document.createElement('span');
    dot.className = 'gs-dot';
    const t = global.document.createElement('span');
    t.textContent = `已停止 · 用时 ${fmtElapsed(Date.now() - genStartAt)}`;
    el.append(dot, t);
    global.setTimeout(() => { if (!App.state.isGenerating) hide(); }, 3000);
  }

  App.genStatus = { show, setPhase, hide, stopped, fmtElapsed };
})(typeof globalThis !== 'undefined' ? globalThis : this);

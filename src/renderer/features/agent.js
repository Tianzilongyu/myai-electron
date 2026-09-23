;(function (global) {
  'use strict';

  /**
   * 研发模式：让 AI 自己把一个任务做完
   *
   * 三件套：模式开关 + 工作目录 + 自动批准。
   * 自动批准只在「工作目录内」生效，目录外照旧弹窗 —— 主进程那边也是这么判的，
   * 两边一致，别让这个开关变成一张空白支票。
   */
  const App = (global.App = global.App || {});

  function apply() {
    const s = App.state;
    const dom = App.dom;
    dom.agentToggle.classList.toggle('active', s.agentMode);
    dom.agentToggle.title = s.agentMode
      ? '研发模式已开启：AI 会自己勘察 → 计划 → 改代码 → 跑验证（点击关闭）'
      : '研发模式：让 AI 自己勘察、计划、写代码、跑验证，把任务做完';
    dom.agentBar.classList.toggle('hidden', !s.agentMode);
    dom.agentDirText.textContent = s.agentWorkDir || '未选择';
    dom.agentDirText.title = s.agentWorkDir || '未选择（AI 不知道该在哪干活，建议选一个）';
    dom.agentDirText.classList.toggle('empty', !s.agentWorkDir);
    dom.agentDirClear.classList.toggle('hidden', !s.agentWorkDir);
    dom.agentAutoBtn.classList.toggle('hidden', !s.agentWorkDir);
    dom.agentAutoBtn.textContent = s.agentAutoApprove ? '自动批准：开' : '自动批准：关';
    dom.agentAutoBtn.classList.toggle('on', s.agentAutoApprove);
    dom.agentAutoBtn.title = s.agentAutoApprove
      ? '工作目录内的写/删/跑命令不再逐个弹窗；目录外仍然会问'
      : '每次写文件 / 删除 / 跑命令都会先弹窗问你';
    App.sessions.updateContextMeter();
  }

  function setMode(on) {
    const s = App.state;
    s.agentMode = Boolean(on);
    apply();
    App.sessions.savePrefs({ agentMode: s.agentMode });
    if (s.agentMode) {
      App.utils.toast(s.agentWorkDir
        ? '研发模式已开启：AI 会自己勘察 → 计划 → 改代码 → 跑验证'
        : '研发模式已开启，建议先在下方选一个工作目录', 'info');
    }
  }

  async function pickDir() {
    const res = await App.bridge.api.files.pickDir();
    if (!res || !res.success) return;
    App.state.agentWorkDir = res.path;
    apply();
    App.sessions.savePrefs({ agentWorkDir: res.path });
    App.utils.toast(`工作目录：${res.path}`, 'success');
  }

  function clearDir() {
    App.state.agentWorkDir = '';
    App.state.agentAutoApprove = false;
    apply();
    App.sessions.savePrefs({ agentWorkDir: '', agentAutoApprove: false });
  }

  function toggleAutoApprove() {
    const s = App.state;
    if (!s.agentWorkDir) {
      App.utils.toast('先选一个工作目录 —— 自动批准只在目录内生效', 'info');
      return;
    }
    s.agentAutoApprove = !s.agentAutoApprove;
    apply();
    App.sessions.savePrefs({ agentAutoApprove: s.agentAutoApprove });
    App.utils.toast(s.agentAutoApprove
      ? '已开启：工作目录内不再逐个弹窗，目录外仍会问你'
      : '已关闭：写文件 / 删除 / 跑命令都会先问你',
    s.agentAutoApprove ? 'info' : 'success');
  }

  App.agent = { apply, setMode, pickDir, clearDir, toggleAutoApprove };
})(typeof globalThis !== 'undefined' ? globalThis : this);

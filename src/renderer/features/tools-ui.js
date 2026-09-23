;(function (global) {
  'use strict';

  /** 设置里的「AI 能力」分区：总开关、命令开关、搜索后端、操作日志 */
  const App = (global.App = global.App || {});

  function renderPanel(info) {
    const s = App.state;
    const dom = App.dom;
    s.toolPrefs = Object.assign({ enabled: false, allowCommand: false, searchProvider: 'ddg' }, info.prefs || {});

    dom.toolMasterBtn.textContent = s.toolPrefs.enabled ? '开' : '关';
    dom.toolMasterBtn.classList.toggle('on', s.toolPrefs.enabled);
    dom.toolCommandBtn.textContent = s.toolPrefs.allowCommand ? '开' : '关';
    dom.toolCommandBtn.classList.toggle('on', s.toolPrefs.allowCommand);
    dom.toolCommandBtn.disabled = !s.toolPrefs.enabled;

    dom.toolSearchProvider.value = s.toolPrefs.searchProvider || 'ddg';
    const needKey = s.toolPrefs.searchProvider !== 'ddg';
    dom.toolSearchKeyRow.classList.toggle('hidden', !needKey);
    dom.toolSearchKey.placeholder = needKey ? '粘贴搜索服务的 API Key' : '当前使用免密钥搜索，无需填写';
    dom.toolKeyState.textContent = needKey
      ? (info.searchKeyTail ? `已保存 · 结尾 ${info.searchKeyTail}` : '还没填 key，搜索会退回免密钥方案')
      : '免密钥搜索已就绪';

    const logEl = dom.toolLogEl;
    if (!logEl) return;
    logEl.textContent = '';
    const logs = (info.log && info.log.length) ? info.log : [];
    if (!logs.length) {
      const empty = global.document.createElement('div');
      empty.className = 'tool-log-empty';
      empty.textContent = '还没有任何工具被调用';
      logEl.appendChild(empty);
      return;
    }
    const frag = global.document.createDocumentFragment();
    logs.slice(0, 12).forEach((item) => {
      const row = global.document.createElement('div');
      row.className = 'tool-log-row' + (item.risk === 'high' ? ' risk' : '');
      const meta = App.constants.TOOL_META[item.tool] || { icon: '·', label: item.tool };
      const name = global.document.createElement('span');
      name.className = 'tool-log-name';
      name.textContent = `${meta.icon} ${item.summary || meta.label}`;
      const right = global.document.createElement('span');
      right.className = 'tool-log-time';
      right.textContent = `${App.utils.hhmmOf(item.time)}${item.result === '用户拒绝' ? ' · 已拒绝' : ''}`;
      row.append(name, right);
      frag.appendChild(row);
    });
    logEl.appendChild(frag);
  }

  async function refresh() {
    if (!App.bridge.api.tools || !App.bridge.api.tools.get) return;
    try {
      renderPanel(await App.bridge.api.tools.get());
    } catch (e) { /* 面板没开就算了 */ }
  }

  async function toggleMaster() {
    const s = App.state;
    const next = !s.toolPrefs.enabled;
    if (next && !global.confirm(
      '打开后，AI 将可以：\n\n'
      + '• 联网搜索与打开网页\n'
      + '• 读取、写入、删除你电脑上的文件\n'
      + (s.toolPrefs.allowCommand ? '• 在你的电脑上执行命令\n' : '')
      + '\n写入 / 删除 / 执行命令每次都会弹窗确认，系统目录与凭据目录永久拒绝。\n\n确定要打开吗？')) {
      return;
    }
    await App.bridge.api.tools.setPrefs({ enabled: next });
    await refresh();
    App.utils.toast(next ? '已打开 AI 能力' : '已关闭 AI 能力', 'success');
  }

  async function toggleCommand() {
    const s = App.state;
    if (!s.toolPrefs.enabled) { App.utils.toast('先打开上面的总开关', 'info'); return; }
    const next = !s.toolPrefs.allowCommand;
    if (next && !global.confirm('允许 AI 在你电脑上执行命令？\n\n每条命令都会先弹窗给你看，明显的危险命令会被直接拒绝。')) return;
    await App.bridge.api.tools.setPrefs({ allowCommand: next });
    await refresh();
    App.utils.toast(next ? '已允许执行命令' : '已禁止执行命令', 'success');
  }

  async function changeSearchProvider() {
    const value = App.dom.toolSearchProvider.value;
    await App.bridge.api.tools.setPrefs({ searchProvider: value });
    await refresh();
    if (App.constants.SEARCH_PROVIDER_KEY_URL[value]) {
      App.utils.toast('可以点下面的输入框上方提示去申请 key', 'info');
    }
  }

  async function saveSearchKey() {
    const v = App.dom.toolSearchKey.value.trim();
    if (!v) { App.utils.toast('请先粘贴 key', 'info'); return; }
    await App.bridge.api.tools.setSearchKey(v);
    App.dom.toolSearchKey.value = '';
    await refresh();
    App.utils.toast('搜索服务的 key 已保存', 'success');
  }

  App.toolsUI = { renderPanel, refresh, toggleMaster, toggleCommand, changeSearchProvider, saveSearchKey };
})(typeof globalThis !== 'undefined' ? globalThis : this);

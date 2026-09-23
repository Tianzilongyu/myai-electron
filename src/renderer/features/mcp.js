;(function (global) {
  'use strict';

  /**
   * MCP 服务器设置界面（渲染层）
   *
   * 列表、添加/删除、重连都在这里；服务器配置存进 prefs.mcpServers，
   * 真正的连接与工具调用在主进程 src/main/mcp.js。
   */
  const App = (global.App = global.App || {});

  function available() {
    return Boolean(App.bridge.api && App.bridge.api.mcp);
  }

  function servers() {
    const v = App.state.prefs && App.state.prefs.mcpServers;
    return Array.isArray(v) ? v : [];
  }

  const STATUS_TEXT = { connected: '已连接', connecting: '连接中…', error: '出错', idle: '未连接' };

  async function refresh() {
    if (!available()) return;
    try {
      const res = await App.bridge.api.mcp.list();
      if (res && Array.isArray(res.servers)) render(res.servers);
    } catch (e) {
      render([]);
    }
  }

  function render(list) {
    const el = App.dom.mcpList;
    if (!el) return;
    el.textContent = '';
    const frag = global.document.createDocumentFragment();

    if (!list.length) {
      const empty = global.document.createElement('div');
      empty.className = 'mcp-empty';
      empty.textContent = '还没有 MCP 服务器。点「添加服务器」接入一个外部工具。';
      frag.appendChild(empty);
    } else {
      list.forEach((s) => {
        const row = global.document.createElement('div');
        row.className = 'mcp-row';

        const dot = global.document.createElement('span');
        dot.className = 'mcp-dot ' + (s.status || 'idle');

        const info = global.document.createElement('div');
        info.className = 'mcp-info';
        const name = global.document.createElement('div');
        name.className = 'mcp-name';
        name.textContent = s.name || s.id;
        const sub = global.document.createElement('div');
        sub.className = 'mcp-sub';
        let subText = `${s.transport === 'http' ? 'HTTP' : 'stdio'} · ${STATUS_TEXT[s.status] || s.status}`;
        if (Array.isArray(s.tools) && s.tools.length) subText += ` · ${s.tools.length} 个工具`;
        sub.textContent = subText;
        if (s.status === 'error' && s.error) {
          sub.textContent += ` · ${s.error}`;
          sub.classList.add('error');
        }
        info.append(name, sub);

        const del = global.document.createElement('button');
        del.className = 'mcp-del';
        del.textContent = '删除';
        del.addEventListener('click', () => remove(s.id));

        row.append(dot, info, del);
        frag.appendChild(row);
      });
    }
    el.appendChild(frag);
  }

  async function save(list) {
    if (!available()) return;
    const res = await App.bridge.api.mcp.save(list);
    if (res && Array.isArray(res.servers)) render(res.servers);
  }

  async function remove(id) {
    await save(servers().filter((s) => s.id !== id));
  }

  function toggleTransportFields() {
    const http = App.dom.mcpTransport.value === 'http';
    App.dom.mcpCommandRow.classList.toggle('hidden', http);
    App.dom.mcpUrlRow.classList.toggle('hidden', !http);
  }

  function showForm() {
    App.dom.mcpForm.classList.remove('hidden');
    App.dom.mcpAddBtn.classList.add('hidden');
    App.dom.mcpName.value = '';
    App.dom.mcpCommand.value = '';
    App.dom.mcpArgs.value = '';
    App.dom.mcpUrl.value = '';
    toggleTransportFields();
    App.dom.mcpName.focus();
  }

  function hideForm() {
    App.dom.mcpForm.classList.add('hidden');
    App.dom.mcpAddBtn.classList.remove('hidden');
  }

  async function addServer() {
    const name = App.dom.mcpName.value.trim();
    if (!name) { App.utils.toast('请填写服务器名称', 'info'); return; }
    const transport = App.dom.mcpTransport.value;
    const cfg = { id: App.utils.genId(), name: name.slice(0, 40), transport };
    if (transport === 'http') {
      const url = App.dom.mcpUrl.value.trim();
      if (!/^https?:\/\//.test(url)) { App.utils.toast('请填写有效的 http(s) 地址', 'info'); return; }
      cfg.url = url;
    } else {
      const command = App.dom.mcpCommand.value.trim();
      if (!command) { App.utils.toast('请填写启动命令', 'info'); return; }
      cfg.command = command;
      cfg.args = App.dom.mcpArgs.value.trim().split(/\s+/).filter(Boolean);
    }
    await save(servers().concat([cfg]));
    hideForm();
    App.utils.toast('已保存，正在连接…', 'success');
    await refresh();
  }

  function bind() {
    App.dom.mcpAddBtn.addEventListener('click', showForm);
    App.dom.mcpCancelBtn.addEventListener('click', hideForm);
    App.dom.mcpSaveBtn.addEventListener('click', addServer);
    App.dom.mcpTransport.addEventListener('change', toggleTransportFields);
    App.dom.mcpReloadBtn.addEventListener('click', async () => {
      try { await App.bridge.api.mcp.reload(); } catch (e) { /* 忽略 */ }
      await refresh();
    });
  }

  App.mcp = { available, refresh, render, bind };
})(typeof globalThis !== 'undefined' ? globalThis : this);

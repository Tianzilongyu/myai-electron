;(function (global) {
  'use strict';

  /** 命令面板（Ctrl / Cmd + K）：命令 + 切换 AI + 跳转会话 */
  const App = (global.App = global.App || {});

  let open = false;
  let items = [];
  let cursor = 0;

  function buildCommands() {
    const s = App.state;
    return [
      { iconText: '＋', name: '新建对话', keywords: 'new chat xin 新建 对话', run: () => App.dom.newChatBtn.click() },
      { iconText: '设', name: '打开设置与密钥', keywords: 'settings key 设置 密钥', run: App.settings.openView },
      { iconText: '技', name: '选择 AI 技能', keywords: 'skill 技能', run: App.panels.openSkillPanel },
      { iconText: '词', name: '打开提示词库', keywords: 'prompt 提示词 模板', run: App.promptLib.open },
      { iconText: '导', name: '导出当前会话为 Markdown', keywords: 'export md 导出 markdown', run: () => App.sessions.exportSession() },
      { iconText: '文', name: '导入本地文件', keywords: 'file attach 附件 导入', run: App.attachments.attachByDialog },
      { iconText: '单', name: '切换到单 AI 模式', keywords: 'single 单ai', run: () => { App.chat.setMode('single'); App.utils.toast('已切换到单 AI 模式', 'success', 1600); } },
      { iconText: '多', name: '切换到多 AI 模式', keywords: 'multi 多ai', run: () => { App.chat.setMode('multi'); App.utils.toast('已切换到多 AI 模式', 'success', 1600); } },
      { iconText: '团', name: '配置多 AI 团队', keywords: 'multi config 团队', run: () => { App.chat.setMode('multi'); App.panels.openConfigPanel(); } },
      { iconText: '思', name: `${s.prefs.thinkMode ? '关闭' : '开启'}深度思考`, keywords: 'think 思考', run: () => App.providerUI.setThinkMode(!s.prefs.thinkMode) },
      { iconText: '研', name: `${s.agentMode ? '关闭' : '开启'}研发模式`, keywords: 'agent dev 研发 独立 写代码 自主', run: () => App.agent.setMode(!s.agentMode) },
      { iconText: '目', name: '选择研发工作目录', keywords: 'agent dir workdir 目录 项目', run: App.agent.pickDir },
      { iconText: '清', name: '清除已选技能', keywords: 'clear skill 清除', run: async () => { s.selectedSkills = []; await App.sessions.savePrefs({ skills: [] }); App.panels.updateSkillBadge(); App.utils.toast('已清除全部技能', 'success'); } },
      { iconText: '栏', name: `${App.dom.sidebar.classList.contains('collapsed') ? '展开' : '折叠'}侧边栏`, keywords: 'sidebar 侧边栏', run: () => App.panels.setSidebarCollapsed(!App.dom.sidebar.classList.contains('collapsed')) },
      { iconText: '复', name: '复制最后一条回答', keywords: 'copy 复制', run: App.chat.copyLastReply },
      { iconText: '⌨️', name: '查看键盘快捷键', keywords: 'shortcut keyboard 快捷键', run: App.shortcuts.open },
      { iconText: '会', name: '清空全部会话', keywords: 'clear 清空 删除', run: async () => {
        if (!global.confirm('确定要清空全部会话吗？此操作不可撤销。')) return;
        await App.sessions.clearAll();
        App.utils.toast('已清空全部会话', 'success');
      } },
    ];
  }

  function build(query) {
    const q = String(query || '').trim().toLowerCase();
    const out = [];

    const matchedCmds = q
      ? buildCommands().filter((c) => `${c.name} ${c.keywords}`.toLowerCase().includes(q))
      : buildCommands();
    if (matchedCmds.length) out.push({ group: '命令' }, ...matchedCmds.map((c) => Object.assign({ kind: '命令' }, c)));

    const ais = App.state.providers.filter((p) => p.configured);
    const matchedAi = ais.filter((p) => !q || `${p.name} ${p.id}`.toLowerCase().includes(q));
    if (matchedAi.length) {
      out.push({ group: '切换 AI' }, ...matchedAi.map((p) => ({
        iconImg: App.avatars.avatarImageSrc(p.id), iconText: p.avatar,
        name: `切换到 ${p.name}`, sub: `当前模型 ${p.model || '—'}`,
        kind: 'AI', run: () => App.providerUI.selectProvider(p.id),
      })));
    }

    const matchedSessions = (q ? App.state.sessions.filter((s) => App.sessions.sessionMatches(s, q)) : App.state.sessions).slice(0, 8);
    if (matchedSessions.length) {
      out.push({ group: '会话' }, ...matchedSessions.map((s) => ({
        iconText: '聊',
        name: s.title || '新对话',
        sub: `${App.utils.formatTime(s.updatedAt)} · ${(s.messages || []).length} 条消息`,
        kind: '会话', run: () => App.sessions.switchSession(s.id),
      })));
    }

    items = out;
    const first = out.findIndex((i) => !i.group);
    cursor = first < 0 ? 0 : first;
    render();
  }

  function render() {
    const listEl = App.dom.cmdList;
    listEl.textContent = '';
    if (items.length === 0) {
      const empty = global.document.createElement('div');
      empty.className = 'cmd-empty';
      empty.textContent = '没有匹配的结果';
      listEl.appendChild(empty);
      return;
    }
    const frag = global.document.createDocumentFragment();
    items.forEach((item, i) => {
      if (item.group) {
        const g = global.document.createElement('div');
        g.className = 'cmd-group-title';
        g.textContent = item.group;
        frag.appendChild(g);
        return;
      }
      const el = global.document.createElement('button');
      el.type = 'button';
      el.className = 'cmd-item' + (i === cursor ? ' cursor' : '');
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', i === cursor ? 'true' : 'false');

      const icon = global.document.createElement('span');
      icon.className = 'cmd-item-icon';
      if (item.iconImg) {
        const img = global.document.createElement('img');
        img.src = item.iconImg;
        img.alt = '';
        icon.appendChild(img);
      } else {
        icon.textContent = item.iconText || '·';
      }

      const text = global.document.createElement('span');
      text.className = 'cmd-item-text';
      const nm = global.document.createElement('span');
      nm.className = 'cmd-item-name';
      nm.textContent = item.name;
      text.appendChild(nm);
      if (item.sub) {
        const sb = global.document.createElement('span');
        sb.className = 'cmd-item-sub';
        sb.textContent = item.sub;
        text.appendChild(sb);
      }

      const kind = global.document.createElement('span');
      kind.className = 'cmd-item-kind';
      kind.textContent = item.kind || '';

      el.append(icon, text, kind);
      el.addEventListener('mousemove', () => {
        if (cursor === i) return;
        cursor = i;
        render();
      });
      el.addEventListener('click', () => exec(i));
      frag.appendChild(el);
    });
    listEl.appendChild(frag);
    const cur = listEl.querySelector('.cmd-item.cursor');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  function exec(index) {
    const item = items[index];
    if (!item || item.group) return;
    close();
    try { item.run(); } catch (e) { App.utils.toast(`执行失败：${(e && e.message) || e}`, 'error'); }
  }

  function close() {
    open = false;
    App.dom.cmdPanel.classList.remove('show');
    App.dom.cmdMask.classList.remove('show');
    App.dom.cmdInput.value = '';
  }

  function openPalette() {
    App.panels.closeFloatingLayers();
    App.pet.closePet();
    open = true;
    App.dom.cmdPanel.classList.add('show');
    App.dom.cmdMask.classList.add('show');
    App.dom.cmdInput.value = '';
    build('');
    App.dom.cmdInput.focus();
  }

  function move(delta) {
    const idxs = [];
    items.forEach((it, i) => { if (!it.group) idxs.push(i); });
    if (idxs.length === 0) return;
    let pos = idxs.indexOf(cursor);
    if (pos < 0) pos = 0;
    pos = (pos + delta + idxs.length) % idxs.length;
    cursor = idxs[pos];
    render();
  }

  function bind() {
    App.dom.cmdInput.addEventListener('input', () => build(App.dom.cmdInput.value));
    App.dom.cmdInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); exec(cursor); }
    });
    App.dom.cmdMask.addEventListener('click', close);
  }

  App.command = { bind, open: openPalette, close, isOpen: () => open };
})(typeof globalThis !== 'undefined' ? globalThis : this);

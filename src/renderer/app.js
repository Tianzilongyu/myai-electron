;(function (global) {
  'use strict';

  /**
   * 启动与事件绑定
   *
   * 这里是唯一把各模块「接起来」的地方：谁点什么触发谁。
   * 模块之间不互相绑事件，所以单个模块可以独立读懂、独立换掉。
   */
  const App = (global.App = global.App || {});

  /* 判断焦点是否在输入框里，避免「?」这类字符被当成快捷键吃掉 */
  function isTypingInField() {
    const el = global.document.activeElement;
    if (!el) return false;
    const tag = String(el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || el.isContentEditable === true;
  }

  function bindGlobalKeys() {
    global.document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (App.shortcuts.isRecording()) { App.shortcuts.cancelRecording(); return; }
        if (App.command.isOpen()) { App.command.close(); return; }
        if (App.shortcuts.isOpen()) { App.shortcuts.close(); return; }
        App.panels.closeFloatingLayers();
        return;
      }

      // 可自定义的组合键统一走这里匹配；「?」是特殊键，单独处理
      const action = App.shortcuts.match(e);
      if (action) {
        e.preventDefault();
        switch (action) {
          case 'command': { if (App.command.isOpen()) App.command.close(); else App.command.open(); return; }
          case 'newChat': { App.dom.newChatBtn.click(); return; }
          case 'toggleSidebar': { App.panels.setSidebarCollapsed(!App.dom.sidebar.classList.contains('collapsed')); return; }
          case 'settings': { App.settings.openView(); return; }
          case 'searchSessions': {
            if (App.dom.sidebar.classList.contains('collapsed')) App.panels.setSidebarCollapsed(false);
            App.dom.chatSearchInput.focus();
            App.dom.chatSearchInput.select();
            return;
          }
          case 'importFile': { App.attachments.attachByDialog(); return; }
          case 'toggleMode': {
            const next = App.state.currentMode === 'single' ? 'multi' : 'single';
            App.chat.setMode(next);
            App.utils.toast(next === 'multi' ? '已切换到多 AI 模式' : '已切换到单 AI 模式', 'success', 1600);
            return;
          }
          default: return;
        }
      }

      if (e.key === '?' && !isTypingInField()) { e.preventDefault(); App.shortcuts.open(); }
    });
  }

  function bindEvents() {
    const dom = App.dom;

    /* 输入框 */
    dom.userInput.addEventListener('input', function autoGrow() {
      App.utils.autoGrowEl(this, 160);
    });
    dom.userInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        App.chat.sendMessage();
      }
    });

    /* 会话搜索：防抖，避免每敲一个字就把整个列表重建一遍 */
    const renderChatListDebounced = App.utils.debounce(() => App.sessions.renderChatList(), 120);
    dom.chatSearchInput.addEventListener('input', () => {
      App.state.sessionQuery = dom.chatSearchInput.value.trim();
      dom.chatSearchClear.classList.toggle('hidden', !App.state.sessionQuery);
      renderChatListDebounced();
    });
    dom.chatSearchClear.addEventListener('click', () => {
      dom.chatSearchInput.value = '';
      App.state.sessionQuery = '';
      dom.chatSearchClear.classList.add('hidden');
      App.sessions.renderChatList();
      dom.chatSearchInput.focus();
    });

    /* 发送 / 会话 */
    dom.sendBtn.addEventListener('click', () => App.chat.sendMessage());
    dom.singleAiSelect.addEventListener('change', () => App.providerUI.selectProvider(dom.singleAiSelect.value));
    dom.newChatBtn.addEventListener('click', () => {
      const active = App.sessions.getActive();
      if (App.state.sessions.length && active && active.messages.length === 0) {
        App.utils.toast('已经有一个空对话了', 'info');
        return;
      }
      App.sessions.createSession();
      dom.userInput.focus();
    });
    dom.openFileBtn.addEventListener('click', () => App.attachments.attachByDialog());

    if (dom.quickCards) {
      dom.quickCards.addEventListener('click', (e) => {
        const card = e.target.closest('.quick-card');
        if (!card) return;
        const prompt = card.dataset.prompt;
        if (prompt) {
          dom.userInput.value = prompt;
          dom.userInput.focus();
          dom.userInput.dispatchEvent(new Event('input'));
        }
      });
    }

    /* 首屏：一键继续上次的对话 */
    if (dom.resumeLastBtn) {
      dom.resumeLastBtn.addEventListener('click', () => App.sessions.resumeLast());
    }

    /* 技能 */
    dom.skillBtn.addEventListener('click', App.panels.openSkillPanel);
    dom.skillPanelClose.addEventListener('click', App.panels.closeSkillPanel);
    dom.skillPanelMask.addEventListener('click', App.panels.closeSkillPanel);
    dom.skillClearBtn.addEventListener('click', () => {
      App.state.selectedSkills = [];
      App.panels.renderSkillGrid();
    });
    dom.skillApplyBtn.addEventListener('click', async () => {
      await App.sessions.savePrefs({ skills: App.state.selectedSkills.slice() });
      App.panels.updateSkillBadge();
      App.panels.closeSkillPanel();
      App.utils.toast(App.state.selectedSkills.length ? `已应用 ${App.state.selectedSkills.length} 个技能` : '已清除全部技能', 'success');
    });

    /* 提示词库 */
    if (dom.promptBtn) dom.promptBtn.addEventListener('click', App.promptLib.open);

    /* 模式 / 多 AI 配置 */
    dom.modeSwitch.addEventListener('click', (e) => {
      const btn = e.target.closest('.mode-btn');
      if (!btn) return;
      App.chat.setMode(btn.dataset.mode);
    });
    dom.multiConfigBtn.addEventListener('click', App.panels.openConfigPanel);
    dom.configClose.addEventListener('click', App.panels.closeConfigPanel);
    dom.configCancel.addEventListener('click', App.panels.closeConfigPanel);
    dom.configMask.addEventListener('click', App.panels.closeConfigPanel);
    dom.configSave.addEventListener('click', App.panels.saveMultiConfig);
    App.panels.bindConfigSections();
    dom.workerSelectAll.addEventListener('click', App.panels.selectAllConfiguredWorkers);
    dom.workerClear.addEventListener('click', App.panels.clearWorkers);
    // 勾一个就更新一次计数，不用等保存才知道选了几个
    [dom.leaderGroup, dom.workerGroup].forEach((group) => {
      group.addEventListener('change', App.panels.updateConfigCounts);
    });

    /* 设置 */
    dom.settingsBtn.addEventListener('click', App.settings.openView);
    dom.sidebarSettingsBtn.addEventListener('click', App.settings.openView);
    dom.setupHintBtn.addEventListener('click', App.settings.openView);
    dom.svBack.addEventListener('click', App.settings.closeView);
    dom.sidebarUser.addEventListener('click', App.settings.openView);
    dom.clearSessionsBtn.addEventListener('click', async () => {
      if (!global.confirm('确定要清空全部会话吗？此操作不可撤销。')) return;
      await App.sessions.clearAll();
      App.utils.toast('已清空全部会话', 'success');
    });

    dom.toggleBtn.addEventListener('click', () => {
      const willCollapse = !dom.sidebar.classList.contains('collapsed');
      // 折叠前先退出设置视图，否则侧边栏会被 settings-mode 的加宽撑住，比例很怪
      if (willCollapse && dom.sidebar.classList.contains('settings-mode')) App.settings.closeView();
      App.panels.setSidebarCollapsed(willCollapse);
    });

    dom.tokenChip.addEventListener('click', () => {
      const t = App.tokens.sessionTokens(App.sessions.getActive());
      if (!t.total) { App.utils.toast('本会话还没有产生用量', 'info'); return; }
      App.utils.toast(`本会话累计 ${t.total} tokens：提示 ${t.prompt} · 补全 ${t.completion}`, 'info', 5000);
    });

    dom.thinkToggle.addEventListener('click', () => {
      const p = App.providerUI.currentProvider();
      if (p && p.thinkingSupported === false) {
        App.utils.toast(`${p.name} 没有可用的深度思考参数，这个开关对它无效`, 'info', 2600);
        return;
      }
      App.providerUI.setThinkMode(!App.state.prefs.thinkMode);
      App.utils.toast(App.state.prefs.thinkMode ? '已开启深度思考' : '已关闭深度思考', 'success', 1600);
    });

    /* 研发模式 */
    dom.agentToggle.addEventListener('click', () => App.agent.setMode(!App.state.agentMode));
    dom.agentDirPick.addEventListener('click', App.agent.pickDir);
    dom.agentDirClear.addEventListener('click', App.agent.clearDir);
    dom.agentAutoBtn.addEventListener('click', App.agent.toggleAutoApprove);

    /* AI 能力 */
    dom.toolMasterBtn.addEventListener('click', App.toolsUI.toggleMaster);
    dom.toolCommandBtn.addEventListener('click', App.toolsUI.toggleCommand);
    dom.toolSearchProvider.addEventListener('change', App.toolsUI.changeSearchProvider);
    dom.toolSearchKeySave.addEventListener('click', App.toolsUI.saveSearchKey);

    /* 浮层收起 */
    dom.aiPickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (App.state.aiPickerOpen) App.providerUI.closeAiPicker();
      else App.providerUI.openAiPicker();
    });
    global.document.addEventListener('mousedown', (e) => {
      const t = e.target;
      if (App.state.aiPickerOpen && t && !dom.aiPicker.contains(t)) App.providerUI.closeAiPicker();
    });
    dom.mainEl.addEventListener('mousedown', (e) => {
      if (e.target.closest('.ai-picker, .skill-panel, .config-panel')) return;
      App.panels.closeFloatingLayers();
    });

    /* 关窗时异步 invoke 来不及落盘，这里走同步通道兜最后一次 */
    global.addEventListener('beforeunload', () => {
      try {
        if (App.bridge.api.sessions && App.bridge.api.sessions.saveSync) App.bridge.api.sessions.saveSync(App.state.sessions);
        else App.sessions.saveSessionsNow();
      } catch (e) {
        App.sessions.saveSessionsNow();
      }
    });
  }

  async function bootstrap() {
    const dom = App.dom;

    App.messages.bindScroll();
    App.attachments.bindDragAndDrop();
    App.command.bind();
    App.shortcuts.bind();
    App.promptLib.bind();
    App.mcp.bind();
    App.pet.bind();
    App.settings.bindParamControls();
    bindEvents();
    bindGlobalKeys();

    await App.settings.refreshConfig();
    App.theme.apply();
    App.theme.bindSystemChange();
    App.settings.syncParamControls();

    const loaded = await App.bridge.api.sessions.load();
    App.state.sessions = (Array.isArray(loaded) ? loaded : [])
      .filter((s) => s && Array.isArray(s.messages) && s.messages.length > 0)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    App.panels.setSidebarCollapsed(App.state.prefs.sidebarCollapsed !== false);
    App.providerUI.setThinkMode(Boolean(App.state.prefs.thinkMode));

    // 每回启动都停在待机界面（一个空白新对话）；历史会话照样在左侧列表里
    // 载入时把空会话滤掉，所以每次最多只有一个空白会话，不会越积越多
    App.sessions.createSession();

    // 每回启动，小助手默认回到右下角
    if (App.state.prefs.petPos) App.sessions.savePrefs({ petPos: null });
    App.state.petPos = App.pet.defaultPos();
    App.pet.petApplyPosition();

    App.sessions.updateContextMeter();
    App.tokens.updateTokenChip();
    dom.userInput.focus();

    // 没配密钥时，直接把侧边栏设置摊开，第一件事就是填 key
    if (!App.chat.anyConfigured()) {
      global.setTimeout(() => {
        App.settings.openView();
        App.utils.toast('先在密钥管理里填一个 AI 的 Key，之后就不用来回了', 'info', 4200);
      }, 700);
    }
  }

  // 启动只能有一次：重复 bootstrap 会把所有事件监听绑两遍，
  // 表现就是开关点一下翻两下、看起来「点了没反应」
  let startPromise = null;

  function start() {
    if (startPromise) return startPromise;
    if (!App.bridge.available()) {
      global.document.body.innerHTML =
        `<div style="padding:40px;font-family:sans-serif">${App.bridge.fatalMessage}</div>`;
      startPromise = Promise.resolve();
      return startPromise;
    }
    // 返回 promise 给测试和上层用（启动是异步的：要读配置、拉会话）
    startPromise = bootstrap().catch((e) => {
      global.document.body.innerHTML =
        `<div style="padding:40px;font-family:sans-serif">启动失败：${(e && e.message) || e}</div>`;
    });
    return startPromise;
  }

  App.app = { start, bootstrap };
})(typeof globalThis !== 'undefined' ? globalThis : this);

;(function (global) {
  'use strict';

  /**
   * DOM 引用集中地
   *
   * 所有 getElementById 只在这里出现一次，其它模块一律从这里取引用。
   * 好处：少了一个 id 写错就全盘崩的风险，也方便单测时整体替换。
   */
  const App = (global.App = global.App || {});

  function byId(id) {
    return global.document.getElementById(id);
  }

  function bySel(sel) {
    return global.document.querySelector(sel);
  }

  const dom = {
    byId,
    bySel,
    chatScroll: byId('chat-container'),
    chatInner: bySel('#chat-container .chat-inner'),
    welcomeScreen: byId('welcome-screen'),
    setupHint: byId('setup-hint'),
    setupHintBtn: byId('setup-hint-btn'),
    quickCards: byId('quick-cards'),
    resumeLastBtn: byId('resume-last-btn'),
    userInput: byId('user-input'),
    sendBtn: byId('send-btn'),
    chatList: byId('chat-list'),
    newChatBtn: byId('new-chat-btn'),
    sidebar: byId('sidebar'),
    toggleBtn: byId('toggle-btn'),
    thinkToggle: byId('think-toggle'),
    openFileBtn: byId('open-file-btn'),
    skillBtn: byId('skill-btn'),
    skillCount: byId('skill-count'),
    skillPanel: byId('skill-panel'),
    skillPanelMask: byId('skill-panel-mask'),
    skillGrid: byId('skill-grid'),
    skillPanelClose: byId('skill-panel-close'),
    skillClearBtn: byId('skill-clear-btn'),
    skillApplyBtn: byId('skill-apply-btn'),
    promptBtn: byId('prompt-btn'),
    promptPanel: byId('prompt-panel'),
    promptPanelMask: byId('prompt-panel-mask'),
    promptPanelClose: byId('prompt-panel-close'),
    promptNewBtn: byId('prompt-new-btn'),
    promptForm: byId('prompt-form'),
    promptTitleInput: byId('prompt-title-input'),
    promptContentInput: byId('prompt-content-input'),
    promptSaveBtn: byId('prompt-save-btn'),
    promptCancelBtn: byId('prompt-cancel-btn'),
    promptList: byId('prompt-list'),
    attachmentBar: byId('attachment-bar'),
    dropOverlay: byId('drop-overlay'),
    modeSwitch: byId('mode-switch'),
    singleAiSelect: byId('single-ai-select'),
    multiConfigBtn: byId('multi-config-btn'),
    configMask: byId('config-mask'),
    configPanel: byId('config-panel'),
    configClose: byId('config-close'),
    configCancel: byId('config-cancel'),
    configSave: byId('config-save'),
    leaderGroup: byId('leader-group'),
    workerGroup: byId('worker-group'),
    leaderCount: byId('leader-count'),
    workerCount: byId('worker-count'),
    workerSelectAll: byId('worker-select-all'),
    workerClear: byId('worker-clear'),
    teamLeaderName: byId('team-leader-name'),
    teamWorkerSummary: byId('team-worker-summary'),
    statusDot: byId('status-dot'),
    toastWrap: byId('toast-wrap'),
    tokenChip: byId('token-chip'),
    tokenChipText: byId('token-chip-text'),

    aiPicker: byId('ai-picker'),
    aiPickerBtn: byId('ai-picker-btn'),
    aiPickerAvatar: byId('ai-picker-avatar'),
    aiPickerName: byId('ai-picker-name'),
    aiPickerMenu: byId('ai-picker-menu'),
    settingsBtn: byId('settings-btn'),
    sidebarSettingsBtn: byId('sidebar-settings-btn'),
    sidebarChatView: byId('sidebar-chat-view'),
    sidebarSettingsView: byId('sidebar-settings-view'),
    svBack: byId('sv-back'),
    sidebarUser: byId('sidebar-user'),
    sidebarUserAvatar: byId('sidebar-user-avatar'),
    sidebarUserName: byId('sidebar-user-name'),
    sidebarUserStatus: byId('sidebar-user-status'),
    settingsSub: byId('settings-sub'),
    keyList: byId('key-list'),
    contextRoundsInput: byId('context-rounds'),
    temperatureInput: byId('temperature'),
    temperatureOut: byId('temperature-out'),
    maxTokensInput: byId('max-tokens'),
    requestCharsInput: byId('request-chars'),
    systemPromptInput: byId('system-prompt'),
    autoTitleBtn: byId('auto-title'),
    autoSaveFilesBtn: byId('auto-save-files'),
    resetParamsBtn: byId('reset-params-btn'),
    themeSelect: byId('theme-select'),
    clearSessionsBtn: byId('clear-sessions-btn'),
    dataDirHint: byId('data-dir-hint'),

    toolMasterBtn: byId('tool-master'),
    toolCommandBtn: byId('tool-command'),
    toolSearchProvider: byId('tool-search-provider'),
    toolSearchKey: byId('tool-search-key'),
    toolSearchKeySave: byId('tool-search-key-save'),
    toolSearchKeyRow: byId('tool-key-row'),
    toolKeyState: byId('tool-key-state'),
    toolLogEl: byId('tool-log'),

    deskmate: byId('deskmate'),
    deskmatePet: byId('deskmate-pet'),
    deskmateImg: byId('deskmate-img'),
    deskmateBubble: byId('deskmate-bubble'),

    chatSearchInput: byId('chat-search-input'),
    chatSearchClear: byId('chat-search-clear'),
    genStatus: byId('gen-status'),
    cmdMask: byId('cmd-mask'),
    cmdPanel: byId('cmd-panel'),
    cmdInput: byId('cmd-input'),
    cmdList: byId('cmd-list'),
    shortcutsMask: byId('shortcuts-mask'),
    shortcutsPanel: byId('shortcuts-panel'),
    shortcutsClose: byId('shortcuts-close'),
    shortcutsBody: byId('shortcuts-body'),

    /* 研发模式 / 工作台 */
    agentToggle: byId('agent-toggle'),
    agentBar: byId('agent-bar'),
    agentDirText: byId('agent-dir'),
    agentDirPick: byId('agent-dir-pick'),
    agentDirClear: byId('agent-dir-clear'),
    agentAutoBtn: byId('agent-auto-approve'),

    /* 主区域没有 id，只能按 class 取 —— 之前漏了这一步，导致渲染层整体崩掉 */
    mainEl: bySel('.main'),
  };

  /* 上下文计量条（动态插入，避免每次改 HTML） */
  const contextMeter = global.document.createElement('div');
  contextMeter.id = 'context-meter';
  contextMeter.className = 'context-meter';
  const inputArea = bySel('.input-area');
  if (inputArea) inputArea.insertBefore(contextMeter, bySel('.input-inner'));
  dom.contextMeter = contextMeter;

  /* 回到底部按钮 */
  const jumpBottomBtn = global.document.createElement('button');
  jumpBottomBtn.id = 'jump-bottom';
  jumpBottomBtn.className = 'jump-bottom hidden';
  jumpBottomBtn.textContent = '↓ 回到最新';
  if (dom.mainEl) dom.mainEl.appendChild(jumpBottomBtn);
  dom.jumpBottomBtn = jumpBottomBtn;

  App.dom = dom;
})(typeof globalThis !== 'undefined' ? globalThis : this);

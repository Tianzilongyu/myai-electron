;(function (global) {
  'use strict';

  /**
   * 全局可变状态
   *
   * 全部收在一个对象里而不是散落的 let，好处是跨模块访问一定是「取值时」而非「加载时」，
   * 不会出现模块顺序导致的 TDZ（用到一个还没初始化的 let）问题。
   */
  const App = (global.App = global.App || {});

  App.state = {
    /* 来自主进程 */
    providers: [],
    prefs: {
      contextRounds: 6,
      skills: [],
      multi: { leader: 'deepseek', workers: ['zhipu'] },
      thinkMode: false,
      singleProvider: 'deepseek',
      theme: 'system',           // 主题：system / light / dark
      shortcuts: {},             // 自定义快捷键：{ actionId: 'mod+k' }
      prompts: [],               // 自定义提示词库
      mcpServers: [],            // MCP 服务器配置
    },

    /* 会话 */
    sessions: [],
    activeSessionId: null,
    sessionQuery: '',

    /* 输入 */
    selectedSkills: [],
    pendingAttachments: [],
    currentMode: 'single',
    multiConfig: { leader: 'deepseek', workers: ['zhipu'] },

    /* 研发模式：让 AI 自己把一个任务做完（勘察 → 计划 → 执行 → 验证 → 汇报） */
    agentMode: false,
    agentWorkDir: '',
    agentAutoApprove: false,

    /* 生成中 */
    currentReqId: null,
    isGenerating: false,
    loadingDiv: null,          // 不再挂在 session 上（否则存档会炸）
    autoScroll: true,

    /* 工具面板 */
    toolPrefs: { enabled: false, allowCommand: false, searchProvider: 'ddg' },

    /* 桌面宠物 */
    petOpen: false,
    petPos: null,              // 相对 main 左上角的坐标，null 表示还在默认位置
    petDrag: null,
    petSuppressClick: false,
    petBalances: null,         // { items, fetchedAt }
    petLastErrorAt: 0,
    petCelebrateUntil: 0,

    /* 形象形态：normal / chibi */
    chibiActive: false,
    chibiTimer: null,

    /* AI 选择器 */
    aiPickerOpen: false,

    /* 系统提示词缓存：参数没变就不重复拼字符串 */
    systemPromptCache: { key: '', value: '' },
  };

  App.resetTransient = function resetTransient() {
    const s = App.state;
    s.currentReqId = null;
    s.isGenerating = false;
    s.loadingDiv = null;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

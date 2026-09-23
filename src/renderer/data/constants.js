;(function (global) {
  'use strict';

  /** 静态配置：工具元信息、快捷键、宠物台词、参数默认值、有立绘的厂商 */
  const App = (global.App = global.App || {});

  /* 工具调用过程的可视化（AI 正在搜什么 / 读什么文件） */
  const TOOL_META = {
    web_search: { icon: '🔍', label: '联网搜索' },
    web_fetch: { icon: '🌐', label: '打开网页' },
    list_dir: { icon: '📂', label: '列目录' },
    read_file: { icon: '📄', label: '读文件' },
    search_files: { icon: '🔎', label: '搜索本地文件' },
    write_file: { icon: '✍️', label: '写文件' },
    delete_path: { icon: '🗑️', label: '删除' },
    run_command: { icon: '💻', label: '执行命令' },
    set_plan: { icon: '🗺️', label: '更新计划' },
  };

  const SHORTCUT_GROUPS = [
    {
      group: '全局',
      items: [
        { keys: ['Ctrl/⌘', 'K'], desc: '打开命令面板' },
        { keys: ['Ctrl/⌘', 'N'], desc: '新建对话' },
        { keys: ['Ctrl/⌘', 'B'], desc: '折叠 / 展开侧边栏' },
        { keys: ['Ctrl/⌘', ','], desc: '打开设置与密钥' },
        { keys: ['Ctrl/⌘', 'F'], desc: '搜索会话' },
        { keys: ['?'], desc: '查看这份快捷键' },
        { keys: ['Esc'], desc: '关闭浮层 / 取消' },
      ],
    },
    {
      group: '输入框',
      items: [
        { keys: ['Enter'], desc: '发送' },
        { keys: ['Shift', 'Enter'], desc: '换行' },
      ],
    },
    {
      group: '对话',
      items: [
        { keys: ['Ctrl/⌘', 'Shift', 'O'], desc: '导入本地文件' },
        { keys: ['Ctrl/⌘', 'Shift', 'M'], desc: '切换单 / 多 AI 模式' },
      ],
    },
  ];

  const PET_LINES_IDLE = [
    '今天也想帮你把活干完',
    '拖我去哪儿都行，别扔出屏幕就行',
    '余额我看得很紧的，放心',
    '想换个 AI 陪聊？点左上角那个下拉',
    '文件直接拖进窗口我也能读',
    '深呼吸，需求总会写完的',
    '我在，随时叫我',
    'Ctrl/⌘ + K 能叫出命令面板，试试',
    '写一半想改主意？直接按停止，我不会生气',
  ];

  const PET_LINES_TIP = [
    '提示：Enter 发送，Shift+Enter 换行',
    '提示：点主区域空白处能收起所有弹层',
    '提示：密钥存一次就够了，重开照样在',
    '提示：轮数调小一点更省 token',
    '提示：按 ? 能看全部快捷键',
    '提示：消息上可以「编辑并重发」，改一句就行',
  ];

  const PET_LINES_THINKING = [
    '正在替你想，稍等一小会儿…',
    '这题有点意思，我多想两步',
    '别急，脱口而出的答案通常不对',
    '我在翻资料，马上给你',
    '让我把思路理顺一点再开口',
  ];

  const PET_LINES_DONE = [
    '好了，看看合不合用',
    '交卷，不满意随时让我重来',
    '写完了，你改改就能用',
    '文件已经放好了，去看看吧',
  ];

  const PET_LINES_UPSET = [
    '刚才那下没成，要不再试一次？',
    '翻车了…换个 AI 或者把问题再说明白点',
    '这次没接住，我还在',
  ];

  const PARAM_DEFAULTS = {
    temperature: 0.7,
    maxTokens: 0,
    contextRounds: 6,
    requestChars: 60000,
    systemPrompt: '',
    autoTitle: true,
    autoSaveFiles: true,
  };

  /* 只有这些厂商有立绘素材（assets/avatars/{id}.png）。
   * 没有 PNG 的厂商必须走 emoji 兜底，否则页面会显示成碎图。 */
  const AVATAR_ART = new Set([
    'deepseek', 'zhipu', 'aliyun', 'moonshot', 'doubao', 'siliconflow', 'openai', 'ollama',
    'hunyuan', 'spark', 'qianfan', 'gemini', 'groq', 'openrouter', 'xai',
  ]);

  const SEARCH_PROVIDER_KEY_URL = {
    tavily: 'https://app.tavily.com/home',
    serper: 'https://serper.dev/api-key',
    bing: 'https://portal.azure.com/#view/Microsoft_Azure_Bing',
  };

  App.constants = {
    TOOL_META,
    SHORTCUT_GROUPS,
    PET_LINES_IDLE,
    PET_LINES_TIP,
    PET_LINES_THINKING,
    PET_LINES_DONE,
    PET_LINES_UPSET,
    PARAM_DEFAULTS,
    AVATAR_ART,
    SEARCH_PROVIDER_KEY_URL,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

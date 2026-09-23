;(function (global) {
  'use strict';

  /** 系统提示词：基础准则 + 研发模式基调 + 文件生成约定 */
  const App = (global.App = global.App || {});

  const BASE_PROMPT = `你是一个中文办公与创作助手。直接给用户能用的结果，不谈过程，不复述问题。

【回答准则】
1. 先给结论或成品，再给必要的说明。不要写「好的，我帮你……」这类铺垫。
2. 用 Markdown 排版：标题分层、要点用列表、对比用表格、代码用代码块。
3. 不确定就说不确定，绝不编造事实、数据、文献、人名或链接。
4. 用户没问的延伸内容一律省略；确实需要追问时，只问最关键的那一件事。

【生成文件的约定】
只有当用户明确要「生成 / 制作 / 导出 / 做一个」文件时才输出文件，普通问答不要输出。

输出格式严格如下 —— 两个标记各占一行，中间不要嵌套代码块：
[[SAVE:文件名.扩展名]]
文件正文
[[/SAVE]]

各格式要求：
- .docx：Markdown 正文，支持 # 标题、列表、加粗、代码块
- .xlsx：必须是 Markdown 表格（表头行 + 分隔行 + 数据行）
- .pptx：用 # 一级标题分页
- .pdf：Markdown 正文
- .md / .txt / .csv：纯文本

在 [[SAVE]] 标记之前，先用一两句自然语言说明这份文件是什么。`;

  /* 研发模式：渲染层这边先定行为基调，主进程那边再补工具说明和工作目录，两边叠加 */
  const AGENT_PROMPT = `
【当前是研发模式】用户给你的是一个任务，不是一个问题。

- 不要先抛一串澄清问题。先自己勘察（list_dir / read_file / search_files），
  信息实在不够再一次性问清楚，同时把你的方案讲出来。
- 用 set_plan 列出 3-8 步计划再动手，然后一步一步做完，不要中途停下来等确认。
- 代码一律给完整文件，禁止「……」「其余省略」「// TODO 同上」这类占位。
- 能验证就验证（run_command 跑测试 / 跑构建），把真实输出贴给用户看；
  没验证过就明说，不要说「应该没问题」。
- 最后用中文汇报：改了哪些文件、验证结果、哪些假设需要用户确认、还剩什么没做。`.trim();

  const NO_FILES_PROMPT = '【重要：当前不生成文件】无论用户怎么要求，都不要输出 [[SAVE:]] 标记，把内容直接写在回复里。';

  const MAX_REQUEST_CHARS = 60000;   // 单次请求携带的正文上限
  const SAVE_DEBOUNCE_MS = 400;
  const ATTACH_STORE_CHARS = 12000;  // 附件正文存进会话时的上限（发给模型的仍是全文）

  /** 会话是整份写盘的，附件正文要截断存档，否则 sessions.json 会一路膨胀到几十 MB */
  function clipForStore(text) {
    const s = String(text || '');
    if (s.length <= ATTACH_STORE_CHARS) return s;
    return `${s.slice(0, ATTACH_STORE_CHARS)}\n……（附件正文共 ${s.length} 字，存档时只保留前 ${ATTACH_STORE_CHARS} 字；本轮发给模型的是完整内容）`;
  }

  /**
   * 组装系统提示词。
   * 拼字符串这件事在每次算上下文条、每次发请求时都会被触发，所以按「参数指纹」缓存：
   * 技能、研发模式、自动保存、自定义提示词没变就不重拼。
   */
  function getSystemPrompt() {
    const s = App.state;
    const prefs = s.prefs || {};
    const custom = String(prefs.systemPrompt || '').trim();
    const key = [
      s.agentMode ? '1' : '0',
      prefs.autoSaveFiles === false ? '0' : '1',
      s.selectedSkills.slice().sort().join(','),
      custom,
    ].join('|');

    const cache = s.systemPromptCache;
    if (cache.key === key) return cache.value;

    let p = BASE_PROMPT;
    if (s.agentMode) p += '\n\n' + AGENT_PROMPT;
    if (prefs.autoSaveFiles === false) p += '\n\n' + NO_FILES_PROMPT;
    if (s.selectedSkills.length > 0) {
      const extra = s.selectedSkills
        .map((id) => App.skills.find((sk) => sk.id === id))
        .filter(Boolean)
        .map((sk) => sk.prompt)
        .join('\n\n');
      if (extra) p += '\n\n' + extra;
    }
    if (custom) p += `\n\n【用户长期有效的额外要求】\n${custom}`;

    cache.key = key;
    cache.value = p;
    return p;
  }

  /* 对话参数：取值不合法就退回默认（不发这个字段，由各家自己决定） */
  function currentTemperature() {
    const t = Number(App.state.prefs.temperature);
    return Number.isFinite(t) && t >= 0 && t <= 2 ? t : null;
  }

  function currentMaxTokens() {
    const n = Number(App.state.prefs.maxTokens);
    return Number.isFinite(n) && n >= 256 ? Math.floor(n) : null;
  }

  function requestCharLimit() {
    const n = Number(App.state.prefs.requestChars);
    return Number.isFinite(n) && n >= 5000 ? Math.floor(n) : MAX_REQUEST_CHARS;
  }

  App.prompts = {
    BASE_PROMPT,
    AGENT_PROMPT,
    NO_FILES_PROMPT,
    MAX_REQUEST_CHARS,
    ATTACH_STORE_CHARS,
    clipForStore,
    getSystemPrompt,
    currentTemperature,
    currentMaxTokens,
    requestCharLimit,
    saveDebounceMs: SAVE_DEBOUNCE_MS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

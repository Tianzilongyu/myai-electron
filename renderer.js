/* eslint-env browser */
'use strict';

/* ==================================================================
 * 渲染层
 * 这里不持有任何密钥，也不接触 Node —— 一切都通过 window.api 走主进程。
 * 整段包在 IIFE 里：全局已存在 window.api，顶层再 const 同名会直接报语法错。
 * ================================================================== */
(function () {
  const api = window.api;

  if (!api) {
    document.body.innerHTML =
      '<div style="padding:40px;font-family:sans-serif">预加载脚本未生效，请检查 preload.js 是否存在。</div>';
    return;
  }

/* ===== 技能库 ===== */
const SKILLS = [
  {
    id: 'office', icon: '💼', name: '办公助手', desc: '写周报、做表格、整理文档',
    prompt: `【角色：资深办公助理】擅长周报月报、会议纪要、通知公告、Excel 表格、文档整理。

工作方法：
- 周报按「已完成 / 进行中 / 风险与阻塞 / 下周计划」四段组织，每条一句话说清结果，不写流水账。
- 要表格时，先用 Markdown 表格给出可直接落地的骨架（表头 + 2~3 行示例数据）。
- 会议纪要用「结论 / 待办（含负责人与时间）/ 待讨论」结构。
- 语言正式但不啰嗦，删掉所有空话套话。`,
  },
  {
    id: 'code', icon: '💻', name: '编程专家', desc: '写代码、调试、代码审查',
    prompt: `【角色：资深工程师】先让代码能跑对，再谈优雅。

工作方法：
- 给完整可运行的代码，不要写 \`// 其余略\` 这种占位。
- 关键处写简短注释，解释「为什么」而不是「这行在做什么」。
- 主动指出边界条件、异常处理和性能陷阱，但不要长篇大论。
- 代码审查按「会出错的 / 有隐患的 / 只是风格问题」三档排列，先说会出错的。
- 不确定的 API 行为要说明，不要凭印象编。`,
  },
  {
    id: 'write', icon: '✍️', name: '写作润色', desc: '写文章、改稿、提升文采',
    prompt: `【角色：专业文字工作者】中文语感好，改稿能说到点上。

工作方法：
- 润色时保留原意和原作者的表达习惯，只改该改的地方。
- 改完给出「改了什么、为什么这么改」的简短说明，按重要性列出前 3 条即可。
- 删掉冗余修饰、重复表述和空洞的形容词。
- 除非用户要求，不要擅自改变文体和篇幅量级。`,
  },
  {
    id: 'translate', icon: '🌏', name: '翻译官', desc: '中英互译、地道表达',
    prompt: `【角色：专业译者】追求地道自然，不做字对字的机器翻译。

工作方法：
- 先理解原文意图，再用目标语言重新表达，而不是逐句硬翻。
- 专有名词、术语保持一致性；有歧义时保留原文并加简短说明。
- 译完后，把拿不准或有多重译法的地方单独列出，说明各版本的语气差异。
- 用户没指定时，默认用中性、专业的书面语。`,
  },
  {
    id: 'data', icon: '📊', name: '数据分析', desc: '分析数据、做图表、写SQL',
    prompt: `【角色：数据分析师】结论先行，数字要有出处。

工作方法：
- 先给结论和关键数字，再给推导过程。
- 数据不足或样本有偏时，明确说出来，不要硬凑结论。
- 写 SQL 时说明适用的数据库方言，注意索引与全表扫描的取舍。
- 建议图表时说清「为什么用这个图」，而不只是丢一个图名。
- 区分「相关」和「因果」，不要把相关性写成因果。`,
  },
  {
    id: 'academic', icon: '🎓', name: '学术论文', desc: '写论文、文献综述、答辩',
    prompt: `【角色：学术写作顾问】严谨、克制、有结构。

工作方法：
- 帮搭结构时给出各级标题和每部分要回答的核心问题。
- 论述要有论点、论据、论证，避免空泛的宏大表述。
- 引用格式按用户指定（APA / MLA / GB7714 等），不确定就问。
- 绝不编造文献、作者、期刊、DOI 或实验数据。记不清就说记不清，并建议去哪里查。`,
  },
  {
    id: 'business', icon: '📈', name: '商业策划', desc: '商业计划、市场分析、PPT',
    prompt: `【角色：资深商业顾问】讲人话，算得清账。

工作方法：
- 分析框架优先用成熟的（如 TAM/SAM/SOM、波特五力、SWOT），但不要为了套框架而套。
- 涉及数字时给出估算口径和假设条件，让人能自己复算。
- 做 PPT 大纲时，一页一个主张，标题是结论句而不是名词短语。
- 主动指出方案里最可能不成立的那条假设。`,
  },
  {
    id: 'teacher', icon: '👨‍🏫', name: '耐心老师', desc: '讲解知识点、辅导作业',
    prompt: `【角色：耐心老师】擅长把复杂概念拆成能一步步跟下来的东西。

工作方法：
- 先用一个生活化的类比建立直觉，再给准确定义。
- 分步骤讲解，每步结束后确认这一步是否成立。
- 学生答错时，先肯定思路里对的部分，再指出卡在哪一步，不要直接给答案。
- 讲完给一道小练习巩固，并附答案要点。
- 不用居高临下的语气。`,
  },
  {
    id: 'creative', icon: '🎨', name: '创意灵感', desc: '头脑风暴、取名字、写文案',
    prompt: `【角色：创意总监】点子要多，但要能落地。

工作方法：
- 一次给 8~12 个选项，覆盖不同方向，不要在同一个思路里打转。
- 每个选项配一句话说清它的调性和适用场景。
- 命名类需求附一句 slogan 或一个使用场景，让名字活起来。
- 最后挑出你最推荐的 2~3 个，说明理由。
- 允许适度荒诞，但要标注哪些偏保守、哪些偏冒险。`,
  },
  {
    id: 'interview', icon: '🎤', name: '面试官', desc: '模拟面试、简历点评',
    prompt: `【角色：资深面试官】问得准，点评到位。

工作方法：
- 一次只问一个问题，等回答再追问，不要一口气列 10 个问题。
- 追问要往深处走：从「做了什么」追到「为什么这么做、结果如何、换你会怎么改」。
- 简历点评按「致命问题 / 可以更好 / 已经不错」三档，先说致命的。
- 指出经历描述里缺数字、缺结果的空泛表述，并给出改写示例。`,
  },
  {
    id: 'lawyer', icon: '⚖️', name: '法律顾问', desc: '合同审阅、法律常识',
    prompt: `【角色：法律顾问】讲清风险，不代替正式法律意见。

工作方法：
- 审阅条款时指出：风险点在哪、对谁不利、通常怎么改。
- 主动标出缺失的关键条款（如违约责任、争议解决、保密、知识产权归属）。
- 用通俗语言解释法律概念，再给出条款原文建议。
- 明确说明自己只能提供一般性参考，具体事务应咨询执业律师并核对现行法规。`,
  },
  {
    id: 'doctor', icon: '🩺', name: '健康顾问', desc: '健康科普、生活习惯建议',
    prompt: `【角色：健康科普顾问】只说有依据的，不吓人也不敷衍。

工作方法：
- 基于公认的健康常识和权威指南回答，不编造数据或研究结论。
- 涉及具体症状、用药、检查指标时，明确建议去正规医疗机构就诊，不给出诊断。
- 生活方式建议要具体可执行（频率、时长、强度），不要只说「注意休息」。
- 遇到可能的急症信号，第一时间提醒就医。`,
  },
];

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

const MAX_REQUEST_CHARS = 60000;   // 单次请求携带的正文上限
const SAVE_DEBOUNCE_MS = 400;
const ATTACH_STORE_CHARS = 12000;  // 附件正文存进会话时的上限（发给模型的仍是全文）

/** 会话是整份写盘的，附件正文要截断存档，否则 sessions.json 会一路膨胀到几十 MB */
function clipForStore(text) {
  const s = String(text || '');
  if (s.length <= ATTACH_STORE_CHARS) return s;
  return `${s.slice(0, ATTACH_STORE_CHARS)}\n……（附件正文共 ${s.length} 字，存档时只保留前 ${ATTACH_STORE_CHARS} 字；本轮发给模型的是完整内容）`;
}

/* ===== DOM ===== */
const chatScroll = document.getElementById('chat-container');
const chatInner = chatScroll.querySelector('.chat-inner');
const welcomeScreen = document.getElementById('welcome-screen');
const setupHint = document.getElementById('setup-hint');
const quickCards = document.getElementById('quick-cards');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const chatList = document.getElementById('chat-list');
const newChatBtn = document.getElementById('new-chat-btn');
const sidebar = document.getElementById('sidebar');
const toggleBtn = document.getElementById('toggle-btn');
const thinkToggle = document.getElementById('think-toggle');
const openFileBtn = document.getElementById('open-file-btn');
const skillBtn = document.getElementById('skill-btn');
const skillCount = document.getElementById('skill-count');
const skillPanel = document.getElementById('skill-panel');
const skillPanelMask = document.getElementById('skill-panel-mask');
const skillGrid = document.getElementById('skill-grid');
const skillPanelClose = document.getElementById('skill-panel-close');
const skillClearBtn = document.getElementById('skill-clear-btn');
const skillApplyBtn = document.getElementById('skill-apply-btn');
const attachmentBar = document.getElementById('attachment-bar');
const dropOverlay = document.getElementById('drop-overlay');
const modeSwitch = document.getElementById('mode-switch');
const singleAiSelect = document.getElementById('single-ai-select');
const multiConfigBtn = document.getElementById('multi-config-btn');
const configMask = document.getElementById('config-mask');
const configPanel = document.getElementById('config-panel');
const configClose = document.getElementById('config-close');
const configCancel = document.getElementById('config-cancel');
const configSave = document.getElementById('config-save');
const leaderGroup = document.getElementById('leader-group');
const workerGroup = document.getElementById('worker-group');
const statusDot = document.getElementById('status-dot');
const toastWrap = document.getElementById('toast-wrap');
const tokenChip = document.getElementById('token-chip');
const tokenChipText = document.getElementById('token-chip-text');

const aiPicker = document.getElementById('ai-picker');
const aiPickerBtn = document.getElementById('ai-picker-btn');
const aiPickerAvatar = document.getElementById('ai-picker-avatar');
const aiPickerName = document.getElementById('ai-picker-name');
const aiPickerMenu = document.getElementById('ai-picker-menu');
const settingsBtn = document.getElementById('settings-btn');
const sidebarSettingsBtn = document.getElementById('sidebar-settings-btn');
const sidebarChatView = document.getElementById('sidebar-chat-view');
const sidebarSettingsView = document.getElementById('sidebar-settings-view');
const svBack = document.getElementById('sv-back');
const sidebarUser = document.getElementById('sidebar-user');
const sidebarUserAvatar = document.getElementById('sidebar-user-avatar');
const sidebarUserName = document.getElementById('sidebar-user-name');
const sidebarUserStatus = document.getElementById('sidebar-user-status');
const settingsSub = document.getElementById('settings-sub');
const keyList = document.getElementById('key-list');
const contextRoundsInput = document.getElementById('context-rounds');
const temperatureInput = document.getElementById('temperature');
const temperatureOut = document.getElementById('temperature-out');
const maxTokensInput = document.getElementById('max-tokens');
const requestCharsInput = document.getElementById('request-chars');
const systemPromptInput = document.getElementById('system-prompt');
const autoTitleBtn = document.getElementById('auto-title');
const autoSaveFilesBtn = document.getElementById('auto-save-files');
const resetParamsBtn = document.getElementById('reset-params-btn');
const clearSessionsBtn = document.getElementById('clear-sessions-btn');
const dataDirHint = document.getElementById('data-dir-hint');
const setupHintBtn = document.getElementById('setup-hint-btn');
const toolMasterBtn = document.getElementById('tool-master');
const toolCommandBtn = document.getElementById('tool-command');
const toolSearchProvider = document.getElementById('tool-search-provider');
const toolSearchKey = document.getElementById('tool-search-key');
const toolSearchKeySave = document.getElementById('tool-search-key-save');
const toolSearchKeyRow = document.getElementById('tool-key-row');
const toolKeyState = document.getElementById('tool-key-state');
const toolLogEl = document.getElementById('tool-log');
const deskmate = document.getElementById('deskmate');
const deskmatePet = document.getElementById('deskmate-pet');
const deskmateImg = document.getElementById('deskmate-img');
const deskmateBubble = document.getElementById('deskmate-bubble');

const chatSearchInput = document.getElementById('chat-search-input');
const chatSearchClear = document.getElementById('chat-search-clear');
const genStatus = document.getElementById('gen-status');
const cmdMask = document.getElementById('cmd-mask');
const cmdPanel = document.getElementById('cmd-panel');
const cmdInput = document.getElementById('cmd-input');
const cmdList = document.getElementById('cmd-list');
const shortcutsMask = document.getElementById('shortcuts-mask');
const shortcutsPanel = document.getElementById('shortcuts-panel');
const shortcutsClose = document.getElementById('shortcuts-close');
const shortcutsBody = document.getElementById('shortcuts-body');

/* 研发模式 / 工作台 */
const agentToggle = document.getElementById('agent-toggle');
const agentBar = document.getElementById('agent-bar');
const agentDirText = document.getElementById('agent-dir');
const agentDirPick = document.getElementById('agent-dir-pick');
const agentDirClear = document.getElementById('agent-dir-clear');
const agentAutoBtn = document.getElementById('agent-auto-approve');

/* 上下文计量条（动态插入，避免每次改 HTML） */
const contextMeter = document.createElement('div');
contextMeter.id = 'context-meter';
contextMeter.className = 'context-meter';
document.querySelector('.input-area').insertBefore(contextMeter, document.querySelector('.input-inner'));

/* 回到底部按钮 */
const jumpBottomBtn = document.createElement('button');
jumpBottomBtn.id = 'jump-bottom';
jumpBottomBtn.className = 'jump-bottom hidden';
jumpBottomBtn.textContent = '↓ 回到最新';
document.querySelector('.main').appendChild(jumpBottomBtn);

/* ===== 状态 ===== */
let providers = [];
let prefs = { contextRounds: 6, skills: [], multi: { leader: 'deepseek', workers: ['zhipu'] }, thinkMode: false, singleProvider: 'deepseek' };

let sessions = [];
let activeSessionId = null;
let selectedSkills = [];
let pendingAttachments = [];
let currentMode = 'single';
let multiConfig = { leader: 'deepseek', workers: ['zhipu'] };

/* 研发模式：让 AI 自己把一个任务做完（勘察 → 计划 → 执行 → 验证 → 汇报） */
let agentMode = false;
let agentWorkDir = '';
let agentAutoApprove = false;

let currentReqId = null;
let isGenerating = false;
let loadingDiv = null;            // 不再挂在 session 上（否则存档会炸）
let autoScroll = true;

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function providerById(id) {
  return providers.find((p) => p.id === id) || null;
}

function configuredProviders() {
  return providers.filter((p) => p.configured);
}

function anyConfigured() {
  return configuredProviders().length > 0;
}

/* ==================================================================
 * 轻提示（替代 alert）
 * ================================================================== */
function toast(text, type = 'info', duration = 3200) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = text;
  toastWrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
  }, duration);
}

/* ==================================================================
 * Markdown 渲染（先转义，再解析；链接做协议白名单）
 * ================================================================== */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SAFE_URL_RE = /^(https?:\/\/|mailto:|tel:)/i;

function sanitizeUrl(url) {
  const trimmed = String(url || '').trim();
  return SAFE_URL_RE.test(trimmed) ? trimmed : null;
}

function renderMarkdown(text) {
  if (!text) return '';

  let html = escapeHtml(text);

  const codeBlocks = [];
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
    const idx = codeBlocks.length;
    const label = lang ? `<div class="code-lang">${escapeHtml(lang)}</div>` : '';
    codeBlocks.push(`${label}<pre><code>${code.replace(/^\n/, '')}</code></pre>`);
    return `\u0000CODEBLOCK${idx}\u0000`;
  });

  const inlineCodes = [];
  html = html.replace(/`([^`\n]+)`/g, (_m, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${code}</code>`);
    return `\u0000INLINECODE${idx}\u0000`;
  });

  html = html.replace(/((?:^\|.+\|\s*$\n?)+)/gm, (tableBlock) => {
    const lines = tableBlock.trim().split('\n').filter((l) => l.trim());
    if (lines.length < 2) return tableBlock;
    if (!lines[1].match(/^\|[\s\-:|]+\|$/)) return tableBlock;
    const parseRow = (line) => line.trim().slice(1, -1).split('|').map((c) => c.trim());
    const headers = parseRow(lines[0]);
    let table = '<table><thead><tr>';
    headers.forEach((h) => { table += `<th>${h}</th>`; });
    table += '</tr></thead><tbody>';
    lines.slice(2).forEach((line) => {
      table += '<tr>' + parseRow(line).map((cell) => `<td>${cell}</td>`).join('') + '</tr>';
    });
    return table + '</tbody></table>';
  });

  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  html = html.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

  html = html.replace(/^---+$/gm, '<hr>');
  html = html.replace(/^\*\*\*+$/gm, '<hr>');

  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*([^*]|$)/g, '$1<em>$2</em>$3');
  html = html.replace(/(^|[^_])_([^_\n]+)_([^_]|$)/g, '$1<em>$2</em>$3');
  html = html.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  // 链接：只放行 http(s) / mailto / tel，其余退化成纯文本
  html = html.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, label, url) => {
    const safe = sanitizeUrl(url);
    if (!safe) return label || '';
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  html = html.replace(/^[\-\*\+]\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);

  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li-ordered>$1</li-ordered>');
  html = html.replace(/(<li-ordered>.*<\/li-ordered>\n?)+/g, (m) =>
    '<ol>' + m.replace(/<\/?li-ordered>/g, (tag) => (tag.startsWith('</') ? '</li>' : '<li>')) + '</ol>');

  html = html.split(/\n{2,}/).map((block) => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    if (/^<(h[1-6]|ul|ol|pre|blockquote|table|hr|li)/.test(trimmed)) return trimmed;
    return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  html = html.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (_m, i) => codeBlocks[+i]);
  html = html.replace(/\u0000INLINECODE(\d+)\u0000/g, (_m, i) => inlineCodes[+i]);

  return html;
}

/* ==================================================================
 * AI 调用
 * ================================================================== */
/* 用户主动停止：单独一种错误，走到最上层时不再弹错误框 */
function abortError() {
  const e = new Error('已停止生成');
  e.isAbort = true;
  return e;
}

function isAbort(e) {
  return Boolean(e && (e.isAbort === true || e.name === 'AbortError' || /已停止生成|aborted/i.test(String((e && e.message) || ''))));
}

async function callOnce(providerId, messages, options = {}) {
  const result = await api.ai.once({
    provider: providerId,
    messages,
    model: options.model,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    thinking: options.thinking,
    reqId: options.reqId || null,      // 传了就能实时收到工具过程
  });
  return {
    content: (result && result.content) || '',
    usage: (result && result.usage) || null,
    tools: (result && result.tools) || [],
    aborted: Boolean(result && result.aborted),
  };
}

async function callOnceWithRetry(providerId, messages, options = {}, retries = 1) {
  try {
    const res = await callOnce(providerId, messages, options);
    // 用户按了停止就别再重试了 —— 否则「停止」之后还会偷偷重跑一次
    if (res.aborted) return res;
    return res;
  } catch (e) {
    if (isAbort(e)) throw abortError();
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 800));
      return callOnceWithRetry(providerId, messages, options, retries - 1);
    }
    throw e;
  }
}

/* ==================================================================
 * Token 统计
 * ================================================================== */
/* 服务商没返回 usage 时的兜底估算：中日韩字符按 1 token，其余按 4 字符 1 token */
function estimateTokens(text) {
  const s = String(text || '');
  if (!s) return 0;
  const cjk = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff]/g) || []).length;
  return Math.ceil(cjk + (s.length - cjk) / 4);
}

function usageOf(usage, promptText, completionText) {
  if (usage && usage.total) {
    return {
      prompt: usage.prompt || 0,
      completion: usage.completion || 0,
      total: usage.total,
      exact: true,
    };
  }
  const prompt = estimateTokens(promptText);
  const completion = estimateTokens(completionText);
  return { prompt, completion, total: prompt + completion, exact: false };
}

function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

function sessionTokens(session) {
  if (session && session.tokens) return session.tokens;
  const t = { prompt: 0, completion: 0, total: 0 };
  if (session) {
    session.messages.forEach((m) => {
      if (m && m.usage) {
        t.prompt += m.usage.prompt || 0;
        t.completion += m.usage.completion || 0;
        t.total += m.usage.total || 0;
      }
    });
  }
  return t;
}

function addSessionUsage(session, usage) {
  if (!session || !usage || !usage.total) return;
  if (!session.tokens) session.tokens = { prompt: 0, completion: 0, total: 0 };
  session.tokens.prompt += usage.prompt || 0;
  session.tokens.completion += usage.completion || 0;
  session.tokens.total += usage.total || 0;
}

function updateTokenChip() {
  const t = sessionTokens(getActiveSession());
  tokenChipText.textContent = fmtTokens(t.total);
  tokenChip.title = `本会话累计 ${t.total} tokens\n提示 ${t.prompt} · 补全 ${t.completion}\n点击查看明细`;
}

function buildTokenChip(usage) {
  if (!usage || !usage.total) return null;
  const el = document.createElement('div');
  el.className = 'msg-tokens';
  el.textContent = `🪙 提示 ${fmtTokens(usage.prompt)} · 补全 ${fmtTokens(usage.completion)}`
    + (usage.exact ? '' : '（估算）');
  el.title = usage.exact ? '服务商返回的实际用量' : '服务商未返回用量，这里按字符数估算';
  return el;
}

/* ==================================================================
 * 虚拟形象
 * 每个角色有两套形态：
 *   normal —— 正常版（腰部以上半身立绘），默认展示
 *   chibi  —— Q 萌版（二头身），思考中与回答完成时短暂切换，做「活起来」的反馈
 * 素材缺失时按 buildAvatar 的兜底逻辑退回 emoji
 * ================================================================== */
const CHIBI_HOLD_MS = 2600;   // 回答完成后萌版停留时长
let chibiActive = false;      // 当前是否处于萌版
let chibiTimer = null;

/* 只有这些厂商有立绘素材（assets/avatars/{id}.png）。
 * 后加入的厂商没有 PNG，这里不挡住的话页面会显示成碎图。
 * 后 7 家（混元/星火/千帆/Gemini/Groq/OpenRouter/xAI）的形象是 AI 按前 8 家的风格生成的。 */
const AVATAR_ART = new Set([
  'deepseek', 'zhipu', 'aliyun', 'moonshot', 'doubao', 'siliconflow', 'openai', 'ollama',
  'hunyuan', 'spark', 'qianfan', 'gemini', 'groq', 'openrouter', 'xai',
]);

function avatarImageSrc(providerId, variant) {
  if (!providerById(providerId)) return null;
  if (!AVATAR_ART.has(providerId)) return null;   // 没有素材就交给 emoji 兜底
  const v = variant || (chibiActive ? 'chibi' : 'normal');
  return v === 'chibi'
    ? `assets/avatars/${providerId}-chibi.png`
    : `assets/avatars/${providerId}.png`;
}

/* 桌面宠物一定要有张图，没有自家立绘时退回吉祥物 */
function petArtSrc(providerId) {
  return avatarImageSrc(providerId) || 'assets/avatars/mascot.png';
}

/* 生成一个形象节点：有素材用图（加载失败自动退回 emoji），没有直接用 emoji */
function avatarNode(providerId) {
  const p = providerById(providerId);
  const src = avatarImageSrc(providerId);
  if (!src) {
    const span = document.createElement('span');
    span.textContent = (p && p.avatar) || '🤖';
    return span;
  }
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  img.draggable = false;
  img.addEventListener('error', () => {
    const span = document.createElement('span');
    span.textContent = (p && p.avatar) || '🤖';
    if (img.parentNode) img.parentNode.replaceChild(span, img);
  });
  return img;
}

/** 把页面上所有已渲染的 AI 形象切到当前形态，带一个弹跳动效 */
function refreshAvatars() {
  const suffix = chibiActive ? '-chibi' : '';
  document.querySelectorAll('img[src*="/avatars/"]').forEach((img) => {
    if (!/(?:-chibi)?\.png$/.test(img.src)) return;
    const next = img.src.replace(/(?:-chibi)?\.png$/, suffix + '.png');
    if (next === img.src) return;
    img.src = next;
    img.classList.remove('pop');
    void img.offsetWidth;           // 强制重排，让动画能重复触发
    img.classList.add('pop');
  });
  if (typeof renderSidebarUser === 'function') renderSidebarUser();
}

/** 切换全体形象的形态。holdMs 给了就自动切回，不给就一直保持 */
function setChibi(on, holdMs) {
  clearTimeout(chibiTimer);
  if (on !== chibiActive) {
    chibiActive = on;
    refreshAvatars();
  }
  if (on && holdMs) chibiTimer = setTimeout(() => setChibi(false), holdMs);
}

function buildAvatar(meta, extraClass = '') {
  const el = document.createElement('span');
  el.className = 'ai-avatar ' + extraClass;
  if (meta.img) {
    const img = document.createElement('img');
    img.src = meta.img;
    img.alt = '';
    img.draggable = false;
    // 素材缺失（比如新厂商还没画）时退回 emoji，别留个碎图
    img.addEventListener('error', () => {
      el.classList.remove('has-img');
      el.style.backgroundColor = meta.color || '#4d6bfe';
      el.textContent = meta.avatar || '🤖';
      if (img.parentNode) img.parentNode.removeChild(img);
    });
    el.classList.add('has-img');
    el.appendChild(img);
  } else {
    el.style.backgroundColor = meta.color || '#4d6bfe';
    el.textContent = meta.avatar || '🤖';
  }
  return el;
}

function aiMeta(providerId, nameOverride) {
  const p = providerById(providerId);
  return {
    name: nameOverride || (p ? p.name : 'AI'),
    avatar: p ? p.avatar : '🤖',
    color: p ? p.color : '#4d6bfe',
    img: avatarImageSrc(providerId),
  };
}

/* ==================================================================
 * SAVE 标记解析
 * ================================================================== */
/* 文件名去掉路径分隔符和非法字符，防止模型写成 ../../x 之类 */
function safeFileName(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || '未命名.txt';
}

/* 模型常常给文件正文套一层代码围栏，这里剥掉 */
function stripCodeFence(text) {
  const t = String(text || '').trim();
  const m = t.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  return m ? m[1] : t;
}

/* 模型输出 [[SAVE:xxx]] 时经常不规矩，这里做宽容解析：
 *  - 标记里多几个空格、大小写不一致都认
 *  - 正文外面套了代码围栏就剥掉
 *  - 忘了写闭合标记时，内容一直取到消息结尾（或下一个 SAVE 之前）
 *  - 文件名做安全化处理 */
function parseSaveMarkers(content) {
  const text = String(content || '');
  const OPEN = /\[\[\s*SAVE\s*:\s*([^\]]+?)\s*\]\]/gi;
  const CLOSE = /\[\[\s*\/\s*SAVE\s*\]\]/gi;

  const opens = [];
  let m;
  while ((m = OPEN.exec(text)) !== null) {
    opens.push({ fileName: m[1], start: m.index, openEnd: m.index + m[0].length });
  }
  if (opens.length === 0) return { files: [], cleanText: text.trim() };

  const files = [];
  const ranges = [];
  opens.forEach((op, i) => {
    CLOSE.lastIndex = op.openEnd;
    const close = CLOSE.exec(text);
    const bodyEnd = close ? close.index : (i + 1 < opens.length ? opens[i + 1].start : text.length);
    const rangeEnd = close ? close.index + close[0].length : bodyEnd;
    const body = stripCodeFence(text.slice(op.openEnd, bodyEnd));
    if (body.trim()) files.push({ fileName: safeFileName(op.fileName), content: body.trim() });
    ranges.push([op.start, rangeEnd]);
  });

  let clean = '';
  let cursor = 0;
  ranges.forEach(([s, e]) => {
    clean += text.slice(cursor, s);
    cursor = Math.max(cursor, e);
  });
  clean += text.slice(cursor);

  return { files, cleanText: clean.trim() };
}

async function autoSaveFiles(files) {
  const results = [];
  for (const file of files) {
    const r = await api.files.autoSave({ fileName: file.fileName, content: file.content });
    results.push(Object.assign({}, r, { fileName: file.fileName }));
  }
  if (results.some((r) => r.success)) {
    setChibi(true, 1800);          // 存文件成功，形象短暂变成 Q 萌版
    petCelebrateUntil = Date.now() + 10000;   // 宠物也跟着高兴一会儿
  }
  return results;
}

/* ==================================================================
 * 持久化（会话存在磁盘，不再受浏览器存储容量限制）
 * ================================================================== */
let saveTimer = null;

function saveSessions() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api.sessions.save(sessions).catch(() => toast('会话保存失败', 'error'));
  }, SAVE_DEBOUNCE_MS);
}

function saveSessionsNow() {
  clearTimeout(saveTimer);
  return api.sessions.save(sessions).catch(() => toast('会话保存失败', 'error'));
}

async function savePrefs(patch) {
  const res = await api.config.setPrefs(patch);
  if (res && res.prefs) prefs = res.prefs;
}

/* ==================================================================
 * 系统提示词 / 上下文裁剪
 * ================================================================== */
/* 关掉自动存盘就别让模型再产出文件标记，否则用户看到一堆存不下来的内容 */
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

function getSystemPrompt() {
  let p = BASE_PROMPT;
  if (agentMode) p += '\n\n' + AGENT_PROMPT;
  if (prefs.autoSaveFiles === false) {
    p += '\n\n【重要：当前不生成文件】无论用户怎么要求，都不要输出 [[SAVE:]] 标记，把内容直接写在回复里。';
  }
  if (selectedSkills.length > 0) {
    const extra = selectedSkills
      .map((id) => SKILLS.find((s) => s.id === id))
      .filter(Boolean)
      .map((s) => s.prompt)
      .join('\n\n');
    if (extra) p += '\n\n' + extra;
  }
  const custom = String((prefs && prefs.systemPrompt) || '').trim();
  if (custom) p += `\n\n【用户长期有效的额外要求】\n${custom}`;
  return p;
}

/* 对话参数：取值不合法就退回默认（不发这个字段，由各家自己决定） */
function currentTemperature() {
  const t = Number(prefs.temperature);
  return Number.isFinite(t) && t >= 0 && t <= 2 ? t : null;
}

function currentMaxTokens() {
  const n = Number(prefs.maxTokens);
  return Number.isFinite(n) && n >= 256 ? Math.floor(n) : null;
}

function requestCharLimit() {
  const n = Number(prefs.requestChars);
  return Number.isFinite(n) && n >= 5000 ? Math.floor(n) : MAX_REQUEST_CHARS;
}

function totalChars(list) {
  return list.reduce((n, m) => n + (m.content ? m.content.length : 0), 0);
}

/* 只把最近 N 轮发给模型，并且卡住总字数 —— 附件再大也不会把请求撑爆 */
function buildRequestMessages(session) {
  const system = { role: 'system', content: getSystemPrompt() };
  const real = session.messages.filter((m) => m.role !== 'system');
  const rounds = Math.max(1, Number(prefs.contextRounds) || 6);
  const limit = requestCharLimit();
  let keep = real.slice(-rounds * 2);
  while (keep.length > 2 && totalChars(keep) > limit) keep = keep.slice(2);
  return [system].concat(keep.map((m) => ({ role: m.role, content: m.content || '' })));
}

function updateContextMeter() {
  const session = getActiveSession();
  if (!session) { contextMeter.textContent = ''; return; }
  const total = session.messages.filter((m) => m.role !== 'system').length;
  if (total === 0) {
    contextMeter.textContent = '';
    return;
  }
  const msgs = buildRequestMessages(session);
  const chars = totalChars(msgs);
  const shown = msgs.length - 1;
  const size = chars > 10000 ? `${(chars / 10000).toFixed(1)} 万字` : `${Math.round(chars / 100) / 10} 千字`;
  contextMeter.textContent = `本次发送 ${shown}/${total} 条 · 约 ${size}`;
  contextMeter.title = '只把最近若干轮对话发给模型，更早的内容仍保存在本地';
}

/* ==================================================================
 * 时间格式
 * ================================================================== */
function isToday(ts) {
  const d = new Date(ts || Date.now());
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function formatTime(ts) {
  const d = new Date(ts || Date.now());
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (isToday(ts)) return hhmm;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm}`;
}

/* ==================================================================
 * 附件
 * ================================================================== */
function getFileIcon(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  if (['doc', 'docx'].includes(ext)) return '📘';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📗';
  if (['ppt', 'pptx'].includes(ext)) return '📙';
  if (ext === 'pdf') return '📕';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return '🖼️';
  if (['txt', 'md', 'log'].includes(ext)) return '📄';
  if (['js', 'py', 'html', 'css', 'java', 'cpp', 'c', 'ts', 'json'].includes(ext)) return '💻';
  return '📎';
}

function fmtBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function renderAttachments() {
  attachmentBar.innerHTML = '';
  if (pendingAttachments.length === 0) {
    attachmentBar.classList.remove('show');
    return;
  }
  attachmentBar.classList.add('show');
  pendingAttachments.forEach((att) => {
    const chip = document.createElement('div');
    chip.className = `attachment-chip${att.isDir ? ' is-dir' : ''}`;
    const icon = document.createElement('span');
    icon.textContent = att.isDir ? '📁' : getFileIcon(att.name);
    const name = document.createElement('span');
    name.className = 'attachment-chip-name';
    name.textContent = att.name;
    name.title = att.path || att.name;
    const size = document.createElement('span');
    size.className = 'attachment-chip-size';
    // 目录报文件数，文件报真实体积；都拿不到才退回「内容多少字」
    size.textContent = att.isDir
      ? `${att.fileCount || 0} 个文件`
      : (fmtBytes(att.size) || `${Math.max(1, Math.round((att.content || '').length / 1000))}k 字`);
    const removeBtn = document.createElement('button');
    removeBtn.className = 'attachment-chip-remove';
    removeBtn.textContent = '✕';
    removeBtn.title = '移除';
    removeBtn.addEventListener('click', () => {
      const i = pendingAttachments.indexOf(att);
      if (i !== -1) pendingAttachments.splice(i, 1);
      renderAttachments();
      updateContextMeter();
    });
    chip.append(icon, name, size, removeBtn);
    attachmentBar.appendChild(chip);
  });
}

async function addAttachment(result) {
  if (!result || !result.success) return;
  if (result.path && pendingAttachments.some((a) => a.path === result.path)) {
    toast('这个文件已经在列表里了', 'info');
    return;
  }
  pendingAttachments.push({
    name: result.name,
    path: result.path,
    content: result.content,
    isDir: Boolean(result.isDir),
    size: Number(result.size) || 0,
    fileCount: Number(result.fileCount) || (result.isDir ? 0 : 1),
  });
  renderAttachments();
  updateContextMeter();
}

/* 文件 / 文件夹统一入口。
 * 之前只有 file:read，拖个目录进来会返回「这是一个目录」，等于白拖。 */
async function attachPath(filePath) {
  const result = await api.files.ingest(filePath);
  if (!result || !result.success) {
    toast(`读取失败：${(result && result.error) || '未知错误'}`, 'error');
    return false;
  }
  await addAttachment(result);
  return true;
}

async function attachFileByPath(filePath) {
  return attachPath(filePath);
}

async function attachFileByDialog() {
  const result = await api.files.openDialog();
  if (!result || !result.success) return;
  await addAttachment(result);
  updateContextMeter();
}

/* ==================================================================
 * 会话管理
 * ================================================================== */
function createSession(makeActive = true) {
  const session = {
    id: genId(),
    title: '新对话',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  sessions.unshift(session);
  if (makeActive) activeSessionId = session.id;
  renderChatList();
  if (makeActive) renderMessages();
  saveSessions();
  return session;
}

function getActiveSession() {
  return sessions.find((s) => s.id === activeSessionId) || null;
}

function renderChatList() {
  chatList.innerHTML = '';
  const q = sessionQuery.trim().toLowerCase();
  const list = q ? sessions.filter((s) => sessionMatches(s, q)) : sessions;

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chat-list-empty';
    empty.textContent = q ? '没有匹配的会话' : '还没有会话';
    chatList.appendChild(empty);
    return;
  }

  list.forEach((session) => {
    const item = document.createElement('div');
    item.className = 'chat-item' + (session.id === activeSessionId ? ' active' : '');
    const title = document.createElement('span');
    title.className = 'chat-item-title';
    highlightInto(title, session.title || '新对话', q);
    title.title = `${session.title || '新对话'}（双击可重命名）`;
    title.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRenameSession(session, title);
    });
    const del = document.createElement('button');
    del.className = 'chat-item-delete';
    del.textContent = '✕';
    del.title = '删除对话';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSession(session.id);
    });
    item.append(title, del);
    item.addEventListener('click', () => switchSession(session.id));
    chatList.appendChild(item);
  });
}

/* 双击会话标题就地重命名。AI 起的标题不一定合心意，得让人能改 */
function startRenameSession(session, titleEl) {
  const input = document.createElement('input');
  input.className = 'chat-rename-input';
  input.value = session.title || '';
  input.setAttribute('aria-label', '重命名会话');
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let settled = false;
  const finish = (commit) => {
    if (settled) return;
    settled = true;
    if (commit) {
      const next = input.value.trim();
      if (next && next !== session.title) {
        session.title = next.slice(0, 40);
        saveSessions();
      }
    }
    renderChatList();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

function deleteSession(id) {
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx === -1) return;
  sessions.splice(idx, 1);
  if (sessions.length === 0) {
    createSession();
  } else if (activeSessionId === id) {
    activeSessionId = sessions[0].id;
  }
  renderChatList();
  renderMessages();
  updateContextMeter();
  saveSessions();
}

/* 不依赖 AI 的标题提取：把「帮我整理桌面」压成「整理桌面」，
 * 而不是像以前那样直接截断开头十几个字。AI 标题生成失败时，它就是最终答案。 */
const TITLE_LEAD_RE = /^(帮我一下|帮我个忙|麻烦你|麻烦|拜托你|拜托|辛苦你|请你|请|你可以|你能不能|你能|能不能|能否|给我|我想让你|我想|我要你|我要|帮我)\s*/;
const TITLE_TAIL_RE = /(一下|的话|吧|呢|啊|哈|哦|嘛)\s*[。！？!?.]*$/;

function localTitle(text) {
  const raw = String(text || '')
    .replace(/【附件：[^\n]*】\s*\n?```[\s\S]*?```/g, '')
    .replace(/【附件：[^\n]*】/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return '新对话';

  // 「麻烦帮我……」这种叠了两层的，反复剥
  let s = raw;
  let prev = '';
  while (s !== prev) { prev = s; s = s.replace(TITLE_LEAD_RE, '').trim(); }

  s = s.replace(/^[，。、！？,.!?\s]+/, '').trim();
  // 只取第一个分句，后面的补充说明不算标题
  const firstSentence = (s.split(/[。,，！？!?\n]/)[0] || s).trim();
  s = firstSentence || s;
  // 去掉量词，标题紧凑一点：「写一份周报」→「写周报」
  s = s.replace(/^(写|做个|做|整理一下|整理|生成|制作|翻译|分析|总结|润色一下|润色|改写|改|查一下|查|算一下|算|列出|列)(一个|一份|一篇|一下|个|份|篇|下)/, '$1');
  s = s.replace(TITLE_TAIL_RE, '').trim().replace(/[：:，,]\s*$/, '').trim();

  if (!s) s = firstSentence || raw;
  return s.length > 12 ? `${s.slice(0, 12)}…` : (s || '新对话');
}

async function autoGenerateTitle(session, firstMessage) {
  try {
    // 用户关掉了 AI 自动命名，就用本地规则提取的结果
    if (prefs.autoTitle === false) return;
    const providerId = currentMode === 'multi' ? multiConfig.leader : singleAiSelect.value;
    if (!providerId || !providerById(providerId) || !providerById(providerId).configured) return;
    // 标题只看用户真正说的话，附件正文不参与（否则标题会变成文件名）
    const raw = String(firstMessage)
      .replace(/【附件：[^\n]*】\s*\n?```[\s\S]*?```/g, '')
      .replace(/【附件：[^\n]*】/g, '')
      .trim();
    if (!raw) return;
    const res = await callOnce(providerId, [
      { role: 'system', content: '给下面这段内容起一个不超过 8 个字的标题。只输出标题本身，不要标点、不要引号、不要解释、不要前后缀。' },
      { role: 'user', content: raw.slice(0, 300) },
    ], { maxTokens: 30, temperature: 0.3 });
    const title = String(res.content).replace(/[""'']/g, '').replace(/[。，、！？\n]/g, '').slice(0, 12).trim();
    if (title) {
      session.title = title;
      renderChatList();
      saveSessions();
    }
  } catch (e) {
    /* 标题生成失败不影响主流程：本地规则提取的结果已经挂在会话上了 */
  }
}

/* ==================================================================
 * 各种展示块
 * ================================================================== */
function buildReasoningBox(reasoningObj, { open = false, live = false } = {}) {
  const box = document.createElement('div');
  box.className = 'reasoning-box' + (open ? ' open' : '');
  box.innerHTML = `
    <div class="reasoning-header">
      <span class="reasoning-dot"></span>
      <span class="reasoning-title"></span>
      <span class="arrow">▼</span>
    </div>
    <div class="reasoning-content"></div>
  `;
  const titleEl = box.querySelector('.reasoning-title');
  titleEl.textContent = live
    ? '正在思考…'
    : `已深度思考（用时 ${reasoningObj.elapsed} 秒）`;
  box.querySelector('.reasoning-content').textContent = reasoningObj.content || '';
  box.querySelector('.reasoning-header').addEventListener('click', () => box.classList.toggle('open'));
  return box;
}

function buildStageBox(num, title, body, open = false, avatar = null) {
  const box = document.createElement('div');
  box.className = 'stage-box' + (open ? ' open' : '');
  box.innerHTML = `
    <div class="stage-header">
      <span class="stage-num">${num}</span>
      <span class="stage-name"></span>
      <span class="stage-tip">点击展开</span>
    </div>
    <div class="stage-body"></div>
  `;
  box.querySelector('.stage-name').textContent = avatar ? `${avatar} ${title}` : title;
  box.querySelector('.stage-body').textContent = body;
  box.querySelector('.stage-header').addEventListener('click', () => box.classList.toggle('open'));
  return box;
}

function buildSavedFilesCard(savedResults) {
  const ok = savedResults.filter((r) => r.success);
  const card = document.createElement('div');
  card.className = 'saved-files-card';
  const header = document.createElement('div');
  header.className = 'saved-files-header';
  header.textContent = `✅ 已自动保存 ${ok.length} 个文件到桌面`;
  card.appendChild(header);
  const list = document.createElement('div');
  list.className = 'saved-files-list';
  ok.forEach((r) => {
    const item = document.createElement('div');
    item.className = 'saved-file-item';
    const icon = document.createElement('span');
    icon.textContent = getFileIcon(r.fileName);
    const name = document.createElement('span');
    name.className = 'saved-file-name';
    name.textContent = r.fileName;
    name.title = r.fileName;
    const openBtn = document.createElement('button');
    openBtn.className = 'saved-file-btn';
    openBtn.textContent = '打开';
    openBtn.addEventListener('click', () => api.files.openInSystem(r.path));
    const folderBtn = document.createElement('button');
    folderBtn.className = 'saved-file-btn';
    folderBtn.textContent = '文件夹';
    folderBtn.addEventListener('click', () => api.files.showInFolder(r.path));
    item.append(icon, name, openBtn, folderBtn);
    list.appendChild(item);
  });
  savedResults.filter((r) => !r.success).forEach((r) => {
    const item = document.createElement('div');
    item.className = 'saved-file-item failed';
    item.textContent = `⚠️ ${r.fileName} 保存失败：${r.error || '未知原因'}`;
    list.appendChild(item);
  });
  card.appendChild(list);
  return card;
}

/* 关掉自动保存后模型还是产出了文件标记：明确告诉用户，别让他以为存下来了 */
function buildFilesOffCard(files) {
  const card = document.createElement('div');
  card.className = 'files-off-card';
  card.textContent = `自动保存已关闭，AI 产出的 ${files.length} 个文件内容没有落盘：`
    + `${files.map((f) => f.fileName).join('、')}。可在「设置 → 对话参数」里重新打开。`;
  return card;
}

function buildErrorBox(message) {
  const box = document.createElement('div');
  box.className = 'error-box';
  box.textContent = `⚠️ ${message}`;
  return box;
}

/* ==================================================================
 * 工具调用过程的可视化（AI 正在搜什么 / 读什么文件）
 * ================================================================== */
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

/** 把一次工具事件并入步骤列表（同一步只保留最新状态，running 会被 done 覆盖） */
function mergeToolStep(steps, chunk) {
  // 一次工具调用会连发几条事件（running 空 -> running 带描述 -> done），
  // 只更新该工具「还在进行中」的那条；已经结束的再开一条，这样重复调用也分得开
  const idx = steps.findIndex((s) => s.name === chunk.name && s.status === 'running');
  if (idx !== -1) {
    steps[idx] = { name: chunk.name, status: chunk.status, summary: chunk.summary };
    return;
  }
  steps.push({ name: chunk.name, status: chunk.status, summary: chunk.summary });
}

function buildToolBar(steps) {
  const bar = document.createElement('div');
  bar.className = 'tool-bar';
  const head = document.createElement('div');
  head.className = 'tool-bar-head';
  head.textContent = '🧰 AI 用过的工具';
  bar.appendChild(head);
  steps.forEach((s) => {
    const meta = TOOL_META[s.name] || { icon: '🧰', label: s.name || '工具' };
    const chip = document.createElement('div');
    chip.className = 'tool-chip';
    chip.dataset.tool = s.name || '';
    chip.dataset.status = s.status;
    chip.classList.toggle('running', s.status === 'running');
    chip.classList.toggle('denied', s.status === 'denied');
    chip.classList.toggle('error', s.status === 'error');
    const state = s.status === 'running' ? '进行中'
      : s.status === 'denied' ? '已拒绝'
        : s.status === 'error' ? '失败' : '完成';
    chip.innerHTML = `<span class="tool-chip-icon">${meta.icon}</span><span class="tool-chip-label"></span><span class="tool-chip-state">${state}</span>`;
    chip.querySelector('.tool-chip-label').textContent = s.summary ? `${meta.label} · ${s.summary}` : meta.label;
    bar.appendChild(chip);
  });
  return bar;
}

function upsertToolChip(msgDiv, chunk) {
  let bar = msgDiv.querySelector('.tool-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'tool-bar';
    const head = document.createElement('div');
    head.className = 'tool-bar-head';
    head.textContent = '🧰 AI 正在使用工具';
    bar.appendChild(head);
    msgDiv.appendChild(bar);
  }
  const sel = `.tool-chip[data-tool="${CSS.escape(chunk.name || '')}"]`;
  let chip = bar.querySelector(sel);
  if (!chip) {
    chip = document.createElement('div');
    chip.className = 'tool-chip';
    chip.dataset.tool = chunk.name || '';
    bar.appendChild(chip);
  }
  chip.dataset.status = chunk.status;
  chip.classList.toggle('running', chunk.status === 'running');
  chip.classList.toggle('denied', chunk.status === 'denied');
  chip.classList.toggle('error', chunk.status === 'error');
  const meta = TOOL_META[chunk.name] || { icon: '🧰', label: chunk.name || '工具' };
  const state = chunk.status === 'running' ? '进行中'
    : chunk.status === 'denied' ? '已拒绝'
      : chunk.status === 'error' ? '失败' : '完成';
  chip.innerHTML = `<span class="tool-chip-icon">${meta.icon}</span><span class="tool-chip-label"></span><span class="tool-chip-state">${state}</span>`;
  chip.querySelector('.tool-chip-label').textContent = chunk.summary ? `${meta.label} · ${chunk.summary}` : meta.label;
  scrollToBottom();
}

/* ---------- 研发模式的执行过程：时间线 + 计划卡 ---------- */

/* 普通模式用 mergeToolStep 合并（同一步只留一条），但研发模式要看到「它到底干了多少活」，
 * 所以另开一份 append-only 列表：同一个工具的 running→done 合成一行，不同调用各占一行。 */
function pushLiveStep(list, chunk) {
  const last = list[list.length - 1];
  if (last && last.status === 'running' && last.name === chunk.name) {
    last.status = chunk.status;
    if (chunk.summary) last.summary = chunk.summary;
    return;
  }
  list.push({ name: chunk.name || '', status: chunk.status, summary: chunk.summary || '' });
}

function buildToolTimeline(steps) {
  const panel = document.createElement('div');
  panel.className = 'tool-timeline';
  const head = document.createElement('div');
  head.className = 'tool-timeline-head';
  head.textContent = `🛠 执行过程 · ${steps.length} 步`;
  panel.appendChild(head);
  const body = document.createElement('div');
  body.className = 'tool-timeline-body';
  steps.forEach((s, i) => {
    const meta = TOOL_META[s.name] || { icon: '🧰', label: s.name || '工具' };
    const row = document.createElement('div');
    row.className = 'tool-step';
    row.dataset.status = s.status;
    const num = document.createElement('span');
    num.className = 'tool-step-num';
    num.textContent = String(i + 1);
    const icon = document.createElement('span');
    icon.className = 'tool-step-icon';
    icon.textContent = meta.icon;
    const label = document.createElement('span');
    label.className = 'tool-step-label';
    label.textContent = s.summary ? `${meta.label} · ${s.summary}` : meta.label;
    const state = document.createElement('span');
    state.className = 'tool-step-state';
    state.textContent = s.status === 'running' ? '进行中'
      : s.status === 'denied' ? '已拒绝'
        : s.status === 'error' ? '失败' : '完成';
    row.append(num, icon, label, state);
    body.appendChild(row);
  });
  panel.appendChild(body);
  return panel;
}

function buildToolSteps(steps, asTimeline) {
  return asTimeline ? buildToolTimeline(steps) : buildToolBar(steps);
}

/* 流式过程中整体重画：步骤最多几十条，重画比逐条 diff 简单也不容易错位 */
function renderToolTimelineLive(msgDiv, steps) {
  const old = msgDiv.querySelector('.tool-timeline');
  if (old) old.remove();
  if (steps.length) msgDiv.appendChild(buildToolTimeline(steps));
  scrollToBottom();
}

/* AI 用 set_plan 把计划推过来，直接渲染成清单，让用户知道它打算怎么干 */
function upsertPlanCard(msgDiv, steps) {
  let card = msgDiv.querySelector('.plan-card');
  if (!card) {
    card = document.createElement('div');
    card.className = 'plan-card';
    const head = document.createElement('div');
    head.className = 'plan-card-head';
    head.textContent = '🗺 执行计划';
    const list = document.createElement('ol');
    list.className = 'plan-list';
    card.append(head, list);
    const bubble = msgDiv.querySelector('.bubble');
    if (bubble) msgDiv.insertBefore(card, bubble);
    else msgDiv.appendChild(card);
  }
  const list = card.querySelector('.plan-list');
  list.textContent = '';
  steps.forEach((s) => {
    const li = document.createElement('li');
    li.className = 'plan-item';
    li.textContent = s;
    list.appendChild(li);
  });
  scrollToBottom();
}

/* ==================================================================
 * 消息渲染
 * ================================================================== */
function renderMessages() {
  const session = getActiveSession();
  if (!session) return;

  Array.from(chatInner.children).forEach((child) => {
    if (child.id !== 'welcome-screen') child.remove();
  });

  const realMsgs = session.messages.filter((m) => m.role !== 'system');

  if (realMsgs.length === 0) {
    welcomeScreen.classList.remove('hidden');
    refreshSetupHint();
    updateTokenChip();     // 切到空会话时，用量数字也要跟着归零
    return;
  }
  welcomeScreen.classList.add('hidden');

  realMsgs.forEach((m) => {
    if (m.role === 'user') {
      appendMessage('user', m.displayText || m.content, m.attachments || [], m.timestamp, null, false, null, null, m);
    } else {
      const { cleanText } = parseSaveMarkers(m.content || '');
      const msgDiv = appendMessage(
        'ai', cleanText, [], m.timestamp,
        aiMeta(m.providerId, m.aiName), false, m.content, m.usage, m,
      );
      if (m.reasoning) msgDiv.prepend(buildReasoningBox(m.reasoning));
      if (m.multiStages) msgDiv.prepend(buildMultiDetailBox(m.multiStages));
      if (m.savedFiles && m.savedFiles.length > 0) msgDiv.appendChild(buildSavedFilesCard(m.savedFiles));
      if (m.tools && m.tools.length) msgDiv.appendChild(buildToolSteps(m.tools, Boolean(m.agent)));
      // 历史里被手动停掉的回答，重新打开时也要看得出是停掉的
      if (m.stopped) {
        const tag = document.createElement('div');
        tag.className = 'msg-stopped-tag';
        tag.textContent = m.multiStages ? '⏹ 已手动停止 · 以上是中断前完成的部分' : '⏹ 已手动停止 · 以上是中断时的内容';
        msgDiv.appendChild(tag);
      }
    }
  });
  updateTokenChip();
  scrollToBottom(true);
}

function buildMultiDetailBox(stages) {
  const detailBox = document.createElement('div');
  detailBox.className = 'reasoning-box';
  detailBox.innerHTML = `
    <div class="reasoning-header">
      <span class="reasoning-dot"></span>
      <span class="reasoning-title">🎯 多 AI 协作详情</span>
      <span class="arrow">▼</span>
    </div>
    <div class="reasoning-content"></div>
  `;
  const contentEl = detailBox.querySelector('.reasoning-content');
  if (stages.plan) {
    const p = document.createElement('div');
    p.className = 'multi-block';
    p.textContent = `【规划】\n${stages.plan}`;
    contentEl.appendChild(p);
  }
  (stages.workers || []).forEach((r, i) => {
    const w = document.createElement('div');
    w.className = 'multi-block';
    w.textContent = `【专家${i + 1} ${r.name}】\n任务：${r.task}\n结果：${r.result}`;
    contentEl.appendChild(w);
  });
  detailBox.querySelector('.reasoning-header').addEventListener('click', () => detailBox.classList.toggle('open'));
  return detailBox;
}

function appendMessage(role, text, attachments = [], timestamp = null, meta = null, isStreaming = false, rawContent = null, usage = null, msgRef = null) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role}-message`;
  if (rawContent) msgDiv.dataset.rawContent = rawContent;

  if (role === 'user') {
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    msgDiv.appendChild(bubble);

    if (attachments.length > 0) {
      const attDiv = document.createElement('div');
      attDiv.className = 'msg-attachments';
      attachments.forEach((att) => {
        const chip = document.createElement('span');
        chip.className = 'msg-attach-chip';
        chip.textContent = `${getFileIcon(att.name)} ${att.name}`;
        attDiv.appendChild(chip);
      });
      msgDiv.appendChild(attDiv);
    }

    const timeEl = document.createElement('div');
    timeEl.className = 'msg-time';
    timeEl.textContent = formatTime(timestamp);
    msgDiv.appendChild(timeEl);

    // 改一句再重发，比删掉整段重打省事
    if (msgRef) {
      const actions = document.createElement('div');
      actions.className = 'msg-actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'msg-action';
      editBtn.type = 'button';
      editBtn.textContent = '✏️ 编辑';
      editBtn.title = '修改这条消息并重新发送';
      editBtn.addEventListener('click', () => startEditUserMessage(msgDiv, msgRef));
      actions.appendChild(editBtn);
      msgDiv.appendChild(actions);
    }
  } else {
    if (meta) {
      const metaRow = document.createElement('div');
      metaRow.className = 'ai-meta';
      metaRow.appendChild(buildAvatar(meta));
      const tag = document.createElement('span');
      tag.className = 'ai-tag';
      tag.textContent = meta.name || 'AI';
      metaRow.appendChild(tag);
      msgDiv.appendChild(metaRow);
    }

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = renderMarkdown(text) + (isStreaming ? '<span class="streaming-cursor"></span>' : '');
    msgDiv.appendChild(bubble);

    bubble.querySelectorAll('pre').forEach((pre) => {
      const btn = document.createElement('button');
      btn.className = 'code-copy-btn';
      btn.textContent = '复制';
      btn.addEventListener('click', () => {
        const code = pre.querySelector('code');
        navigator.clipboard.writeText(code ? code.textContent : pre.textContent).then(
          () => { btn.textContent = '✓ 已复制'; },
          () => { btn.textContent = '复制失败'; },
        );
        setTimeout(() => { btn.textContent = '复制'; }, 1500);
      });
      pre.appendChild(btn);
    });

    const timeEl = document.createElement('div');
    timeEl.className = 'msg-time';
    timeEl.textContent = formatTime(timestamp);
    msgDiv.appendChild(timeEl);

    const actions = document.createElement('div');
    actions.className = 'msg-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'msg-action';
    saveBtn.textContent = '💾 另存为';
    saveBtn.addEventListener('click', () => saveReplyAsFile(msgDiv.dataset.rawContent || text));

    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action';
    copyBtn.textContent = '📋 复制';
    copyBtn.addEventListener('click', () => {
      const content = msgDiv.dataset.rawContent || text;
      navigator.clipboard.writeText(content).then(
        () => { copyBtn.textContent = '✅ 已复制'; toast('已复制到剪贴板', 'success', 1600); },
        () => { copyBtn.textContent = '复制失败'; },
      );
      setTimeout(() => { copyBtn.textContent = '📋 复制'; }, 1500);
    });

    const regenBtn = document.createElement('button');
    regenBtn.className = 'msg-action';
    regenBtn.type = 'button';
    regenBtn.textContent = '🔄 重新生成';
    regenBtn.addEventListener('click', () => regenerateFrom(msgDiv));

    actions.append(saveBtn, copyBtn, regenBtn);

    if (msgRef) {
      const delBtn = document.createElement('button');
      delBtn.className = 'msg-action danger';
      delBtn.type = 'button';
      delBtn.textContent = '🗑️ 删除';
      delBtn.title = '删掉这条回答';
      delBtn.addEventListener('click', () => deleteMessage(msgRef));
      actions.appendChild(delBtn);
    }

    msgDiv.appendChild(actions);

    const chip = buildTokenChip(usage);
    if (chip) msgDiv.appendChild(chip);
  }

  chatInner.appendChild(msgDiv);
  return msgDiv;
}

/* ===== 滚动：用户手动往上翻过就不自动跟随 ===== */
function isNearBottom() {
  return chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight < 80;
}

function scrollToBottom(force = false) {
  if (force || autoScroll) {
    chatScroll.scrollTop = chatScroll.scrollHeight;
    jumpBottomBtn.classList.add('hidden');
  }
}

chatScroll.addEventListener('scroll', () => {
  autoScroll = isNearBottom();
  if (autoScroll) jumpBottomBtn.classList.add('hidden');
  else jumpBottomBtn.classList.remove('hidden');
});

jumpBottomBtn.addEventListener('click', () => {
  autoScroll = true;
  scrollToBottom(true);
});

/* ==================================================================
 * 另存为 / 重新生成
 * ================================================================== */
async function saveReplyAsFile(content) {
  const text = content || '';
  const firstLine = text.split('\n')[0].trim().slice(0, 20).replace(/[\\/:*?"<>|]/g, '');
  const result = await api.files.save({ defaultName: (firstLine || 'ai回复') + '.md', content: text });
  if (result.success) toast(`已保存到：${result.path}`, 'success', 3600);
  else if (result.error) toast(`保存失败：${result.error}`, 'error');
}

async function regenerateFrom(aiMsgDiv) {
  if (isGenerating) {
    toast('正在生成中，请先停止', 'info');
    return;
  }
  const session = getActiveSession();
  if (!session) return;

  const raw = aiMsgDiv.dataset.rawContent;
  const aiIdx = session.messages.findIndex((m) => m.role === 'assistant' && m.content === raw);
  if (aiIdx === -1) return;

  // 往前找最近一条用户消息，从那里截断重来
  let userIdx = -1;
  for (let i = aiIdx - 1; i >= 0; i -= 1) {
    if (session.messages[i].role === 'user') { userIdx = i; break; }
  }
  if (userIdx === -1) return;

  const userMsg = session.messages[userIdx];
  session.messages.splice(userIdx);
  saveSessions();
  renderMessages();

  await sendMessageInternal(userMsg.content, userMsg.displayText, userMsg.attachments || []);
}

/* ==================================================================
 * 发送主流程
 * ================================================================== */
async function sendMessageInternal(fullContent, displayText, attachmentsSnapshot, storedContent) {
  const session = getActiveSession();
  if (!session) return;

  if (!anyConfigured()) {
    toast('还没有配置任何 AI 密钥', 'error');
    openSettingsView();
    return;
  }

  // 先建好消息对象再渲染：编辑/删除按钮要拿着它去定位 session 里的位置
  const userMsg = {
    role: 'user',
    content: storedContent || fullContent,
    displayText,
    attachments: attachmentsSnapshot,
    timestamp: Date.now(),
  };

  appendMessage('user', displayText, attachmentsSnapshot, Date.now(), null, false, null, null, userMsg);
  scrollToBottom(true);

  loadingDiv = appendMessage('ai', currentMode === 'multi' ? '🎯 正在启动多 AI 协作…' : '正在思考…', [], Date.now());
  scrollToBottom(true);

  session.messages.push(userMsg);
  session.updatedAt = Date.now();
  saveSessions();

  const startTime = Date.now();
  isGenerating = true;
  setSendButtonStopMode(true);
  setChibi(true);            // 思考过程中保持 Q 萌形态
  genStatusShow(currentMode === 'multi' ? '🎯 多 AI 协作中' : '正在思考');

  let failed = false;
  let aborted = false;
  try {
    if (currentMode === 'multi') await sendMultiAI(session, fullContent, startTime);
    else await sendSingleAI(session, fullContent, startTime);
  } catch (e) {
    aborted = isAbort(e);
    failed = !aborted;
    if (failed) petLastErrorAt = Date.now();
    removeLoading();
    // 用户自己按的停止，不算出错，不弹红色错误框
    if (!aborted) appendMessage('ai', '', [], Date.now()).appendChild(buildErrorBox(e.message || '出错了'));
  } finally {
    removeLoading();
    isGenerating = false;
    setSendButtonStopMode(false);
    currentReqId = null;
    // 停止是用户自己按的，单独给个状态，别和「出错」混在一起
    if (aborted) genStatusStopped();
    else genStatusHide();
    if (aborted || failed) setChibi(false);
    else setChibi(true, CHIBI_HOLD_MS);   // 回答完成：Q 萌形态亮相一会儿再切回正常版
    updateContextMeter();
    scrollToBottom();
    if (petOpen) buildPetBubble();       // 宠物的话要跟着状态变
  }
}

function removeLoading() {
  if (loadingDiv && loadingDiv.parentNode) loadingDiv.remove();
  loadingDiv = null;
}

async function sendSingleAI(session, userContent, startTime) {
  const providerId = singleAiSelect.value;
  const provider = providerById(providerId);
  if (!provider) throw new Error('请先选择一个 AI 服务');
  if (!provider.configured) throw new Error(`${provider.name} 还没配置密钥，请到「设置」里填写`);

  removeLoading();

  const reqMessages = buildRequestMessages(session);
  const promptText = reqMessages.map((m) => m.content).join('\n');

  const msgDiv = appendMessage('ai', '', [], Date.now(), aiMeta(providerId), true);
  const bubbleEl = msgDiv.querySelector('.bubble');

  let accumulated = '';
  let reasoning = '';
  let reasoningBox = null;
  let reasoningContentEl = null;
  let renderQueued = false;

  const flush = () => {
    renderQueued = false;
    bubbleEl.innerHTML = renderMarkdown(accumulated) + '<span class="streaming-cursor"></span>';
    if (reasoningBox && reasoningContentEl) reasoningContentEl.textContent = reasoning;
    scrollToBottom();
  };
  const scheduleRender = () => {
    if (renderQueued) return;          // 每个动画帧最多重排一次
    renderQueued = true;
    requestAnimationFrame(flush);
  };

  currentReqId = genId();

  let streamError = null;
  const toolSteps = [];
  const liveSteps = [];               // 研发模式下按调用顺序记每一步
  const result = await api.ai.stream(
    currentReqId,
    {
      provider: providerId,
      messages: reqMessages,
      thinking: prefs.thinkMode,
      temperature: currentTemperature(),
      maxTokens: currentMaxTokens(),
      agent: agentMode,
      workDir: agentMode ? agentWorkDir : '',
      autoApprove: agentMode ? agentAutoApprove : false,
    },
    (chunk) => {
      if (chunk.type === 'content') {
        accumulated += chunk.text;
        genStatusSetPhase('正在回答');
        scheduleRender();
      } else if (chunk.type === 'reasoning') {
        reasoning += chunk.text;
        genStatusSetPhase('正在深度思考');
        if (!reasoningBox) {
          reasoningBox = buildReasoningBox({ content: '', elapsed: 0 }, { open: true, live: true });
          reasoningContentEl = reasoningBox.querySelector('.reasoning-content');
          msgDiv.prepend(reasoningBox);
        }
      } else if (chunk.type === 'error') {
        streamError = chunk.text;
      } else if (chunk.type === 'tool') {
        // 主进程在跑工具（搜索/读文件/执行命令），这里实时把过程显示出来
        genStatusSetPhase('正在使用工具');
        mergeToolStep(toolSteps, chunk);
        if (agentMode) {
          pushLiveStep(liveSteps, chunk);
          renderToolTimelineLive(msgDiv, liveSteps);
        } else {
          upsertToolChip(msgDiv, chunk);
        }
      } else if (chunk.type === 'plan' && Array.isArray(chunk.steps)) {
        // 研发模式下 AI 主动推的计划，渲染成清单
        upsertPlanCard(msgDiv, chunk.steps);
      }
    },
  );

  const finalText = (result && result.content) || accumulated;
  const elapsed = Math.max(1, Math.round((Date.now() - startTime) / 1000));
  // 研发模式用 append-only 的那份（能看出每一步），普通模式用合并后的（不重复堆叠）
  const shownSteps = agentMode ? liveSteps : toolSteps;

  // 用户按了停止：把已经生成的部分留下来，标上「已停止」，不要让他白等一场
  if (result && result.aborted) {
    const partial = String(accumulated || '').trim();
    msgDiv.remove();
    if (partial && session) {
      const stoppedText = parseSaveMarkers(partial).cleanText;
      const stoppedUsage = usageOf(null, promptText, partial);
      const stoppedMsg = {
        role: 'assistant',
        content: partial,
        timestamp: Date.now(),
        aiName: provider.name,
        providerId,
        usage: stoppedUsage,
        stopped: true,
      };
      session.messages.push(stoppedMsg);
      session.updatedAt = Date.now();
      addSessionUsage(session, stoppedUsage);
      saveSessions();
      updateTokenChip();
      const stoppedDiv = appendMessage('ai', stoppedText, [], stoppedMsg.timestamp, aiMeta(providerId), false, partial, stoppedUsage, stoppedMsg);
      if (reasoning) stoppedDiv.prepend(buildReasoningBox({ content: reasoning, elapsed }));
      if (shownSteps.length) stoppedDiv.appendChild(buildToolSteps(shownSteps, agentMode));
      const tag = document.createElement('div');
      tag.className = 'msg-stopped-tag';
      tag.textContent = '⏹ 已手动停止 · 以上是中断时的内容';
      stoppedDiv.appendChild(tag);
      scrollToBottom();
    }
    throw abortError();
  }

  const { files, cleanText } = parseSaveMarkers(finalText);
  const saveOff = files.length > 0 && prefs.autoSaveFiles === false;

  // 存文件这一步失败，不能把已经拿到的回答一起带走 —— 先兜住，再往下走
  let savedResults = [];
  if (files.length > 0 && !saveOff) {
    try {
      savedResults = await autoSaveFiles(files);
    } catch (e) {
      savedResults = files.map((f) => ({ success: false, fileName: f.fileName, error: (e && e.message) || '保存失败' }));
    }
  }

  msgDiv.remove();
  if (streamError) throw new Error(streamError);

  const usage = usageOf(result && result.usage, promptText, finalText);
  const aiMsg = {
    role: 'assistant',
    content: finalText,
    timestamp: Date.now(),
    aiName: provider.name,
    providerId,
    usage,
  };
  if (savedResults.length > 0) aiMsg.savedFiles = savedResults;
  if (reasoning) aiMsg.reasoning = { content: reasoning, elapsed };
  if (shownSteps.length) {
    aiMsg.tools = shownSteps.slice();
    if (agentMode) aiMsg.agent = true;
  }
  session.messages.push(aiMsg);
  session.updatedAt = Date.now();
  addSessionUsage(session, usage);
  saveSessions();
  updateTokenChip();

  const newMsgDiv = appendMessage('ai', cleanText, [], aiMsg.timestamp, aiMeta(providerId), false, finalText, usage, aiMsg);
  if (shownSteps.length) newMsgDiv.appendChild(buildToolSteps(shownSteps, agentMode));
  if (reasoning) newMsgDiv.prepend(buildReasoningBox({ content: reasoning, elapsed }));
  if (savedResults.length > 0) newMsgDiv.appendChild(buildSavedFilesCard(savedResults));
  if (saveOff) newMsgDiv.appendChild(buildFilesOffCard(files));

  if (session.messages.filter((m) => m.role !== 'system').length <= 2) {
    autoGenerateTitle(session, userContent);
  }
  scrollToBottom();
}

async function sendMultiAI(session, userContent, startTime) {
  const leader = multiConfig.leader;
  const workers = multiConfig.workers.filter((w) => providerById(w));
  if (!providerById(leader) || !providerById(leader).configured) {
    throw new Error(`${(providerById(leader) || {}).name || '统领 AI'} 还没配置密钥，请到「设置」里填写`);
  }
  if (workers.length === 0) throw new Error('请先在多 AI 配置里至少选择一个被统领 AI');

  removeLoading();
  const placeholder = appendMessage('ai', '🎯 正在启动多 AI 协作…', [], Date.now());
  scrollToBottom(true);

  currentReqId = genId();
  const workerNames = workers.map((w) => `${providerById(w).name}(${w})`).join('、');

  // 多 AI 下每个角色（总指挥 + 各位专家）都能用工具，过程实时汇总到同一条消息里
  const multiToolSteps = [];
  const multiLiveSteps = [];
  const offChunk = api.ai.onChunk(currentReqId, (chunk) => {
    if (chunk && chunk.type === 'tool') {
      mergeToolStep(multiToolSteps, chunk);
      if (agentMode) {
        pushLiveStep(multiLiveSteps, chunk);
        renderToolTimelineLive(placeholder, multiLiveSteps);
      } else {
        upsertToolChip(placeholder, chunk);
      }
      scrollToBottom();
    } else if (chunk && chunk.type === 'plan' && Array.isArray(chunk.steps)) {
      upsertPlanCard(placeholder, chunk.steps);
    }
  });

  // 多 AI 一轮下来有 1 次规划 + N 次专家 + 1 次汇总，用量要累加
  const usageAcc = { prompt: 0, completion: 0, total: 0 };
  let allExact = true;
  const accumulate = (usage, promptText, completionText) => {
    const u = usageOf(usage, promptText, completionText);
    usageAcc.prompt += u.prompt;
    usageAcc.completion += u.completion;
    usageAcc.total += u.total;
    if (!u.exact) allExact = false;
  };

  // 三个角色（规划 / 专家 / 汇总）共用一套参数，改一处就全跟着变
  const callOpts = () => ({
    reqId: currentReqId,
    thinking: prefs.thinkMode,
    temperature: currentTemperature(),
    maxTokens: currentMaxTokens(),
    agent: agentMode,
    workDir: agentMode ? agentWorkDir : '',
    autoApprove: agentMode ? agentAutoApprove : false,
  });

  // 中途被停止时要把已经跑完的阶段留下来，所以这两个放到 try 外面
  let plan = '';
  let workerResults = [];

  try {
    const planMessages = [
      {
        role: 'system',
        content: `你是一个总指挥 AI。把用户任务拆成互不重叠的子任务，分派给下面这些专家：
${workerNames}

严格按下面的格式输出，除此之外不要写任何内容：

[PLAN]
一句话说明整体思路和拆法。

[TASK:专家ID]
给这个专家的具体任务描述。

规则：
- 专家 ID 必须来自上面的列表，一个 ID 对应一个 TASK 块，不要重复。
- 每个任务要自带上下文，让专家不依赖别人的输出也能开工。
- 任务之间尽量不重叠；确实要串行的，在描述里说明先后顺序。
- 任务很小就只分一个；最多 ${workers.length} 个。
- 需要实时信息时，在任务描述里明确要求它先联网搜索，并说清楚要查什么。
- 不要输出代码块，不要加前言和解释。`,
      },
      { role: 'user', content: userContent },
    ];

    genStatusSetPhase('正在拆解任务');
    const planRes = await callOnceWithRetry(leader, planMessages, callOpts());
    if (planRes.aborted) throw abortError();
    const planReply = planRes.content;
    accumulate(planRes.usage, planMessages.map((m) => m.content).join('\n'), planReply);
    const planText = (planReply.match(/\[PLAN\]([\s\S]*?)(?=\[TASK:|$)/) || [])[1];
    plan = (planText || '').trim();

    const taskRegex = /\[TASK:([^\]]+)\]([\s\S]*?)(?=\[TASK:|$)/g;
    const tasks = [];
    let m;
    while ((m = taskRegex.exec(planReply)) !== null) {
      const wid = m[1].trim();
      if (providerById(wid)) tasks.push({ workerId: wid, task: m[2].trim() });
    }
    if (tasks.length === 0) workers.forEach((w) => tasks.push({ workerId: w, task: userContent }));

    if (plan) {
      placeholder.appendChild(
        buildStageBox(1, `统领 ${providerById(leader).name} 规划`, plan, true, providerById(leader).avatar),
      );
    }
    placeholder.querySelector('.bubble').textContent = '🎯 多 AI 并行处理中…';
    scrollToBottom();

    genStatusSetPhase(`${tasks.length} 位专家并行处理中`);
    workerResults = await Promise.all(tasks.map(async (t, i) => {
      const worker = providerById(t.workerId);
      try {
        const workerMessages = [
          {
            role: 'system',
            content: `你是 ${worker.name}，一位专业助手。

输出要求：
- 只给出任务结果本身，不要「好的」「以下是」这类开场白，也不要复述任务。
- 用 Markdown 排版；结论先行，有数据就给数据，有步骤就分步骤。
- 就当用户是直接交给你的，不要提及其它专家或分工。
- 不确定就直接说不确定，不要编造事实、数据或链接。`,
          },
          { role: 'user', content: `请完成这个任务：\n${t.task}` },
        ];
        const res = await callOnceWithRetry(t.workerId, workerMessages, callOpts());
        if (res.aborted) throw abortError();
        accumulate(res.usage, workerMessages.map((m) => m.content).join('\n'), res.content);
        return { workerId: t.workerId, name: worker.name, task: t.task, result: res.content, index: i };
      } catch (e) {
        return { workerId: t.workerId, name: worker.name, task: t.task, result: `[执行失败] ${e.message}`, index: i };
      }
    }));

    workerResults.forEach((r) => {
      placeholder.appendChild(
        buildStageBox(r.index + 2, `专家 ${r.name} 处理`, `【任务】\n${r.task}\n\n【结果】\n${r.result}`, false, providerById(r.workerId).avatar),
      );
    });
    scrollToBottom();

    const summaryInput = workerResults.map((r) => `【${r.name} 的输出】\n${r.result}`).join('\n\n');
    const summaryMessages = [
      {
        role: 'system',
        content: `你是总指挥 AI。下面是各位专家完成子任务后的输出，请综合成一份给用户的最终答案。

要求：
- 直接给出完整、连贯、可执行的答案，就当是你一个人做完的。
- 不要出现「专家A」「某位同事」这类说法，也不要复述分工过程。
- 专家结论互相矛盾时，你自己判断并说明依据；都不靠谱就直接说不确定。
- 保留有用的细节（数据、步骤、代码、表格），删掉重复和客套话。
- 用户要文件的话，照常使用 [[SAVE:文件名.扩展名]] 标记输出。`,
      },
      { role: 'user', content: `用户原始任务：\n${userContent}\n\n各位专家的输出：\n${summaryInput}` },
    ];
    genStatusSetPhase('正在汇总结果');
    const finalRes = await callOnceWithRetry(leader, summaryMessages, callOpts());
    if (finalRes.aborted) throw abortError();
    const finalReply = finalRes.content;
    accumulate(finalRes.usage, summaryMessages.map((m) => m.content).join('\n'), finalReply);

    offChunk();
    placeholder.remove();

    const { files, cleanText } = parseSaveMarkers(finalReply);
    const saveOff = files.length > 0 && prefs.autoSaveFiles === false;
    // 同样：存文件失败不能把已经汇总好的答案弄丢
    let savedResults = [];
    if (files.length > 0 && !saveOff) {
      try {
        savedResults = await autoSaveFiles(files);
      } catch (e) {
        savedResults = files.map((f) => ({ success: false, fileName: f.fileName, error: (e && e.message) || '保存失败' }));
      }
    }

    const usage = Object.assign({}, usageAcc, { exact: allExact });
    const aiMsg = {
      role: 'assistant',
      content: finalReply,
      timestamp: Date.now(),
      aiName: `多AI（统领：${providerById(leader).name}）`,
      providerId: leader,
      usage,
      multiStages: { plan, leader, workers: workerResults },
    };
    if (savedResults.length > 0) aiMsg.savedFiles = savedResults;
    const multiShownSteps = agentMode ? multiLiveSteps : multiToolSteps;
    if (multiShownSteps.length) {
      aiMsg.tools = multiShownSteps.slice();
      if (agentMode) aiMsg.agent = true;
    }
    session.messages.push(aiMsg);
    session.updatedAt = Date.now();
    addSessionUsage(session, usage);
    saveSessions();
    updateTokenChip();

    const msgDiv = appendMessage('ai', cleanText, [], aiMsg.timestamp, aiMeta(leader, aiMsg.aiName), false, finalReply, usage, aiMsg);
    msgDiv.prepend(buildMultiDetailBox(aiMsg.multiStages));
    if (multiToolSteps.length) msgDiv.appendChild(buildToolSteps(agentMode ? multiLiveSteps : multiToolSteps, agentMode));
    if (savedResults.length > 0) msgDiv.appendChild(buildSavedFilesCard(savedResults));
    if (saveOff) msgDiv.appendChild(buildFilesOffCard(files));

    if (session.messages.filter((m) => m.role !== 'system').length <= 2) {
      autoGenerateTitle(session, userContent);
    }
    scrollToBottom();
  } catch (e) {
    offChunk();
    placeholder.remove();
    // 多 AI 被手动停止：把规划 / 专家结果留下来，别让整轮白跑
    if (isAbort(e) && (plan || workerResults.length)) {
      const stoppedUsage = Object.assign({}, usageAcc, { exact: allExact });
      const stoppedMsg = {
        role: 'assistant',
        content: workerResults.length
          ? workerResults.map((r) => `【${r.name}】\n${r.result}`).join('\n\n')
          : plan,
        timestamp: Date.now(),
        aiName: `多AI（统领：${providerById(leader).name}）`,
        providerId: leader,
        usage: stoppedUsage,
        stopped: true,
        multiStages: { plan, leader, workers: workerResults },
      };
      session.messages.push(stoppedMsg);
      session.updatedAt = Date.now();
      addSessionUsage(session, stoppedUsage);
      saveSessions();
      updateTokenChip();
      const box = appendMessage('ai', '', [], stoppedMsg.timestamp, aiMeta(leader, stoppedMsg.aiName), false, stoppedMsg.content, stoppedUsage, stoppedMsg);
      box.prepend(buildMultiDetailBox(stoppedMsg.multiStages));
      const tag = document.createElement('div');
      tag.className = 'msg-stopped-tag';
      tag.textContent = '⏹ 已手动停止 · 以上是中断前完成的部分';
      box.appendChild(tag);
    }
    throw e;
  }
}

/* ==================================================================
 * 发送按钮 / 停止
 * ================================================================== */
function setSendButtonStopMode(stop) {
  sendBtn.textContent = stop ? '⏹ 停止' : '发送';
  sendBtn.classList.toggle('stop-mode', stop);
}

function stopGeneration() {
  if (currentReqId) {
    api.ai.abort(currentReqId).catch(() => {});
    currentReqId = null;
  }
}

async function sendMessage(customText = null) {
  if (isGenerating) {
    stopGeneration();
    return;
  }

  const text = customText !== null ? customText : userInput.value.trim();
  const hasAttachments = pendingAttachments.length > 0;
  if (!text && !hasAttachments) return;

  let session = getActiveSession();
  if (!session) session = createSession();

  let fullContent = text || '';
  let storedContent = text || '';
  if (hasAttachments) {
    const blocks = pendingAttachments.map((att) => `【附件：${att.name}】\n\`\`\`\n${att.content}\n\`\`\``);
    const storedBlocks = pendingAttachments.map((att) => `【附件：${att.name}】\n\`\`\`\n${clipForStore(att.content)}\n\`\`\``);
    storedContent += (storedContent ? '\n\n' : '') + storedBlocks.join('\n\n');
    fullContent += (fullContent ? '\n\n' : '') + blocks.join('\n\n');
  }

  const displayText = text || (hasAttachments ? `（发来 ${pendingAttachments.length} 个文件）` : '');
  const attachmentsSnapshot = pendingAttachments.map((a) => ({ name: a.name }));

  if (customText === null) {
    userInput.value = '';
    userInput.style.height = 'auto';
  }
  pendingAttachments = [];
  renderAttachments();

  const realCount = session.messages.filter((m) => m.role !== 'system').length;
  if (realCount === 0) {
    session.title = localTitle(displayText);
    renderChatList();
    welcomeScreen.classList.add('hidden');
  }

  await sendMessageInternal(fullContent, displayText, attachmentsSnapshot, storedContent);
}

/* ==================================================================
 * 拖拽
 * ================================================================== */
let dragCounter = 0;

function dragHasFiles(e) {
  const dt = e && e.dataTransfer;
  if (!dt) return false;
  return Array.prototype.includes.call(dt.types || [], 'Files');
}

/* 绑在 document 上而不是 .main，侧边栏上松手也能接住；
 * 另外再兜一层 window 级 preventDefault，防止 Electron 直接导航去打开被拖的文件。 */
document.addEventListener('dragenter', (e) => {
  if (!dragHasFiles(e)) return;
  e.preventDefault();
  dragCounter += 1;
  dropOverlay.classList.add('show');
});
document.addEventListener('dragover', (e) => {
  if (!dragHasFiles(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', (e) => {
  if (!dragHasFiles(e)) return;
  e.preventDefault();
  dragCounter -= 1;
  if (dragCounter <= 0) {
    dragCounter = 0;
    dropOverlay.classList.remove('show');
  }
});
document.addEventListener('drop', async (e) => {
  if (!dragHasFiles(e)) return;
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.remove('show');
  await ingestDroppedFiles(Array.from((e.dataTransfer && e.dataTransfer.files) || []));
});
window.addEventListener('dragover', (e) => { if (dragHasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', (e) => { if (dragHasFiles(e)) e.preventDefault(); });

/* Electron 32 起 File.path 被移除，渲染层拿不到真实路径 —— 这就是「拖进去没反应」的根因。
 * 现在统一走 preload 里的 webUtils.getPathForFile。目录也能拖：主进程会展开成目录树。 */
async function ingestDroppedFiles(fileList) {
  const paths = [];
  for (const file of fileList) {
    const p = api.files.pathFor(file);
    if (p && !paths.includes(p)) paths.push(p);
  }
  if (!paths.length) {
    toast('没能读出拖进来的内容，试试输入框旁边的文件按钮', 'error');
    return;
  }

  const many = paths.length > 1;
  if (many) toast(`正在读取 ${paths.length} 项……`, 'info', 1200);
  let ok = 0;
  for (const p of paths) {
    if (await attachPath(p)) ok += 1;
  }
  const failed = paths.length - ok;
  if (ok > 0) {
    toast(`已加入 ${ok} 项${failed ? `，${failed} 项读取失败` : ''}`, failed ? 'info' : 'success');
  }
  userInput.focus();
}

/* ==================================================================
 * 侧边栏设置视图（含密钥管理）
 * ================================================================== */
/* ==================================================================
 * 对话参数（温度 / 最大输出 / 上下文 / 系统提示词 …）
 * ================================================================== */
const PARAM_DEFAULTS = {
  temperature: 0.7,
  maxTokens: 0,
  contextRounds: 6,
  requestChars: 60000,
  systemPrompt: '',
  autoTitle: true,
  autoSaveFiles: true,
};

function syncParamControls() {
  const temp = typeof prefs.temperature === 'number' ? prefs.temperature : PARAM_DEFAULTS.temperature;
  temperatureInput.value = String(temp);
  temperatureOut.textContent = temp.toFixed(1);
  maxTokensInput.value = String(Number(prefs.maxTokens) || 0);
  requestCharsInput.value = String(Number(prefs.requestChars) || PARAM_DEFAULTS.requestChars);
  contextRoundsInput.value = String(Number(prefs.contextRounds) || PARAM_DEFAULTS.contextRounds);
  systemPromptInput.value = String(prefs.systemPrompt || '');

  const setSwitch = (btn, on) => {
    btn.textContent = on ? '开' : '关';
    btn.classList.toggle('on', Boolean(on));
  };
  setSwitch(autoTitleBtn, prefs.autoTitle !== false);
  setSwitch(autoSaveFilesBtn, prefs.autoSaveFiles !== false);
}

function bindParamControls() {
  temperatureInput.addEventListener('input', () => {
    temperatureOut.textContent = Number(temperatureInput.value).toFixed(1);
  });
  temperatureInput.addEventListener('change', async () => {
    await savePrefs({ temperature: Number(temperatureInput.value) });
    toast(`温度已设为 ${Number(temperatureInput.value).toFixed(1)}`, 'success', 1600);
  });

  maxTokensInput.addEventListener('change', async () => {
    const v = Math.max(0, parseInt(maxTokensInput.value, 10) || 0);
    maxTokensInput.value = String(v);
    await savePrefs({ maxTokens: v });
    toast(v ? `最大输出已设为 ${v} token` : '最大输出已改为不限制', 'success', 1600);
  });

  requestCharsInput.addEventListener('change', async () => {
    const v = Math.min(300000, Math.max(5000, parseInt(requestCharsInput.value, 10) || PARAM_DEFAULTS.requestChars));
    requestCharsInput.value = String(v);
    await savePrefs({ requestChars: v });
    updateContextMeter();
    toast(`单次请求上限已设为 ${v} 字符`, 'success', 1600);
  });

  systemPromptInput.addEventListener('change', async () => {
    await savePrefs({ systemPrompt: systemPromptInput.value.trim() });
    toast('自定义提示词已保存，后续对话生效', 'success', 1800);
  });

  autoTitleBtn.addEventListener('click', async () => {
    const next = prefs.autoTitle === false;
    await savePrefs({ autoTitle: next });
    syncParamControls();
    toast(next ? '已开启 AI 自动命名' : '已关闭 AI 自动命名，改用本地规则', 'success');
  });

  autoSaveFilesBtn.addEventListener('click', async () => {
    const next = prefs.autoSaveFiles === false;
    await savePrefs({ autoSaveFiles: next });
    syncParamControls();
    toast(next ? '已开启自动保存生成的文件' : '已关闭自动保存，AI 不再产出文件标记', 'success');
  });

  resetParamsBtn.addEventListener('click', async () => {
    if (!window.confirm('把温度、最大输出、上下文轮数等参数都恢复成默认值吗？\n（密钥和技能不受影响）')) return;
    await savePrefs(Object.assign({}, PARAM_DEFAULTS));
    syncParamControls();
    updateContextMeter();
    toast('对话参数已恢复默认', 'success');
  });
}

function openSettingsView() {
  if (sidebar.classList.contains('collapsed')) setSidebarCollapsed(false);
  renderKeyList();
  refreshToolPanel();
  syncParamControls();
  sidebar.classList.add('settings-mode');
  sidebarChatView.classList.add('hidden');
  sidebarSettingsView.classList.remove('hidden');
}

function closeSettingsView() {
  sidebar.classList.remove('settings-mode');
  sidebarSettingsView.classList.add('hidden');
  sidebarChatView.classList.remove('hidden');
}

function renderKeyList() {
  keyList.innerHTML = '';
  // 供应商有十几个了，配过密钥的排前面，先让你看得见正在用的
  const ordered = providers.slice().sort((a, b) => {
    const av = a.configured ? 0 : 1;
    const bv = b.configured ? 0 : 1;
    return av - bv;
  });
  // 一家都没配过的话，默认替你展开第一家，不然找不到从哪填
  const anyConfigured = ordered.some((p) => p.configured);

  ordered.forEach((p, index) => {
    // 已配置和未配置之间插一条分隔线
    if (index > 0 && ordered[index - 1].configured && !p.configured) {
      const div = document.createElement('div');
      div.className = 'key-list-divider';
      div.textContent = '以下还没配置密钥';
      keyList.appendChild(div);
    }
    const row = document.createElement('div');
    row.className = 'key-row' + (p.configured ? ' configured' : '');

    // 折叠行：一行一家，点开才见模型/密钥表单。十几个家全部摊开根本没法看。
    const rowBody = document.createElement('div');
    rowBody.className = 'key-body hidden';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'key-head key-toggle';
    const avatar = buildAvatar({ img: avatarImageSrc(p.id), avatar: p.avatar, color: p.color }, 'key-avatar');
    const nameWrap = document.createElement('div');
    nameWrap.className = 'key-name-wrap';
    const name = document.createElement('span');
    name.className = 'key-name';
    name.textContent = p.name;
    // 已存过的 key 直接显示结尾几位，一眼就知道不用重填
    const tail = document.createElement('span');
    tail.className = 'key-tail';
    if (p.keyTail === '✗') {
      tail.textContent = '密钥已失效，请重新填写';
      tail.classList.add('broken');
      row.classList.add('broken');
    } else if (p.keyTail) {
      tail.textContent = `已保存 · 结尾 ${p.keyTail}`;
    } else if (p.optionalKey) {
      tail.textContent = '本机模式，无需密钥';
    } else {
      tail.textContent = '未配置';
    }
    nameWrap.append(name, tail);
    head.append(avatar, nameWrap);

    const chevron = document.createElement('span');
    chevron.className = 'key-chevron';
    chevron.textContent = '▸';
    head.appendChild(chevron);

    const setOpen = (open) => {
      rowBody.classList.toggle('hidden', !open);
      row.classList.toggle('open', open);
      chevron.textContent = open ? '▾' : '▸';
    };
    head.addEventListener('click', () => {
      // 手风琴：一次只展开一家，来回比较才不乱
      const willOpen = rowBody.classList.contains('hidden');
      keyList.querySelectorAll('.key-row.open').forEach((r) => {
        r.classList.remove('open');
        const b = r.querySelector('.key-body');
        if (b) b.classList.add('hidden');
        const c = r.querySelector('.key-chevron');
        if (c) c.textContent = '▸';
      });
      setOpen(willOpen);
    });

    const modelRow = document.createElement('div');
    modelRow.className = 'key-model-row';
    const modelLabel = document.createElement('span');
    modelLabel.textContent = '模型';
    // 用 input + datalist：既能选预设，也能手填（Ollama 的本地模型名千奇百怪）
    const modelInput = document.createElement('input');
    modelInput.className = 'settings-input';
    modelInput.value = p.model || '';
    modelInput.setAttribute('list', `models-${p.id}`);
    modelInput.title = p.allowCustomModel ? '可以直接手填模型名' : '从预设里选，也可以手填';
    const datalist = document.createElement('datalist');
    datalist.id = `models-${p.id}`;
    (p.models && p.models.length ? p.models : [p.model]).forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      datalist.appendChild(opt);
    });
    modelInput.addEventListener('change', async () => {
      const value = modelInput.value.trim();
      if (!value) return;
      await savePrefs({ modelOverrides: Object.assign({}, prefs.modelOverrides, { [p.id]: value }) });
      await refreshConfig();
      toast(`${p.name} 模型已切换为 ${value}`, 'success');
    });
    modelRow.append(modelLabel, modelInput, datalist);

    const inputRow = document.createElement('div');
    inputRow.className = 'key-input-row';
    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'settings-input key-input';
    input.placeholder = p.keyTail ? '已保存，留空就不改' : (p.keyHint || '粘贴密钥');
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
    });

    // 密码明文开关，粘错的时候能看一眼
    const eyeBtn = document.createElement('button');
    eyeBtn.className = 'key-icon-btn';
    eyeBtn.type = 'button';
    eyeBtn.title = '显示 / 隐藏';
    eyeBtn.textContent = '👁';
    eyeBtn.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      input.focus();
    });

    const saveBtn = document.createElement('button');
    saveBtn.className = 'key-btn primary';
    saveBtn.textContent = '保存';
    saveBtn.addEventListener('click', async () => {
      const value = input.value.trim();
      if (!value) {
        toast('请先粘贴密钥', 'info');
        return;
      }
      const res = await api.config.setKey(p.id, value);
      if (res.success) {
        input.value = '';
        input.type = 'password';
        toast(`${p.name} 密钥已保存，下次打开自动带上`, 'success');
        await refreshConfig();
      } else {
        toast(res.error || '保存失败', 'error');
      }
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'key-btn';
    removeBtn.textContent = '清除';
    removeBtn.disabled = !p.configured;
    removeBtn.addEventListener('click', async () => {
      await api.config.removeKey(p.id);
      toast(`${p.name} 密钥已清除`, 'success');
      await refreshConfig();
    });

    const link = document.createElement('button');
    link.className = 'key-link';
    link.textContent = '去申请 ↗';
    link.addEventListener('click', () => api.app.openExternal(p.keyUrl));

    inputRow.append(input, eyeBtn, saveBtn, removeBtn);
    rowBody.append(modelRow, inputRow, link);
    row.append(head, rowBody);
    keyList.appendChild(row);
    if (!anyConfigured && index === 0) setOpen(true);
  });

  // 分区标题上挂个「3/15」，不用展开就知道配了几家
  const countEl = document.getElementById('key-count');
  if (countEl) {
    const n = ordered.filter((p) => p.configured).length;
    countEl.textContent = ` ${n}/${ordered.length}`;
    countEl.title = `${n} 家已配置密钥`;
  }
}

/* 设置分区折叠：点标题收起 / 展开。
 * 密钥管理默认收着（15 家全摊开没法看），其它分区默认展开。 */
document.querySelectorAll('.settings-section-head').forEach((btn) => {
  btn.addEventListener('click', () => {
    const sec = document.getElementById(btn.dataset.sec);
    if (!sec) return;
    const collapsed = sec.classList.toggle('collapsed');
    const chev = btn.querySelector('.sec-chevron');
    if (chev) chev.textContent = collapsed ? '▸' : '▾';
  });
});

/* ==================================================================
 * AI 能力：联网搜索 + 本地访问
 * ================================================================== */
let toolPrefs = { enabled: false, allowCommand: false, searchProvider: 'ddg' };

const SEARCH_PROVIDER_KEY_URL = {
  tavily: 'https://app.tavily.com/home',
  serper: 'https://serper.dev/api-key',
  bing: 'https://portal.azure.com/#view/Microsoft_Azure_Bing',
};

function renderToolPanel(info) {
  toolPrefs = Object.assign({ enabled: false, allowCommand: false, searchProvider: 'ddg' }, info.prefs || {});

  toolMasterBtn.textContent = toolPrefs.enabled ? '开' : '关';
  toolMasterBtn.classList.toggle('on', toolPrefs.enabled);
  toolCommandBtn.textContent = toolPrefs.allowCommand ? '开' : '关';
  toolCommandBtn.classList.toggle('on', toolPrefs.allowCommand);
  toolCommandBtn.disabled = !toolPrefs.enabled;

  toolSearchProvider.value = toolPrefs.searchProvider || 'ddg';
  const needKey = toolPrefs.searchProvider !== 'ddg';
  toolSearchKeyRow.classList.toggle('hidden', !needKey);
  toolSearchKey.placeholder = needKey ? '粘贴搜索服务的 API Key' : '当前使用免密钥搜索，无需填写';
  toolKeyState.textContent = needKey
    ? (info.searchKeyTail ? `已保存 · 结尾 ${info.searchKeyTail}` : '还没填 key，搜索会退回免密钥方案')
    : '免密钥搜索已就绪';

  if (!toolLogEl) return;
  toolLogEl.innerHTML = '';
  const logs = (info.log && info.log.length) ? info.log : [];
  if (!logs.length) {
    const empty = document.createElement('div');
    empty.className = 'tool-log-empty';
    empty.textContent = '还没有任何工具被调用';
    toolLogEl.appendChild(empty);
    return;
  }
  logs.slice(0, 12).forEach((item) => {
    const row = document.createElement('div');
    row.className = 'tool-log-row' + (item.risk === 'high' ? ' risk' : '');
    const t = new Date(item.time);
    const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    const meta = TOOL_META[item.tool] || { icon: '🧰', label: item.tool };
    const name = document.createElement('span');
    name.className = 'tool-log-name';
    name.textContent = `${meta.icon} ${item.summary || meta.label}`;
    const right = document.createElement('span');
    right.className = 'tool-log-time';
    right.textContent = `${hhmm}${item.result === '用户拒绝' ? ' · 已拒绝' : ''}`;
    row.append(name, right);
    toolLogEl.appendChild(row);
  });
}

async function refreshToolPanel() {
  if (!api.tools || !api.tools.get) return;
  try {
    renderToolPanel(await api.tools.get());
  } catch (e) { /* 面板没开就算了 */ }
}

toolMasterBtn.addEventListener('click', async () => {
  const next = !toolPrefs.enabled;
  if (next && !window.confirm(
    '打开后，AI 将可以：\n\n'
    + '• 联网搜索与打开网页\n'
    + '• 读取、写入、删除你电脑上的文件\n'
    + (toolPrefs.allowCommand ? '• 在你的电脑上执行命令\n' : '')
    + '\n写入 / 删除 / 执行命令每次都会弹窗确认，系统目录与凭据目录永久拒绝。\n\n确定要打开吗？')) {
    return;
  }
  await api.tools.setPrefs({ enabled: next });
  await refreshToolPanel();
  toast(next ? '已打开 AI 能力' : '已关闭 AI 能力', 'success');
});

toolCommandBtn.addEventListener('click', async () => {
  if (!toolPrefs.enabled) { toast('先打开上面的总开关', 'info'); return; }
  const next = !toolPrefs.allowCommand;
  if (next && !window.confirm('允许 AI 在你电脑上执行命令？\n\n每条命令都会先弹窗给你看，明显的危险命令会被直接拒绝。')) return;
  await api.tools.setPrefs({ allowCommand: next });
  await refreshToolPanel();
  toast(next ? '已允许执行命令' : '已禁止执行命令', 'success');
});

toolSearchProvider.addEventListener('change', async () => {
  await api.tools.setPrefs({ searchProvider: toolSearchProvider.value });
  await refreshToolPanel();
  if (SEARCH_PROVIDER_KEY_URL[toolSearchProvider.value]) {
    toast('可以点下面的输入框上方提示去申请 key', 'info');
  }
});

toolSearchKeySave.addEventListener('click', async () => {
  const v = toolSearchKey.value.trim();
  if (!v) { toast('请先粘贴 key', 'info'); return; }
  await api.tools.setSearchKey(v);
  toolSearchKey.value = '';
  await refreshToolPanel();
  toast('搜索服务的 key 已保存', 'success');
});

/* ==================================================================
 * 技能 / 多 AI 配置面板
 * ================================================================== */
function renderSkillGrid() {
  skillGrid.innerHTML = '';
  SKILLS.forEach((skill) => {
    const card = document.createElement('div');
    card.className = 'skill-card' + (selectedSkills.includes(skill.id) ? ' selected' : '');
    card.innerHTML = `
      <div class="skill-card-icon">${skill.icon}</div>
      <div class="skill-card-name"></div>
      <div class="skill-card-desc"></div>
    `;
    card.querySelector('.skill-card-name').textContent = skill.name;
    card.querySelector('.skill-card-desc').textContent = skill.desc;
    card.addEventListener('click', () => {
      const idx = selectedSkills.indexOf(skill.id);
      if (idx === -1) selectedSkills.push(skill.id);
      else selectedSkills.splice(idx, 1);
      card.classList.toggle('selected');
    });
    skillGrid.appendChild(card);
  });
}

function updateSkillBadge() {
  skillCount.textContent = selectedSkills.length;
  skillBtn.classList.toggle('active', selectedSkills.length > 0);
}

function openSkillPanel() {
  renderSkillGrid();
  skillPanel.classList.add('show');
  skillPanelMask.classList.add('show');
}

function closeSkillPanel() {
  skillPanel.classList.remove('show');
  skillPanelMask.classList.remove('show');
}

function renderMultiConfigGroups() {
  leaderGroup.innerHTML = '';
  workerGroup.innerHTML = '';
  providers.forEach((p) => {
    const label = document.createElement('label');
    label.className = 'config-radio';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'leader';
    radio.value = p.id;
    radio.checked = p.id === multiConfig.leader;
    const span = document.createElement('span');
    span.textContent = p.name;
    label.append(radio, span);
    leaderGroup.appendChild(label);

    const clabel = document.createElement('label');
    clabel.className = 'config-checkbox';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = p.id;
    checkbox.checked = multiConfig.workers.includes(p.id);
    const cspan = document.createElement('span');
    cspan.textContent = p.name;
    clabel.append(checkbox, cspan);
    workerGroup.appendChild(clabel);
  });
}

function openConfigPanel() {
  renderMultiConfigGroups();
  configPanel.classList.add('show');
  configMask.classList.add('show');
}

function closeConfigPanel() {
  configPanel.classList.remove('show');
  configMask.classList.remove('show');
}

/* Esc 或点击主区域时收起所有浮层（侧边栏设置是「视图」不是浮层，不在这里收） */
function closeFloatingLayers() {
  closeConfigPanel();
  closeSkillPanel();
  closeAiPicker();
}

function closeAllPanels() {
  closeFloatingLayers();
}

/* ==================================================================
 * 状态刷新
 * ================================================================== */
/* ==================================================================
 * 研发模式：让 AI 自己把一个任务做完
 *
 * 三件套：模式开关 + 工作目录 + 自动批准。
 * 自动批准只在「工作目录内」生效，目录外照旧弹窗 —— 主进程那边也是这么判的，
 * 两边一致，别让这个开关变成一张空白支票。
 * ================================================================== */
function applyAgentMode() {
  agentToggle.classList.toggle('active', agentMode);
  agentToggle.title = agentMode
    ? '研发模式已开启：AI 会自己勘察 → 计划 → 改代码 → 跑验证（点击关闭）'
    : '研发模式：让 AI 自己勘察、计划、写代码、跑验证，把任务做完';
  agentBar.classList.toggle('hidden', !agentMode);
  agentDirText.textContent = agentWorkDir || '未选择';
  agentDirText.title = agentWorkDir || '未选择（AI 不知道该在哪干活，建议选一个）';
  agentDirText.classList.toggle('empty', !agentWorkDir);
  agentDirClear.classList.toggle('hidden', !agentWorkDir);
  agentAutoBtn.classList.toggle('hidden', !agentWorkDir);
  agentAutoBtn.textContent = agentAutoApprove ? '自动批准：开' : '自动批准：关';
  agentAutoBtn.classList.toggle('on', agentAutoApprove);
  agentAutoBtn.title = agentAutoApprove
    ? '工作目录内的写/删/跑命令不再逐个弹窗；目录外仍然会问'
    : '每次写文件 / 删除 / 跑命令都会先弹窗问你';
  updateContextMeter();
}

function setAgentMode(on) {
  agentMode = Boolean(on);
  applyAgentMode();
  savePrefs({ agentMode });
  if (agentMode) {
    toast(agentWorkDir
      ? '研发模式已开启：AI 会自己勘察 → 计划 → 改代码 → 跑验证'
      : '研发模式已开启，建议先在下方选一个工作目录', 'info');
  }
}

async function pickAgentDir() {
  const res = await api.files.pickDir();
  if (!res || !res.success) return;
  agentWorkDir = res.path;
  applyAgentMode();
  savePrefs({ agentWorkDir });
  toast(`工作目录：${agentWorkDir}`, 'success');
}

function clearAgentDir() {
  agentWorkDir = '';
  agentAutoApprove = false;
  applyAgentMode();
  savePrefs({ agentWorkDir: '', agentAutoApprove: false });
}

function toggleAutoApprove() {
  if (!agentWorkDir) {
    toast('先选一个工作目录 —— 自动批准只在目录内生效', 'info');
    return;
  }
  agentAutoApprove = !agentAutoApprove;
  applyAgentMode();
  savePrefs({ agentAutoApprove });
  toast(agentAutoApprove
    ? '已开启：工作目录内不再逐个弹窗，目录外仍会问你'
    : '已关闭：写文件 / 删除 / 跑命令都会先问你',
  agentAutoApprove ? 'info' : 'success');
}

agentToggle.addEventListener('click', () => setAgentMode(!agentMode));
agentDirPick.addEventListener('click', pickAgentDir);
agentDirClear.addEventListener('click', clearAgentDir);
agentAutoBtn.addEventListener('click', toggleAutoApprove);

async function refreshConfig() {
  const cfg = await api.config.get();
  providers = cfg.providers || [];
  prefs = cfg.prefs || prefs;

  multiConfig = (prefs.multi && prefs.multi.leader) ? prefs.multi : multiConfig;
  selectedSkills = Array.isArray(prefs.skills) ? prefs.skills.slice() : [];
  updateSkillBadge();

  agentMode = prefs.agentMode === true;
  agentWorkDir = String(prefs.agentWorkDir || '');
  // 没工作目录就不可能自动批准，防止上次的状态残留成一张空白支票
  agentAutoApprove = prefs.agentAutoApprove === true && Boolean(agentWorkDir);
  applyAgentMode();

  const previous = singleAiSelect.value;
  singleAiSelect.innerHTML = '';
  providers.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.configured ? `${p.avatar} ${p.name}` : `${p.avatar} ${p.name}（未配置）`;
    opt.disabled = !p.configured;
    singleAiSelect.appendChild(opt);
  });

  const preferred = providers.find((p) => p.id === prefs.singleProvider && p.configured)
    || providers.find((p) => p.id === previous && p.configured)
    || providers.find((p) => p.configured);
  if (preferred) {
    singleAiSelect.value = preferred.id;
    if (prefs.singleProvider !== preferred.id) savePrefs({ singleProvider: preferred.id });
  }

  statusDot.classList.toggle('offline', !anyConfigured());
  statusDot.title = anyConfigured() ? '已就绪' : '尚未配置密钥';
  settingsSub.textContent = providers.length && providers[0].encrypted
    ? '密钥已用系统级加密保存在本机'
    : '密钥保存在本机（当前系统不支持系统级加密）';

  const info = await api.app.info();
  dataDirHint.textContent = `会话与配置保存在：${info.dataDir}`;

  renderMultiConfigGroups();
  renderAiPicker();
  refreshThinkToggle();
  updatePetArt();
  if (petBalances && petOpen) invalidatePetBalance();
  else if (petOpen) buildPetBubble();
  if (sidebar.classList.contains('settings-mode')) renderKeyList();
  refreshSetupHint();
  renderSidebarUser();
  updateContextMeter();
  updateTokenChip();
}

function refreshSetupHint() {
  if (!setupHint) return;
  setupHint.classList.toggle('hidden', anyConfigured());
}

/* ==================================================================
 * 左下角侧边栏：当前 AI 信息区
 * ================================================================== */
function renderSidebarUser() {
  const p = providerById(singleAiSelect.value) || configuredProviders()[0];
  if (p) {
    // 没有自家立绘的厂商退回吉祥物，别留空白或碎图
    sidebarUserAvatar.src = petArtSrc(p.id);
    sidebarUserAvatar.style.visibility = 'visible';
    sidebarUserAvatar.onerror = () => { sidebarUserAvatar.style.visibility = 'hidden'; };
    sidebarUserName.textContent = p.name;
    sidebarUserStatus.textContent = p.hasKey
      ? '已就绪'
      : (p.optionalKey ? '本机模式' : '未配置密钥');
    sidebarUserStatus.classList.toggle('warn', !p.hasKey && !p.optionalKey);
  } else {
    sidebarUserAvatar.style.visibility = 'hidden';
    sidebarUserName.textContent = 'AI 助手';
    sidebarUserStatus.textContent = '未配置密钥';
    sidebarUserStatus.classList.add('warn');
  }
}

sidebarUser.addEventListener('click', openSettingsView);

/* ==================================================================
 * 顶部 AI 选择器：每一项都带自己的漫画形象
 * ================================================================== */
let aiPickerOpen = false;

function renderAiPicker() {
  const p = providerById(singleAiSelect.value) || configuredProviders()[0];
  aiPickerAvatar.innerHTML = '';
  if (p) {
    aiPickerAvatar.appendChild(avatarNode(p.id));
    aiPickerName.textContent = p.name;
    aiPickerBtn.classList.remove('empty');
  } else {
    aiPickerName.textContent = '未配置 AI';
    aiPickerBtn.classList.add('empty');
  }
}

function renderAiPickerMenu() {
  aiPickerMenu.innerHTML = '';
  providers.forEach((p) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ai-picker-item'
      + (p.id === singleAiSelect.value ? ' active' : '')
      + (p.configured ? '' : ' disabled');

    const av = document.createElement('span');
    av.className = 'ai-picker-item-avatar';
    av.appendChild(avatarNode(p.id));

    const txt = document.createElement('span');
    txt.className = 'ai-picker-item-text';
    const nm = document.createElement('span');
    nm.className = 'ai-picker-item-name';
    nm.textContent = p.name;
    const st = document.createElement('span');
    st.className = 'ai-picker-item-sub';
    st.textContent = p.hasKey ? (p.keyTail && p.keyTail !== '✗' ? `已保存 · ${p.keyTail}` : '已就绪')
      : (p.optionalKey ? '本机模式' : '未配置密钥');
    txt.append(nm, st);

    item.append(av, txt);
    if (!p.configured) {
      item.addEventListener('click', () => {
        closeAiPicker();
        toast(`${p.name} 还没配置密钥，侧边栏设置已打开`, 'info');
        openSettingsView();
      });
    } else {
      item.addEventListener('click', async () => {
        await selectProvider(p.id);
        closeAiPicker();
        toast(`已切换到 ${p.name}`, 'success', 1800);
      });
    }
    aiPickerMenu.appendChild(item);
  });
}

/* 换 AI 的公共入口：下拉菜单、命令面板都走这里，保证该刷新的都刷新 */
async function selectProvider(id) {
  if (!providerById(id)) return;
  singleAiSelect.value = id;
  await savePrefs({ singleProvider: id });
  renderAiPicker();
  renderSidebarUser();
  refreshThinkToggle();
  updatePetArt();
  invalidatePetBalance();   // 换人了，余额要重新查，不能沿用上一家的
}

function openAiPicker() {
  renderAiPickerMenu();
  aiPickerMenu.classList.remove('hidden');
  aiPickerBtn.classList.add('open');
  aiPickerOpen = true;
}

function closeAiPicker() {
  if (!aiPickerOpen) return;
  aiPickerMenu.classList.add('hidden');
  aiPickerBtn.classList.remove('open');
  aiPickerOpen = false;
}

aiPickerBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (aiPickerOpen) closeAiPicker();
  else openAiPicker();
});

/* 点击其它任何地方都收起浮层：下拉、技能面板、多 AI 配置面板 */
document.addEventListener('mousedown', (e) => {
  const t = e.target;
  if (aiPickerOpen && t && !aiPicker.contains(t)) closeAiPicker();
});

mainEl.addEventListener('mousedown', (e) => {
  if (e.target.closest('.ai-picker, .skill-panel, .config-panel')) return;
  closeFloatingLayers();
});

/* ==================================================================
 * 右下角桌面宠物浮窗：可拖动 + 点头像弹信息气泡
 * ================================================================== */
const PET_SIZE = 104;
const PET_DEFAULT = { right: 26, bottom: 118 };
const BALANCE_TTL_MS = 60000;

let petOpen = false;
let petPos = null;              // 相对 main 左上角的坐标，null 表示还在默认位置
let petDrag = null;
let petSuppressClick = false;
let petBalances = null;         // { items, fetchedAt }

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

/* 最近一次出错 / 最近一次存文件成功的时间，用来让宠物说应景的话 */
let petLastErrorAt = 0;
let petCelebrateUntil = 0;

function pickLine(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}

function petLine() {
  if (isGenerating) return pickLine(PET_LINES_THINKING);
  if (!anyConfigured()) return '还没接上任何 AI，带我去设置里配一个吧';
  if (Date.now() < petCelebrateUntil) return pickLine(PET_LINES_DONE);
  if (Date.now() - petLastErrorAt < 15000) return pickLine(PET_LINES_UPSET);

  const bal = petBalanceNumber();
  if (bal !== null && bal > 0 && bal < 2) return '我这点余额快见底了，再不充值就要饿肚子了…';
  if (bal !== null && bal >= 50) return '余额挺充裕的，使劲用';

  const h = new Date().getHours();
  if (h >= 23 || h < 6) return '这么晚还在忙？早点睡，我先替你看着余额';
  if (h < 11) return '早上好，今天先从哪一件事开始？';
  return pickLine(Math.random() < 0.25 ? PET_LINES_TIP : PET_LINES_IDLE);
}

function petApplyPosition() {
  const maxX = Math.max(0, mainEl.clientWidth - PET_SIZE - 4);
  const maxY = Math.max(0, mainEl.clientHeight - PET_SIZE - 4);
  const x = Math.min(Math.max(0, Math.round(petPos.x)), maxX);
  const y = Math.min(Math.max(0, Math.round(petPos.y)), maxY);
  petPos = { x, y };
  Object.assign(deskmate.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
  // 靠左 / 靠上时把气泡翻到另一侧，避免出屏
  deskmate.classList.toggle('bubble-left', x < mainEl.clientWidth / 2);
  deskmate.classList.toggle('bubble-below', y < 240);
}

function petResetPosition() {
  petPos = {
    x: mainEl.clientWidth - PET_SIZE - PET_DEFAULT.right,
    y: mainEl.clientHeight - PET_SIZE - PET_DEFAULT.bottom,
  };
  petApplyPosition();
  savePrefs({ petPos: null });
  toast('已回到右下角原位', 'success', 1600);
}

function updatePetArt() {
  const p = providerById(singleAiSelect.value) || configuredProviders()[0];
  if (p) deskmateImg.src = petArtSrc(p.id);
}

/* ---------- 拖动 ---------- */
deskmatePet.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const rect = deskmate.getBoundingClientRect();
  const mainRect = mainEl.getBoundingClientRect();
  petSuppressClick = false;   // 每次按下都重置，避免上一次拖动把这次点击吞了
  petDrag = {
    // 抓取偏移要在同一套坐标里算，这里统一用视口坐标；落到 main 里时再统一减 main 的偏移
    grabX: e.clientX - rect.left,
    grabY: e.clientY - rect.top,
    startX: e.clientX, startY: e.clientY, moved: false,
  };
  deskmate.classList.add('dragging');
  try { deskmatePet.setPointerCapture(e.pointerId); } catch (err) { /* 某些环境不支持就跳过 */ }
});

deskmatePet.addEventListener('pointermove', (e) => {
  if (!petDrag) return;
  const mainRect = mainEl.getBoundingClientRect();
  petPos = {
    x: e.clientX - mainRect.left - petDrag.grabX,
    y: e.clientY - mainRect.top - petDrag.grabY,
  };
  if (Math.abs(e.clientX - petDrag.startX) > 3 || Math.abs(e.clientY - petDrag.startY) > 3) petDrag.moved = true;
  petApplyPosition();
});

function petEndDrag() {
  if (!petDrag) return;
  const moved = petDrag.moved;
  petDrag = null;
  deskmate.classList.remove('dragging');
  if (moved) {
    savePrefs({ petPos });
    petSuppressClick = true;   // 拖完了浏览器还会补一个 click，这里把它吃掉（在 click 里消费，不靠计时）
  }
}
deskmatePet.addEventListener('pointerup', petEndDrag);
deskmatePet.addEventListener('pointercancel', petEndDrag);

deskmatePet.addEventListener('dblclick', () => petResetPosition());

deskmatePet.addEventListener('click', (e) => {
  e.stopPropagation();
  if (petSuppressClick) { petSuppressClick = false; return; }
  if (petOpen) closePet(); else openPet();
});

window.addEventListener('resize', () => {
  if (petPos) petApplyPosition();
});

/* ---------- 气泡 ---------- */
function openPet() {
  buildPetBubble();
  deskmateBubble.classList.remove('hidden');
  deskmatePet.classList.add('active');
  petOpen = true;
  if (!petBalances || Date.now() - petBalances.fetchedAt > BALANCE_TTL_MS) {
    refreshPetBalance(true);
  }
}

function closePet() {
  deskmateBubble.classList.add('hidden');
  deskmatePet.classList.remove('active');
  petOpen = false;
}

/* 当前这个 AI 自己的余额（气泡里只显示它自己） */
function petCurrentBalance() {
  const p = providerById(singleAiSelect.value) || configuredProviders()[0];
  if (!p || !petBalances || !Array.isArray(petBalances.items)) return null;
  return petBalances.items.find((it) => it.id === p.id) || null;
}

function petBalanceNumber() {
  const it = petCurrentBalance();
  if (!it || !it.ok || !it.accounts || !it.accounts.length) return null;
  return Number(it.accounts[0].amount);
}

/** 换 AI 时余额缓存要作废，否则会看到上一家的数字 */
function invalidatePetBalance() {
  petBalances = null;
  if (petOpen) refreshPetBalance(true);
}

function fmtMoney(amount, currency) {
  const cur = String(currency || 'CNY').toUpperCase();
  const symbol = cur === 'USD' ? '$' : '¥';
  const digits = Math.abs(amount) < 10 ? 4 : 2;
  return `${symbol}${amount.toFixed(digits)}`;
}

async function refreshPetBalance(silent) {
  if (!api.balance || !api.balance.fetch) return;
  const p = providerById(singleAiSelect.value) || configuredProviders()[0];
  if (!p) return;
  petBalances = petBalances || { items: [], fetchedAt: 0, loading: true };
  petBalances.loading = true;
  if (petOpen) buildPetBubble();
  try {
    const res = await api.balance.fetch(p.id);
    petBalances = Object.assign({ loading: false, forProvider: p.id }, res);
  } catch (e) {
    petBalances = { items: [], fetchedAt: Date.now(), loading: false, error: (e && e.message) || '查询失败' };
    if (!silent) toast('余额查询失败', 'error');
  }
  if (petOpen) buildPetBubble();
}

function buildPetBubble() {
  deskmateBubble.innerHTML = '';

  const p = providerById(singleAiSelect.value) || configuredProviders()[0];
  if (!p) {
    const empty = document.createElement('div');
    empty.className = 'pet-balance-empty';
    empty.textContent = '还没有选择任何 AI';
    deskmateBubble.appendChild(empty);
    return;
  }

  // 头部：它自己的形象 + 名字 + 一句会变的话
  const head = document.createElement('div');
  head.className = 'pet-head';
  const av = document.createElement('span');
  av.className = 'pet-head-avatar';
  av.appendChild(avatarNode(p.id) || document.createTextNode(''));
  const htxt = document.createElement('div');
  htxt.className = 'pet-head-text';
  const nm = document.createElement('div');
  nm.className = 'pet-head-name';
  nm.textContent = p.name;
  const line = document.createElement('div');
  line.className = 'pet-head-line';
  line.textContent = petLine();
  htxt.append(nm, line);
  head.append(av, htxt);

  // 它自己的余额（一整块，不是列表）
  const card = document.createElement('div');
  card.className = 'pet-balance-card';
  const label = document.createElement('div');
  label.className = 'pet-balance-label';
  const labelText = document.createElement('span');
  labelText.textContent = '我的余额';
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'pet-refresh';
  refreshBtn.type = 'button';
  refreshBtn.textContent = petBalances && petBalances.loading ? '查询中…' : '刷新';
  refreshBtn.disabled = Boolean(petBalances && petBalances.loading);
  refreshBtn.addEventListener('click', (e) => { e.stopPropagation(); refreshPetBalance(false); });
  label.append(labelText, refreshBtn);

  const big = document.createElement('div');
  big.className = 'pet-balance-big';
  const it = petCurrentBalance();
  if (petBalances && petBalances.loading) {
    big.classList.add('muted');
    big.textContent = '查询中…';
  } else if (it && it.ok && it.accounts && it.accounts.length) {
    big.textContent = it.accounts.map((a) => fmtMoney(a.amount, a.currency)).join('  /  ');
    big.classList.add('ok');
  } else {
    big.classList.add('muted');
    big.textContent = (it && it.error) || '点刷新查一下';
  }
  card.append(label, big);

  // 两小项：本会话用量 + 当前模型
  const stats = document.createElement('div');
  stats.className = 'pet-stats';
  const t = sessionTokens(getActiveSession());
  const s1 = document.createElement('div');
  s1.className = 'pet-stat';
  s1.innerHTML = `<b>${fmtTokens(t.total || 0)}</b><span>本会话 tokens</span>`;
  const s2 = document.createElement('div');
  s2.className = 'pet-stat';
  s2.innerHTML = `<b title="${escapeHtml(p.model || '')}">${escapeHtml((p.model || '—').slice(0, 14))}</b><span>当前模型</span>`;
  stats.append(s1, s2);

  // 当前是单 AI 还是多 AI、挂了几个技能，一眼能看见
  const modes = document.createElement('div');
  modes.className = 'pet-modes';
  const chip1 = document.createElement('span');
  chip1.className = 'pet-mode-chip';
  chip1.textContent = currentMode === 'multi'
    ? `🎯 多 AI · ${multiConfig.workers.length + 1} 个角色`
    : '🤖 单 AI';
  const chip2 = document.createElement('span');
  chip2.className = 'pet-mode-chip';
  chip2.textContent = selectedSkills.length ? `🎯 技能 ${selectedSkills.length}` : '🎯 无技能';
  modes.append(chip1, chip2);

  deskmate.classList.toggle('pet-busy', isGenerating);

  // 密钥状态 + 设置入口
  const foot = document.createElement('div');
  foot.className = 'pet-foot';
  const note = document.createElement('span');
  note.className = 'pet-note';
  if (p.keyTail === '✗') {
    note.textContent = '⚠️ 密钥失效，请重填';
    note.classList.add('warn');
  } else if (p.keyTail) {
    note.textContent = `🔑 已保存 · ${p.keyTail}`;
  } else if (p.optionalKey) {
    note.textContent = '本机模式，无需密钥';
  } else {
    note.textContent = '⚠️ 还没配置密钥';
    note.classList.add('warn');
  }
  const setBtn = document.createElement('button');
  setBtn.className = 'pet-settings-btn';
  setBtn.type = 'button';
  setBtn.textContent = '⚙️ 设置';
  setBtn.addEventListener('click', (e) => { e.stopPropagation(); closePet(); openSettingsView(); });
  foot.append(note, setBtn);

  deskmateBubble.append(head, card, stats, modes, foot);
}

deskmateBubble.addEventListener('click', (e) => e.stopPropagation());
deskmateBubble.addEventListener('mousedown', (e) => e.stopPropagation());

document.addEventListener('mousedown', (e) => {
  if (!petOpen) return;
  if (e.target && deskmate.contains(e.target)) return;
  closePet();
});

/* ==================================================================
 * 生成中状态条：说清「现在在干什么、跑了多久、是不是停了」
 * ================================================================== */
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
  const elapsed = Date.now() - genStartAt;
  genStatus.textContent = '';
  const dot = document.createElement('span');
  dot.className = 'gs-dot pulse';
  const phase = document.createElement('span');
  phase.textContent = genPhase;
  const time = document.createElement('span');
  time.className = 'gs-time';
  time.textContent = fmtElapsed(elapsed);
  genStatus.append(dot, phase, time);
}

function genStatusShow(phase) {
  genPhase = phase || '正在回答';
  genStartAt = Date.now();
  genStatus.classList.remove('hidden', 'gs-stopped');
  renderGenStatus();
  clearInterval(genTimer);
  genTimer = setInterval(renderGenStatus, 200);
}

function genStatusSetPhase(phase) {
  if (!genPhase || genPhase === phase) return;
  genPhase = phase;
  if (!genStatus.classList.contains('hidden')) renderGenStatus();
}

function genStatusStopped() {
  clearInterval(genTimer);
  genTimer = null;
  genStatus.classList.add('gs-stopped');
  genStatus.classList.remove('hidden');
  genStatus.textContent = '';
  const dot = document.createElement('span');
  dot.className = 'gs-dot';
  const t = document.createElement('span');
  t.textContent = `已停止 · 用时 ${fmtElapsed(Date.now() - genStartAt)}`;
  genStatus.append(dot, t);
  setTimeout(() => { if (!isGenerating) genStatusHide(); }, 3000);
}

function genStatusHide() {
  clearInterval(genTimer);
  genTimer = null;
  genStatus.classList.add('hidden');
  genStatus.classList.remove('gs-stopped');
}

/* ==================================================================
 * 会话搜索与切换
 * ================================================================== */
let sessionQuery = '';

function sessionMatches(session, q) {
  if (String(session.title || '').toLowerCase().includes(q)) return true;
  const msgs = Array.isArray(session.messages) ? session.messages : [];
  return msgs.some((m) => String(m.content || '').toLowerCase().includes(q));
}

/* 命中的片段高亮。全程用 textContent 拼，不碰 innerHTML */
function highlightInto(el, text, q) {
  const s = String(text || '');
  el.textContent = '';
  const idx = q ? s.toLowerCase().indexOf(q) : -1;
  if (idx < 0) { el.textContent = s; return; }
  el.appendChild(document.createTextNode(s.slice(0, idx)));
  const mk = document.createElement('mark');
  mk.textContent = s.slice(idx, idx + q.length);
  el.appendChild(mk);
  el.appendChild(document.createTextNode(s.slice(idx + q.length)));
}

function switchSession(id) {
  if (activeSessionId === id) return;
  activeSessionId = id;
  renderChatList();
  renderMessages();
  updateContextMeter();
}

/* ==================================================================
 * 模式切换（命令面板和快捷键共用）
 * ================================================================== */
function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  const isSingle = mode === 'single';
  aiPicker.classList.toggle('hidden', !isSingle);
  multiConfigBtn.classList.toggle('hidden', isSingle);
}

function copyLastReply() {
  const session = getActiveSession();
  if (!session) return;
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    if (session.messages[i].role === 'assistant') {
      const content = session.messages[i].content || '';
      navigator.clipboard.writeText(content).then(
        () => toast('已复制最后一条回答', 'success', 1600),
        () => toast('复制失败', 'error'),
      );
      return;
    }
  }
  toast('这个会话还没有回答', 'info');
}

/* ==================================================================
 * 命令面板（Ctrl / Cmd + K）
 * ================================================================== */
let cmdPaletteOpen = false;
let cmdItems = [];
let cmdCursor = 0;

function cmdItemsBuild(query) {
  const q = String(query || '').trim().toLowerCase();
  const out = [];

  const cmds = [
    { iconText: '＋', name: '新建对话', keywords: 'new chat xin 新建 对话', run: () => { newChatBtn.click(); } },
    { iconText: '⚙️', name: '打开设置与密钥', keywords: 'settings key 设置 密钥', run: openSettingsView },
    { iconText: '🎯', name: '选择 AI 技能', keywords: 'skill 技能', run: openSkillPanel },
    { iconText: '📂', name: '导入本地文件', keywords: 'file attach 附件 导入', run: attachFileByDialog },
    { iconText: '🤖', name: '切换到单 AI 模式', keywords: 'single 单ai', run: () => { setMode('single'); toast('已切换到单 AI 模式', 'success', 1600); } },
    { iconText: '🎯', name: '切换到多 AI 模式', keywords: 'multi 多ai', run: () => { setMode('multi'); toast('已切换到多 AI 模式', 'success', 1600); } },
    { iconText: '⚙️', name: '配置多 AI 团队', keywords: 'multi config 团队', run: () => { setMode('multi'); openConfigPanel(); } },
    { iconText: '💭', name: `${prefs.thinkMode ? '关闭' : '开启'}深度思考`, keywords: 'think 思考', run: () => setThinkMode(!prefs.thinkMode) },
    { iconText: '🛠', name: `${agentMode ? '关闭' : '开启'}研发模式`, keywords: 'agent dev 研发 独立 写代码 自主', run: () => setAgentMode(!agentMode) },
    { iconText: '📁', name: '选择研发工作目录', keywords: 'agent dir workdir 目录 项目', run: pickAgentDir },
    { iconText: '🧹', name: '清除已选技能', keywords: 'clear skill 清除', run: async () => { selectedSkills = []; await savePrefs({ skills: [] }); updateSkillBadge(); toast('已清除全部技能', 'success'); } },
    { iconText: '☰', name: `${sidebar.classList.contains('collapsed') ? '展开' : '折叠'}侧边栏`, keywords: 'sidebar 侧边栏', run: () => setSidebarCollapsed(!sidebar.classList.contains('collapsed')) },
    { iconText: '📋', name: '复制最后一条回答', keywords: 'copy 复制', run: copyLastReply },
    { iconText: '⌨️', name: '查看键盘快捷键', keywords: 'shortcut keyboard 快捷键', run: openShortcuts },
    { iconText: '🗑️', name: '清空全部会话', keywords: 'clear 清空 删除', run: async () => {
      if (!window.confirm('确定要清空全部会话吗？此操作不可撤销。')) return;
      sessions = [];
      await saveSessionsNow();
      createSession();
      toast('已清空全部会话', 'success');
    } },
  ];
  const matchedCmds = q
    ? cmds.filter((c) => `${c.name} ${c.keywords}`.toLowerCase().includes(q))
    : cmds;
  if (matchedCmds.length) out.push({ group: '命令' }, ...matchedCmds.map((c) => Object.assign({ kind: '命令' }, c)));

  const ais = providers.filter((p) => p.configured);
  const matchedAi = ais.filter((p) => !q || `${p.name} ${p.id}`.toLowerCase().includes(q));
  if (matchedAi.length) {
    out.push({ group: '切换 AI' }, ...matchedAi.map((p) => ({
      iconImg: avatarImageSrc(p.id), iconText: p.avatar,
      name: `切换到 ${p.name}`, sub: `当前模型 ${p.model || '—'}`,
      kind: 'AI', run: () => selectProvider(p.id),
    })));
  }

  const matchedSessions = (q ? sessions.filter((s) => sessionMatches(s, q)) : sessions).slice(0, 8);
  if (matchedSessions.length) {
    out.push({ group: '会话' }, ...matchedSessions.map((s) => ({
      iconText: '💬',
      name: s.title || '新对话',
      sub: `${formatTime(s.updatedAt)} · ${(s.messages || []).length} 条消息`,
      kind: '会话', run: () => switchSession(s.id),
    })));
  }

  cmdItems = out;
  const first = out.findIndex((i) => !i.group);
  cmdCursor = first < 0 ? 0 : first;
  cmdRender();
}

function cmdRender() {
  cmdList.textContent = '';
  if (cmdItems.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'cmd-empty';
    empty.textContent = '没有匹配的结果';
    cmdList.appendChild(empty);
    return;
  }
  cmdItems.forEach((item, i) => {
    if (item.group) {
      const g = document.createElement('div');
      g.className = 'cmd-group-title';
      g.textContent = item.group;
      cmdList.appendChild(g);
      return;
    }
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'cmd-item' + (i === cmdCursor ? ' cursor' : '');
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', i === cmdCursor ? 'true' : 'false');

    const icon = document.createElement('span');
    icon.className = 'cmd-item-icon';
    if (item.iconImg) {
      const img = document.createElement('img');
      img.src = item.iconImg;
      img.alt = '';
      icon.appendChild(img);
    } else {
      icon.textContent = item.iconText || '·';
    }

    const text = document.createElement('span');
    text.className = 'cmd-item-text';
    const nm = document.createElement('span');
    nm.className = 'cmd-item-name';
    nm.textContent = item.name;
    text.appendChild(nm);
    if (item.sub) {
      const sb = document.createElement('span');
      sb.className = 'cmd-item-sub';
      sb.textContent = item.sub;
      text.appendChild(sb);
    }

    const kind = document.createElement('span');
    kind.className = 'cmd-item-kind';
    kind.textContent = item.kind || '';

    el.append(icon, text, kind);
    el.addEventListener('mousemove', () => {
      if (cmdCursor === i) return;
      cmdCursor = i;
      cmdRender();
    });
    el.addEventListener('click', () => cmdExec(i));
    cmdList.appendChild(el);
  });
  const cur = cmdList.querySelector('.cmd-item.cursor');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

function cmdExec(index) {
  const item = cmdItems[index];
  if (!item || item.group) return;
  cmdClosePalette();
  try { item.run(); } catch (e) { toast(`执行失败：${e.message || e}`, 'error'); }
}

function cmdClosePalette() {
  cmdPaletteOpen = false;
  cmdPanel.classList.remove('show');
  cmdMask.classList.remove('show');
  cmdInput.value = '';
}

function cmdOpenPalette() {
  closeFloatingLayers();
  closePet();
  cmdPaletteOpen = true;
  cmdPanel.classList.add('show');
  cmdMask.classList.add('show');
  cmdInput.value = '';
  cmdItemsBuild('');
  cmdInput.focus();
}

function cmdMove(delta) {
  const idxs = [];
  cmdItems.forEach((it, i) => { if (!it.group) idxs.push(i); });
  if (idxs.length === 0) return;
  let pos = idxs.indexOf(cmdCursor);
  if (pos < 0) pos = 0;
  pos = (pos + delta + idxs.length) % idxs.length;
  cmdCursor = idxs[pos];
  cmdRender();
}

/* ==================================================================
 * 快捷键速查
 * ================================================================== */
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

function openShortcuts() {
  shortcutsBody.textContent = '';
  SHORTCUT_GROUPS.forEach((g) => {
    const h = document.createElement('div');
    h.className = 'sc-group';
    h.textContent = g.group;
    shortcutsBody.appendChild(h);
    g.items.forEach((it) => {
      const row = document.createElement('div');
      row.className = 'sc-row';
      const d = document.createElement('span');
      d.textContent = it.desc;
      const k = document.createElement('span');
      k.className = 'sc-keys';
      it.keys.forEach((key) => {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        k.appendChild(kbd);
      });
      row.append(d, k);
      shortcutsBody.appendChild(row);
    });
  });
  shortcutsPanel.classList.add('show');
  shortcutsMask.classList.add('show');
}

function closeShortcuts() {
  shortcutsPanel.classList.remove('show');
  shortcutsMask.classList.remove('show');
}

/* ==================================================================
 * 消息编辑 / 删除
 * ================================================================== */
function startEditUserMessage(msgDiv, msg) {
  const session = getActiveSession();
  if (!session) return;
  const idx = session.messages.indexOf(msg);
  if (idx < 0) return;

  const bubble = msgDiv.querySelector('.bubble');
  if (!bubble || bubble.dataset.editing === '1') return;
  bubble.dataset.editing = '1';

  const ta = document.createElement('textarea');
  ta.className = 'msg-edit-input';
  ta.value = msg.displayText || msg.content || '';
  ta.rows = 2;
  bubble.textContent = '';
  bubble.appendChild(ta);

  const bar = document.createElement('div');
  bar.className = 'msg-edit-bar';
  const cancel = document.createElement('button');
  cancel.className = 'msg-action';
  cancel.type = 'button';
  cancel.textContent = '取消';
  const save = document.createElement('button');
  save.className = 'msg-action primary';
  save.type = 'button';
  save.textContent = '保存并重发';
  bar.append(cancel, save);
  msgDiv.appendChild(bar);

  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  autoGrowEl(ta);

  const finish = (commit) => {
    delete bubble.dataset.editing;
    bar.remove();
    if (!commit) { renderMessages(); return; }
    const next = ta.value.trim();
    if (!next) { toast('内容不能为空', 'info'); renderMessages(); return; }
    session.messages.splice(idx);   // 从这一条起重新来
    renderMessages();
    sendMessageInternal(next, next, msg.attachments || []);
  };
  cancel.addEventListener('click', () => finish(false));
  save.addEventListener('click', () => finish(true));
  ta.addEventListener('input', () => autoGrowEl(ta));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
}

function autoGrowEl(el) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
}

function deleteMessage(msg) {
  const session = getActiveSession();
  if (!session) return;
  const idx = session.messages.indexOf(msg);
  if (idx < 0) return;
  session.messages.splice(idx, 1);
  saveSessions();
  renderMessages();
  updateContextMeter();
}

/* ==================================================================
 * 事件绑定
 * ================================================================== */
userInput.addEventListener('input', function autoGrow() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 160) + 'px';
});

userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

/* Esc 与全局快捷键。
 * 判断焦点是否在输入框里，避免「?」这类字符被当成快捷键吃掉。 */
function isTypingInField() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = String(el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable === true;
}

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;

  if (e.key === 'Escape') {
    if (cmdPaletteOpen) { cmdClosePalette(); return; }
    if (shortcutsPanel.classList.contains('show')) { closeShortcuts(); return; }
    closeAllPanels();
    return;
  }

  if (mod) {
    const key = e.key.toLowerCase();
    if (key === 'k') { e.preventDefault(); if (cmdPaletteOpen) cmdClosePalette(); else cmdOpenPalette(); return; }
    if (key === 'n') { e.preventDefault(); newChatBtn.click(); return; }
    if (key === 'b') { e.preventDefault(); setSidebarCollapsed(!sidebar.classList.contains('collapsed')); return; }
    if (e.key === ',') { e.preventDefault(); openSettingsView(); return; }
    if (key === 'f') {
      e.preventDefault();
      if (sidebar.classList.contains('collapsed')) setSidebarCollapsed(false);
      chatSearchInput.focus();
      chatSearchInput.select();
      return;
    }
    if (e.shiftKey && key === 'o') { e.preventDefault(); attachFileByDialog(); return; }
    if (e.shiftKey && key === 'm') {
      e.preventDefault();
      const next = currentMode === 'single' ? 'multi' : 'single';
      setMode(next);
      toast(next === 'multi' ? '已切换到多 AI 模式' : '已切换到单 AI 模式', 'success', 1600);
      return;
    }
    return;
  }

  if (e.key === '?' && !isTypingInField()) { e.preventDefault(); openShortcuts(); }
});

/* ---------- 会话搜索 ---------- */
chatSearchInput.addEventListener('input', () => {
  sessionQuery = chatSearchInput.value.trim();
  chatSearchClear.classList.toggle('hidden', !sessionQuery);
  renderChatList();
});
chatSearchClear.addEventListener('click', () => {
  chatSearchInput.value = '';
  sessionQuery = '';
  chatSearchClear.classList.add('hidden');
  renderChatList();
  chatSearchInput.focus();
});

/* ---------- 命令面板 ---------- */
cmdInput.addEventListener('input', () => cmdItemsBuild(cmdInput.value));
cmdInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); cmdMove(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); cmdMove(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); cmdExec(cmdCursor); }
});
cmdMask.addEventListener('click', cmdClosePalette);

/* ---------- 快捷键速查 ---------- */
shortcutsMask.addEventListener('click', closeShortcuts);
shortcutsClose.addEventListener('click', closeShortcuts);

sendBtn.addEventListener('click', () => sendMessage());

singleAiSelect.addEventListener('change', async () => {
  await selectProvider(singleAiSelect.value);
});
newChatBtn.addEventListener('click', () => {
  if (sessions.length && getActiveSession() && getActiveSession().messages.length === 0) {
    toast('已经有一个空对话了', 'info');
    return;
  }
  createSession();
  userInput.focus();
});
openFileBtn.addEventListener('click', attachFileByDialog);

if (quickCards) {
  quickCards.addEventListener('click', (e) => {
    const card = e.target.closest('.quick-card');
    if (!card) return;
    const prompt = card.dataset.prompt;
    if (prompt) {
      userInput.value = prompt;
      userInput.focus();
      userInput.dispatchEvent(new Event('input'));
    }
  });
}

skillBtn.addEventListener('click', openSkillPanel);
skillPanelClose.addEventListener('click', closeSkillPanel);
skillPanelMask.addEventListener('click', closeSkillPanel);
skillClearBtn.addEventListener('click', () => {
  selectedSkills = [];
  renderSkillGrid();
});
skillApplyBtn.addEventListener('click', async () => {
  await savePrefs({ skills: selectedSkills.slice() });
  updateSkillBadge();
  closeSkillPanel();
  toast(selectedSkills.length ? `已应用 ${selectedSkills.length} 个技能` : '已清除全部技能', 'success');
});

modeSwitch.addEventListener('click', (e) => {
  const btn = e.target.closest('.mode-btn');
  if (!btn) return;
  setMode(btn.dataset.mode);
});

multiConfigBtn.addEventListener('click', openConfigPanel);
configClose.addEventListener('click', closeConfigPanel);
configCancel.addEventListener('click', closeConfigPanel);
configMask.addEventListener('click', closeConfigPanel);
configSave.addEventListener('click', async () => {
  const leaderInput = document.querySelector('#leader-group input:checked');
  const workerInputs = Array.from(document.querySelectorAll('#worker-group input:checked'));
  if (!leaderInput) { toast('请选择一个统领 AI', 'info'); return; }
  if (workerInputs.length === 0) { toast('请至少选择一个被统领 AI', 'info'); return; }
  multiConfig = { leader: leaderInput.value, workers: workerInputs.map((i) => i.value) };
  await savePrefs({ multi: multiConfig });
  closeConfigPanel();
  toast('多 AI 配置已保存', 'success');
});

settingsBtn.addEventListener('click', openSettingsView);
sidebarSettingsBtn.addEventListener('click', openSettingsView);
setupHintBtn.addEventListener('click', openSettingsView);
svBack.addEventListener('click', closeSettingsView);

contextRoundsInput.addEventListener('change', async () => {
  const value = Math.min(30, Math.max(1, parseInt(contextRoundsInput.value, 10) || 6));
  contextRoundsInput.value = value;
  await savePrefs({ contextRounds: value });
  updateContextMeter();
  toast(`已设置为携带最近 ${value} 轮对话`, 'success');
});

clearSessionsBtn.addEventListener('click', async () => {
  if (!window.confirm('确定要清空全部会话吗？此操作不可撤销。')) return;
  sessions = [];
  await saveSessionsNow();
  createSession();
  toast('已清空全部会话', 'success');
});

function setSidebarCollapsed(collapsed) {
  sidebar.classList.toggle('collapsed', collapsed);
  savePrefs({ sidebarCollapsed: collapsed });
}

toggleBtn.addEventListener('click', () => {
  const willCollapse = !sidebar.classList.contains('collapsed');
  // 折叠前先退出设置视图，否则侧边栏会被 settings-mode 的加宽撑住，比例很怪
  if (willCollapse && sidebar.classList.contains('settings-mode')) closeSettingsView();
  setSidebarCollapsed(willCollapse);
});

tokenChip.addEventListener('click', () => {
  const session = getActiveSession();
  const t = sessionTokens(session);
  if (!t.total) {
    toast('本会话还没有产生用量', 'info');
    return;
  }
  toast(`本会话累计 ${t.total} tokens：提示 ${t.prompt} · 补全 ${t.completion}`, 'info', 5000);
});

function setThinkMode(on) {
  prefs.thinkMode = on;
  thinkToggle.classList.toggle('active', on);
  thinkToggle.title = on ? '深度思考：开' : '深度思考：关';
  savePrefs({ thinkMode: on });
}

/** 各家对深度思考的支持度不同，不支持的要明确说，不能让它静默失效 */
function refreshThinkToggle() {
  const p = providerById(singleAiSelect.value) || configuredProviders()[0];
  const supported = !p || p.thinkingSupported !== false;
  thinkToggle.classList.toggle('unsupported', !supported);
  thinkToggle.disabled = !supported;
  if (!supported) {
    thinkToggle.classList.remove('active');
    thinkToggle.title = `${p ? p.name : '这家'} 的接口没有可用的深度思考参数（开关对它无效）`;
  } else {
    thinkToggle.title = prefs.thinkMode ? '深度思考：开' : '深度思考：关';
    thinkToggle.classList.toggle('active', Boolean(prefs.thinkMode));
  }
}

thinkToggle.addEventListener('click', () => {
  const p = providerById(singleAiSelect.value) || configuredProviders()[0];
  if (p && p.thinkingSupported === false) {
    toast(`${p.name} 没有可用的深度思考参数，这个开关对它无效`, 'info', 2600);
    return;
  }
  setThinkMode(!prefs.thinkMode);
  toast(prefs.thinkMode ? '已开启深度思考' : '已关闭深度思考', 'success', 1600);
});

window.addEventListener('beforeunload', () => {
  // 关窗时异步 invoke 来不及落盘，这里走同步通道兜最后一次
  try {
    if (api.sessions && api.sessions.saveSync) api.sessions.saveSync(sessions);
    else saveSessionsNow();
  } catch (e) {
    saveSessionsNow();
  }
});

/* ==================================================================
 * 启动
 * ================================================================== */
(async function bootstrap() {
  await refreshConfig();
  bindParamControls();
  syncParamControls();

  const loaded = await api.sessions.load();
  sessions = (Array.isArray(loaded) ? loaded : [])
    .filter((s) => s && Array.isArray(s.messages) && s.messages.length > 0)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  setSidebarCollapsed(prefs.sidebarCollapsed !== false);
  setThinkMode(Boolean(prefs.thinkMode));

  // 每回启动都停在待机界面（一个空白新对话）；历史会话照样在左侧列表里
  // 载入时把空会话滤掉，所以每次最多只有一个空白会话，不会越积越多
  createSession();

  // 每回启动，小助手默认回到右下角
  // （想让它记住上次拖到的位置，就把下面这段换成：if (prefs.petPos) petPos = {...prefs.petPos}; petApplyPosition();）
  if (prefs.petPos) savePrefs({ petPos: null });
  petPos = { x: mainEl.clientWidth - PET_SIZE - PET_DEFAULT.right, y: mainEl.clientHeight - PET_SIZE - PET_DEFAULT.bottom };
  petApplyPosition();

  updateContextMeter();
  updateTokenChip();
  userInput.focus();

  // 没配密钥时，直接把侧边栏设置摊开，第一件事就是填 key
  if (!anyConfigured()) {
    setTimeout(() => {
      openSettingsView();
      toast('先在密钥管理里填一个 AI 的 Key，之后就不用来回了', 'info', 4200);
    }, 700);
  }
})();

})();

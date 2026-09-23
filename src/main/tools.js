'use strict';

/**
 * AI 能力：联网搜索 + 本地访问（工具调用）
 *
 * 安全设计（用户可全盘放开，但仍然有硬底线）：
 *   1. 总开关默认关闭，必须由用户在设置里显式打开
 *   2. 系统目录 / 凭据目录一律硬拒绝，不随开关放开
 *   3. 写文件 / 删除 / 执行命令 三类操作每次都弹窗确认，且路径命令都给你看
 *   4. 命令另有黑名单，明显的毁灭性命令直接拒绝
 *   5. 所有动作记日志，可在设置里回看
 */

const path = require('path');
const fs = require('fs');

const TOOL_OUTPUT_LIMIT = 12000;    // 单个工具返回给模型的最大字符
const TOOL_LOG_MAX = 200;

/* 本地遍历是在主进程里跑的，同步读目录会连界面一起冻住，
 * 所以改成异步，并且给「时间 + 节点数」双预算，防止在 C:\Users 这种大目录里跑没完 */
const SEARCH_TIME_BUDGET_MS = 8000;
const SEARCH_MAX_NODES = 20000;
const MAX_TOOL_READ_BYTES = 2 * 1024 * 1024;   // 搜内容时单文件最多读 2MB

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const TOOL_DEFS = [
  { type: 'function', function: { name: 'web_search', description: '联网搜索。当你需要最新信息、实时数据、或训练数据里没有的内容时使用。', parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'web_fetch', description: '打开一个网页并读取它的正文（已去掉 HTML 标签）。', parameters: { type: 'object', properties: { url: { type: 'string', description: '完整网址' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'list_dir', description: '列出某个目录下的文件和子目录。', parameters: { type: 'object', properties: { path: { type: 'string', description: '目录绝对路径' }, max: { type: 'number', description: '最多返回多少条，默认 80' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'read_file', description: '读取本地文件内容。支持 txt/md/csv/json/代码等文本；docx/xlsx/pdf 会自动提取文本。', parameters: { type: 'object', properties: { path: { type: 'string', description: '文件绝对路径' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'search_files', description: '按文件名或内容在本地搜索。', parameters: { type: 'object', properties: { root: { type: 'string', description: '起始目录' }, keyword: { type: 'string', description: '文件名里的关键词' }, content: { type: 'string', description: '文件内容里要找的字符串（给了就搜内容）' }, max: { type: 'number', description: '最多返回多少条，默认 30' } }, required: ['root'] } } },
  { type: 'function', function: { name: 'write_file', description: '把内容写入本地文件（会覆盖已有文件，需要用户确认）。', parameters: { type: 'object', properties: { path: { type: 'string', description: '目标文件绝对路径' }, content: { type: 'string', description: '要写入的内容' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'delete_path', description: '删除本地文件或目录（需要用户确认）。', parameters: { type: 'object', properties: { path: { type: 'string', description: '要删除的绝对路径' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'run_command', description: '在用户电脑上执行一条命令（需要用户确认）。', parameters: { type: 'object', properties: { command: { type: 'string', description: '要执行的命令' }, cwd: { type: 'string', description: '工作目录，可选' } }, required: ['command'] } } },
];

const TOOL_DEF_SET_PLAN = {
  type: 'function',
  function: {
    name: 'set_plan',
    description: '把接下来要做的步骤列出来展示给用户（研发模式）。开工前先调用一次，中途计划变了就再调用一次。',
    parameters: {
      type: 'object',
      properties: { steps: { type: 'array', items: { type: 'string' }, description: '步骤列表，每项一句话，3-8 条' } },
      required: ['steps'],
    },
  },
};

const AGENT_TOOL_DEFS = TOOL_DEFS.concat([TOOL_DEF_SET_PLAN]);

/* ---------- 硬底线：这些地方任何情况下都不许碰 ---------- */
const BLOCKED_PATH_RE = [
  /^[A-Za-z]:[\\/]Windows[\\/]/i,
  /^[A-Za-z]:[\\/]Program Files/i,
  /^[A-Za-z]:[\\/]ProgramData/i,
  /^[A-Za-z]:[\\/]System Volume Information/i,
  /^[A-Za-z]:[\\/]Recovery/i,
  /^[A-Za-z]:[\\/]?$/i,                       // 盘根目录
  /^[/](System|etc|usr|bin|sbin|boot|dev|proc|var|lib)/i,
  /[\\/]\.ssh[\\/]?/i,
  /[\\/]\.aws[\\/]?/i,
  /[\\/]\.gnupg[\\/]?/i,
];

const BLOCKED_CMD_RE = [
  /rm\s+-rf\s+([/]|~|$)/i,
  /rmdir\s+\/s\s+\/q\s+[A-Za-z]:[\\/]?$/i,
  /^(format|mkfs|diskpart|fdisk)\b/i,
  /del\s+\/f\s+\/s\s+\/q\s+[A-Za-z]:[\\/]?$/i,
  /^(shutdown|poweroff|reboot|halt)\b/i,
  /\breg\s+delete\b/i,
  /\b(taskkill\s+\/f\s+\/im\s+(system|csrss|wininit|smss|lsass))/i,
  /:\(\)\{/,                                   // fork 炸弹
];

function isBlockedPath(p) {
  const raw = String(p || '');
  const norm = raw.replace(/\//g, '\\');
  return BLOCKED_PATH_RE.some((re) => re.test(norm) || re.test(raw));
}

function isBlockedCommand(c) {
  return BLOCKED_CMD_RE.some((re) => re.test(String(c || '')));
}

function clipText(text, limit) {
  if (typeof text !== 'string') return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n……（内容过长，已截取前 ${limit} 个字符）`;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function ddgSearch(query) {
  const endpoints = ['https://html.duckduckgo.com/html/', 'https://lite.duckduckgo.com/lite/'];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' },
        body: `q=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const out = [];
      const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = linkRe.exec(html)) && out.length < 8) {
        let href = m[1];
        const uddg = /uddg=([^&]+)/.exec(href);
        if (uddg) href = decodeURIComponent(uddg[1]);
        const title = stripHtml(m[2]);
        if (title && href) out.push({ title, url: href });
      }
      // 摘要
      const snRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
      let i = 0;
      while ((m = snRe.exec(html)) && i < out.length) { out[i].snippet = stripHtml(m[1]).slice(0, 300); i += 1; }
      if (out.length) return out;
    } catch (e) { /* 换下一个端点 */ }
  }
  return [];
}

/** 按 provider 选一个搜索后端；没配 key 的一律退回免密钥方案 */
async function webSearch(provider, key, query) {
  if (provider === 'tavily' && key) {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: 8, search_depth: 'basic' }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`搜索接口返回 HTTP ${res.status}`);
    const j = await res.json();
    return (j.results || []).map((r) => ({ title: r.title, url: r.url, snippet: String(r.content || '').slice(0, 300) }));
  }
  if (provider === 'serper' && key) {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: query, num: 8 }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`搜索接口返回 HTTP ${res.status}`);
    const j = await res.json();
    return (j.organic || []).map((r) => ({ title: r.title, url: r.link, snippet: String(r.snippet || '').slice(0, 300) }));
  }
  if (provider === 'bing' && key) {
    const res = await fetch(`https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=8`, {
      headers: { 'Ocp-Apim-Subscription-Key': key, 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`搜索接口返回 HTTP ${res.status}`);
    const j = await res.json();
    return ((j.webPages && j.webPages.value) || []).map((r) => ({ title: r.name, url: r.url, snippet: String(r.snippet || '').slice(0, 300) }));
  }
  return ddgSearch(query);
}

/* ---------- 降级方案：模型不支持 tools 时，用文本指令让它自己发号 ---------- */

/* 工具可用时追加的系统说明：明确「你可以用」，并划清安全边界 */
const TOOLS_SYSTEM_HINT = `
你现在具备两类扩展能力，需要时主动使用，不要凭记忆编造：

1. 联网搜索：web_search 查最新信息，web_fetch 打开具体网页读正文。
   凡是涉及实时数据、新闻、价格、版本、时效性强的内容，先搜再答。
2. 本地访问：list_dir 列目录、read_file 读文件、search_files 搜文件、
   write_file 写文件、delete_path 删除、run_command 执行命令。
   写文件 / 删除 / 执行命令这三种会先弹窗让用户确认，用户拒绝就换个方案或如实说明。

规则：
- 用了工具就在回答里体现你查到了什么，不要声称你做了没做的事。
- 工具失败或被拒绝，如实告诉用户，不要伪造结果。
- 能用一次搜清楚的，不要反复搜。`.trim();

/* 研发模式（自主研发）：目标是「自己把一件事做完」，不是问用户下一步干嘛。
 * 这套提示的关键在三件事：先勘察再动手、每次写完整文件、跑完要验证。 */
const AGENT_SYSTEM_HINT = `
你现在处于「研发模式」，目标是**独立把一个任务从头做完**，不要每一步都回头问用户。

工作流（自己循环，不要等人推）：
1. 勘察：先用 list_dir / search_files / read_file 把现状摸清楚。
   给了工作目录就从那里开始；没给就用用户提到的路径，实在没有再问一次。
2. 计划：用 set_plan 把步骤列出来（3-8 条），用户能实时看到你在干什么。
3. 执行：一次做一件事。write_file 必须写**完整可运行的文件**，
   严禁出现「……」「其余部分类似」「// TODO 同上」这类占位。
   改已有文件时先 read_file 读原文，再整体重写，不要输出 diff 片段让用户自己拼。
4. 验证：能跑就跑（run_command），报错就读报错、改、再跑，最多自己重试几轮。
   没验证过就说「还没验证」，不许说「应该可以了」。
5. 汇报：最后用中文简短说明——改了哪些文件、怎么验证的、哪些假设需要用户确认、还剩什么没做。

铁律：
- 每个文件内容都要完整，一个文件一次输出，不要一次甩十个文件然后说「以此类推」。
- 命令失败要看错误原因，不要原样重试第二遍。
- 不确定的需求，按最合理的方案做完，然后在汇报里把假设讲清楚。
- 写文件 / 删除 / 执行命令会弹窗让用户确认。被拒绝就换方案或如实说明，不许绕开。
- 不要伪造运行结果，也不要声称做了没做的事。`.trim();

const FALLBACK_TOOL_HINT = `
你可以使用下列能力。需要用到时，**只输出一行指令**，不要输出其它内容：
  SEARCH: 关键词                    → 联网搜索
  FETCH: 网址                        → 打开网页读正文
  LIST: 目录路径                     → 列出目录
  READ: 文件路径                     → 读取文件
  FIND: 目录 | 关键词                → 搜索文件
  WRITE: 文件路径 ||| 内容            → 写文件（会先问用户）
  DELETE: 文件路径                   → 删除（会先问用户）
  RUN: 命令                          → 执行命令（会先问用户）
  PLAN: 步骤一 | 步骤二 | 步骤三      → 把计划展示给用户
不需要任何能力时，正常回答即可。`;

const FALLBACK_CMD_RE = /^\s*(SEARCH|FETCH|LIST|READ|FIND|WRITE|DELETE|RUN|PLAN)\s*:\s*([\s\S]+)$/i;

function parseFallbackCommand(text) {
  const m = FALLBACK_CMD_RE.exec(String(text || '').trim());
  if (!m) return null;
  const kind = m[1].toUpperCase();
  const rest = m[2].trim();
  if (kind === 'SEARCH') return { name: 'web_search', args: { query: rest } };
  if (kind === 'FETCH') return { name: 'web_fetch', args: { url: rest } };
  if (kind === 'LIST') return { name: 'list_dir', args: { path: rest } };
  if (kind === 'READ') return { name: 'read_file', args: { path: rest } };
  if (kind === 'FIND') { const [root, kw] = rest.split('|').map((s) => s.trim()); return { name: 'search_files', args: { root, keyword: kw || '' } }; }
  if (kind === 'WRITE') { const [p, c] = rest.split('|||').map((s) => (s || '').trim()); return { name: 'write_file', args: { path: p, content: c || '' } }; }
  if (kind === 'DELETE') return { name: 'delete_path', args: { path: rest } };
  if (kind === 'RUN') return { name: 'run_command', args: { command: rest } };
  if (kind === 'PLAN') {
    const steps = rest.split(/\s*\|\s*|\s*\n\s*/).map((s) => s.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
    return { name: 'set_plan', args: { steps } };
  }
  return null;
}

/* ---------- 工具执行器 ---------- */
function createTools({ config, readFileContent, confirmDangerous }) {
  const toolLog = [];

  function appendToolLog(entry) {
    toolLog.unshift(Object.assign({ time: Date.now() }, entry));
    if (toolLog.length > TOOL_LOG_MAX) toolLog.length = TOOL_LOG_MAX;
  }

  function toolsEnabled() {
    const t = config.get().prefs.tools;
    return Boolean(t && t.enabled);
  }

  /* 研发模式下用户可勾选「工作目录内自动批准」，省掉重复弹窗。
   * 但只对工作目录内部的路径生效 —— 目录外一律照旧弹窗，
   * 而且黑名单命令、硬底线路径的拦截在它之前就跑完了，不受影响。 */
  function insideWorkDir(workDir, target) {
    if (!workDir || !target) return false;
    const norm = (p) => String(p).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    const root = norm(workDir);
    const t = norm(target);
    return t === root || t.startsWith(`${root}\\`);
  }

  async function askPermission(ctx, title, detail, target) {
    const auto = ctx && ctx.autoApprove;
    if (auto && insideWorkDir(ctx.workDir, target)) {
      appendToolLog({ tool: 'auto-approve', risk: 'high', result: '自动批准', summary: `（工作目录内自动批准）${title}` });
      return true;
    }
    const extra = auto
      ? '\n\n（你开了自动批准，但它只对工作目录内的路径生效，这次不在目录内，所以仍然问你）'
      : '';
    return confirmDangerous(title, `${detail}${extra}`);
  }

  async function currentSearch() {
    const t = config.get().prefs.tools || {};
    return { provider: t.searchProvider || 'ddg', key: config.getToolKey('search') };
  }

  async function executeTool(name, args, onEvent, ctx = {}) {
    const emit = (status, summary) => { if (onEvent) onEvent({ type: 'tool', name, status, summary }); };

    // 总开关管的是「全部能力」，联网搜索也算在内。
    if (!toolsEnabled()) {
      emit('denied', '能力已关闭');
      return 'AI 能力已被用户关闭，联网搜索和本地访问都不能用。';
    }

    emit('running', '');

    try {
      /* 计划展示：不碰文件系统，纯粹把步骤推给界面，让用户看得见 AI 在干嘛 */
      if (name === 'set_plan') {
        const steps = (Array.isArray(args.steps) ? args.steps : [])
          .map((s) => String(s || '').trim()).filter(Boolean).slice(0, 20);
        if (!steps.length) return '计划为空，请给出具体步骤。';
        if (onEvent) onEvent({ type: 'plan', steps });
        appendToolLog({ tool: name, args: { steps }, risk: 'low', summary: `列出 ${steps.length} 步计划` });
        emit('done', `${steps.length} 步`);
        return `计划已展示给用户，共 ${steps.length} 步。按计划继续往下做。`;
      }

      if (name === 'web_search') {
        emit('running', `搜索「${args.query}」`);
        const { provider, key } = await currentSearch();
        const results = await webSearch(provider, key, String(args.query || ''));
        appendToolLog({ tool: name, args: { query: args.query }, risk: 'low', summary: `搜索「${args.query}」，返回 ${results.length} 条` });
        emit('done', `搜索到 ${results.length} 条`);
        if (!results.length) return '没有搜到结果，可以换个关键词再试。';
        return clipText(results.map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet || ''}`).join('\n\n'), TOOL_OUTPUT_LIMIT);
      }

      if (name === 'web_fetch') {
        emit('running', `打开 ${args.url}`);
        const res = await fetch(String(args.url), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) return `打开失败：HTTP ${res.status}`;
        const text = stripHtml(await res.text());
        appendToolLog({ tool: name, args: { url: args.url }, risk: 'low', summary: `读取网页 ${args.url}` });
        emit('done', '网页已读取');
        return clipText(text, TOOL_OUTPUT_LIMIT);
      }

      // ---- 以下都是本地操作，先过硬底线（总开关已在函数入口统一拦过） ----
      const target = String(args.path || args.root || args.cwd || '');

      if (name === 'list_dir') {
        if (isBlockedPath(target)) return `拒绝访问：${target} 属于受保护的系统位置。`;
        const max = Math.min(Math.max(parseInt(args.max, 10) || 80, 1), 300);
        const entries = await fs.promises.readdir(target, { withFileTypes: true });
        const lines = entries.slice(0, max).map((e) => `${e.isDirectory() ? '[目录]' : '[文件]'} ${e.name}`);
        appendToolLog({ tool: name, args: { path: target }, risk: 'low', summary: `列出目录 ${target}` });
        emit('done', `${lines.length} 项`);
        return clipText(lines.join('\n') || '（空目录）', TOOL_OUTPUT_LIMIT);
      }

      if (name === 'read_file') {
        if (isBlockedPath(target)) return `拒绝访问：${target} 属于受保护的系统位置。`;
        const text = await readFileContent(target);
        appendToolLog({ tool: name, args: { path: target }, risk: 'low', summary: `读取文件 ${target}` });
        emit('done', path.basename(target));
        return clipText(text, TOOL_OUTPUT_LIMIT);
      }

      if (name === 'search_files') {
        if (isBlockedPath(target)) return `拒绝访问：${target} 属于受保护的系统位置。`;
        const max = Math.min(Math.max(parseInt(args.max, 10) || 30, 1), 100);
        const hits = [];
        const keyword = String(args.keyword || '').toLowerCase();
        const needle = String(args.content || '');
        const TEXT_EXT = ['.txt', '.md', '.csv', '.json', '.js', '.ts', '.py', '.html', '.css', '.java', '.go', '.yml', '.yaml', '.log'];
        const deadline = Date.now() + SEARCH_TIME_BUDGET_MS;
        let visited = 0;
        const exhausted = () => hits.length >= max || visited >= SEARCH_MAX_NODES || Date.now() > deadline;
        const walk = async (dir, depth) => {
          if (depth > 4 || exhausted()) return;
          let items = [];
          try { items = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
          for (const it of items) {
            if (exhausted()) return;
            visited += 1;
            const full = path.join(dir, it.name);
            if (isBlockedPath(full)) continue;
            if (it.isDirectory()) { await walk(full, depth + 1); continue; }
            if (keyword && it.name.toLowerCase().includes(keyword)) { hits.push(full); continue; }
            if (needle && TEXT_EXT.includes(path.extname(it.name).toLowerCase())) {
              try {
                const st = await fs.promises.stat(full);
                if (st.size <= MAX_TOOL_READ_BYTES && (await fs.promises.readFile(full, 'utf8')).includes(needle)) {
                  hits.push(full);
                }
              } catch (e) { /* 读不动就跳过 */ }
            }
          }
        };
        await walk(target, 0);
        const truncated = visited >= SEARCH_MAX_NODES || Date.now() > deadline;
        appendToolLog({ tool: name, args: { root: target, keyword, content: needle }, risk: 'low', summary: `在 ${target} 下搜到 ${hits.length} 个${truncated ? '（已到上限，提前停止）' : ''}` });
        emit('done', `${hits.length} 个结果`);
        return clipText(hits.join('\n') || '没有找到匹配项', TOOL_OUTPUT_LIMIT);
      }

      if (name === 'write_file') {
        if (isBlockedPath(target)) return `拒绝写入：${target} 属于受保护的系统位置。`;
        const ok = await askPermission(ctx, 'AI 想要写入文件', `目标：${target}\n内容长度：${String(args.content || '').length} 字符`, target);
        if (!ok) { appendToolLog({ tool: name, args: { path: target }, risk: 'high', result: '用户拒绝', summary: `写入 ${target}（已拒绝）` }); emit('denied', '用户拒绝'); return '用户拒绝了这个操作。'; }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, String(args.content || ''), 'utf8');
        appendToolLog({ tool: name, args: { path: target }, risk: 'high', result: '已执行', summary: `写入 ${target}` });
        emit('done', path.basename(target));
        return `已写入 ${target}`;
      }

      if (name === 'delete_path') {
        if (isBlockedPath(target)) return `拒绝删除：${target} 属于受保护的系统位置。`;
        const ok = await askPermission(ctx, 'AI 想要删除文件/目录', `目标：${target}`, target);
        if (!ok) { appendToolLog({ tool: name, args: { path: target }, risk: 'high', result: '用户拒绝', summary: `删除 ${target}（已拒绝）` }); emit('denied', '用户拒绝'); return '用户拒绝了这个操作。'; }
        fs.rmSync(target, { recursive: true, force: true });
        appendToolLog({ tool: name, args: { path: target }, risk: 'high', result: '已执行', summary: `删除 ${target}` });
        emit('done', path.basename(target));
        return `已删除 ${target}`;
      }

      if (name === 'run_command') {
        const t = config.get().prefs.tools || {};
        if (!t.allowCommand) return '命令执行已被用户关闭。';
        const cmd = String(args.command || '');
        if (isBlockedCommand(cmd)) return '拒绝执行：这条命令在危险命令黑名单里。';
        for (const p of String(cmd).match(/[A-Za-z]:[\\/][^\s"']*/g) || []) {
          if (isBlockedPath(p)) return `拒绝执行：命令里涉及受保护的系统位置 ${p}。`;
        }
        const ok = await askPermission(ctx, 'AI 想要执行一条命令', `命令：\n${cmd}\n\n工作目录：${args.cwd || '（默认）'}`, args.cwd || ctx.workDir);
        if (!ok) { appendToolLog({ tool: name, args: { command: cmd }, risk: 'high', result: '用户拒绝', summary: '执行命令（已拒绝）' }); emit('denied', '用户拒绝'); return '用户拒绝了这个操作。'; }
        const { exec } = require('child_process');
        const out = await new Promise((resolve) => {
          exec(cmd, { cwd: args.cwd || undefined, timeout: 60000, maxBuffer: 1024 * 1024 * 4, windowsHide: true },
            (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
        });
        appendToolLog({ tool: name, args: { command: cmd }, risk: 'high', result: out.err ? '失败' : '已执行', summary: `执行命令：${cmd.slice(0, 60)}` });
        emit('done', out.err ? '命令失败' : '命令完成');
        return clipText(`退出码：${out.err ? out.err.code : 0}\n${out.stdout}${out.stderr ? '\n[stderr]\n' + out.stderr : ''}`, TOOL_OUTPUT_LIMIT);
      }

      return `未知工具：${name}`;
    } catch (e) {
      emit('error', String((e && e.message) || e));
      return `工具执行出错：${(e && e.message) || e}`;
    }
  }

  return { executeTool, toolsEnabled, toolLog, appendToolLog, TOOL_DEFS, AGENT_TOOL_DEFS };
}

module.exports = {
  createTools,
  TOOL_DEFS,
  AGENT_TOOL_DEFS,
  TOOLS_SYSTEM_HINT,
  AGENT_SYSTEM_HINT,
  FALLBACK_TOOL_HINT,
  parseFallbackCommand,
  isBlockedPath,
  isBlockedCommand,
  stripHtml,
  clipText,
  TOOL_OUTPUT_LIMIT,
};

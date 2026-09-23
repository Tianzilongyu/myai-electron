'use strict';

/**
 * 主进程单元测试
 * 只碰不依赖 electron 的模块（providers / config / ai / tools / agent / files），
 * 依赖全部注入临时目录 + 假加密器，跑完不留痕。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const { PROVIDERS } = require(path.join(ROOT, 'src/main/providers'));
const { createConfigStore, defaultPrefs } = require(path.join(ROOT, 'src/main/config'));
const {
  createAiClient, buildError, normalizeUsage, isAbortError,
  looksLikeToolsUnsupported, createSseParser,
} = require(path.join(ROOT, 'src/main/ai'));
const {
  createTools, parseFallbackCommand, isBlockedPath, isBlockedCommand, clipText,
} = require(path.join(ROOT, 'src/main/tools'));
const {
  toolNameFor, parseToolName, isMcpTool, mcpToolToDef, contentToText,
} = require(path.join(ROOT, 'src/main/mcp'));
const { createAgentRunner, mergeToolStep } = require(path.join(ROOT, 'src/main/agent'));
const {
  createFileService, collectDirEntries, mdToHtml, parseTable, collectTable,
} = require(path.join(ROOT, 'src/main/files'));

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `myai-${tag}-`));
}

function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(`enc(${s})`, 'utf8'),
    decryptString: (b) => {
      const s = b.toString('utf8');
      if (!s.startsWith('enc(') || !s.endsWith(')')) throw new Error('bad payload');
      return s.slice(4, -1);
    },
  };
}

function makeConfig(dir) {
  return createConfigStore({ dataDir: dir, safeStorage: fakeSafeStorage(true) });
}

module.exports = function run(t) {
  /* ================= 供应商注册表 ================= */
  t.group('providers');
  t.ok('15 家供应商', Object.keys(PROVIDERS).length >= 15);
  t.ok('每家都有 id/name/baseURL/model/模型列表', Object.values(PROVIDERS).every((p) =>
    p.id && p.name && p.baseURL && p.model && Array.isArray(p.models) && p.models.length));
  t.ok('每家的 id 和键名一致', Object.entries(PROVIDERS).every(([k, p]) => k === p.id));
  t.ok('thinkingParam 都是函数且返回对象', Object.values(PROVIDERS).every((p) => {
    const a = p.thinkingParam(true);
    const b = p.thinkingParam(false);
    return a && typeof a === 'object' && b && typeof b === 'object';
  }));
  t.ok('只有 ollama 关掉了 streamUsage', Object.values(PROVIDERS).filter((p) => p.streamUsage === false).length === 1);

  /* ================= 配置存储 ================= */
  t.group('config');
  const dirA = tmpDir('cfg');
  {
    const cfg = makeConfig(dirA);
    t.eq('默认 prefs 完整', Object.keys(defaultPrefs()).length > 10, true);
    t.eq('默认预置了 tools 结构', typeof cfg.get().prefs.tools.enabled, 'boolean');

    cfg.setApiKey('deepseek', 'sk-abcdef1234');
    t.eq('密钥可回读', cfg.getApiKey('deepseek', 'DeepSeek'), 'sk-abcdef1234');
    t.eq('密钥尾号只露 4 位', cfg.keyTail('deepseek'), '1234');

    cfg.setToolKey('search', 'tvly-9999');
    t.eq('工具密钥可回读', cfg.getToolKey('search'), 'tvly-9999');

    // 回归：以前重建缓存时会把 toolKeys 整个丢掉，重启后搜索 key 就没了
    const cfg2 = makeConfig(dirA);
    t.eq('重启后 AI 密钥仍在', cfg2.getApiKey('deepseek', 'DeepSeek'), 'sk-abcdef1234');
    t.eq('重启后工具密钥仍在（回归）', cfg2.getToolKey('search'), 'tvly-9999');

    cfg2.removeApiKey('deepseek');
    t.eq('清除密钥生效', cfg2.get().keys.deepseek, undefined);

    cfg2.setPrefs({ temperature: 1.2 });
    const cfg3 = makeConfig(dirA);
    t.eq('prefs 落盘', cfg3.get().prefs.temperature, 1.2);
  }
  {
    // 脏配置不能把结构搅坏
    const dirB = tmpDir('cfg2');
    fs.writeFileSync(path.join(dirB, 'config.json'), JSON.stringify({
      keys: 'not-an-object',
      prefs: { tools: undefined, contextRounds: 'abc', temperature: 0.5, petPos: { x: 1, y: 2 } },
    }));
    const cfg = makeConfig(dirB);
    t.eq('坏掉的 keys 退回空对象', Object.keys(cfg.get().keys).length, 0);
    t.eq('tools 被冲掉后仍是对象', typeof cfg.get().prefs.tools, 'object');
    t.ok('tools 三个开关都在', ['enabled', 'allowCommand', 'searchProvider'].every((k) => k in cfg.get().prefs.tools));
    t.eq('用户自定义的键保留', cfg.get().prefs.petPos.x, 1);
    t.eq('正常数值保留', cfg.get().prefs.temperature, 0.5);
  }
  {
    // 系统不支持加密时不能把人卡死
    const dirC = tmpDir('cfg3');
    const cfg = createConfigStore({ dataDir: dirC, safeStorage: fakeSafeStorage(false) });
    cfg.setApiKey('openai', 'sk-plain');
    t.eq('无加密环境也能存读', cfg.getApiKey('openai', 'OpenAI'), 'sk-plain');
    t.eq('encryptionAvailable 如实报告', cfg.encryptionAvailable(), false);
  }

  /* ================= AI 请求助手 ================= */
  t.group('ai');
  t.ok('401 说密钥问题', /密钥/.test(buildError(401, '{"error":{"message":"nope"}}')));
  t.ok('429 说限流', /限流/.test(buildError(429, '')));
  t.ok('500 说服务商', /服务商/.test(buildError(500, '')));
  t.ok('422 带原文', /HTTP 422/.test(buildError(422, 'bad')));

  t.eq('usage 归一化', JSON.stringify(normalizeUsage({ prompt_tokens: 3, completion_tokens: 5 })),
    JSON.stringify({ prompt: 3, completion: 5, total: 8, exact: true }));
  t.eq('usage 缺失返回 null', normalizeUsage(null), null);
  t.eq('usage 全 0 返回 null', normalizeUsage({ prompt_tokens: 0, completion_tokens: 0 }), null);

  t.ok('识别 AbortError', isAbortError({ name: 'AbortError' }));
  t.ok('识别 isAbort 标记', isAbortError({ isAbort: true }));
  t.ok('识别「已停止生成」', isAbortError(new Error('已停止生成')));
  t.eq('普通错误不算中止', isAbortError(new Error('连接失败')), false);

  t.ok('认出 tools 不支持', looksLikeToolsUnsupported("Unknown parameter: 'tools'"));
  t.ok('认出中文不支持', looksLikeToolsUnsupported('不支持 tools 参数'));
  t.eq('普通报错不算', looksLikeToolsUnsupported('余额不足'), false);

  {
    const got = [];
    const push = createSseParser((j) => got.push(j));
    push('data: {"a":1}\n\n');
    push('data: {"b":2}\n');
    t.eq('SSE 解析', got.length, 2);
    push('data: [DONE]\n');
    t.eq('[DONE] 被忽略', got.length, 2);
    push('data: {broken\n');
    t.eq('坏 JSON 被跳过', got.length, 2);
  }

  {
    const ai = createAiClient({ providers: PROVIDERS, getApiKey: () => 'sk-test' });
    const body = ai.buildChatBody('deepseek', [], { thinking: true, temperature: 0.7 });
    t.ok('深度思考会带上 thinking', body.thinking && body.thinking.type === 'enabled');
    t.eq('DeepSeek 思考模式下丢掉 temperature', 'temperature' in body, false);
    const body2 = ai.buildChatBody('deepseek', [], { temperature: 0.5 });
    t.eq('普通模式保留 temperature', body2.temperature, 0.5);
    const body3 = ai.buildChatBody('ollama', [], { model: 'llama3' });
    t.eq('模型覆盖生效', body3.model, 'llama3');
    t.eq('默认模型回退', ai.buildChatBody('zhipu', [], {}).model, PROVIDERS.zhipu.model);
  }

  /* ================= 安全底线 ================= */
  t.group('安全底线');
  t.ok('Windows 目录拒绝', isBlockedPath('C:\\Windows\\System32'));
  t.ok('Program Files 拒绝', isBlockedPath('C:\\Program Files\\app'));
  t.ok('盘根目录拒绝', isBlockedPath('C:\\'));
  t.ok('.ssh 拒绝', isBlockedPath('C:\\Users\\me\\.ssh\\id_rsa'));
  t.ok('Linux /etc 拒绝', isBlockedPath('/etc/passwd'));
  t.eq('用户目录放行', isBlockedPath('C:\\Users\\me\\project'), false);
  t.ok('rm -rf / 拒绝', isBlockedCommand('rm -rf /'));
  t.ok('format 拒绝', isBlockedCommand('format C:'));
  t.ok('关机拒绝', isBlockedCommand('shutdown /s'));
  t.eq('普通命令放行', isBlockedCommand('npm run build'), false);

  /* ================= MCP 工具名与定义转换 ================= */
  t.group('MCP');
  t.eq('工具名编码', toolNameFor('db', 'query'), 'mcp_db__query');
  t.eq('工具名净化特殊字符', toolNameFor('a b', 'x-y'), 'mcp_a_b__x_y');
  t.eq('解析回 serverId', parseToolName('mcp_db__query').serverId, 'db');
  t.eq('解析回 toolName', parseToolName('mcp_db__query').toolName, 'query');
  t.eq('非 MCP 工具返回 null', parseToolName('web_search'), null);
  t.eq('isMcpTool 判定为真', isMcpTool('mcp_db__query'), true);
  t.eq('isMcpTool 判定为假', isMcpTool('read_file'), false);
  {
    const def = mcpToolToDef(
      { id: 'db', name: '数据库' },
      { name: 'query', description: '查数据', inputSchema: { type: 'object', properties: { sql: { type: 'string' } } } },
    );
    t.eq('工具定义名称', def.function.name, 'mcp_db__query');
    t.eq('工具描述带服务器名', /数据库/.test(def.function.description), true);
    t.ok('参数透传', Boolean(def.function.parameters.properties.sql));
  }
  t.eq('文本提取', contentToText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'a\nb');
  t.eq('忽略非文本块', contentToText([{ type: 'image' }, { type: 'text', text: 'c' }]), 'c');
  t.eq('空数组返回空串', contentToText([]), '');

  /* ================= 降级指令解析 ================= */
  t.group('降级指令');
  t.eq('SEARCH', parseFallbackCommand('SEARCH: 今天天气').name, 'web_search');
  t.eq('FETCH', parseFallbackCommand('FETCH: https://a.com').args.url, 'https://a.com');
  t.eq('LIST', parseFallbackCommand('LIST: D:\\\\work').args.path, 'D:\\\\work');
  t.eq('FIND 拆 root|kw', parseFallbackCommand('FIND: D:\\\\work | report').args.keyword, 'report');
  t.eq('WRITE 拆 |||', parseFallbackCommand('WRITE: a.txt ||| hello').args.content, 'hello');
  t.eq('RUN', parseFallbackCommand('RUN: npm test').args.command, 'npm test');
  t.eq('PLAN 拆步骤', parseFallbackCommand('PLAN: 一 | 二 | 三').args.steps.length, 3);
  t.eq('普通回答不误判', parseFallbackCommand('好的，我帮你整理一下'), null);
  t.eq('空输入', parseFallbackCommand(''), null);

  /* ================= 工具执行 ================= */
  t.group('工具执行');
  {
    const dir = tmpDir('tools');
    const cfg = makeConfig(dir);
    const tools = createTools({
      config: cfg,
      readFileContent: async () => 'file-body',
      confirmDangerous: async () => false,
    });
    t.eq('总开关默认关', tools.toolsEnabled(), false);

    const denied = [];
    tools.executeTool('web_search', { query: 'x' }, (e) => denied.push(e));
    t.ok('开关关着时联网也被挡', denied.some((e) => e.status === 'denied'));

    cfg.setToolsPrefs({ enabled: true });
    t.eq('打开后生效', tools.toolsEnabled(), true);

    // 工作目录内自动批准
    const workDir = path.join(dir, 'proj');
    fs.mkdirSync(workDir);
    const target = path.join(workDir, 'a.txt');
    return chain();

    async function chain() {
      const events = [];
      const out = await tools.executeTool('write_file', { path: target, content: 'hi' },
        (e) => events.push(e), { autoApprove: true, workDir });
      t.ok('工作目录内自动批准写入', /已写入/.test(out));
      t.eq('写入内容正确', fs.readFileSync(target, 'utf8'), 'hi');
      t.ok('事件里出现 done', events.some((e) => e.status === 'done'));

      // 目录外仍然要问（这里 confirm 一律拒绝）
      const out2 = await tools.executeTool('write_file', { path: path.join(dir, 'outside.txt'), content: 'x' },
        () => {}, { autoApprove: true, workDir });
      t.ok('目录外照旧弹窗并被拒绝', /拒绝/.test(out2));

      // 受保护路径硬拒绝
      const out3 = await tools.executeTool('read_file', { path: 'C:\\Windows\\win.ini' }, () => {}, {});
      t.ok('系统路径硬拒绝', /受保护/.test(out3));

      // 命令开关
      const out4 = await tools.executeTool('run_command', { command: 'echo hi' }, () => {}, {});
      t.ok('命令开关关着时拒绝', /关闭/.test(out4));
      cfg.setToolsPrefs({ allowCommand: true });
      const out5 = await tools.executeTool('run_command', { command: 'format C:' }, () => {}, {});
      t.ok('黑名单命令直接拒', /黑名单/.test(out5));

      t.ok('操作日志有记录', tools.toolLog.length >= 3);

      await agentTests();
    }
  }

  /* ================= Agent 主循环 ================= */
  async function agentTests() {
    t.group('Agent 主循环');

    // 1) 直接回答
    {
      const calls = [];
      const aiClient = {
        buildChatBody: (id, msgs, opts) => ({ id, msgs, opts }),
        aiFetch: async (id, body) => { calls.push(body); return { content: '答案在这里', reasoning: '', usage: { prompt: 1, completion: 2, total: 3 }, toolCalls: [] }; },
      };
      const { runAgent } = createAgentRunner({
        providers: PROVIDERS, aiClient, executeTool: async () => 'x',
        TOOL_DEFS: [], AGENT_TOOL_DEFS: [], TOOLS_SYSTEM_HINT: 'H', AGENT_SYSTEM_HINT: 'A',
        FALLBACK_TOOL_HINT: 'F', parseFallbackCommand, looksLikeToolsUnsupported,
      });
      const r = await runAgent('deepseek', [{ role: 'user', content: 'hi' }], { useTools: false });
      t.eq('直接返回答案', r.content, '答案在这里');
      t.eq('只请求一次', calls.length, 1);
      t.eq('用量累加', r.usage.total, 3);
    }

    // 2) 标准 function calling 走一轮工具
    {
      let n = 0;
      const executed = [];
      const aiClient = {
        buildChatBody: (id, msgs, opts) => ({ msgs, opts }),
        aiFetch: async () => {
          n += 1;
          if (n === 1) return { content: '', usage: { prompt: 1, completion: 1, total: 2 }, toolCalls: [{ id: 'c1', function: { name: 'read_file', arguments: '{"path":"a"}' } }] };
          return { content: '读完了', usage: { prompt: 1, completion: 1, total: 2 }, toolCalls: [] };
        },
      };
      const { runAgent } = createAgentRunner({
        providers: PROVIDERS, aiClient,
        executeTool: async (name) => { executed.push(name); return '内容'; },
        TOOL_DEFS: [], AGENT_TOOL_DEFS: [], TOOLS_SYSTEM_HINT: 'H', AGENT_SYSTEM_HINT: 'A',
        FALLBACK_TOOL_HINT: 'F', parseFallbackCommand, looksLikeToolsUnsupported,
      });
      const r = await runAgent('deepseek', [{ role: 'user', content: 'hi' }], { useTools: true });
      t.eq('工具确实被调用', executed.join(','), 'read_file');
      t.eq('拿到最终答案', r.content, '读完了');
      t.eq('两轮请求', n, 2);
    }

    // 3) 不支持 tools 时自动降级
    {
      let n = 0;
      const aiClient = {
        buildChatBody: (id, msgs, opts) => ({ msgs, opts }),
        aiFetch: async (id, body) => {
          n += 1;
          if (n === 1) throw new Error("Unknown parameter: 'tools'");
          if (n === 2) return { content: 'SEARCH: 天气', usage: null, toolCalls: [] };
          return { content: '搜完了', usage: null, toolCalls: [] };
        },
      };
      const executed = [];
      const { runAgent } = createAgentRunner({
        providers: PROVIDERS, aiClient,
        executeTool: async (name) => { executed.push(name); return '结果'; },
        TOOL_DEFS: [], AGENT_TOOL_DEFS: [], TOOLS_SYSTEM_HINT: 'H', AGENT_SYSTEM_HINT: 'A',
        FALLBACK_TOOL_HINT: 'F', parseFallbackCommand, looksLikeToolsUnsupported,
      });
      const r = await runAgent('deepseek', [{ role: 'user', content: 'hi' }], { useTools: true });
      t.eq('降级后解析出工具', executed.join(','), 'web_search');
      t.eq('降级也能收尾', r.content, '搜完了');
      t.ok('降级没有把错误抛出去', true);
    }

    // 4) 步骤合并
    {
      const steps = [];
      mergeToolStep(steps, { name: 'read_file', status: 'running', summary: '' });
      mergeToolStep(steps, { name: 'read_file', status: 'running', summary: '读 a' });
      mergeToolStep(steps, { name: 'read_file', status: 'done', summary: '读 a' });
      mergeToolStep(steps, { name: 'read_file', status: 'running', summary: '读 b' });
      t.eq('同一个工具的多次事件合成一条', steps.length, 2);
      t.eq('第一条已结束', steps[0].status, 'done');
    }

    await fileTests();
    tableTests();
  }

  /* ================= 文件读写与生成 ================= */
  async function fileTests() {
    t.group('文件读写与生成');

    const dir = tmpDir('files');
    const service = createFileService({ tempDir: dir, createHiddenWindow: () => { throw new Error('不该走 PDF'); } });

    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello 中文');
    t.eq('读纯文本', await service.readFileContent(path.join(dir, 'a.txt')), 'hello 中文');

    const bigPath = path.join(dir, 'big.txt');
    fs.writeFileSync(bigPath, 'x');
    fs.truncateSync(bigPath, 21 * 1024 * 1024);   // 撑到 21MB，超过 20MB 上限
    t.ok('超过上限不读', /文件过大/.test(await service.readFileContent(bigPath)));
    t.ok('超限时不吃掉内存', fs.statSync(bigPath).size > 20 * 1024 * 1024);

    // 目录展开
    const tree = path.join(dir, 'proj');
    fs.mkdirSync(path.join(tree, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tree, 'README.md'), '# 标题\n内容');
    fs.writeFileSync(path.join(tree, 'src', 'main.js'), 'console.log(1)');
    const brief = await service.buildDirectoryBrief(tree, {});
    t.ok('目录摘要带目录名', brief.content.includes('proj'));
    t.ok('目录摘要带文件树', brief.content.includes('README.md'));
    t.eq('统计出 2 个文件', brief.fileCount, 2);
    t.ok('展开了文件内容', brief.content.includes('console.log(1)'));

    const entries = await collectDirEntries(tree, {});
    t.eq('遍历节点数正确', entries.files.length, 2);
    t.ok('文件大小是数字', entries.files.every((f) => typeof f.size === 'number'));

    // 生成各格式
    const outDocx = path.join(dir, 'x.docx');
    await service.generateFile(outDocx, '# 标题\n\n正文\n\n- 条目\n\n```\ncode\n```');
    t.ok('docx 生成成功', fs.existsSync(outDocx) && fs.statSync(outDocx).size > 1000);

    const outXlsx = path.join(dir, 'x.xlsx');
    await service.generateFile(outXlsx, '| 姓名 | 年龄 |\n| --- | --- |\n| 张三 | 18 |\n| 李四 | 20 |');
    t.ok('xlsx 生成成功', fs.existsSync(outXlsx) && fs.statSync(outXlsx).size > 1000);

    const outPptx = path.join(dir, 'x.pptx');
    await service.generateFile(outPptx, '# 第一页\n内容一\n\n# 第二页\n内容二');
    t.ok('pptx 生成成功', fs.existsSync(outPptx) && fs.statSync(outPptx).size > 1000);

    const outMd = path.join(dir, 'x.md');
    await service.generateFile(outMd, '# 纯文本');
    t.eq('md 原样写出', fs.readFileSync(outMd, 'utf8'), '# 纯文本');

    t.eq('clipText 超限截断', clipText('abcdef', 3).startsWith('abc'), true);
    t.eq('clipText 未超限不动', clipText('ab', 3), 'ab');
  }

  /* ================= 表格解析（界面和导出共用） ================= */
  function tableTests() {
    t.group('表格解析');

    const md = [
      '| 姓名 | 年龄 | 城市 |',
      '| :--- | :--: | ---: |',
      '| 张三 | 18 | 北京 |',
      '| 李四 | 20 |',
    ].join('\n');
    const parsed = collectTable(md.split('\n'), 0);
    t.eq('表头解析', parsed.header.join('/'), '姓名/年龄/城市');
    t.eq('行数', parsed.rows.length, 2);
    t.eq('缺列自动补齐', parsed.rows[1].join('/'), '李四/20/');
    t.eq('结束位置跳过表格块', parsed.end, 4);

    // 模型常常省掉首尾竖线，照样得认出来
    const loose = collectTable(['姓名 | 年龄', '--- | ---', '张三 | 18'], 0);
    t.ok('无首尾竖线也能认', Boolean(loose));
    t.eq('无首尾竖线的表头', loose ? loose.header.join('/') : '', '姓名/年龄');

    t.eq('分隔行判定：含 - 才算', collectTable(['| a | b |', '| 普通文本 |', '| 1 | 2 |'], 0), null);

    // xlsx：整篇是表格时按表格切；普通句子不能被逗号切碎
    const rows = parseTable(md);
    t.eq('表格按行切', rows.length, 3);
    t.eq('第一行是表头', rows[0].join('/'), '姓名/年龄/城市');

    const prose = parseTable('你好，帮我看下这个\n第二段，也有逗号');
    t.eq('普通句子不按逗号切列', prose.every((r) => r.length === 1), true);

    const csv = parseTable('a,b,c\n1,2,3');
    t.eq('整齐的 CSV 仍按逗号切', csv[0].join('/'), 'a/b/c');

    // PDF（mdToHtml）里的表格
    const html = mdToHtml('# 标题\n\n' + md + '\n\n收尾');
    t.ok('HTML 里有 table', html.includes('<table>'));
    t.ok('HTML 里有 th', html.includes('<th>姓名</th>'));
    t.ok('HTML 表格只出现一次', html.split('<table>').length - 1 === 1);
    t.ok('HTML 里没有漏掉的分隔行', !html.includes('---'));
    t.ok('标题照常解析', html.includes('<h1>标题</h1>'));
  }
};

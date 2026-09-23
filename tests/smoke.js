'use strict';

/**
 * 渲染层冒烟测试（真实 DOM）
 *
 * 用 jsdom 把 index.html 连同全部渲染层脚本真跑一遍，
 * 再用一套假的 window.api 把主流程整个走一遍：发消息、流式、工具、存文件、
 * 多 AI、命令面板、设置、附件、会话、宠物、快捷键……
 *
 * 目的很直接：这类改动最容易犯的错是「某个变量没定义 / 某个 id 写错 / 某个模块改名漏改」，
 * 靠眼睛看不出来，跑一遍就现形。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadJsdom() {
  try {
    return require('jsdom');
  } catch (e) {
    try {
      return require(path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'jsdom'));
    } catch (e2) {
      return null;
    }
  }
}

function provider(id, name, extra = {}) {
  return Object.assign({
    id,
    name,
    avatar: '🤖',
    color: '#4d6bfe',
    model: `${id}-model`,
    models: [`${id}-model`, `${id}-pro`],
    allowCustomModel: true,
    optionalKey: false,
    hasKey: true,
    configured: true,
    keyTail: '1234',
    thinkingSupported: true,
    keyUrl: 'https://example.com',
    keyHint: 'sk-',
    balanceSupported: false,
    encrypted: true,
  }, extra);
}

function defaultPrefs() {
  return {
    singleProvider: 'deepseek',
    modelOverrides: {},
    contextRounds: 6,
    thinkMode: false,
    skills: [],
    multi: { leader: 'deepseek', workers: ['zhipu'] },
    saveDir: '',
    sidebarCollapsed: false,
    tools: { enabled: false, allowCommand: false, searchProvider: 'ddg' },
    temperature: 0.7,
    maxTokens: 0,
    requestChars: 60000,
    systemPrompt: '',
    autoTitle: true,
    autoSaveFiles: true,
    agentMode: false,
    agentWorkDir: '',
    agentAutoApprove: false,
  };
}

/** 假的 window.api：记录调用，并按脚本返回可控结果 */
function createFakeApi(ctl) {
  const calls = [];
  const rec = (name) => (...args) => { calls.push({ name, args }); return undefined; };

  const api = {
    _calls: calls,
    _reset: () => { calls.length = 0; },
    _has: (name) => calls.some((c) => c.name === name),
    _count: (name) => calls.filter((c) => c.name === name).length,
    _last: (name) => [...calls].reverse().find((c) => c.name === name),

    config: {
      get: async () => ({ providers: ctl.providers, prefs: ctl.prefs }),
      setKey: async (p, key) => {
        calls.push({ name: 'setKey', args: [p, key] });
        const prov = ctl.providers.find((x) => x.id === p);
        if (prov) { prov.hasKey = true; prov.configured = true; prov.keyTail = String(key).slice(-4); }
        return { success: true };
      },
      removeKey: async (p) => {
        calls.push({ name: 'removeKey', args: [p] });
        const prov = ctl.providers.find((x) => x.id === p);
        if (prov) { prov.hasKey = false; prov.configured = false; prov.keyTail = ''; }
        return { success: true };
      },
      setPrefs: async (patch) => {
        calls.push({ name: 'setPrefs', args: [patch] });
        Object.assign(ctl.prefs, patch);
        return { success: true, prefs: ctl.prefs };
      },
    },

    ai: {
      once: async (payload) => {
        calls.push({ name: 'ai.once', args: [payload] });
        return ctl.onceHandler(payload);
      },
      abort: async (reqId) => { calls.push({ name: 'ai.abort', args: [reqId] }); return { success: true, aborted: 1 }; },
      onChunk: (reqId, cb) => {
        calls.push({ name: 'ai.onChunk', args: [reqId] });
        ctl.chunkListeners.push(cb);
        return () => {
          const i = ctl.chunkListeners.indexOf(cb);
          if (i >= 0) ctl.chunkListeners.splice(i, 1);
        };
      },
      stream: async (reqId, payload, onChunk) => {
        calls.push({ name: 'ai.stream', args: [reqId, payload] });
        return ctl.streamHandler(reqId, payload, onChunk);
      },
    },

    sessions: {
      load: async () => ctl.storedSessions,
      save: async (sessions) => { ctl.storedSessions = JSON.parse(JSON.stringify(sessions)); return { success: true }; },
      saveSync: (sessions) => { ctl.storedSessions = JSON.parse(JSON.stringify(sessions)); return { success: true }; },
    },

    files: {
      openDialog: async () => ({ success: true, path: 'D:/doc.txt', name: 'doc.txt', content: '文件正文' }),
      pathFor: () => 'D:/dropped.txt',
      ingest: async (p) => {
        calls.push({ name: 'ingest', args: [p] });
        if (ctl.ingestFails) return { success: false, error: '读不了' };
        return { success: true, isDir: false, path: p, name: path.basename(p), content: '拖进来的内容', size: 10, fileCount: 1 };
      },
      pickDir: async () => ({ success: true, path: 'D:/work' }),
      read: async (p) => ({ success: true, path: p, name: path.basename(p), content: 'x' }),
      save: async (o) => { calls.push({ name: 'file.save', args: [o] }); return { success: true, path: 'D:/out/' + (o.defaultName || 'x') }; },
      autoSave: async (o) => {
        calls.push({ name: 'autoSave', args: [o] });
        return { success: true, path: 'D:/desktop/' + o.fileName };
      },
      openInSystem: async () => ({ success: true }),
      showInFolder: () => ({ success: true }),
    },

    balance: {
      fetch: async (p) => ({
        items: [{ id: p, name: p, ok: true, supported: true, accounts: [{ currency: 'CNY', amount: 12.5 }] }],
        fetchedAt: Date.now(),
      }),
    },

    tools: {
      get: async () => ({ prefs: ctl.prefs.tools, searchKeyTail: '', log: [{ time: Date.now(), tool: 'web_search', summary: '搜索 xxx', risk: 'low' }] }),
      setPrefs: async (patch) => { Object.assign(ctl.prefs.tools, patch); return { success: true, prefs: ctl.prefs.tools }; },
      setSearchKey: async () => ({ success: true }),
    },

    app: {
      openExternal: () => ({ success: true }),
      info: async () => ({ version: '1.1.0', dataDir: 'D:/userData' }),
    },
  };
  return api;
}

function flush(win) {
  return new Promise((resolve) => win.setTimeout(resolve, 0));
}

module.exports = async function run(t) {
  const { JSDOM } = loadJsdom() || {};
  if (!JSDOM) {
    t.skip('渲染层冒烟（缺少 jsdom，执行 npm i 后再跑）');
    return null;
  }

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'file:///' + ROOT.replace(/\\/g, '/') + '/index.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const win = dom.window;

  /* jsdom 没实现的部分，补成无害的空操作 */
  win.confirm = () => true;
  win.alert = () => {};
  win.Element.prototype.scrollIntoView = function scrollIntoView() {};
  if (!win.CSS) win.CSS = {};
  if (typeof win.CSS.escape !== 'function') {
    win.CSS.escape = (s) => String(s).replace(/[^\w-]/g, (c) => `\\${c}`);
  }
  Object.defineProperty(win.navigator, 'clipboard', {
    value: { writeText: () => Promise.resolve() },
    configurable: true,
  });

  /* 事件回调里抛出来的异常在 jsdom 里不会打断测试，必须自己接住 */
  const runtimeErrors = [];
  win.addEventListener('error', (e) => {
    runtimeErrors.push(String((e.error && e.error.stack) || e.message));
  });
  win.addEventListener('unhandledrejection', (e) => {
    runtimeErrors.push('unhandledrejection: ' + String((e.reason && e.reason.stack) || e.reason));
  });

  const ctl = {
    providers: [provider('deepseek', 'DeepSeek'), provider('zhipu', '智谱 GLM')],
    prefs: defaultPrefs(),
    storedSessions: [],
    chunkListeners: [],
    ingestFails: false,
    onceHandler: async () => ({ content: '一次性回答', usage: { prompt: 10, completion: 20, total: 30 }, tools: [] }),
    streamHandler: async (reqId, payload, onChunk) => {
      onChunk({ type: 'content', text: '你好，**这是**加粗' });
      return { success: true, content: '你好，**这是**加粗', reasoning: '', usage: { prompt: 10, completion: 20, total: 30 }, tools: [] };
    },
  };

  const api = createFakeApi(ctl);
  win.api = api;

  /* ---- 按 index.html 里的顺序加载全部脚本 ---- */
  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const errors = [];
  const ctx = dom.getInternalVMContext();
  for (const rel of srcs) {
    const file = path.join(ROOT, rel);
    try {
      vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: rel });
    } catch (e) {
      errors.push(`${rel}: ${e.message}`);
    }
  }

  t.group('渲染层加载');
  t.eq('全部脚本无异常加载', errors.length, 0, errors.join(' | '));
  const App = win.App;
  t.ok('App 命名空间建立', Boolean(App));
  if (!App) return null;
  t.ok('dom 模块就位', Boolean(App.dom && App.dom.mainEl), 'mainEl 必须取到，否则整层不工作');
  t.ok('state 模块就位', Boolean(App.state));
  t.ok('chat 模块就位', Boolean(App.chat));
  t.ok('app 模块就位', Boolean(App.app));
  if (errors.length) return App;

  /* ---- 启动 ---- */
  t.group('启动');
  await App.app.start();
  await flush(win);
  t.eq('创建了一条空会话', App.state.sessions.length, 1);
  t.ok('会话列表渲染出来了', App.dom.chatList.querySelectorAll('.chat-item').length === 1);
  t.ok('待机界面可见', !App.dom.welcomeScreen.classList.contains('hidden'));
  t.ok('状态点显示已就绪', !App.dom.statusDot.classList.contains('offline'));
  t.ok('数据目录提示已填', /userData/.test(App.dom.dataDirHint.textContent));
  t.ok('侧边栏身份区刷新了', App.dom.sidebarUserName.textContent === 'DeepSeek');
  t.ok('AI 选择器刷新了', App.dom.aiPickerName.textContent === 'DeepSeek');

  /* ---- 发一条消息（单 AI 流式） ---- */
  t.group('发送消息');
  App.dom.userInput.value = '帮我写周报';
  App.dom.userInput.dispatchEvent(new win.Event('input'));
  await App.chat.sendMessage();
  await flush(win);
  t.ok('调用了 ai.stream', api._has('ai.stream'));
  t.eq('会话里有两条消息', App.state.sessions[0].messages.length, 2);
  t.ok('用户气泡已渲染', App.dom.chatInner.querySelectorAll('.user-message').length === 1);
  const aiBubbles = App.dom.chatInner.querySelectorAll('.ai-message .bubble');
  t.ok('AI 回复已渲染', aiBubbles.length === 1);
  t.ok('Markdown 被解析成 HTML', /<strong>这是<\/strong>/.test(aiBubbles[0].innerHTML));
  t.ok('待机界面已隐藏', App.dom.welcomeScreen.classList.contains('hidden'));
  t.ok('token 计数已更新', App.dom.tokenChipText.textContent !== '0');
  t.ok('上下文计量条有文案', /本次发送/.test(App.dom.contextMeter.textContent));

  /* ---- 表格 ---- */
  t.group('表格');
  const mdTable = [
    '| 姓名 | 年龄 | 城市 |',
    '| :--- | :--: | ---: |',
    '| 张三 | 18 | 北京 |',
    '| 李四 | 20 |',
  ].join('\n');
  const tableHtml = App.markdown.render(mdTable);
  t.ok('渲染成真正的 table', tableHtml.includes('<table>'));
  t.ok('套了横向滚动容器', tableHtml.includes('class="table-scroll"'));
  t.ok('对齐语法生效', /text-align:center/.test(tableHtml));
  t.eq('缺列自动补齐', (tableHtml.match(/<td[ >]/g) || []).length, 6);
  t.ok('分隔行不会漏进正文', !/---/.test(tableHtml));

  ctl.streamHandler = async (reqId, payload, onChunk) => {
    onChunk({ type: 'content', text: mdTable });
    return { success: true, content: mdTable, reasoning: '', usage: null, tools: [] };
  };
  App.dom.userInput.value = '给我一张表';
  await App.chat.sendMessage();
  await flush(win);
  t.ok('气泡里渲染出表格', App.dom.chatInner.querySelectorAll('.table-wrap table').length >= 1);
  t.ok('表格挂上了复制按钮', App.dom.chatInner.querySelectorAll('.table-copy-btn').length >= 1);

  /* ---- 工具调用过程 ---- */
  t.group('工具过程');
  ctl.streamHandler = async (reqId, payload, onChunk) => {
    onChunk({ type: 'tool', name: 'web_search', status: 'running', summary: '搜索 天气' });
    onChunk({ type: 'tool', name: 'web_search', status: 'done', summary: '搜索到 3 条' });
    onChunk({ type: 'content', text: '查到了' });
    return { success: true, content: '查到了', reasoning: '', usage: null, tools: [] };
  };
  App.dom.userInput.value = '今天天气';
  await App.chat.sendMessage();
  await flush(win);
  const bars = App.dom.chatInner.querySelectorAll('.tool-bar');
  t.ok('工具条出现了', bars.length >= 1);
  t.ok('工具 chip 有记录', App.dom.chatInner.querySelectorAll('.tool-chip').length >= 1);
  t.ok('最后一条消息记录了工具', (App.state.sessions[0].messages.slice(-1)[0].tools || []).length === 1);

  /* ---- [[SAVE:]] 自动存盘 ---- */
  t.group('文件自动保存');
  ctl.streamHandler = async (reqId, payload, onChunk) => {
    const text = '说明一句\n[[SAVE:报告.md]]\n# 标题\n正文\n[[/SAVE]]\n收尾';
    onChunk({ type: 'content', text });
    return { success: true, content: text, reasoning: '', usage: null, tools: [] };
  };
  App.dom.userInput.value = '做个报告';
  await App.chat.sendMessage();
  await flush(win);
  t.ok('调用了 autoSave', api._has('autoSave'));
  t.eq('存的文件名正确', api._last('autoSave').args[0].fileName, '报告.md');
  t.ok('保存卡片出现', App.dom.chatInner.querySelectorAll('.saved-files-card').length >= 1);
  t.ok('正文里的 SAVE 标记被剥掉', !/\[\[SAVE/.test(App.dom.chatInner.textContent));
  t.ok('文件名做了安全处理', App.saveMarkers.safeFileName('../../etc/passwd') === '_.._etc_passwd');

  /* ---- 停止生成 ---- */
  t.group('停止生成');
  ctl.streamHandler = async (reqId, payload, onChunk) => {
    onChunk({ type: 'content', text: '写了一半' });
    return { success: false, error: '已停止生成', aborted: true };
  };
  App.dom.userInput.value = '长文';
  await App.chat.sendMessage();
  await flush(win);
  const last = App.state.sessions[0].messages.slice(-1)[0];
  t.ok('保留了已生成的部分', /写了一半/.test(last.content || ''));
  t.eq('标记为已停止', last.stopped, true);
  t.ok('界面上有停止标记', App.dom.chatInner.querySelectorAll('.msg-stopped-tag').length >= 1);
  t.eq('停止不产生错误气泡', App.dom.chatInner.querySelectorAll('.error-box').length, 0);

  /* ---- 出错 ---- */
  t.group('出错处理');
  ctl.streamHandler = async () => { throw new Error('连接断了'); };
  App.dom.userInput.value = '再试一次';
  await App.chat.sendMessage();
  await flush(win);
  t.ok('出错弹了错误块', App.dom.chatInner.querySelectorAll('.error-box').length >= 1);
  t.ok('生成状态已复位', App.state.isGenerating === false);
  t.ok('发送按钮回到「发送」', App.dom.sendBtn.textContent === '发送');

  /* ---- 多 AI ---- */
  t.group('多 AI 协作');
  ctl.streamHandler = async (reqId, payload, onChunk) => {
    onChunk({ type: 'content', text: 'ok' });
    return { success: true, content: 'ok', reasoning: '', usage: null, tools: [] };
  };
  const onceCalls = [];
  ctl.onceHandler = async (payload) => {
    onceCalls.push(payload);
    const sys = payload.messages[0].content;
    if (/总指挥 AI。把用户任务拆成/.test(sys)) {
      return { content: '[PLAN]\n分两步\n\n[TASK:zhipu]\n去查资料', usage: { prompt: 5, completion: 5, total: 10 }, tools: [] };
    }
    if (/专业助手/.test(sys)) return { content: '专家结果', usage: { prompt: 5, completion: 5, total: 10 }, tools: [] };
    return { content: '汇总答案', usage: { prompt: 5, completion: 5, total: 10 }, tools: [] };
  };
  App.chat.setMode('multi');
  t.ok('团队按钮出现', !App.dom.multiConfigBtn.classList.contains('hidden'));
  t.ok('团队按钮显示了统领', App.dom.teamLeaderName.textContent === 'DeepSeek');
  t.ok('团队按钮显示了专家数', /1 位专家/.test(App.dom.teamWorkerSummary.textContent));
  App.dom.userInput.value = '多 AI 任务';
  await App.chat.sendMessage();
  await flush(win);
  t.eq('多 AI 走了三次调用（规划/专家/汇总）', onceCalls.length, 3);
  const multiMsg = App.state.sessions[0].messages.slice(-1)[0];
  t.ok('记录了协作详情', Boolean(multiMsg.multiStages));
  t.eq('规划被解析出来', multiMsg.multiStages.plan, '分两步');
  t.eq('专家结果被记下', multiMsg.multiStages.workers.length, 1);
  t.ok('最终答案是汇总结果', multiMsg.content === '汇总答案');
  t.ok('协作详情盒子渲染', App.dom.chatInner.querySelectorAll('.reasoning-box').length >= 1);

  /* ---- 多 AI 团队配置 ---- */
  t.group('多 AI 团队配置');
  App.panels.openConfigPanel();
  await flush(win);
  t.ok('面板打开', App.dom.configPanel.classList.contains('show'));
  t.eq('统领列表渲染', App.dom.leaderGroup.querySelectorAll('.config-row').length, 2);
  t.eq('专家列表渲染', App.dom.workerGroup.querySelectorAll('.config-row').length, 2);
  t.eq('统领计数', App.dom.leaderCount.textContent, '1');
  App.dom.workerClear.click();
  t.eq('清空后专家归零', App.dom.workerCount.textContent, '0');
  App.dom.workerSelectAll.click();
  t.eq('全选后专家计数', App.dom.workerCount.textContent, '2');

  const workerSec = App.dom.configPanel.querySelector('.config-section[data-sec="worker"]');
  const secHead = workerSec.querySelector('.config-section-head');
  secHead.click();
  t.ok('分区可折叠', workerSec.classList.contains('collapsed'));
  t.eq('折叠写进 aria-expanded', secHead.getAttribute('aria-expanded'), 'false');
  secHead.click();
  t.ok('再点展开', !workerSec.classList.contains('collapsed'));

  App.dom.configSave.click();
  await flush(win);
  t.ok('保存后面板关闭', !App.dom.configPanel.classList.contains('show'));
  t.eq('保存后专家是两位', App.state.multiConfig.workers.length, 2);
  t.ok('团队按钮同步更新', /2 位专家/.test(App.dom.teamWorkerSummary.textContent));

  App.chat.setMode('single');

  /* ---- 深度思考 ---- */
  t.group('深度思考');
  App.providerUI.setThinkMode(false);
  App.dom.thinkToggle.click();
  await flush(win);
  t.eq('开关切到开', App.state.prefs.thinkMode, true);
  t.ok('按钮高亮', App.dom.thinkToggle.classList.contains('active'));
  App.dom.thinkToggle.click();
  await flush(win);
  t.eq('再点切回关', App.state.prefs.thinkMode, false);

  /* ---- 研发模式 ---- */
  t.group('研发模式');
  App.dom.agentToggle.click();
  t.eq('模式打开', App.state.agentMode, true);
  t.ok('工作目录条出现', !App.dom.agentBar.classList.contains('hidden'));
  ctl.streamHandler = async (reqId, payload, onChunk) => {
    onChunk({ type: 'plan', steps: ['勘察', '改代码', '验证'] });
    onChunk({ type: 'tool', name: 'read_file', status: 'running', summary: '读 a.js' });
    onChunk({ type: 'tool', name: 'read_file', status: 'done', summary: '读 a.js' });
    onChunk({ type: 'content', text: '做完了' });
    return { success: true, content: '做完了', reasoning: '', usage: null, tools: [] };
  };
  App.dom.userInput.value = '重构这个项目';
  await App.chat.sendMessage();
  await flush(win);
  t.ok('计划卡渲染', App.dom.chatInner.querySelectorAll('.plan-card').length >= 1);
  t.ok('时间线渲染', App.dom.chatInner.querySelectorAll('.tool-timeline').length >= 1);
  App.dom.agentToggle.click();
  t.eq('模式关闭', App.state.agentMode, false);

  /* ---- 附件 ---- */
  t.group('附件');
  await App.attachments.attachPath('D:/a.txt');
  await flush(win);
  t.eq('附件 chip 出现', App.dom.attachmentBar.querySelectorAll('.attachment-chip').length, 1);
  t.ok('附件栏展开', App.dom.attachmentBar.classList.contains('show'));
  App.dom.attachmentBar.querySelector('.attachment-chip-remove').click();
  await flush(win);
  t.eq('移除后清空', App.state.pendingAttachments.length, 0);
  ctl.ingestFails = true;
  await App.attachments.attachPath('D:/b.txt');
  await flush(win);
  t.ok('读取失败给提示', App.dom.toastWrap.querySelectorAll('.toast').length >= 1);
  ctl.ingestFails = false;

  /* ---- 会话管理 ---- */
  t.group('会话管理');
  const before = App.state.sessions.length;
  App.dom.newChatBtn.click();
  await flush(win);
  t.eq('新建会话', App.state.sessions.length, before + 1);
  App.state.sessionQuery = '周报';
  App.sessions.renderChatList();
  t.ok('搜索能过滤', App.dom.chatList.querySelectorAll('.chat-item').length >= 1);
  App.state.sessionQuery = '';
  App.sessions.renderChatList();
  t.eq('清空搜索恢复', App.dom.chatList.querySelectorAll('.chat-item').length, App.state.sessions.length);

  const target = App.state.sessions[0];
  App.sessions.switchSession(target.id);
  t.eq('切换会话生效', App.state.activeSessionId, target.id);
  t.eq('标题本地提取', App.sessions.localTitle('帮我整理桌面文件'), '整理桌面文件');
  t.eq('叠词也能剥', App.sessions.localTitle('麻烦帮我写一份周报'), '写周报');
  t.eq('只取第一个分句', App.sessions.localTitle('帮我查一下天气，顺便看看路况'), '查天气');
  t.eq('空输入有兜底', App.sessions.localTitle(''), '新对话');

  const delCount = App.state.sessions.length;
  App.sessions.deleteSession(App.state.sessions[1].id);
  await flush(win);
  t.eq('删除会话', App.state.sessions.length, delCount - 1);

  /* ---- 命令面板 ---- */
  t.group('命令面板');
  App.command.open();
  t.ok('面板打开', App.dom.cmdPanel.classList.contains('show'));
  t.ok('命令已列出', App.dom.cmdList.querySelectorAll('.cmd-item').length > 5);
  App.dom.cmdInput.value = '设置';
  App.dom.cmdInput.dispatchEvent(new win.Event('input'));
  await flush(win);
  t.ok('搜索能过滤命令', App.dom.cmdList.querySelectorAll('.cmd-item').length >= 1);
  App.utils.toast;
  App.command.close();
  t.ok('面板关闭', !App.dom.cmdPanel.classList.contains('show'));

  /* ---- 技能面板 ---- */
  t.group('技能面板');
  App.panels.openSkillPanel();
  t.ok('面板打开', App.dom.skillPanel.classList.contains('show'));
  t.eq('技能全部渲染', App.dom.skillGrid.querySelectorAll('.skill-card').length, App.skills.length);
  App.dom.skillGrid.querySelector('.skill-card').click();
  t.eq('选中一个技能', App.state.selectedSkills.length, 1);
  App.dom.skillApplyBtn.click();
  await flush(win);
  t.ok('应用后徽标更新', App.dom.skillCount.textContent === '1');
  t.ok('面板关闭', !App.dom.skillPanel.classList.contains('show'));

  /* ---- 设置与密钥 ---- */
  t.group('设置与密钥');
  App.settings.openView();
  t.ok('设置视图打开', !App.dom.sidebarSettingsView.classList.contains('hidden'));
  t.ok('密钥列表渲染', App.dom.keyList.querySelectorAll('.key-row').length === 2);
  const row = App.dom.keyList.querySelector('.key-row');
  row.querySelector('.key-head').click();
  t.ok('展开密钥行', !row.querySelector('.key-body').classList.contains('hidden'));
  const input = row.querySelector('.key-input');
  input.value = 'sk-newkey9999';
  row.querySelectorAll('.key-btn')[0].click();
  await flush(win);
  t.ok('保存密钥被调到', api._has('setKey'));
  t.ok('保存后刷新了状态', /已保存/.test(row.querySelector('.key-tail').textContent));
  const removeBtn = row.querySelectorAll('.key-btn')[1];
  removeBtn.click();
  await flush(win);
  t.ok('清除密钥被调到', api._has('removeKey'));

  App.dom.temperatureInput.value = '1.2';
  App.dom.temperatureInput.dispatchEvent(new win.Event('change'));
  await flush(win);
  t.eq('温度已保存', App.state.prefs.temperature, 1.2);
  App.dom.autoSaveFilesBtn.click();
  await flush(win);
  t.eq('自动保存开关可切换', App.state.prefs.autoSaveFiles, false);
  App.dom.autoSaveFilesBtn.click();
  await flush(win);

  /* ---- AI 能力面板 ---- */
  t.group('AI 能力');
  await App.toolsUI.refresh();
  await flush(win);
  t.eq('总开关默认关', App.dom.toolMasterBtn.textContent, '关');
  t.ok('日志渲染', App.dom.toolLogEl.querySelectorAll('.tool-log-row').length >= 1);
  App.dom.toolMasterBtn.click();
  await flush(win);
  t.eq('打开总开关', App.state.prefs.tools.enabled, true);
  t.eq('按钮变开', App.dom.toolMasterBtn.textContent, '开');
  App.dom.toolCommandBtn.click();
  await flush(win);
  t.eq('命令开关打开', App.state.prefs.tools.allowCommand, true);
  App.dom.toolMasterBtn.click();
  await flush(win);
  t.eq('再关回去', App.state.prefs.tools.enabled, false);

  /* ---- 桌面宠物 ---- */
  t.group('桌面宠物');
  App.pet.openPet();
  await flush(win);
  t.ok('气泡打开', App.state.petOpen);
  t.ok('气泡有内容', App.dom.deskmateBubble.querySelectorAll('.pet-balance-card').length === 1);
  t.ok('余额显示出来了', /¥/.test(App.dom.deskmateBubble.textContent));
  t.ok('模式小标签渲染', App.dom.deskmateBubble.querySelectorAll('.pet-mode-chip').length === 2);
  App.dom.deskmatePet.click();
  await flush(win);
  t.ok('再点收起', !App.state.petOpen);
  App.pet.petApplyPosition();
  t.ok('位置已应用', typeof App.state.petPos.x === 'number');

  /* ---- 消息操作 ---- */
  t.group('消息操作');
  // 前面的会话增删可能把当前会话换成了空会话，先切回有回答的那一条
  // 前面的「清空会话」会把历史抹掉，先切回有回答的那条；没有就现发一条
  let withAi = App.state.sessions.find((s) => s.messages.some((m) => m.role === 'assistant'));
  if (!withAi) {
    App.dom.userInput.value = '再来一条';
    await App.chat.sendMessage();
    await flush(win);
    withAi = App.state.sessions.find((s) => s.messages.some((m) => m.role === 'assistant'));
  }
  if (withAi) App.sessions.switchSession(withAi.id);
  await flush(win);
  const aiMsgDiv = App.dom.chatInner.querySelector('.ai-message');
  t.ok('找到一条 AI 回答', Boolean(aiMsgDiv));
  if (!aiMsgDiv) return App;
  aiMsgDiv.querySelectorAll('.msg-action')[1].click();   // 复制
  await flush(win);
  t.ok('复制不报错', true);
  const delCountMsg = App.state.sessions[0].messages.length;
  const delBtn = [...aiMsgDiv.querySelectorAll('.msg-action')].find((b) => /删除/.test(b.textContent));
  if (delBtn) {
    delBtn.click();
    await flush(win);
    t.eq('删除回答生效', App.state.sessions[0].messages.length, delCountMsg - 1);
  } else {
    t.ok('删除按钮存在', false);
  }

  /* ---- 快捷键 ---- */
  t.group('快捷键');
  App.shortcuts.open();
  t.ok('快捷键面板打开', App.dom.shortcutsPanel.classList.contains('show'));
  t.ok('快捷键条目渲染', App.dom.shortcutsBody.querySelectorAll('.sc-row').length >= 8);
  App.shortcuts.close();
  t.ok('快捷键面板关闭', !App.dom.shortcutsPanel.classList.contains('show'));

  const key = (k, opts = {}) => {
    const e = new win.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts));
    win.document.dispatchEvent(e);
  };
  key('k', { ctrlKey: true });
  t.ok('Ctrl+K 打开命令面板', App.command.isOpen());
  key('Escape');
  t.ok('Esc 关闭命令面板', !App.command.isOpen());
  // 「?」只在没打字的时候才生效，先把焦点从输入框挪开
  if (win.document.activeElement && win.document.activeElement.blur) win.document.activeElement.blur();
  key('?');
  t.ok('? 打开快捷键', App.shortcuts.isOpen());
  key('Escape');

  /* ---- 落盘 ---- */
  t.group('落盘');
  await App.sessions.saveSessionsNow();
  t.ok('会话写盘', Array.isArray(ctl.storedSessions) && ctl.storedSessions.length > 0);
  t.ok('存档里没有 loadingDiv 之类脏东西',
    JSON.stringify(ctl.storedSessions).indexOf('loadingDiv') === -1);

  /* ---- 全程无未捕获异常 ---- */
  t.group('运行时异常');
  t.eq('事件回调没有抛异常', runtimeErrors.length, 0, runtimeErrors.slice(0, 3).join(' | '));

  return App;
};

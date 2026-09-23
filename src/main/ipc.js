'use strict';

/**
 * 所有 IPC 通道的注册
 *
 * 约定：
 *   - 渲染层拿不到任何密钥，密钥只在主进程里取用
 *   - 出错时统一返回 { success:false, error }，不要把异常直接抛穿到渲染层
 *   - ai:stream / ai:once 会把中止当成一种正常结果，用 aborted 标记区分「用户按停」和「真出错」
 */
const path = require('path');
const fs = require('fs');
const { ipcMain, dialog, shell, BrowserWindow } = require('electron');

const BALANCE_TIMEOUT_MS = 8000;

function registerIpc(ctx) {
  const {
    app, providers, config, aiClient, tools, files, runAgent, isAbortError, getMainWindow,
  } = ctx;

  /* ---------- 配置 ---------- */
  ipcMain.handle('config:get', () => {
    const cfg = config.get();
    return {
      providers: Object.values(providers).map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        color: p.color,
        model: (cfg.prefs.modelOverrides && cfg.prefs.modelOverrides[p.id]) || p.model,
        models: p.models,
        allowCustomModel: Boolean(p.allowCustomModel),
        optionalKey: Boolean(p.optionalKey),
        hasKey: Boolean(cfg.keys[p.id]),
        configured: Boolean(cfg.keys[p.id]) || Boolean(p.optionalKey),
        keyTail: config.keyTail(p.id),
        thinkingSupported: Boolean(p.thinkingSupported),
        keyUrl: p.keyUrl,
        keyHint: p.keyHint,
        balanceSupported: Boolean(p.balance),
        encrypted: config.encryptionAvailable(),
      })),
      prefs: cfg.prefs,
    };
  });

  ipcMain.handle('config:set-key', (_e, { provider, key }) => {
    if (!providers[provider]) return { success: false, error: '未知的 AI 服务' };
    const value = String(key || '').trim();
    if (!value) return { success: false, error: '密钥不能为空' };
    config.setApiKey(provider, value);
    return { success: true };
  });

  ipcMain.handle('config:remove-key', (_e, { provider }) => {
    config.removeApiKey(provider);
    return { success: true };
  });

  ipcMain.handle('config:set-prefs', (_e, prefs) => {
    if (prefs && typeof prefs === 'object' && !Array.isArray(prefs)) config.setPrefs(prefs);
    return { success: true, prefs: config.get().prefs };
  });

  /* ---------- 余额 ----------
   * 只有官方开放了余额接口的才去查；其余的一律不去猜
   * （智谱的余额接口是内部抓包地址、火山和阿里要控制台鉴权，都不稳定，宁缺毋错） */
  async function fetchProviderBalance(p) {
    const base = { id: p.id, name: p.name, color: p.color, supported: Boolean(p.balance) };
    let key = '';
    try {
      key = config.getApiKey(p.id, p.name);
    } catch (e) {
      return Object.assign(base, { ok: false, error: '密钥解不开，请重新填写' });
    }
    if (!key) return Object.assign(base, { ok: false, supported: false, error: '未配置密钥' });
    if (!p.balance) return Object.assign(base, { ok: false, supported: false, error: '该平台无公开余额接口' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BALANCE_TIMEOUT_MS);
    try {
      const res = await fetch(p.balance.url, {
        method: 'GET',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      });
      const text = await res.text();
      if (!res.ok) {
        let detail = text.slice(0, 120);
        try {
          const j = JSON.parse(text);
          detail = (j.error && (j.error.message || j.error.code)) || j.message || detail;
        } catch (e) { /* 不是 JSON 就用原文 */ }
        throw new Error(`HTTP ${res.status} ${detail}`);
      }
      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        throw new Error('返回的不是 JSON');
      }
      return Object.assign(base, { ok: true, accounts: p.balance.parse(json) });
    } catch (e) {
      return Object.assign(base, { ok: false, error: (e && e.message) || '查询失败' });
    } finally {
      clearTimeout(timer);
    }
  }

  /* provider 传了就只查这一家，不传就查全部 */
  ipcMain.handle('balance:fetch', async (_e, arg) => {
    const provider = arg && arg.provider;
    const targets = provider ? (providers[provider] ? [providers[provider]] : []) : Object.values(providers);
    const list = await Promise.all(targets.map(fetchProviderBalance));
    return { items: list, fetchedAt: Date.now() };
  });

  /* ---------- AI 能力面板 ---------- */
  ipcMain.handle('tools:get', () => {
    const t = config.get().prefs.tools || {};
    return {
      prefs: { enabled: Boolean(t.enabled), allowCommand: Boolean(t.allowCommand), searchProvider: t.searchProvider || 'ddg' },
      searchKeyTail: config.getToolKey('search').slice(-4),
      log: tools.toolLog.slice(0, 40),
    };
  });

  ipcMain.handle('tools:set-prefs', (_e, patch) => ({ success: true, prefs: config.setToolsPrefs(patch) }));

  ipcMain.handle('tools:set-search-key', (_e, arg) => {
    config.setToolKey('search', arg && arg.key);
    return { success: true };
  });

  /* ---------- AI 请求 ---------- */
  function senderFor(event, reqId) {
    if (!reqId || !event || !event.sender || event.sender.isDestroyed()) return null;
    return (payload) => { if (!event.sender.isDestroyed()) event.sender.send(`ai:chunk:${reqId}`, payload); };
  }

  function agentOptions(o) {
    return {
      model: o.model,
      temperature: o.temperature,
      maxTokens: o.maxTokens,
      thinking: Boolean(o.thinking),
      stream: Boolean(o.stream),
      // 跟随总开关：用户关了就不给任何工具
      useTools: tools.toolsEnabled(),
      agent: Boolean(o.agent),
      workDir: String(o.workDir || ''),
      autoApprove: Boolean(o.autoApprove),
    };
  }

  /* 多 AI 模式下每个角色（总指挥 + 各个专家）也都要能用工具。
   * 和 ai:stream 走同一套 runAgent，只是不流式吐字；
   * 传了 reqId 就把工具过程实时推给渲染层，最终返回里也带 tools 步骤。 */
  ipcMain.handle('ai:once', async (event, o) => {
    const arg = o || {};
    const providerId = arg.provider;
    if (!providers[providerId]) throw new Error('未知的 AI 服务');
    if (!Array.isArray(arg.messages)) throw new Error('消息格式不正确');

    const baseMessages = arg.messages.map((m) => ({ role: m.role, content: String(m.content || '') }));
    const onEvent = senderFor(event, arg.reqId);

    try {
      return await runAgent(providerId, baseMessages, agentOptions(arg), arg.reqId || null, onEvent);
    } catch (e) {
      // 中止不当错误抛：渲染层据此区分「用户主动停」和「真出错」
      if (isAbortError(e)) return { content: '', reasoning: '', usage: null, tools: [], aborted: true };
      throw e;
    }
  });

  ipcMain.handle('ai:stream', async (event, o) => {
    const arg = o || {};
    const reqId = arg.reqId;
    const providerId = arg.provider;
    if (!reqId) throw new Error('缺少请求 ID');
    if (!providers[providerId]) throw new Error('未知的 AI 服务');
    if (!Array.isArray(arg.messages)) throw new Error('消息格式不正确');

    const baseMessages = arg.messages.map((m) => ({ role: m.role, content: String(m.content || '') }));
    const send = senderFor(event, reqId) || (() => {});

    try {
      const result = await runAgent(providerId, baseMessages, agentOptions(arg), reqId, send);
      send({ type: 'done' });
      return Object.assign({ success: true }, result);
    } catch (e) {
      const aborted = isAbortError(e);
      const message = aborted ? '已停止生成' : ((e && e.message) || '请求失败');
      send({ type: 'error', text: message });
      return { success: false, error: message, aborted };
    }
  });

  ipcMain.handle('ai:abort', (_e, arg) => ({ success: true, aborted: aiClient.abort(arg && arg.reqId) }));

  /* ---------- 会话 ---------- */
  ipcMain.handle('sessions:load', () => config.readJson(config.dataFile('sessions.json'), []));

  ipcMain.handle('sessions:save', (_e, sessions) => {
    if (!Array.isArray(sessions)) return { success: false };
    config.writeJsonAtomic(config.dataFile('sessions.json'), sessions);
    return { success: true };
  });

  /* 关窗口时渲染层走 beforeunload，异步 invoke 来不及落盘（进程已经走了）。
   * 这条同步通道专门给「最后一刻保存」用，会短暂阻塞渲染进程，只在退出时调一次。 */
  ipcMain.on('sessions:save-sync', (event, sessions) => {
    try {
      if (!Array.isArray(sessions)) {
        event.returnValue = { success: false, error: '数据格式不对' };
        return;
      }
      config.writeJsonAtomic(config.dataFile('sessions.json'), sessions);
      event.returnValue = { success: true };
    } catch (e) {
      event.returnValue = { success: false, error: (e && e.message) || '保存失败' };
    }
  });

  /* ---------- 文件 ---------- */
  const DOC_FILTERS = [
    { name: '办公文档', extensions: ['docx', 'pdf', 'txt', 'md', 'xlsx', 'xls', 'csv'] },
    { name: '代码文件', extensions: ['js', 'py', 'html', 'css', 'java', 'cpp', 'c', 'ts', 'json', 'xml', 'yml', 'yaml'] },
    { name: '所有文件', extensions: ['*'] },
  ];

  const SAVE_FILTERS = [
    { name: 'Word 文档', extensions: ['docx'] },
    { name: 'Excel 表格', extensions: ['xlsx'] },
    { name: 'PPT 演示', extensions: ['pptx'] },
    { name: 'PDF 文档', extensions: ['pdf'] },
    { name: 'Markdown', extensions: ['md'] },
    { name: '文本文件', extensions: ['txt'] },
    { name: 'CSV 表格', extensions: ['csv'] },
    { name: '所有文件', extensions: ['*'] },
  ];

  function focusedWindow() {
    return getMainWindow() || BrowserWindow.getFocusedWindow();
  }

  ipcMain.handle('file:open', async () => {
    const result = await dialog.showOpenDialog(focusedWindow(), { properties: ['openFile'], filters: DOC_FILTERS });
    if (result.canceled || !result.filePaths.length) return { success: false };
    try {
      const filePath = result.filePaths[0];
      return { success: true, path: filePath, name: path.basename(filePath), content: await files.readFileContent(filePath) };
    } catch (e) {
      return { success: false, error: (e && e.message) || '读取失败' };
    }
  });

  ipcMain.handle('file:read', async (_e, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return { success: false, error: '路径无效' };
    try {
      return { success: true, path: filePath, name: path.basename(filePath), content: await files.readFileContent(filePath) };
    } catch (e) {
      return { success: false, error: (e && e.message) || '读取失败' };
    }
  });

  /* 拖拽 / 附件的统一入口。文件和目录都从这里进，
   * 目录会被展开成「目录树 + 关键文件内容」，直接读会返回「这是个目录」，等于白拖。 */
  ipcMain.handle('file:ingest', async (_e, payload) => {
    const filePath = payload && payload.path;
    if (typeof filePath !== 'string' || !filePath) return { success: false, error: '路径无效' };
    try {
      const st = await fs.promises.stat(filePath);
      if (st.isDirectory()) {
        const brief = await files.buildDirectoryBrief(filePath, {
          maxFiles: payload && payload.maxFiles,
          maxChars: payload && payload.maxChars,
        });
        return {
          success: true,
          isDir: true,
          path: filePath,
          name: path.basename(filePath) || filePath,
          content: brief.content,
          size: brief.totalBytes,
          fileCount: brief.fileCount,
          dirCount: brief.dirCount,
          includedCount: brief.includedCount,
          truncated: brief.truncated,
        };
      }
      return {
        success: true,
        isDir: false,
        path: filePath,
        name: path.basename(filePath),
        content: await files.readFileContent(filePath),
        size: st.size,
        fileCount: 1,
      };
    } catch (e) {
      return { success: false, error: (e && e.message) || '读取失败' };
    }
  });

  ipcMain.handle('file:pick-dir', async () => {
    const result = await dialog.showOpenDialog(focusedWindow(), { properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths.length) return { success: false, canceled: true };
    return { success: true, path: result.filePaths[0] };
  });

  ipcMain.handle('file:save', async (_e, arg) => {
    const o = arg || {};
    const cfg = config.get();
    const dir = cfg.prefs.saveDir || app.getPath('desktop');
    const result = await dialog.showSaveDialog(focusedWindow(), {
      defaultPath: path.join(dir, o.defaultName || 'untitled.txt'),
      filters: SAVE_FILTERS,
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    try {
      await files.generateFile(result.filePath, String(o.content || ''));
      config.setPrefs({ saveDir: path.dirname(result.filePath) });
      return { success: true, path: result.filePath };
    } catch (e) {
      return { success: false, error: (e && e.message) || '保存失败' };
    }
  });

  ipcMain.handle('file:auto-save', async (_e, arg) => {
    const o = arg || {};
    try {
      const desktopPath = app.getPath('desktop');
      const safeName = String(o.fileName || 'untitled.txt').replace(/[\\/:*?"<>|]/g, '_');
      let finalPath = path.join(desktopPath, safeName);
      if (fs.existsSync(finalPath)) {
        const ext = path.extname(safeName);
        const base = path.basename(safeName, ext);
        let counter = 1;
        while (fs.existsSync(finalPath)) {
          finalPath = path.join(desktopPath, `${base}_${counter}${ext}`);
          counter += 1;
        }
      }
      await files.generateFile(finalPath, String(o.content || ''));
      return { success: true, path: finalPath };
    } catch (e) {
      return { success: false, error: (e && e.message) || '保存失败' };
    }
  });

  ipcMain.handle('file:open-in-system', async (_e, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return { success: false };
    const err = await shell.openPath(filePath);
    return { success: !err, error: err || '' };
  });

  ipcMain.handle('file:show-in-folder', (_e, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return { success: false };
    shell.showItemInFolder(filePath);
    return { success: true };
  });

  ipcMain.handle('app:open-external', (_e, url) => {
    if (typeof url === 'string' && /^https?:/i.test(url)) {
      shell.openExternal(url);
      return { success: true };
    }
    return { success: false };
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataDir: app.getPath('userData'),
  }));
}

module.exports = { registerIpc };

'use strict';

/**
 * 应用入口
 *
 * 这里只做三件事：建窗口、组装各模块、注册 IPC。
 * 真正的逻辑都在 src/main/ 下的各个模块里，main.js 不承载业务细节。
 */
const path = require('path');
const { app, BrowserWindow, dialog, nativeTheme } = require('electron');

const { PROVIDERS } = require('./providers');
const { createConfigStore } = require('./config');
const { createAiClient, isAbortError, looksLikeToolsUnsupported } = require('./ai');
const { createTools, TOOL_DEFS, AGENT_TOOL_DEFS, TOOLS_SYSTEM_HINT, AGENT_SYSTEM_HINT, FALLBACK_TOOL_HINT, parseFallbackCommand } = require('./tools');
const { createFileService } = require('./files');
const { createAgentRunner } = require('./agent');
const { registerIpc } = require('./ipc');
const { createMainWindow, createHiddenWindow } = require('./window');

let mainWindow = null;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function confirmDangerous(title, detail) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(false);
  return dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['允许', '拒绝'],
    defaultId: 1,
    cancelId: 1,
    title: 'AI 想做一件有风险的事',
    message: title,
    detail: `${detail}\n\n这是 AI 通过工具调用发起的操作。确认无误再点「允许」。`,
  }).then((res) => res.response === 0, () => false);
}

/* 根据主题偏好决定窗口底色，避免深色模式下启动闪一下白屏 */
function bgForTheme(prefs) {
  const theme = prefs && prefs.theme;
  const dark = theme === 'dark' || (theme !== 'light' && nativeTheme.shouldUseDarkColors);
  return dark ? '#111827' : '#f7f8fa';
}

function bootstrap() {
  const config = createConfigStore({ dataDir: app.getPath('userData'), safeStorage: require('electron').safeStorage });

  const getApiKey = (id) => config.getApiKey(id, PROVIDERS[id] && PROVIDERS[id].name);

  const aiClient = createAiClient({ providers: PROVIDERS, getApiKey });

  const files = createFileService({
    tempDir: app.getPath('temp'),
    createHiddenWindow,
  });

  const tools = createTools({ config, readFileContent: files.readFileContent, confirmDangerous });

  const { runAgent } = createAgentRunner({
    providers: PROVIDERS,
    aiClient,
    executeTool: tools.executeTool,
    TOOL_DEFS,
    AGENT_TOOL_DEFS,
    TOOLS_SYSTEM_HINT,
    AGENT_SYSTEM_HINT,
    FALLBACK_TOOL_HINT,
    parseFallbackCommand,
    looksLikeToolsUnsupported,
  });

  registerIpc({
    app,
    providers: PROVIDERS,
    config,
    aiClient,
    tools,
    files,
    runAgent,
    isAbortError,
    getMainWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
  });

  mainWindow = createMainWindow(
    path.join(__dirname, '..', '..', 'preload.js'),
    path.join(__dirname, '..', '..', 'index.html'),
    { backgroundColor: bgForTheme(config.get().prefs) },
  );
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow(
      path.join(__dirname, '..', '..', 'preload.js'),
      path.join(__dirname, '..', '..', 'index.html'),
      { backgroundColor: bgForTheme(null) },
    );
    mainWindow.on('closed', () => { mainWindow = null; });
  }
});

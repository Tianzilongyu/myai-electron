'use strict';

/**
 * 安全桥接层
 * 渲染进程只能看到这里暴露出来的方法，拿不到 Node，也拿不到任何密钥。
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    setKey: (provider, key) => ipcRenderer.invoke('config:set-key', { provider, key }),
    removeKey: (provider) => ipcRenderer.invoke('config:remove-key', { provider }),
    setPrefs: (prefs) => ipcRenderer.invoke('config:set-prefs', prefs),
  },

  ai: {
    once: (payload) => ipcRenderer.invoke('ai:once', payload),
    abort: (reqId) => ipcRenderer.invoke('ai:abort', { reqId }),
    /* 多 AI 是并行跑的，工具过程要单独订阅；返回一个取消函数 */
    onChunk: (reqId, cb) => {
      const channel = `ai:chunk:${reqId}`;
      const listener = (_event, chunk) => cb(chunk);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
    stream: (reqId, payload, onChunk) => {
      const channel = `ai:chunk:${reqId}`;
      const listener = (_event, chunk) => onChunk(chunk);
      ipcRenderer.on(channel, listener);
      return ipcRenderer
        .invoke('ai:stream', Object.assign({ reqId }, payload))
        .finally(() => ipcRenderer.removeListener(channel, listener));
    },
  },

  sessions: {
    load: () => ipcRenderer.invoke('sessions:load'),
    save: (sessions) => ipcRenderer.invoke('sessions:save', sessions),
    /* 关窗口的最后一刻用：同步写盘，异步版本来不及 */
    saveSync: (sessions) => ipcRenderer.sendSync('sessions:save-sync', sessions),
  },

  files: {
    openDialog: () => ipcRenderer.invoke('file:open'),
    /* Electron 32 起 File.path 被移除，渲染层拿不到真实路径，
     * 只能在 preload 里用 webUtils 把 File 换成路径串。拖拽必须走这条路。 */
    pathFor: (file) => {
      try {
        if (!file) return '';
        if (typeof file.path === 'string' && file.path) return file.path;   // 老版本兜底
        return webUtils.getPathForFile(file) || '';
      } catch (e) {
        return '';
      }
    },
    /* 统一入口：文件和文件夹都能吃，文件夹会展开成「目录树 + 关键文件内容」 */
    ingest: (filePath, opts) => ipcRenderer.invoke('file:ingest', Object.assign({ path: filePath }, opts || {})),
    pickDir: () => ipcRenderer.invoke('file:pick-dir'),
    read: (filePath) => ipcRenderer.invoke('file:read', filePath),
    save: (options) => ipcRenderer.invoke('file:save', options),
    autoSave: (options) => ipcRenderer.invoke('file:auto-save', options),
    openInSystem: (filePath) => ipcRenderer.invoke('file:open-in-system', filePath),
    showInFolder: (filePath) => ipcRenderer.invoke('file:show-in-folder', filePath),
  },

  balance: {
    fetch: (provider) => ipcRenderer.invoke('balance:fetch', { provider }),
  },

  tools: {
    get: () => ipcRenderer.invoke('tools:get'),
    setPrefs: (patch) => ipcRenderer.invoke('tools:set-prefs', patch),
    setSearchKey: (key) => ipcRenderer.invoke('tools:set-search-key', { key }),
  },

  mcp: {
    list: () => ipcRenderer.invoke('mcp:list'),
    save: (servers) => ipcRenderer.invoke('mcp:save', servers),
    reload: () => ipcRenderer.invoke('mcp:reload'),
  },

  app: {
    openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
    info: () => ipcRenderer.invoke('app:info'),
  },
});

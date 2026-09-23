'use strict';

/**
 * 主窗口
 * 上下文隔离 + 关闭 nodeIntegration，渲染层只能通过 preload 暴露的 api 说话。
 */
const path = require('path');
const { BrowserWindow, shell } = require('electron');

function createMainWindow(preloadPath, htmlPath, opts = {}) {
  const win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 540,
    title: '我的 AI 助手',
    autoHideMenuBar: true,
    backgroundColor: opts.backgroundColor || '#f7f8fa',
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  win.loadFile(htmlPath);

  // 禁止页面内跳转，外链交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.once('ready-to-show', () => win.show());
  return win;
}

/** 生成 PDF 用的离屏窗口，不显示、不参与交互 */
function createHiddenWindow() {
  return new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false },
  });
}

module.exports = { createMainWindow, createHiddenWindow };

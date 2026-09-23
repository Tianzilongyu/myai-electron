;(function (global) {
  'use strict';

  /**
   * 附件（文件 / 文件夹）
   *
   * 目录不能直接读成文本，主进程会展开成「目录树 + 关键文件内容」，
   * 所以入口统一走 file:ingest —— 之前只走 file:read，拖个目录进来等于白拖。
   */
  const App = (global.App = global.App || {});

  function render() {
    const bar = App.dom.attachmentBar;
    bar.textContent = '';
    const atts = App.state.pendingAttachments;
    if (atts.length === 0) {
      bar.classList.remove('show');
      return;
    }
    bar.classList.add('show');
    const frag = global.document.createDocumentFragment();
    atts.forEach((att) => {
      const chip = global.document.createElement('div');
      chip.className = `attachment-chip${att.isDir ? ' is-dir' : ''}`;
      const icon = global.document.createElement('span');
      icon.textContent = att.isDir ? '📁' : App.utils.getFileIcon(att.name);
      const name = global.document.createElement('span');
      name.className = 'attachment-chip-name';
      name.textContent = att.name;
      name.title = att.path || att.name;
      const size = global.document.createElement('span');
      size.className = 'attachment-chip-size';
      // 目录报文件数，文件报真实体积；都拿不到才退回「内容多少字」
      size.textContent = att.isDir
        ? `${att.fileCount || 0} 个文件`
        : (App.utils.fmtBytes(att.size) || `${Math.max(1, Math.round((att.content || '').length / 1000))}k 字`);
      const removeBtn = global.document.createElement('button');
      removeBtn.className = 'attachment-chip-remove';
      removeBtn.textContent = '✕';
      removeBtn.title = '移除';
      removeBtn.addEventListener('click', () => {
        const i = atts.indexOf(att);
        if (i !== -1) atts.splice(i, 1);
        render();
        App.sessions.updateContextMeter();
      });
      chip.append(icon, name, size, removeBtn);
      frag.appendChild(chip);
    });
    bar.appendChild(frag);
  }

  async function addAttachment(result) {
    if (!result || !result.success) return;
    if (result.path && App.state.pendingAttachments.some((a) => a.path === result.path)) {
      App.utils.toast('这个文件已经在列表里了', 'info');
      return;
    }
    App.state.pendingAttachments.push({
      name: result.name,
      path: result.path,
      content: result.content,
      isDir: Boolean(result.isDir),
      size: Number(result.size) || 0,
      fileCount: Number(result.fileCount) || (result.isDir ? 0 : 1),
    });
    render();
    App.sessions.updateContextMeter();
  }

  async function attachPath(filePath) {
    const result = await App.bridge.api.files.ingest(filePath);
    if (!result || !result.success) {
      App.utils.toast(`读取失败：${(result && result.error) || '未知错误'}`, 'error');
      return false;
    }
    await addAttachment(result);
    return true;
  }

  async function attachByDialog() {
    const result = await App.bridge.api.files.openDialog();
    if (!result || !result.success) return;
    await addAttachment(result);
    App.sessions.updateContextMeter();
  }

  /* Electron 32 起 File.path 被移除，渲染层拿不到真实路径 —— 这就是「拖进去没反应」的根因。
   * 现在统一走 preload 里的 webUtils.getPathForFile。目录也能拖：主进程会展开成目录树。 */
  async function ingestDroppedFiles(fileList) {
    const paths = [];
    for (const file of fileList) {
      const p = App.bridge.api.files.pathFor(file);
      if (p && !paths.includes(p)) paths.push(p);
    }
    if (!paths.length) {
      App.utils.toast('没能读出拖进来的内容，试试输入框旁边的文件按钮', 'error');
      return;
    }

    if (paths.length > 1) App.utils.toast(`正在读取 ${paths.length} 项……`, 'info', 1200);
    let ok = 0;
    for (const p of paths) {
      if (await attachPath(p)) ok += 1;
    }
    const failed = paths.length - ok;
    if (ok > 0) {
      App.utils.toast(`已加入 ${ok} 项${failed ? `，${failed} 项读取失败` : ''}`, failed ? 'info' : 'success');
    }
    App.dom.userInput.focus();
  }

  /* ---------- 拖拽 ----------
   * 绑在 document 上而不是 .main，侧边栏上松手也能接住；
   * 另外再兜一层 window 级 preventDefault，防止 Electron 直接导航去打开被拖的文件。 */
  let dragCounter = 0;

  function dragHasFiles(e) {
    const dt = e && e.dataTransfer;
    if (!dt) return false;
    return Array.prototype.includes.call(dt.types || [], 'Files');
  }

  function bindDragAndDrop() {
    global.document.addEventListener('dragenter', (e) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      dragCounter += 1;
      App.dom.dropOverlay.classList.add('show');
    });
    global.document.addEventListener('dragover', (e) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    global.document.addEventListener('dragleave', (e) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      dragCounter -= 1;
      if (dragCounter <= 0) {
        dragCounter = 0;
        App.dom.dropOverlay.classList.remove('show');
      }
    });
    global.document.addEventListener('drop', async (e) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      dragCounter = 0;
      App.dom.dropOverlay.classList.remove('show');
      await ingestDroppedFiles(Array.from((e.dataTransfer && e.dataTransfer.files) || []));
    });
    global.addEventListener('dragover', (e) => { if (dragHasFiles(e)) e.preventDefault(); });
    global.addEventListener('drop', (e) => { if (dragHasFiles(e)) e.preventDefault(); });
  }

  App.attachments = { render, addAttachment, attachPath, attachByDialog, ingestDroppedFiles, bindDragAndDrop };
})(typeof globalThis !== 'undefined' ? globalThis : this);

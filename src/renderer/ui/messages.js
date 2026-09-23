;(function (global) {
  'use strict';

  /**
   * 消息渲染与滚动
   *
   * appendMessage 只负责画一条消息；renderMessages 负责整屏重画。
   * 按钮的回调统一走 App.chat.*，避免这里和发送逻辑互相纠缠。
   */
  const App = (global.App = global.App || {});
  const doc = () => global.document;

  /* ===== 滚动：用户手动往上翻过就不自动跟随 ===== */
  function isNearBottom() {
    const el = App.dom.chatScroll;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function scrollToBottom(force = false) {
    const dom = App.dom;
    if (force || App.state.autoScroll) {
      dom.chatScroll.scrollTop = dom.chatScroll.scrollHeight;
      dom.jumpBottomBtn.classList.add('hidden');
    }
  }

  function bindScroll() {
    const dom = App.dom;
    dom.chatScroll.addEventListener('scroll', () => {
      App.state.autoScroll = isNearBottom();
      if (App.state.autoScroll) dom.jumpBottomBtn.classList.add('hidden');
      else dom.jumpBottomBtn.classList.remove('hidden');
    });
    dom.jumpBottomBtn.addEventListener('click', () => {
      App.state.autoScroll = true;
      scrollToBottom(true);
    });
  }

  function appendMessage(role, text, attachments = [], timestamp = null, meta = null, isStreaming = false, rawContent = null, usage = null, msgRef = null) {
    const msgDiv = doc().createElement('div');
    msgDiv.className = `message ${role}-message msg-in`;
    if (rawContent) msgDiv.dataset.rawContent = rawContent;

    if (role === 'user') {
      const bubble = doc().createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = text;
      msgDiv.appendChild(bubble);

      if (attachments.length > 0) {
        const attDiv = doc().createElement('div');
        attDiv.className = 'msg-attachments';
        attachments.forEach((att) => {
          const chip = doc().createElement('span');
          chip.className = 'msg-attach-chip';
          chip.textContent = `${App.utils.getFileIcon(att.name)} ${att.name}`;
          attDiv.appendChild(chip);
        });
        msgDiv.appendChild(attDiv);
      }

      const timeEl = doc().createElement('div');
      timeEl.className = 'msg-time';
      timeEl.textContent = App.utils.relativeTime(timestamp);
      timeEl.title = App.utils.fullTime(timestamp);
      msgDiv.appendChild(timeEl);

      // 改一句再重发，比删掉整段重打省事
      if (msgRef) {
        const actions = doc().createElement('div');
        actions.className = 'msg-actions';
        const editBtn = doc().createElement('button');
        editBtn.className = 'msg-action';
        editBtn.type = 'button';
        editBtn.textContent = '编辑';
        editBtn.title = '修改这条消息并重新发送';
        editBtn.addEventListener('click', () => App.chat.startEditUserMessage(msgDiv, msgRef));
        actions.appendChild(editBtn);
        msgDiv.appendChild(actions);
      }
    } else {
      if (meta) {
        const metaRow = doc().createElement('div');
        metaRow.className = 'ai-meta';
        metaRow.appendChild(App.avatars.buildAvatar(meta));
        const tag = doc().createElement('span');
        tag.className = 'ai-tag';
        tag.textContent = meta.name || 'AI';
        metaRow.appendChild(tag);
        msgDiv.appendChild(metaRow);
      }

      const bubble = doc().createElement('div');
      bubble.className = 'bubble';
      bubble.innerHTML = App.markdown.render(text) + (isStreaming ? '<span class="streaming-cursor"></span>' : '');
      msgDiv.appendChild(bubble);

      bubble.querySelectorAll('pre').forEach((pre) => {
        const btn = doc().createElement('button');
        btn.className = 'code-copy-btn';
        btn.textContent = '复制';
        btn.addEventListener('click', () => {
          const code = pre.querySelector('code');
          global.navigator.clipboard.writeText(code ? code.textContent : pre.textContent).then(
            () => { btn.textContent = '✓ 已复制'; },
            () => { btn.textContent = '复制失败'; },
          );
          global.setTimeout(() => { btn.textContent = '复制'; }, 1500);
        });
        pre.appendChild(btn);
      });

      // 表格单独给个复制：AI 写的表格经常要粘进 Excel，复制成 TSV 正好直接贴
      bubble.querySelectorAll('.table-wrap').forEach((wrap) => {
        const btn = doc().createElement('button');
        btn.className = 'table-copy-btn';
        btn.type = 'button';
        btn.textContent = '复制表格';
        btn.title = '复制为表格，可直接粘进 Excel / 表格文档';
        btn.addEventListener('click', () => {
          const rows = Array.from(wrap.querySelectorAll('tr')).map((tr) =>
            Array.from(tr.children).map((cell) => cell.textContent.replace(/\s+/g, ' ').trim()).join('\t'));
          global.navigator.clipboard.writeText(rows.join('\n')).then(
            () => { btn.textContent = '已复制'; App.utils.toast('表格已复制，可直接粘贴', 'success', 1600); },
            () => { btn.textContent = '复制失败'; },
          );
          global.setTimeout(() => { btn.textContent = '复制表格'; }, 1500);
        });
        wrap.appendChild(btn);
      });

      const timeEl = doc().createElement('div');
      timeEl.className = 'msg-time';
      timeEl.textContent = App.utils.relativeTime(timestamp);
      timeEl.title = App.utils.fullTime(timestamp);
      msgDiv.appendChild(timeEl);

      const actions = doc().createElement('div');
      actions.className = 'msg-actions';

      const saveBtn = doc().createElement('button');
      saveBtn.className = 'msg-action';
      saveBtn.textContent = '另存为';
      saveBtn.addEventListener('click', () => App.chat.saveReplyAsFile(msgDiv.dataset.rawContent || text));

      const copyBtn = doc().createElement('button');
      copyBtn.className = 'msg-action';
      copyBtn.textContent = '复制';
      copyBtn.addEventListener('click', () => {
        const raw = msgDiv.dataset.rawContent || text;
        // 复制时剥掉 [[SAVE:]] 这类内部标记，只给用户看得懂的正文
        const content = App.saveMarkers.parse(raw).cleanText || raw;
        global.navigator.clipboard.writeText(content).then(
          () => { copyBtn.textContent = '已复制'; App.utils.toast('已复制到剪贴板', 'success', 1600); },
          () => { copyBtn.textContent = '复制失败'; },
        );
        global.setTimeout(() => { copyBtn.textContent = '复制'; }, 1500);
      });

      const regenBtn = doc().createElement('button');
      regenBtn.className = 'msg-action';
      regenBtn.type = 'button';
      regenBtn.textContent = '重新生成';
      regenBtn.addEventListener('click', () => App.chat.regenerateFrom(msgDiv));

      actions.append(saveBtn, copyBtn, regenBtn);

      if (msgRef) {
        const delBtn = doc().createElement('button');
        delBtn.className = 'msg-action danger';
        delBtn.type = 'button';
        delBtn.textContent = '删除';
        delBtn.title = '删掉这条回答';
        delBtn.addEventListener('click', () => App.chat.deleteMessage(msgRef));
        actions.appendChild(delBtn);
      }

      msgDiv.appendChild(actions);

      const chip = App.tokens.buildTokenChip(usage);
      if (chip) msgDiv.appendChild(chip);
    }

    App.dom.chatInner.appendChild(msgDiv);
    return msgDiv;
  }

  function renderMessages() {
    const session = App.sessions.getActive();
    if (!session) return;
    const dom = App.dom;

    Array.from(dom.chatInner.children).forEach((child) => {
      if (child.id !== 'welcome-screen') child.remove();
    });

    const realMsgs = session.messages.filter((m) => m.role !== 'system');

    if (realMsgs.length === 0) {
      dom.welcomeScreen.classList.remove('hidden');
      App.settings.refreshSetupHint();
      App.tokens.updateTokenChip();     // 切到空会话时，用量数字也要跟着归零
      App.sessions.refreshResumeLast();
      return;
    }
    dom.welcomeScreen.classList.add('hidden');

    realMsgs.forEach((m) => {
      if (m.role === 'user') {
        appendMessage('user', m.displayText || m.content, m.attachments || [], m.timestamp, null, false, null, null, m);
        return;
      }
      const { cleanText } = App.saveMarkers.parse(m.content || '');
      const msgDiv = appendMessage(
        'ai', cleanText, [], m.timestamp,
        App.avatars.aiMeta(m.providerId, m.aiName), false, m.content, m.usage, m,
      );
      if (m.reasoning) msgDiv.prepend(App.blocks.buildReasoningBox(m.reasoning));
      if (m.multiStages) msgDiv.prepend(App.blocks.buildMultiDetailBox(m.multiStages));
      if (m.plan && m.plan.length) App.blocks.upsertPlanCard(msgDiv, m.plan);
      if (m.savedFiles && m.savedFiles.length > 0) msgDiv.appendChild(App.blocks.buildSavedFilesCard(m.savedFiles));
      if (m.tools && m.tools.length) msgDiv.appendChild(App.blocks.buildToolSteps(m.tools, Boolean(m.agent)));
      // 历史里被手动停掉的回答，重新打开时也要看得出是停掉的
      if (m.stopped) msgDiv.appendChild(App.blocks.buildStoppedTag(Boolean(m.multiStages)));
    });

    App.tokens.updateTokenChip();
    App.sessions.refreshResumeLast();
    scrollToBottom(true);
  }

  App.messages = { appendMessage, renderMessages, scrollToBottom, isNearBottom, bindScroll };
})(typeof globalThis !== 'undefined' ? globalThis : this);

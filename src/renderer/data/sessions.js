;(function (global) {
  'use strict';

  /**
   * 会话的增删改查、落盘与标题
   *
   * 会话整份写盘，所以写操作一律防抖；关窗口的最后一刻另有同步通道兜底。
   * 附件正文存档时截断，否则 sessions.json 会一路膨胀到几十 MB。
   */
  const App = (global.App = global.App || {});

  let saveTimer = null;

  function saveSessions() {
    if (saveTimer) global.clearTimeout(saveTimer);
    saveTimer = global.setTimeout(() => {
      App.bridge.api.sessions.save(App.state.sessions)
        .catch(() => App.utils.toast('会话保存失败', 'error'));
    }, App.prompts.saveDebounceMs);
  }

  function saveSessionsNow() {
    if (saveTimer) { global.clearTimeout(saveTimer); saveTimer = null; }
    return App.bridge.api.sessions.save(App.state.sessions)
      .catch(() => App.utils.toast('会话保存失败', 'error'));
  }

  function savePrefs(patch) {
    return App.bridge.api.config.setPrefs(patch).then((res) => {
      if (res && res.prefs) App.state.prefs = res.prefs;
    });
  }

  function createSession(makeActive = true) {
    const session = {
      id: App.utils.genId(),
      title: '新对话',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    App.state.sessions.unshift(session);
    if (makeActive) App.state.activeSessionId = session.id;
    renderChatList();
    if (makeActive) App.messages.renderMessages();
    saveSessions();
    return session;
  }

  function getActive() {
    return App.state.sessions.find((s) => s.id === App.state.activeSessionId) || null;
  }

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
    el.appendChild(global.document.createTextNode(s.slice(0, idx)));
    const mk = global.document.createElement('mark');
    mk.textContent = s.slice(idx, idx + q.length);
    el.appendChild(mk);
    el.appendChild(global.document.createTextNode(s.slice(idx + q.length)));
  }

  function renderChatList() {
    const listEl = App.dom.chatList;
    listEl.textContent = '';
    const q = App.state.sessionQuery.trim().toLowerCase();
    const base = q ? App.state.sessions.filter((s) => sessionMatches(s, q)) : App.state.sessions;
    // 置顶的排前面，其余保持原有顺序
    const list = base.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

    if (list.length === 0) {
      const empty = global.document.createElement('div');
      empty.className = 'chat-list-empty';
      empty.textContent = q ? '没有匹配的会话' : '还没有会话';
      listEl.appendChild(empty);
      return;
    }

    const frag = global.document.createDocumentFragment();
    list.forEach((session) => {
      const item = global.document.createElement('div');
      item.className = 'chat-item' + (session.id === App.state.activeSessionId ? ' active' : '');
      const title = global.document.createElement('span');
      title.className = 'chat-item-title';
      highlightInto(title, session.title || '新对话', q);
      title.title = `${session.title || '新对话'}（双击可重命名）`;
      title.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        startRenameSession(session, title);
      });
      const del = global.document.createElement('button');
      del.className = 'chat-item-delete';
      del.textContent = '✕';
      del.title = '删除对话';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSession(session.id);
      });
      const time = global.document.createElement('span');
      time.className = 'chat-item-time';
      time.textContent = App.utils.relativeTime(session.updatedAt);
      const pin = global.document.createElement('button');
      pin.className = 'chat-item-pin' + (session.pinned ? ' active' : '');
      pin.textContent = '📌';
      pin.title = session.pinned ? '取消置顶' : '置顶';
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePin(session.id);
      });
      item.append(title, time, pin, del);
      item.addEventListener('click', () => switchSession(session.id));
      frag.appendChild(item);
    });
    listEl.appendChild(frag);
    refreshResumeLast();
  }

  /* 双击会话标题就地重命名。AI 起的标题不一定合心意，得让人能改 */
  function startRenameSession(session, titleEl) {
    const input = global.document.createElement('input');
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
    const idx = App.state.sessions.findIndex((s) => s.id === id);
    if (idx === -1) return;
    App.state.sessions.splice(idx, 1);
    if (App.state.sessions.length === 0) {
      createSession();
    } else if (App.state.activeSessionId === id) {
      App.state.activeSessionId = App.state.sessions[0].id;
    }
    renderChatList();
    App.messages.renderMessages();
    updateContextMeter();
    saveSessions();
  }

  function switchSession(id) {
    if (App.state.activeSessionId === id) return;
    App.state.activeSessionId = id;
    renderChatList();
    App.messages.renderMessages();
    updateContextMeter();
  }

  /* ---------- 首屏「继续上次对话」 ---------- */
  function lastRealSession() {
    return App.state.sessions.find((s) => s.id !== App.state.activeSessionId
      && s && Array.isArray(s.messages) && s.messages.length > 0) || null;
  }

  function refreshResumeLast() {
    const btn = App.dom.resumeLastBtn;
    if (!btn) return;
    const active = getActive();
    const empty = !active || (active.messages || []).length === 0;
    const target = lastRealSession();
    if (empty && target) {
      btn.classList.remove('hidden');
      btn.textContent = `继续上次对话 · ${target.title || '新对话'}`;
    } else {
      btn.classList.add('hidden');
    }
  }

  function resumeLast() {
    const target = lastRealSession();
    if (!target) return;
    switchSession(target.id);
  }

  async function clearAll() {
    App.state.sessions = [];
    await saveSessionsNow();
    createSession();
  }

  /* ---------- 置顶 ---------- */
  function togglePin(id) {
    const s = App.state.sessions.find((x) => x.id === id);
    if (!s) return;
    s.pinned = !s.pinned;
    saveSessions();
    renderChatList();
  }

  /* ---------- 导出会话为 Markdown ---------- */
  function buildSessionMarkdown(session) {
    const lines = [`# ${session.title || '对话'}`, ''];
    (session.messages || []).forEach((m) => {
      if (m.role === 'user') {
        lines.push('## 用户', '', m.displayText || m.content || '', '');
      } else if (m.role === 'assistant') {
        const clean = App.saveMarkers.parse(m.content || '').cleanText;
        lines.push(`## ${m.aiName || 'AI'}`, '', clean, '');
      }
    });
    return lines.join('\n');
  }

  async function exportSession(session) {
    const s = session || getActive();
    if (!s || (s.messages || []).length === 0) { App.utils.toast('没有可导出的内容', 'info'); return; }
    const content = buildSessionMarkdown(s);
    const safeTitle = String(s.title || '对话').replace(/[\\/:*?"<>|]/g, '_');
    const result = await App.bridge.api.files.save({ defaultName: `${safeTitle}.md`, content });
    if (result && result.success) App.utils.toast(`已导出到：${result.path}`, 'success', 3600);
    else if (result && result.error) App.utils.toast(`导出失败：${result.error}`, 'error');
  }

  /* 不依赖 AI 的标题提取：把「帮我整理桌面」压成「整理桌面」，
   * 而不是像以前那样直接截断开头十几个字。AI 标题生成失败时，它就是最终答案。 */
  const TITLE_LEAD_RE = /^(帮我一下|帮我个忙|麻烦你|麻烦|拜托你|拜托|辛苦你|请你|请|你可以|你能不能|你能|能不能|能否|给我|我想让你|我想|我要你|我要|帮我)\s*/;
  const TITLE_TAIL_RE = /(一下|的话|吧|呢|啊|哈|哦|嘛)\s*[。！？!?.]*$/;

  function cleanForTitle(text) {
    return String(text || '')
      .replace(/【附件：[^\n]*】\s*\n?```[\s\S]*?```/g, '')
      .replace(/【附件：[^\n]*】/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function localTitle(text) {
    const raw = cleanForTitle(text);
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
      if (App.state.prefs.autoTitle === false) return;
      const providerId = App.chat.currentSingleProvider();
      const p = App.avatars.providerById(providerId);
      if (!providerId || !p || !p.configured) return;
      // 标题只看用户真正说的话，附件正文不参与（否则标题会变成文件名）
      const raw = cleanForTitle(firstMessage);
      if (!raw) return;
      const res = await App.ai.callOnce(providerId, [
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

  /* ---------- 上下文裁剪 ---------- */
  function totalChars(list) {
    return list.reduce((n, m) => n + (m.content ? m.content.length : 0), 0);
  }

  /* 只把最近 N 轮发给模型，并且卡住总字数 —— 附件再大也不会把请求撑爆 */
  function buildRequestMessages(session) {
    const system = { role: 'system', content: App.prompts.getSystemPrompt() };
    const real = session.messages.filter((m) => m.role !== 'system');
    const rounds = Math.max(1, Number(App.state.prefs.contextRounds) || 6);
    const limit = App.prompts.requestCharLimit();
    let keep = real.slice(-rounds * 2);
    while (keep.length > 2 && totalChars(keep) > limit) keep = keep.slice(2);
    return [system].concat(keep.map((m) => ({ role: m.role, content: m.content || '' })));
  }

  function updateContextMeter() {
    const el = App.dom.contextMeter;
    if (!el) return;
    const session = getActive();
    if (!session) { el.textContent = ''; return; }
    const total = session.messages.filter((m) => m.role !== 'system').length;
    if (total === 0) { el.textContent = ''; return; }
    const msgs = buildRequestMessages(session);
    const chars = totalChars(msgs);
    const shown = msgs.length - 1;
    const size = chars > 10000 ? `${(chars / 10000).toFixed(1)} 万字` : `${Math.round(chars / 100) / 10} 千字`;
    el.textContent = `本次发送 ${shown}/${total} 条 · 约 ${size}`;
    el.title = '只把最近若干轮对话发给模型，更早的内容仍保存在本地';
  }

  App.sessions = {
    saveSessions,
    saveSessionsNow,
    savePrefs,
    createSession,
    getActive,
    renderChatList,
    startRenameSession,
    deleteSession,
    switchSession,
    clearAll,
    localTitle,
    autoGenerateTitle,
    sessionMatches,
    buildRequestMessages,
    updateContextMeter,
    totalChars,
    lastRealSession,
    refreshResumeLast,
    resumeLast,
    togglePin,
    exportSession,
    buildSessionMarkdown,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

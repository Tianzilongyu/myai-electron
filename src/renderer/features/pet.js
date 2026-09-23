;(function (global) {
  'use strict';

  /** 右下角桌面宠物浮窗：可拖动 + 点头像弹信息气泡（余额 / 用量 / 模式） */
  const App = (global.App = global.App || {});

  const PET_SIZE = 104;
  const PET_DEFAULT = { right: 26, bottom: 118 };
  const BALANCE_TTL_MS = 60000;

  const L = () => App.constants;

  function pickLine(pool) {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function petLine() {
    const s = App.state;
    if (s.isGenerating) return pickLine(L().PET_LINES_THINKING);
    if (!App.chat.anyConfigured()) return '还没接上任何 AI，带我去设置里配一个吧';
    if (Date.now() < s.petCelebrateUntil) return pickLine(L().PET_LINES_DONE);
    if (Date.now() - s.petLastErrorAt < 15000) return pickLine(L().PET_LINES_UPSET);

    const bal = petBalanceNumber();
    if (bal !== null && bal > 0 && bal < 2) return '我这点余额快见底了，再不充值就要饿肚子了…';
    if (bal !== null && bal >= 50) return '余额挺充裕的，使劲用';

    const h = new Date().getHours();
    if (h >= 23 || h < 6) return '这么晚还在忙？早点睡，我先替你看着余额';
    if (h < 11) return '早上好，今天先从哪一件事开始？';
    return pickLine(Math.random() < 0.25 ? L().PET_LINES_TIP : L().PET_LINES_IDLE);
  }

  function petApplyPosition() {
    const s = App.state;
    const mainEl = App.dom.mainEl;
    if (!s.petPos) return;
    const maxX = Math.max(0, mainEl.clientWidth - PET_SIZE - 4);
    const maxY = Math.max(0, mainEl.clientHeight - PET_SIZE - 4);
    const x = Math.min(Math.max(0, Math.round(s.petPos.x)), maxX);
    const y = Math.min(Math.max(0, Math.round(s.petPos.y)), maxY);
    s.petPos = { x, y };
    Object.assign(App.dom.deskmate.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
    // 靠左 / 靠上时把气泡翻到另一侧，避免出屏
    App.dom.deskmate.classList.toggle('bubble-left', x < mainEl.clientWidth / 2);
    App.dom.deskmate.classList.toggle('bubble-below', y < 240);
  }

  function defaultPos() {
    const mainEl = App.dom.mainEl;
    return {
      x: mainEl.clientWidth - PET_SIZE - PET_DEFAULT.right,
      y: mainEl.clientHeight - PET_SIZE - PET_DEFAULT.bottom,
    };
  }

  function petResetPosition() {
    App.state.petPos = defaultPos();
    petApplyPosition();
    App.sessions.savePrefs({ petPos: null });
    App.utils.toast('已回到右下角原位', 'success', 1600);
  }

  function updateArt() {
    const p = App.providerUI.currentProvider();
    if (p) App.dom.deskmateImg.src = App.avatars.petArtSrc(p.id);
  }

  /* ---------- 拖动 ---------- */
  function bindDrag() {
    const dom = App.dom;
    dom.deskmatePet.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const rect = dom.deskmate.getBoundingClientRect();
      App.state.petSuppressClick = false;   // 每次按下都重置，避免上一次拖动把这次点击吞了
      App.state.petDrag = {
        // 抓取偏移要在同一套坐标里算，这里统一用视口坐标；落到 main 里时再统一减 main 的偏移
        grabX: e.clientX - rect.left,
        grabY: e.clientY - rect.top,
        startX: e.clientX, startY: e.clientY, moved: false,
      };
      dom.deskmate.classList.add('dragging');
      try { dom.deskmatePet.setPointerCapture(e.pointerId); } catch (err) { /* 某些环境不支持就跳过 */ }
    });

    dom.deskmatePet.addEventListener('pointermove', (e) => {
      const s = App.state;
      if (!s.petDrag) return;
      const mainRect = dom.mainEl.getBoundingClientRect();
      s.petPos = {
        x: e.clientX - mainRect.left - s.petDrag.grabX,
        y: e.clientY - mainRect.top - s.petDrag.grabY,
      };
      if (Math.abs(e.clientX - s.petDrag.startX) > 3 || Math.abs(e.clientY - s.petDrag.startY) > 3) s.petDrag.moved = true;
      petApplyPosition();
    });

    const endDrag = () => {
      const s = App.state;
      if (!s.petDrag) return;
      const moved = s.petDrag.moved;
      s.petDrag = null;
      dom.deskmate.classList.remove('dragging');
      if (moved) {
        App.sessions.savePrefs({ petPos: s.petPos });
        s.petSuppressClick = true;   // 拖完了浏览器还会补一个 click，这里把它吃掉（在 click 里消费，不靠计时）
      }
    };
    dom.deskmatePet.addEventListener('pointerup', endDrag);
    dom.deskmatePet.addEventListener('pointercancel', endDrag);
    dom.deskmatePet.addEventListener('dblclick', () => petResetPosition());
    dom.deskmatePet.addEventListener('click', (e) => {
      e.stopPropagation();
      if (App.state.petSuppressClick) { App.state.petSuppressClick = false; return; }
      if (App.state.petOpen) closePet(); else openPet();
    });

    global.addEventListener('resize', () => { if (App.state.petPos) petApplyPosition(); });
  }

  /* ---------- 气泡 ---------- */
  function openPet() {
    buildBubble();
    App.dom.deskmateBubble.classList.remove('hidden');
    App.dom.deskmatePet.classList.add('active');
    App.state.petOpen = true;
    const b = App.state.petBalances;
    if (!b || Date.now() - b.fetchedAt > BALANCE_TTL_MS) refreshPetBalance(true);
  }

  function closePet() {
    App.dom.deskmateBubble.classList.add('hidden');
    App.dom.deskmatePet.classList.remove('active');
    App.state.petOpen = false;
  }

  /* 当前这个 AI 自己的余额（气泡里只显示它自己） */
  function petCurrentBalance() {
    const p = App.providerUI.currentProvider();
    const b = App.state.petBalances;
    if (!p || !b || !Array.isArray(b.items)) return null;
    return b.items.find((it) => it.id === p.id) || null;
  }

  function petBalanceNumber() {
    const it = petCurrentBalance();
    if (!it || !it.ok || !it.accounts || !it.accounts.length) return null;
    return Number(it.accounts[0].amount);
  }

  /** 换 AI 时余额缓存要作废，否则会看到上一家的数字 */
  function invalidateBalance() {
    App.state.petBalances = null;
    if (App.state.petOpen) refreshPetBalance(true);
  }

  function fmtMoney(amount, currency) {
    const cur = String(currency || 'CNY').toUpperCase();
    const symbol = cur === 'USD' ? '$' : '¥';
    const digits = Math.abs(amount) < 10 ? 4 : 2;
    return `${symbol}${amount.toFixed(digits)}`;
  }

  async function refreshPetBalance(silent) {
    const api = App.bridge.api;
    if (!api.balance || !api.balance.fetch) return;
    const p = App.providerUI.currentProvider();
    if (!p) return;
    const s = App.state;
    s.petBalances = s.petBalances || { items: [], fetchedAt: 0, loading: true };
    s.petBalances.loading = true;
    if (s.petOpen) buildBubble();
    try {
      const res = await api.balance.fetch(p.id);
      s.petBalances = Object.assign({ loading: false, forProvider: p.id }, res);
    } catch (e) {
      s.petBalances = { items: [], fetchedAt: Date.now(), loading: false, error: (e && e.message) || '查询失败' };
      if (!silent) App.utils.toast('余额查询失败', 'error');
    }
    if (s.petOpen) buildBubble();
  }

  function buildBubble() {
    const dom = App.dom;
    const s = App.state;
    dom.deskmateBubble.textContent = '';

    const p = App.providerUI.currentProvider();
    if (!p) {
      const empty = global.document.createElement('div');
      empty.className = 'pet-balance-empty';
      empty.textContent = '还没有选择任何 AI';
      dom.deskmateBubble.appendChild(empty);
      return;
    }

    // 头部：它自己的形象 + 名字 + 一句会变的话
    const head = global.document.createElement('div');
    head.className = 'pet-head';
    const av = global.document.createElement('span');
    av.className = 'pet-head-avatar';
    av.appendChild(App.avatars.avatarNode(p.id));
    const htxt = global.document.createElement('div');
    htxt.className = 'pet-head-text';
    const nm = global.document.createElement('div');
    nm.className = 'pet-head-name';
    nm.textContent = p.name;
    const line = global.document.createElement('div');
    line.className = 'pet-head-line';
    line.textContent = petLine();
    htxt.append(nm, line);
    head.append(av, htxt);

    // 它自己的余额（一整块，不是列表）
    const card = global.document.createElement('div');
    card.className = 'pet-balance-card';
    const label = global.document.createElement('div');
    label.className = 'pet-balance-label';
    const labelText = global.document.createElement('span');
    labelText.textContent = '我的余额';
    const refreshBtn = global.document.createElement('button');
    refreshBtn.className = 'pet-refresh';
    refreshBtn.type = 'button';
    refreshBtn.textContent = s.petBalances && s.petBalances.loading ? '查询中…' : '刷新';
    refreshBtn.disabled = Boolean(s.petBalances && s.petBalances.loading);
    refreshBtn.addEventListener('click', (e) => { e.stopPropagation(); refreshPetBalance(false); });
    label.append(labelText, refreshBtn);

    const big = global.document.createElement('div');
    big.className = 'pet-balance-big';
    const it = petCurrentBalance();
    if (s.petBalances && s.petBalances.loading) {
      big.classList.add('muted');
      big.textContent = '查询中…';
    } else if (it && it.ok && it.accounts && it.accounts.length) {
      big.textContent = it.accounts.map((a) => fmtMoney(a.amount, a.currency)).join('  /  ');
      big.classList.add('ok');
    } else {
      big.classList.add('muted');
      big.textContent = (it && it.error) || '点刷新查一下';
    }
    card.append(label, big);

    // 两小项：本会话用量 + 当前模型
    const stats = global.document.createElement('div');
    stats.className = 'pet-stats';
    const t = App.tokens.sessionTokens(App.sessions.getActive());
    const s1 = global.document.createElement('div');
    s1.className = 'pet-stat';
    s1.innerHTML = `<b>${App.tokens.fmtTokens(t.total || 0)}</b><span>本会话 tokens</span>`;
    const s2 = global.document.createElement('div');
    s2.className = 'pet-stat';
    s2.innerHTML = `<b title="${App.utils.escapeHtml(p.model || '')}">${App.utils.escapeHtml((p.model || '—').slice(0, 14))}</b><span>当前模型</span>`;
    stats.append(s1, s2);

    // 当前是单 AI 还是多 AI、挂了几个技能，一眼能看见
    const modes = global.document.createElement('div');
    modes.className = 'pet-modes';
    const chip1 = global.document.createElement('span');
    chip1.className = 'pet-mode-chip';
    chip1.textContent = s.currentMode === 'multi'
      ? `多 AI · ${s.multiConfig.workers.length + 1} 个角色`
      : '单 AI';
    const chip2 = global.document.createElement('span');
    chip2.className = 'pet-mode-chip';
    chip2.textContent = s.selectedSkills.length ? `技能 ${s.selectedSkills.length}` : '无技能';
    modes.append(chip1, chip2);

    dom.deskmate.classList.toggle('pet-busy', s.isGenerating);

    // 密钥状态 + 设置入口
    const foot = global.document.createElement('div');
    foot.className = 'pet-foot';
    const note = global.document.createElement('span');
    note.className = 'pet-note';
    if (p.keyTail === '✗') {
      note.textContent = '密钥失效，请重填';
      note.classList.add('warn');
    } else if (p.keyTail) {
      note.textContent = `已保存 · ${p.keyTail}`;
    } else if (p.optionalKey) {
      note.textContent = '本机模式，无需密钥';
    } else {
      note.textContent = '还没配置密钥';
      note.classList.add('warn');
    }
    const setBtn = global.document.createElement('button');
    setBtn.className = 'pet-settings-btn';
    setBtn.type = 'button';
    setBtn.textContent = '设置';
    setBtn.addEventListener('click', (e) => { e.stopPropagation(); closePet(); App.settings.openView(); });
    foot.append(note, setBtn);

    dom.deskmateBubble.append(head, card, stats, modes, foot);
  }

  function bind() {
    const dom = App.dom;
    bindDrag();
    dom.deskmateBubble.addEventListener('click', (e) => e.stopPropagation());
    dom.deskmateBubble.addEventListener('mousedown', (e) => e.stopPropagation());
    global.document.addEventListener('mousedown', (e) => {
      if (!App.state.petOpen) return;
      if (e.target && dom.deskmate.contains(e.target)) return;
      closePet();
    });
  }

  App.pet = {
    PET_SIZE,
    defaultPos,
    bind,
    openPet,
    closePet,
    updateArt,
    buildBubble,
    refreshPetBalance,
    invalidateBalance,
    petApplyPosition,
    petResetPosition,
    fmtMoney,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

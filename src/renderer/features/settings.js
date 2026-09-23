;(function (global) {
  'use strict';

  /** 侧边栏设置视图：密钥管理、对话参数、整体配置刷新 */
  const App = (global.App = global.App || {});

  function openView() {
    if (App.dom.sidebar.classList.contains('collapsed')) App.panels.setSidebarCollapsed(false);
    renderKeyList();
    App.toolsUI.refresh();
    syncParamControls();
    App.dom.sidebar.classList.add('settings-mode');
    App.dom.sidebarChatView.classList.add('hidden');
    App.dom.sidebarSettingsView.classList.remove('hidden');
  }

  function closeView() {
    App.dom.sidebar.classList.remove('settings-mode');
    App.dom.sidebarSettingsView.classList.add('hidden');
    App.dom.sidebarChatView.classList.remove('hidden');
  }

  function refreshSetupHint() {
    if (!App.dom.setupHint) return;
    App.dom.setupHint.classList.toggle('hidden', App.chat.anyConfigured());
  }

  /* ---------- 密钥管理 ---------- */
  function renderKeyList() {
    const keyList = App.dom.keyList;
    keyList.textContent = '';
    // 供应商有十几个了，配过密钥的排前面，先让你看得见正在用的
    const ordered = App.state.providers.slice().sort((a, b) => (a.configured ? 0 : 1) - (b.configured ? 0 : 1));
    const hasConfigured = ordered.some((p) => p.configured);

    const frag = global.document.createDocumentFragment();
    ordered.forEach((p, index) => {
      // 已配置和未配置之间插一条分隔线
      if (index > 0 && ordered[index - 1].configured && !p.configured) {
        const div = global.document.createElement('div');
        div.className = 'key-list-divider';
        div.textContent = '以下还没配置密钥';
        frag.appendChild(div);
      }
      frag.appendChild(buildKeyRow(p));
    });
    keyList.appendChild(frag);

    // 一家都没配过的话，默认替你展开第一家，不然找不到从哪填
    if (!hasConfigured) {
      const first = keyList.querySelector('.key-row');
      if (first) setRowOpen(first, true);
    }

    // 分区标题上挂个「3/15」，不用展开就知道配了几家
    const countEl = App.dom.byId('key-count');
    if (countEl) {
      const n = ordered.filter((p) => p.configured).length;
      countEl.textContent = ` ${n}/${ordered.length}`;
      countEl.title = `${n} 家已配置密钥`;
    }
  }

  function setRowOpen(row, open) {
    const body = row.querySelector('.key-body');
    const chev = row.querySelector('.key-chevron');
    if (body) body.classList.toggle('hidden', !open);
    row.classList.toggle('open', open);
    if (chev) chev.textContent = open ? '▾' : '▸';
  }

  function buildKeyRow(p) {
    const row = global.document.createElement('div');
    row.className = 'key-row' + (p.configured ? ' configured' : '');

    // 折叠行：一行一家，点开才见模型/密钥表单。十几个家全部摊开根本没法看。
    const rowBody = global.document.createElement('div');
    rowBody.className = 'key-body hidden';

    const head = global.document.createElement('button');
    head.type = 'button';
    head.className = 'key-head key-toggle';
    const avatar = App.avatars.buildAvatar({ img: App.avatars.avatarImageSrc(p.id), avatar: p.avatar, color: p.color }, 'key-avatar');
    const nameWrap = global.document.createElement('div');
    nameWrap.className = 'key-name-wrap';
    const name = global.document.createElement('span');
    name.className = 'key-name';
    name.textContent = p.name;
    // 已存过的 key 直接显示结尾几位，一眼就知道不用重填
    const tail = global.document.createElement('span');
    tail.className = 'key-tail';
    if (p.keyTail === '✗') {
      tail.textContent = '密钥已失效，请重新填写';
      tail.classList.add('broken');
      row.classList.add('broken');
    } else if (p.keyTail) {
      tail.textContent = `已保存 · 结尾 ${p.keyTail}`;
    } else if (p.optionalKey) {
      tail.textContent = '本机模式，无需密钥';
    } else {
      tail.textContent = '未配置';
    }
    nameWrap.append(name, tail);
    head.append(avatar, nameWrap);

    const chevron = global.document.createElement('span');
    chevron.className = 'key-chevron';
    chevron.textContent = '▸';
    head.appendChild(chevron);

    head.addEventListener('click', () => {
      // 手风琴：一次只展开一家，来回比较才不乱
      const willOpen = rowBody.classList.contains('hidden');
      App.dom.keyList.querySelectorAll('.key-row.open').forEach((r) => setRowOpen(r, false));
      setRowOpen(row, willOpen);
    });

    const modelRow = global.document.createElement('div');
    modelRow.className = 'key-model-row';
    const modelLabel = global.document.createElement('span');
    modelLabel.textContent = '模型';
    // 用 input + datalist：既能选预设，也能手填（Ollama 的本地模型名千奇百怪）
    const modelInput = global.document.createElement('input');
    modelInput.className = 'settings-input';
    modelInput.value = p.model || '';
    modelInput.setAttribute('list', `models-${p.id}`);
    modelInput.title = p.allowCustomModel ? '可以直接手填模型名' : '从预设里选，也可以手填';
    const datalist = global.document.createElement('datalist');
    datalist.id = `models-${p.id}`;
    (p.models && p.models.length ? p.models : [p.model]).forEach((m) => {
      const opt = global.document.createElement('option');
      opt.value = m;
      datalist.appendChild(opt);
    });
    modelInput.addEventListener('change', async () => {
      const value = modelInput.value.trim();
      if (!value) return;
      const overrides = Object.assign({}, App.state.prefs.modelOverrides, { [p.id]: value });
      await App.sessions.savePrefs({ modelOverrides: overrides });
      await refreshConfig();
      App.utils.toast(`${p.name} 模型已切换为 ${value}`, 'success');
    });
    modelRow.append(modelLabel, modelInput, datalist);

    const inputRow = global.document.createElement('div');
    inputRow.className = 'key-input-row';
    const input = global.document.createElement('input');
    input.type = 'password';
    input.className = 'settings-input key-input';
    input.placeholder = p.keyTail ? '已保存，留空就不改' : (p.keyHint || '粘贴密钥');
    input.autocomplete = 'off';
    input.spellcheck = false;

    // 密码明文开关，粘错的时候能看一眼
    const eyeBtn = global.document.createElement('button');
    eyeBtn.className = 'key-icon-btn';
    eyeBtn.type = 'button';
    eyeBtn.title = '显示 / 隐藏';
    eyeBtn.textContent = '显示';
    eyeBtn.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      input.focus();
    });

    const saveBtn = global.document.createElement('button');
    saveBtn.className = 'key-btn primary';
    saveBtn.textContent = '保存';
    const submit = async () => {
      const value = input.value.trim();
      if (!value) { App.utils.toast('请先粘贴密钥', 'info'); return; }
      const res = await App.bridge.api.config.setKey(p.id, value);
      if (res.success) {
        input.value = '';
        input.type = 'password';
        App.utils.toast(`${p.name} 密钥已保存，下次打开自动带上`, 'success');
        await refreshConfig();
      } else {
        App.utils.toast(res.error || '保存失败', 'error');
      }
    };
    saveBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    const removeBtn = global.document.createElement('button');
    removeBtn.className = 'key-btn';
    removeBtn.textContent = '清除';
    removeBtn.disabled = !p.configured;
    removeBtn.addEventListener('click', async () => {
      await App.bridge.api.config.removeKey(p.id);
      App.utils.toast(`${p.name} 密钥已清除`, 'success');
      await refreshConfig();
    });

    const link = global.document.createElement('button');
    link.className = 'key-link';
    link.textContent = '去申请 ↗';
    link.addEventListener('click', () => App.bridge.api.app.openExternal(p.keyUrl));

    inputRow.append(input, eyeBtn, saveBtn, removeBtn);
    rowBody.append(modelRow, inputRow, link);
    row.append(head, rowBody);
    return row;
  }

  /* ---------- 对话参数 ---------- */
  function syncParamControls() {
    const prefs = App.state.prefs;
    const D = App.constants.PARAM_DEFAULTS;
    const dom = App.dom;
    const temp = typeof prefs.temperature === 'number' ? prefs.temperature : D.temperature;
    dom.temperatureInput.value = String(temp);
    dom.temperatureOut.textContent = temp.toFixed(1);
    dom.maxTokensInput.value = String(Number(prefs.maxTokens) || 0);
    dom.requestCharsInput.value = String(Number(prefs.requestChars) || D.requestChars);
    dom.contextRoundsInput.value = String(Number(prefs.contextRounds) || D.contextRounds);
    dom.systemPromptInput.value = String(prefs.systemPrompt || '');

    const setSwitch = (btn, on) => {
      btn.textContent = on ? '开' : '关';
      btn.classList.toggle('on', Boolean(on));
    };
    setSwitch(dom.autoTitleBtn, prefs.autoTitle !== false);
    setSwitch(dom.autoSaveFilesBtn, prefs.autoSaveFiles !== false);
    if (dom.themeSelect) dom.themeSelect.value = prefs.theme || 'system';
  }

  function bindParamControls() {
    const dom = App.dom;
    const D = App.constants.PARAM_DEFAULTS;

    dom.temperatureInput.addEventListener('input', () => {
      dom.temperatureOut.textContent = Number(dom.temperatureInput.value).toFixed(1);
    });
    dom.temperatureInput.addEventListener('change', async () => {
      await App.sessions.savePrefs({ temperature: Number(dom.temperatureInput.value) });
      App.utils.toast(`温度已设为 ${Number(dom.temperatureInput.value).toFixed(1)}`, 'success', 1600);
    });

    dom.maxTokensInput.addEventListener('change', async () => {
      const v = Math.max(0, parseInt(dom.maxTokensInput.value, 10) || 0);
      dom.maxTokensInput.value = String(v);
      await App.sessions.savePrefs({ maxTokens: v });
      App.utils.toast(v ? `最大输出已设为 ${v} token` : '最大输出已改为不限制', 'success', 1600);
    });

    dom.requestCharsInput.addEventListener('change', async () => {
      const v = Math.min(300000, Math.max(5000, parseInt(dom.requestCharsInput.value, 10) || D.requestChars));
      dom.requestCharsInput.value = String(v);
      await App.sessions.savePrefs({ requestChars: v });
      App.sessions.updateContextMeter();
      App.utils.toast(`单次请求上限已设为 ${v} 字符`, 'success', 1600);
    });

    dom.systemPromptInput.addEventListener('change', async () => {
      await App.sessions.savePrefs({ systemPrompt: dom.systemPromptInput.value.trim() });
      App.utils.toast('自定义提示词已保存，后续对话生效', 'success', 1800);
    });

    dom.contextRoundsInput.addEventListener('change', async () => {
      const value = Math.min(30, Math.max(1, parseInt(dom.contextRoundsInput.value, 10) || D.contextRounds));
      dom.contextRoundsInput.value = String(value);
      await App.sessions.savePrefs({ contextRounds: value });
      App.sessions.updateContextMeter();
      App.utils.toast(`已设置为携带最近 ${value} 轮对话`, 'success');
    });

    dom.autoTitleBtn.addEventListener('click', async () => {
      const next = App.state.prefs.autoTitle === false;
      await App.sessions.savePrefs({ autoTitle: next });
      syncParamControls();
      App.utils.toast(next ? '已开启 AI 自动命名' : '已关闭 AI 自动命名，改用本地规则', 'success');
    });

    dom.autoSaveFilesBtn.addEventListener('click', async () => {
      const next = App.state.prefs.autoSaveFiles === false;
      await App.sessions.savePrefs({ autoSaveFiles: next });
      syncParamControls();
      App.utils.toast(next ? '已开启自动保存生成的文件' : '已关闭自动保存，AI 不再产出文件标记', 'success');
    });

    dom.resetParamsBtn.addEventListener('click', async () => {
      if (!global.confirm('把温度、最大输出、上下文轮数等参数都恢复成默认值吗？\n（密钥和技能不受影响）')) return;
      await App.sessions.savePrefs(Object.assign({}, D));
      syncParamControls();
      App.sessions.updateContextMeter();
      App.utils.toast('对话参数已恢复默认', 'success');
    });

    if (dom.themeSelect) {
      dom.themeSelect.addEventListener('change', () => {
        App.theme.setTheme(dom.themeSelect.value);
        App.utils.toast(App.theme.resolvedTheme() === 'dark' ? '已切换到深色主题' : '已切换到浅色主题', 'success', 1600);
      });
    }

    // 设置分区折叠：点标题收起 / 展开
    global.document.querySelectorAll('.settings-section-head').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sec = App.dom.byId(btn.dataset.sec);
        if (!sec) return;
        const collapsed = sec.classList.toggle('collapsed');
        const chev = btn.querySelector('.sec-chevron');
        if (chev) chev.textContent = collapsed ? '▸' : '▾';
      });
    });
  }

  /* ---------- 整体配置刷新 ---------- */
  async function refreshConfig() {
    const s = App.state;
    const cfg = await App.bridge.api.config.get();
    s.providers = cfg.providers || [];
    s.prefs = cfg.prefs || s.prefs;

    if (s.prefs.multi && s.prefs.multi.leader) s.multiConfig = s.prefs.multi;
    s.selectedSkills = Array.isArray(s.prefs.skills) ? s.prefs.skills.slice() : [];
    App.panels.updateSkillBadge();
    App.panels.updateTeamSummary();

    s.agentMode = s.prefs.agentMode === true;
    s.agentWorkDir = String(s.prefs.agentWorkDir || '');
    // 没工作目录就不可能自动批准，防止上次的状态残留成一张空白支票
    s.agentAutoApprove = s.prefs.agentAutoApprove === true && Boolean(s.agentWorkDir);
    App.agent.apply();

    App.providerUI.fillSingleAiSelect();

    const dot = App.dom.statusDot;
    dot.classList.toggle('offline', !App.chat.anyConfigured());
    dot.title = App.chat.anyConfigured() ? '已就绪' : '尚未配置密钥';
    App.dom.settingsSub.textContent = s.providers.length && s.providers[0].encrypted
      ? '密钥已用系统级加密保存在本机'
      : '密钥保存在本机（当前系统不支持系统级加密）';

    const info = await App.bridge.api.app.info();
    App.dom.dataDirHint.textContent = `会话与配置保存在：${info.dataDir}`;

    App.panels.renderMultiConfigGroups();
    App.providerUI.renderAiPicker();
    App.providerUI.refreshThinkToggle();
    App.pet.updateArt();
    if (s.petBalances && s.petOpen) App.pet.invalidateBalance();
    else if (s.petOpen) App.pet.buildBubble();
    if (App.dom.sidebar.classList.contains('settings-mode')) renderKeyList();
    refreshSetupHint();
    App.providerUI.renderSidebarUser();
    App.sessions.updateContextMeter();
    App.tokens.updateTokenChip();
  }

  App.settings = {
    openView,
    closeView,
    refreshSetupHint,
    renderKeyList,
    syncParamControls,
    bindParamControls,
    refreshConfig,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

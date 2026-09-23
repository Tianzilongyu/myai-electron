;(function (global) {
  'use strict';

  /**
   * 当前 AI 的展示与切换：左下角身份区、顶部下拉、深度思考开关
   */
  const App = (global.App = global.App || {});

  function currentProvider() {
    return App.avatars.providerById(App.chat.currentSingleProvider())
      || App.chat.configuredProviders()[0]
      || null;
  }

  /* ---------- 左下角侧边栏：当前 AI 信息区 ---------- */
  function renderSidebarUser() {
    const dom = App.dom;
    const p = currentProvider();
    if (p) {
      // 没有自家立绘的厂商退回吉祥物，别留空白或碎图
      dom.sidebarUserAvatar.src = App.avatars.petArtSrc(p.id);
      dom.sidebarUserAvatar.style.visibility = 'visible';
      dom.sidebarUserAvatar.onerror = () => { dom.sidebarUserAvatar.style.visibility = 'hidden'; };
      dom.sidebarUserName.textContent = p.name;
      dom.sidebarUserStatus.textContent = p.hasKey
        ? '已就绪'
        : (p.optionalKey ? '本机模式' : '未配置密钥');
      dom.sidebarUserStatus.classList.toggle('warn', !p.hasKey && !p.optionalKey);
    } else {
      dom.sidebarUserAvatar.style.visibility = 'hidden';
      dom.sidebarUserName.textContent = 'AI 助手';
      dom.sidebarUserStatus.textContent = '未配置密钥';
      dom.sidebarUserStatus.classList.add('warn');
    }
  }

  /* ---------- 顶部 AI 选择器：每一项都带自己的漫画形象 ---------- */
  function renderAiPicker() {
    const dom = App.dom;
    const p = currentProvider();
    dom.aiPickerAvatar.textContent = '';
    if (p) {
      dom.aiPickerAvatar.appendChild(App.avatars.avatarNode(p.id));
      dom.aiPickerName.textContent = p.name;
      dom.aiPickerBtn.classList.remove('empty');
    } else {
      dom.aiPickerName.textContent = '未配置 AI';
      dom.aiPickerBtn.classList.add('empty');
    }
  }

  function renderAiPickerMenu() {
    const dom = App.dom;
    const selected = App.chat.currentSingleProvider();
    dom.aiPickerMenu.textContent = '';
    const frag = global.document.createDocumentFragment();
    App.state.providers.forEach((p) => {
      const item = global.document.createElement('button');
      item.type = 'button';
      item.className = 'ai-picker-item'
        + (p.id === selected ? ' active' : '')
        + (p.configured ? '' : ' disabled');

      const av = global.document.createElement('span');
      av.className = 'ai-picker-item-avatar';
      av.appendChild(App.avatars.avatarNode(p.id));

      const txt = global.document.createElement('span');
      txt.className = 'ai-picker-item-text';
      const nm = global.document.createElement('span');
      nm.className = 'ai-picker-item-name';
      nm.textContent = p.name;
      const st = global.document.createElement('span');
      st.className = 'ai-picker-item-sub';
      st.textContent = p.hasKey ? (p.keyTail && p.keyTail !== '✗' ? `已保存 · ${p.keyTail}` : '已就绪')
        : (p.optionalKey ? '本机模式' : '未配置密钥');
      txt.append(nm, st);

      item.append(av, txt);
      if (!p.configured) {
        item.addEventListener('click', () => {
          closeAiPicker();
          App.utils.toast(`${p.name} 还没配置密钥，侧边栏设置已打开`, 'info');
          App.settings.openView();
        });
      } else {
        item.addEventListener('click', async () => {
          await selectProvider(p.id);
          closeAiPicker();
          App.utils.toast(`已切换到 ${p.name}`, 'success', 1800);
        });
      }
      frag.appendChild(item);
    });
    dom.aiPickerMenu.appendChild(frag);
  }

  /* 换 AI 的公共入口：下拉菜单、命令面板都走这里，保证该刷新的都刷新 */
  async function selectProvider(id) {
    if (!App.avatars.providerById(id)) return;
    App.dom.singleAiSelect.value = id;
    await App.sessions.savePrefs({ singleProvider: id });
    renderAiPicker();
    renderSidebarUser();
    refreshThinkToggle();
    App.pet.updateArt();
    App.pet.invalidateBalance();   // 换人了，余额要重新查，不能沿用上一家的
  }

  function openAiPicker() {
    renderAiPickerMenu();
    App.dom.aiPickerMenu.classList.remove('hidden');
    App.dom.aiPickerBtn.classList.add('open');
    App.state.aiPickerOpen = true;
  }

  function closeAiPicker() {
    if (!App.state.aiPickerOpen) return;
    App.dom.aiPickerMenu.classList.add('hidden');
    App.dom.aiPickerBtn.classList.remove('open');
    App.state.aiPickerOpen = false;
  }

  /* ---------- 下拉框填充 ---------- */
  function fillSingleAiSelect() {
    const sel = App.dom.singleAiSelect;
    const previous = sel.value;
    sel.textContent = '';
    const frag = global.document.createDocumentFragment();
    App.state.providers.forEach((p) => {
      const opt = global.document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.configured ? `${p.avatar} ${p.name}` : `${p.avatar} ${p.name}（未配置）`;
      opt.disabled = !p.configured;
      frag.appendChild(opt);
    });
    sel.appendChild(frag);

    const preferred = App.state.providers.find((p) => p.id === App.state.prefs.singleProvider && p.configured)
      || App.state.providers.find((p) => p.id === previous && p.configured)
      || App.state.providers.find((p) => p.configured);
    if (preferred) {
      sel.value = preferred.id;
      if (App.state.prefs.singleProvider !== preferred.id) App.sessions.savePrefs({ singleProvider: preferred.id });
    }
  }

  /* ---------- 深度思考 ---------- */
  function setThinkMode(on) {
    App.state.prefs.thinkMode = on;
    const btn = App.dom.thinkToggle;
    btn.classList.toggle('active', on);
    btn.title = on ? '深度思考：开' : '深度思考：关';
    App.sessions.savePrefs({ thinkMode: on });
  }

  /** 各家对深度思考的支持度不同，不支持的要明确说，不能让它静默失效 */
  function refreshThinkToggle() {
    const p = currentProvider();
    const btn = App.dom.thinkToggle;
    const supported = !p || p.thinkingSupported !== false;
    btn.classList.toggle('unsupported', !supported);
    btn.disabled = !supported;
    if (!supported) {
      btn.classList.remove('active');
      btn.title = `${p ? p.name : '这家'} 的接口没有可用的深度思考参数（开关对它无效）`;
    } else {
      btn.title = App.state.prefs.thinkMode ? '深度思考：开' : '深度思考：关';
      btn.classList.toggle('active', Boolean(App.state.prefs.thinkMode));
    }
  }

  App.providerUI = {
    currentProvider,
    renderSidebarUser,
    renderAiPicker,
    renderAiPickerMenu,
    selectProvider,
    openAiPicker,
    closeAiPicker,
    fillSingleAiSelect,
    setThinkMode,
    refreshThinkToggle,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

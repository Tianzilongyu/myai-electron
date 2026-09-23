;(function (global) {
  'use strict';

  /**
   * 快捷键：速查面板 + 自定义绑定
   *
   * 可自定义的 7 个组合键存进 prefs.shortcuts，其余（Enter、Shift+Enter、Esc、?）保持不变。
   * 面板里的自定义行点击后进入「录音」状态，按下新组合即保存。
   */
  const App = (global.App = global.App || {});

  const DEFAULT_SHORTCUTS = {
    command: 'mod+k',
    newChat: 'mod+n',
    toggleSidebar: 'mod+b',
    settings: 'mod+,',
    searchSessions: 'mod+f',
    importFile: 'mod+shift+o',
    toggleMode: 'mod+shift+m',
  };

  const SHORTCUT_DEFS = [
    { id: 'command', label: '命令面板' },
    { id: 'newChat', label: '新建对话' },
    { id: 'toggleSidebar', label: '折叠 / 展开侧边栏' },
    { id: 'settings', label: '打开设置与密钥' },
    { id: 'searchSessions', label: '搜索会话' },
    { id: 'importFile', label: '导入本地文件' },
    { id: 'toggleMode', label: '切换单 / 多 AI 模式' },
  ];

  const STATIC_GROUPS = [
    { group: '输入框', items: [['Enter', '发送'], ['Shift + Enter', '换行']] },
    { group: '其它', items: [['Esc', '关闭浮层 / 取消'], ['?', '查看快捷键']] },
  ];

  function labelOf(id) {
    const def = SHORTCUT_DEFS.find((d) => d.id === id);
    return def ? def.label : id;
  }

  function resolve() {
    const overrides = (App.state.prefs && App.state.prefs.shortcuts) || {};
    const out = Object.assign({}, DEFAULT_SHORTCUTS);
    Object.keys(out).forEach((id) => {
      const v = overrides[id];
      if (typeof v === 'string' && v) out[id] = v;
    });
    return out;
  }

  function parseChord(chord) {
    const parts = String(chord || '').toLowerCase().split('+');
    return {
      mod: parts.includes('mod'),
      alt: parts.includes('alt'),
      shift: parts.includes('shift'),
      key: parts.find((p) => !['mod', 'alt', 'shift'].includes(p)) || '',
    };
  }

  function matchEvent(e, chord) {
    const c = parseChord(chord);
    if (!c.key) return false;
    if (Boolean(e.ctrlKey || e.metaKey) !== c.mod) return false;
    if (Boolean(e.altKey) !== c.alt) return false;
    if (Boolean(e.shiftKey) !== c.shift) return false;
    return String(e.key || '').toLowerCase() === c.key;
  }

  /** 命中则返回动作 id，否则 null */
  function match(e) {
    const map = resolve();
    for (const id of Object.keys(map)) {
      if (matchEvent(e, map[id])) return id;
    }
    return null;
  }

  const MOD_KEYS = ['control', 'shift', 'alt', 'meta', 'escape', 'capslock', 'tab', 'dead'];

  /** 从一次按键事件里读出可保存的组合（必须含 Ctrl/⌘），读不出返回空串 */
  function chordFromEvent(e) {
    if (!(e.ctrlKey || e.metaKey)) return '';
    const key = String(e.key || '').toLowerCase();
    if (!key || MOD_KEYS.includes(key)) return '';
    const parts = ['mod'];
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    parts.push(key);
    return parts.join('+');
  }

  function keyDisplay(k) {
    if (k === ' ') return 'Space';
    return k.length === 1 ? k.toUpperCase() : k;
  }

  function formatChord(chord) {
    const c = parseChord(chord);
    if (!c.key) return '';
    const parts = [];
    if (c.mod) parts.push('Ctrl/⌘');
    if (c.alt) parts.push('Alt');
    if (c.shift) parts.push('Shift');
    parts.push(keyDisplay(c.key));
    return parts.join(' + ');
  }

  let recording = null;

  function isRecording() {
    return Boolean(recording);
  }

  function makeKbd(text) {
    const kbd = global.document.createElement('kbd');
    kbd.textContent = text;
    return kbd;
  }

  function render() {
    const body = App.dom.shortcutsBody;
    body.textContent = '';
    const frag = global.document.createDocumentFragment();
    const map = resolve();

    // 可自定义的一组
    const customHead = global.document.createElement('div');
    customHead.className = 'sc-group';
    customHead.textContent = '快捷键（点击可改，改完立即生效）';
    frag.appendChild(customHead);

    SHORTCUT_DEFS.forEach((def) => {
      const row = global.document.createElement('div');
      row.className = 'sc-row sc-editable';
      row.dataset.action = def.id;
      row.title = '点击后按下新的组合键';
      const d = global.document.createElement('span');
      d.textContent = def.label;
      const k = global.document.createElement('span');
      k.className = 'sc-keys';
      k.appendChild(makeKbd(formatChord(map[def.id])));
      const hint = global.document.createElement('span');
      hint.className = 'sc-edit-hint';
      hint.textContent = '改';
      k.appendChild(hint);
      row.append(d, k);
      row.addEventListener('click', () => startRecording(def.id, row));
      frag.appendChild(row);
    });

    const reset = global.document.createElement('button');
    reset.className = 'sc-reset';
    reset.type = 'button';
    reset.textContent = '恢复默认快捷键';
    reset.addEventListener('click', resetToDefault);
    frag.appendChild(reset);

    // 不可自定义的两组
    STATIC_GROUPS.forEach((g) => {
      const head = global.document.createElement('div');
      head.className = 'sc-group';
      head.textContent = g.group;
      frag.appendChild(head);
      g.items.forEach(([keys, desc]) => {
        const row = global.document.createElement('div');
        row.className = 'sc-row';
        const d = global.document.createElement('span');
        d.textContent = desc;
        const k = global.document.createElement('span');
        k.className = 'sc-keys';
        k.appendChild(makeKbd(keys));
        row.append(d, k);
        frag.appendChild(row);
      });
    });

    body.appendChild(frag);
  }

  function open() {
    render();
    App.dom.shortcutsPanel.classList.add('show');
    App.dom.shortcutsMask.classList.add('show');
  }

  function close() {
    App.dom.shortcutsPanel.classList.remove('show');
    App.dom.shortcutsMask.classList.remove('show');
  }

  function isOpen() {
    return App.dom.shortcutsPanel.classList.contains('show');
  }

  function startRecording(id, row) {
    if (recording) cancelRecording();
    recording = { id, row };
    row.classList.add('sc-recording');
    const kbd = row.querySelector('kbd');
    if (kbd) kbd.textContent = '…';
    const hint = row.querySelector('.sc-edit-hint');
    if (hint) hint.textContent = '按下新组合…（Esc 取消）';
    global.document.addEventListener('keydown', onRecordKey, true);
  }

  function onRecordKey(e) {
    if (e.key === 'Escape') { cancelRecording(); return; }
    e.preventDefault();
    e.stopPropagation();
    const chord = chordFromEvent(e);
    if (!chord) return;   // 必须含 Ctrl/⌘
    commitRecording(chord);
  }

  function commitRecording(chord) {
    if (!recording) return;
    const id = recording.id;
    const map = resolve();
    for (const other of Object.keys(map)) {
      if (other !== id && map[other] === chord) {
        App.utils.toast(`这个组合已用于「${labelOf(other)}」`, 'info', 2600);
        cancelRecording();
        return;
      }
    }
    const overrides = Object.assign({}, (App.state.prefs && App.state.prefs.shortcuts) || {}, { [id]: chord });
    // 乐观更新：先改本地 prefs，面板立即反映新组合；落盘由 savePrefs 异步完成
    if (App.state.prefs) App.state.prefs.shortcuts = overrides;
    App.sessions.savePrefs({ shortcuts: overrides });
    App.utils.toast(`已更新「${labelOf(id)}」快捷键`, 'success', 1800);
    cancelRecording();
  }

  function cancelRecording() {
    global.document.removeEventListener('keydown', onRecordKey, true);
    if (recording && recording.row) {
      recording.row.classList.remove('sc-recording');
      const hint = recording.row.querySelector('.sc-edit-hint');
      if (hint) hint.textContent = '改';
    }
    recording = null;
    render();
  }

  function resetToDefault() {
    App.sessions.savePrefs({ shortcuts: {} });
    App.utils.toast('快捷键已恢复默认', 'success');
    render();
  }

  function bind() {
    App.dom.shortcutsMask.addEventListener('click', close);
    App.dom.shortcutsClose.addEventListener('click', close);
  }

  App.shortcuts = {
    open,
    close,
    isOpen,
    bind,
    resolve,
    match,
    isRecording,
    cancelRecording,
    resetToDefault,
    formatChord,
    chordFromEvent,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

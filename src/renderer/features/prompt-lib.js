;(function (global) {
  'use strict';

  /**
   * 自定义提示词库
   *
   * 把常用提示词存进 prefs.prompts，需要时一键填入输入框。
   * 存的是纯本地配置（config.json），不占用会话、不需要新的 IPC 通道。
   */
  const App = (global.App = global.App || {});

  function list() {
    const v = App.state.prefs && App.state.prefs.prompts;
    return Array.isArray(v) ? v : [];
  }

  function open() {
    App.panels.closeFloatingLayers();
    App.pet.closePet();
    render();
    hideForm();
    App.dom.promptPanel.classList.add('show');
    App.dom.promptPanelMask.classList.add('show');
  }

  function close() {
    App.dom.promptPanel.classList.remove('show');
    App.dom.promptPanelMask.classList.remove('show');
    hideForm();
  }

  function isOpen() {
    return App.dom.promptPanel.classList.contains('show');
  }

  function render() {
    const el = App.dom.promptList;
    el.textContent = '';
    const frag = global.document.createDocumentFragment();
    const items = list();

    if (items.length === 0) {
      const empty = global.document.createElement('div');
      empty.className = 'prompt-empty';
      empty.textContent = '还没有保存的提示词。点右上角「新建」添加一个。';
      frag.appendChild(empty);
    } else {
      items.forEach((p) => {
        const card = global.document.createElement('div');
        card.className = 'prompt-card';

        const head = global.document.createElement('div');
        head.className = 'prompt-card-head';
        const title = global.document.createElement('span');
        title.className = 'prompt-card-title';
        title.textContent = p.title || '未命名';
        const del = global.document.createElement('button');
        del.className = 'prompt-card-del';
        del.textContent = '删除';
        del.addEventListener('click', () => remove(p.id));
        head.append(title, del);

        const body = global.document.createElement('div');
        body.className = 'prompt-card-body';
        body.textContent = String(p.content || '').slice(0, 200);

        const foot = global.document.createElement('div');
        foot.className = 'prompt-card-foot';
        const useBtn = global.document.createElement('button');
        useBtn.className = 'prompt-card-use';
        useBtn.textContent = '填入输入框';
        useBtn.addEventListener('click', () => insert(p));
        foot.appendChild(useBtn);

        card.append(head, body, foot);
        frag.appendChild(card);
      });
    }
    el.appendChild(frag);
  }

  function insert(p) {
    const input = App.dom.userInput;
    input.value = String(p.content || '');
    App.utils.autoGrowEl(input, 160);
    input.focus();
    close();
    App.utils.toast('提示词已填入输入框', 'success', 1600);
  }

  function showForm() {
    App.dom.promptForm.classList.remove('hidden');
    App.dom.promptNewBtn.classList.add('hidden');
    App.dom.promptTitleInput.value = '';
    App.dom.promptContentInput.value = '';
    App.dom.promptTitleInput.focus();
  }

  function hideForm() {
    App.dom.promptForm.classList.add('hidden');
    App.dom.promptNewBtn.classList.remove('hidden');
  }

  function save() {
    const title = App.dom.promptTitleInput.value.trim();
    const content = App.dom.promptContentInput.value.trim();
    if (!title || !content) { App.utils.toast('标题和内容都不能为空', 'info'); return; }
    const next = list().concat([{ id: App.utils.genId(), title: title.slice(0, 40), content }]);
    if (App.state.prefs) App.state.prefs.prompts = next;   // 乐观更新，立即反映
    App.sessions.savePrefs({ prompts: next });
    render();
    hideForm();
    App.utils.toast('提示词已保存', 'success');
  }

  function remove(id) {
    const next = list().filter((p) => p.id !== id);
    if (App.state.prefs) App.state.prefs.prompts = next;
    App.sessions.savePrefs({ prompts: next });
    render();
    App.utils.toast('已删除', 'success', 1400);
  }

  function bind() {
    App.dom.promptPanelMask.addEventListener('click', close);
    App.dom.promptPanelClose.addEventListener('click', close);
    App.dom.promptNewBtn.addEventListener('click', showForm);
    App.dom.promptCancelBtn.addEventListener('click', hideForm);
    App.dom.promptSaveBtn.addEventListener('click', save);
    App.dom.promptContentInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
    });
  }

  App.promptLib = { open, close, isOpen, render, bind };
})(typeof globalThis !== 'undefined' ? globalThis : this);

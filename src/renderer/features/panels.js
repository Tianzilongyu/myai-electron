;(function (global) {
  'use strict';

  /** 浮层与侧边栏：技能面板、多 AI 配置面板、侧边栏折叠 */
  const App = (global.App = global.App || {});

  /* ---------- 技能面板 ---------- */
  function renderSkillGrid() {
    const grid = App.dom.skillGrid;
    grid.textContent = '';
    const frag = global.document.createDocumentFragment();
    App.skills.forEach((skill) => {
      const card = global.document.createElement('div');
      card.className = 'skill-card' + (App.state.selectedSkills.includes(skill.id) ? ' selected' : '');
      card.innerHTML = `
        <div class="skill-card-icon">${skill.icon}</div>
        <div class="skill-card-name"></div>
        <div class="skill-card-desc"></div>
      `;
      card.querySelector('.skill-card-name').textContent = skill.name;
      card.querySelector('.skill-card-desc').textContent = skill.desc;
      card.addEventListener('click', () => {
        const idx = App.state.selectedSkills.indexOf(skill.id);
        if (idx === -1) App.state.selectedSkills.push(skill.id);
        else App.state.selectedSkills.splice(idx, 1);
        card.classList.toggle('selected');
      });
      frag.appendChild(card);
    });
    grid.appendChild(frag);
  }

  function updateSkillBadge() {
    App.dom.skillCount.textContent = String(App.state.selectedSkills.length);
    App.dom.skillBtn.classList.toggle('active', App.state.selectedSkills.length > 0);
  }

  function openSkillPanel() {
    renderSkillGrid();
    App.dom.skillPanel.classList.add('show');
    App.dom.skillPanelMask.classList.add('show');
  }

  function closeSkillPanel() {
    App.dom.skillPanel.classList.remove('show');
    App.dom.skillPanelMask.classList.remove('show');
  }

  /* ---------- 多 AI 配置面板 ---------- */

  /** 一行一家：形象 + 名称 + 状态（没配密钥的明确置灰，别让人选了才发现用不了） */
  function buildProviderRow(p, kind) {
    const label = global.document.createElement('label');
    label.className = `config-row config-row-${kind}` + (p.configured ? '' : ' disabled');
    label.dataset.provider = p.id;

    const input = global.document.createElement('input');
    input.type = kind === 'leader' ? 'radio' : 'checkbox';
    input.name = kind === 'leader' ? 'leader' : 'worker';
    input.value = p.id;
    input.disabled = !p.configured;

    const avatar = global.document.createElement('span');
    avatar.className = 'config-row-avatar';
    avatar.appendChild(App.avatars.avatarNode(p.id));

    const text = global.document.createElement('span');
    text.className = 'config-row-text';
    const name = global.document.createElement('span');
    name.className = 'config-row-name';
    name.textContent = p.name;
    const sub = global.document.createElement('span');
    sub.className = 'config-row-sub';
    sub.textContent = p.hasKey ? (p.keyTail && p.keyTail !== '✗' ? `已保存 · ${p.keyTail}` : '已就绪')
      : (p.optionalKey ? '本机模式' : '未配置密钥');
    text.append(name, sub);

    label.append(input, avatar, text);
    if (!p.configured) label.title = `${p.name} 还没配置密钥，先去设置里填一个`;
    return label;
  }

  function renderMultiConfigGroups() {
    const s = App.state;
    const dom = App.dom;
    dom.leaderGroup.textContent = '';
    dom.workerGroup.textContent = '';
    const lf = global.document.createDocumentFragment();
    const wf = global.document.createDocumentFragment();

    s.providers.forEach((p) => {
      const row = buildProviderRow(p, 'leader');
      row.querySelector('input').checked = p.id === s.multiConfig.leader;
      lf.appendChild(row);

      const crow = buildProviderRow(p, 'worker');
      crow.querySelector('input').checked = s.multiConfig.workers.includes(p.id);
      wf.appendChild(crow);
    });

    dom.leaderGroup.appendChild(lf);
    dom.workerGroup.appendChild(wf);
    updateConfigCounts();
  }

  function updateConfigCounts() {
    const dom = App.dom;
    const leader = global.document.querySelector('#leader-group input:checked');
    const workers = global.document.querySelectorAll('#worker-group input:checked');
    dom.leaderCount.textContent = leader ? '1' : '0';
    dom.workerCount.textContent = String(workers.length);
  }

  /** 工具条上那颗「团队」按钮：一眼看出现在是谁带谁干 */
  function updateTeamSummary() {
    const s = App.state;
    const dom = App.dom;
    const leader = App.avatars.providerById(s.multiConfig.leader);
    const workers = s.multiConfig.workers
      .map((id) => App.avatars.providerById(id))
      .filter(Boolean);

    dom.teamLeaderName.textContent = leader ? leader.name : '未选择';
    dom.teamWorkerSummary.textContent = workers.length
      ? `${workers.length} 位专家`
      : '未选专家';
    dom.multiConfigBtn.classList.toggle('warn', !leader || workers.length === 0);
    dom.multiConfigBtn.title = leader
      ? `统领：${leader.name}　专家：${workers.map((w) => w.name).join('、') || '未选'}（点击修改）`
      : '还没定统领 AI，点这里配置多 AI 团队';
  }

  function selectAllConfiguredWorkers() {
    global.document.querySelectorAll('#worker-group input').forEach((input) => {
      if (!input.disabled) input.checked = true;
    });
    updateConfigCounts();
  }

  function clearWorkers() {
    global.document.querySelectorAll('#worker-group input:checked').forEach((input) => { input.checked = false; });
    updateConfigCounts();
  }

  /* 分区折叠：点标题收起/展开，内容用 max-height 过渡，不是硬生生 display:none */
  function bindConfigSections() {
    global.document.querySelectorAll('.config-section').forEach((section) => {
      const head = section.querySelector('.config-section-head');
      if (!head) return;
      head.addEventListener('click', () => {
        const collapsed = section.classList.toggle('collapsed');
        head.setAttribute('aria-expanded', String(!collapsed));
      });
    });
  }

  function openConfigPanel() {
    renderMultiConfigGroups();
    App.dom.configPanel.classList.add('show');
    App.dom.configMask.classList.add('show');
  }

  function closeConfigPanel() {
    App.dom.configPanel.classList.remove('show');
    App.dom.configMask.classList.remove('show');
  }

  function saveMultiConfig() {
    const leaderInput = global.document.querySelector('#leader-group input:checked');
    const workerInputs = Array.from(global.document.querySelectorAll('#worker-group input:checked'));
    if (!leaderInput) { App.utils.toast('请选择一个统领 AI', 'info'); return; }
    if (workerInputs.length === 0) { App.utils.toast('请至少选择一个被统领 AI', 'info'); return; }
    App.state.multiConfig = { leader: leaderInput.value, workers: workerInputs.map((i) => i.value) };
    App.sessions.savePrefs({ multi: App.state.multiConfig });
    updateTeamSummary();
    closeConfigPanel();
    App.utils.toast('多 AI 团队已保存', 'success');
  }

  /* ---------- 侧边栏 ---------- */
  function setSidebarCollapsed(collapsed) {
    App.dom.sidebar.classList.toggle('collapsed', collapsed);
    App.sessions.savePrefs({ sidebarCollapsed: collapsed });
  }

  /* Esc 或点击主区域时收起所有浮层（侧边栏设置是「视图」不是浮层，不在这里收） */
  function closeFloatingLayers() {
    closeConfigPanel();
    closeSkillPanel();
    App.providerUI.closeAiPicker();
    if (App.promptLib && App.promptLib.close) App.promptLib.close();
  }

  App.panels = {
    renderSkillGrid,
    updateSkillBadge,
    openSkillPanel,
    closeSkillPanel,
    renderMultiConfigGroups,
    updateConfigCounts,
    updateTeamSummary,
    selectAllConfiguredWorkers,
    clearWorkers,
    bindConfigSections,
    openConfigPanel,
    closeConfigPanel,
    saveMultiConfig,
    setSidebarCollapsed,
    closeFloatingLayers,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

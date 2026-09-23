;(function (global) {
  'use strict';

  /**
   * 各种展示块的构造
   * 只负责「造出一段 DOM」，不关心它挂到哪儿、也不改状态。
   */
  const App = (global.App = global.App || {});

  const TOOL_META = () => App.constants.TOOL_META;

  function buildReasoningBox(reasoningObj, opts = {}) {
    const { open = false, live = false } = opts;
    const box = global.document.createElement('div');
    box.className = 'reasoning-box' + (open ? ' open' : '');
    box.innerHTML = `
      <div class="reasoning-header">
        <span class="reasoning-dot"></span>
        <span class="reasoning-title"></span>
        <span class="arrow">▼</span>
      </div>
      <div class="reasoning-content"></div>
    `;
    const titleEl = box.querySelector('.reasoning-title');
    titleEl.textContent = live
      ? '正在思考…'
      : `已深度思考（用时 ${reasoningObj.elapsed} 秒）`;
    box.querySelector('.reasoning-content').textContent = reasoningObj.content || '';
    box.querySelector('.reasoning-header').addEventListener('click', () => box.classList.toggle('open'));
    return box;
  }

  function buildStageBox(num, title, body, open = false, avatar = null) {
    const box = global.document.createElement('div');
    box.className = 'stage-box' + (open ? ' open' : '');
    box.innerHTML = `
      <div class="stage-header">
        <span class="stage-num">${num}</span>
        <span class="stage-name"></span>
        <span class="stage-tip">点击展开</span>
      </div>
      <div class="stage-body"></div>
    `;
    box.querySelector('.stage-name').textContent = avatar ? `${avatar} ${title}` : title;
    box.querySelector('.stage-body').textContent = body;
    box.querySelector('.stage-header').addEventListener('click', () => box.classList.toggle('open'));
    return box;
  }

  function buildSavedFilesCard(savedResults) {
    const ok = savedResults.filter((r) => r.success);
    const card = global.document.createElement('div');
    card.className = 'saved-files-card';
    const header = global.document.createElement('div');
    header.className = 'saved-files-header';
    header.textContent = `已自动保存 ${ok.length} 个文件到桌面`;
    card.appendChild(header);
    const list = global.document.createElement('div');
    list.className = 'saved-files-list';
    ok.forEach((r) => {
      const item = global.document.createElement('div');
      item.className = 'saved-file-item';
      const icon = global.document.createElement('span');
      icon.textContent = App.utils.getFileIcon(r.fileName);
      const name = global.document.createElement('span');
      name.className = 'saved-file-name';
      name.textContent = r.fileName;
      name.title = r.fileName;
      const openBtn = global.document.createElement('button');
      openBtn.className = 'saved-file-btn';
      openBtn.textContent = '打开';
      openBtn.addEventListener('click', () => App.bridge.api.files.openInSystem(r.path));
      const folderBtn = global.document.createElement('button');
      folderBtn.className = 'saved-file-btn';
      folderBtn.textContent = '文件夹';
      folderBtn.addEventListener('click', () => App.bridge.api.files.showInFolder(r.path));
      item.append(icon, name, openBtn, folderBtn);
      list.appendChild(item);
    });
    savedResults.filter((r) => !r.success).forEach((r) => {
      const item = global.document.createElement('div');
      item.className = 'saved-file-item failed';
      item.textContent = `${r.fileName} 保存失败：${r.error || '未知原因'}`;
      list.appendChild(item);
    });
    card.appendChild(list);
    return card;
  }

  /* 关掉自动保存后模型还是产出了文件标记：明确告诉用户，别让他以为存下来了 */
  function buildFilesOffCard(files) {
    const card = global.document.createElement('div');
    card.className = 'files-off-card';
    card.textContent = `自动保存已关闭，AI 产出的 ${files.length} 个文件内容没有落盘：`
      + `${files.map((f) => f.fileName).join('、')}。可在「设置 → 对话参数」里重新打开。`;
    return card;
  }

  function buildErrorBox(message) {
    const box = global.document.createElement('div');
    box.className = 'error-box';
    box.textContent = `出错了：${message}`;
    return box;
  }

  function buildStoppedTag(withStages) {
    const tag = global.document.createElement('div');
    tag.className = 'msg-stopped-tag';
    tag.textContent = withStages ? '⏹ 已手动停止 · 以上是中断前完成的部分' : '⏹ 已手动停止 · 以上是中断时的内容';
    return tag;
  }

  function toolChip(meta, step) {
    const chip = global.document.createElement('div');
    chip.className = 'tool-chip';
    chip.dataset.tool = step.name || '';
    chip.dataset.status = step.status;
    chip.classList.toggle('running', step.status === 'running');
    chip.classList.toggle('denied', step.status === 'denied');
    chip.classList.toggle('error', step.status === 'error');
    chip.innerHTML = `<span class="tool-chip-icon">${meta.icon}</span><span class="tool-chip-label"></span><span class="tool-chip-state">${App.steps.statusLabel(step.status)}</span>`;
    chip.querySelector('.tool-chip-label').textContent = step.summary ? `${meta.label} · ${step.summary}` : meta.label;
    return chip;
  }

  function metaOf(name) {
    return TOOL_META()[name] || { icon: '·', label: name || '工具' };
  }

  function buildToolBar(steps) {
    const bar = global.document.createElement('div');
    bar.className = 'tool-bar';
    const head = global.document.createElement('div');
    head.className = 'tool-bar-head';
    head.textContent = 'AI 用过的工具';
    bar.appendChild(head);
    steps.forEach((s) => bar.appendChild(toolChip(metaOf(s.name), s)));
    return bar;
  }

  function buildToolTimeline(steps) {
    const panel = global.document.createElement('div');
    panel.className = 'tool-timeline';
    const head = global.document.createElement('div');
    head.className = 'tool-timeline-head';
    head.textContent = `执行过程 · ${steps.length} 步`;
    panel.appendChild(head);
    const body = global.document.createElement('div');
    body.className = 'tool-timeline-body';
    steps.forEach((s, i) => {
      const meta = metaOf(s.name);
      const row = global.document.createElement('div');
      row.className = 'tool-step';
      row.dataset.status = s.status;
      const num = global.document.createElement('span');
      num.className = 'tool-step-num';
      num.textContent = String(i + 1);
      const icon = global.document.createElement('span');
      icon.className = 'tool-step-icon';
      icon.textContent = meta.icon;
      const label = global.document.createElement('span');
      label.className = 'tool-step-label';
      label.textContent = s.summary ? `${meta.label} · ${s.summary}` : meta.label;
      const state = global.document.createElement('span');
      state.className = 'tool-step-state';
      state.textContent = App.steps.statusLabel(s.status);
      row.append(num, icon, label, state);
      body.appendChild(row);
    });
    panel.appendChild(body);
    return panel;
  }

  function buildToolSteps(steps, asTimeline) {
    return asTimeline ? buildToolTimeline(steps) : buildToolBar(steps);
  }

  /** 普通模式下按工具名就地更新那一条 chip，不整块重画 */
  function upsertToolChip(msgDiv, chunk) {
    let bar = msgDiv.querySelector('.tool-bar');
    if (!bar) {
      bar = global.document.createElement('div');
      bar.className = 'tool-bar';
      const head = global.document.createElement('div');
      head.className = 'tool-bar-head';
      head.textContent = 'AI 正在使用工具';
      bar.appendChild(head);
      msgDiv.appendChild(bar);
    }
    const sel = `.tool-chip[data-tool="${global.CSS.escape(chunk.name || '')}"]`;
    let chip = bar.querySelector(sel);
    if (!chip) {
      chip = global.document.createElement('div');
      chip.className = 'tool-chip';
      chip.dataset.tool = chunk.name || '';
      bar.appendChild(chip);
    }
    const meta = metaOf(chunk.name);
    chip.dataset.status = chunk.status;
    chip.classList.toggle('running', chunk.status === 'running');
    chip.classList.toggle('denied', chunk.status === 'denied');
    chip.classList.toggle('error', chunk.status === 'error');
    chip.innerHTML = `<span class="tool-chip-icon">${meta.icon}</span><span class="tool-chip-label"></span><span class="tool-chip-state">${App.steps.statusLabel(chunk.status)}</span>`;
    chip.querySelector('.tool-chip-label').textContent = chunk.summary ? `${meta.label} · ${chunk.summary}` : meta.label;
  }

  /* 流式过程中整体重画：步骤最多几十条，重画比逐条 diff 简单也不容易错位 */
  function renderToolTimelineLive(msgDiv, steps) {
    const old = msgDiv.querySelector('.tool-timeline');
    if (old) old.remove();
    if (steps.length) msgDiv.appendChild(buildToolTimeline(steps));
  }

  /* AI 用 set_plan 把计划推过来，直接渲染成清单，让用户知道它打算怎么干 */
  function upsertPlanCard(msgDiv, steps) {
    let card = msgDiv.querySelector('.plan-card');
    if (!card) {
      card = global.document.createElement('div');
      card.className = 'plan-card';
      const head = global.document.createElement('div');
      head.className = 'plan-card-head';
      head.textContent = '执行计划';
      const list = global.document.createElement('ol');
      list.className = 'plan-list';
      card.append(head, list);
      const bubble = msgDiv.querySelector('.bubble');
      if (bubble) msgDiv.insertBefore(card, bubble);
      else msgDiv.appendChild(card);
    }
    const list = card.querySelector('.plan-list');
    list.textContent = '';
    steps.forEach((s) => {
      const li = global.document.createElement('li');
      li.className = 'plan-item';
      li.textContent = s;
      list.appendChild(li);
    });
  }

  function buildMultiDetailBox(stages) {
    const detailBox = global.document.createElement('div');
    detailBox.className = 'reasoning-box';
    detailBox.innerHTML = `
      <div class="reasoning-header">
        <span class="reasoning-dot"></span>
        <span class="reasoning-title">多 AI 协作详情</span>
        <span class="arrow">▼</span>
      </div>
      <div class="reasoning-content"></div>
    `;
    const contentEl = detailBox.querySelector('.reasoning-content');
    if (stages.plan) {
      const p = global.document.createElement('div');
      p.className = 'multi-block';
      p.textContent = `【规划】\n${stages.plan}`;
      contentEl.appendChild(p);
    }
    (stages.workers || []).forEach((r, i) => {
      const w = global.document.createElement('div');
      w.className = 'multi-block';
      w.textContent = `【专家${i + 1} ${r.name}】\n任务：${r.task}\n结果：${r.result}`;
      contentEl.appendChild(w);
    });
    detailBox.querySelector('.reasoning-header').addEventListener('click', () => detailBox.classList.toggle('open'));
    return detailBox;
  }

  App.blocks = {
    buildReasoningBox,
    buildStageBox,
    buildSavedFilesCard,
    buildFilesOffCard,
    buildErrorBox,
    buildStoppedTag,
    buildToolBar,
    buildToolTimeline,
    buildToolSteps,
    upsertToolChip,
    renderToolTimelineLive,
    upsertPlanCard,
    buildMultiDetailBox,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

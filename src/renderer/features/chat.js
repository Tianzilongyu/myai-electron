;(function (global) {
  'use strict';

  /**
   * 发送主流程：单 AI 流式 / 多 AI 协作
   *
   * 两条主线共用一个外壳 sendMessageInternal：
   * 建消息 → 渲染 → 调 AI → 存文件 → 归档 → 刷新。
   * 用户按停止、中途出错都要留下已经生成的部分，不让一轮白跑。
   */
  const App = (global.App = global.App || {});

  function configuredProviders() {
    return App.state.providers.filter((p) => p.configured);
  }

  function anyConfigured() {
    return configuredProviders().length > 0;
  }

  function currentSingleProvider() {
    const sel = App.dom.singleAiSelect;
    if (sel && sel.value) return sel.value;
    const first = configuredProviders()[0];
    return first ? first.id : '';
  }

  function removeLoading() {
    const s = App.state;
    if (s.loadingDiv && s.loadingDiv.parentNode) s.loadingDiv.remove();
    s.loadingDiv = null;
  }

  function setSendButtonStopMode(stop) {
    const btn = App.dom.sendBtn;
    btn.textContent = stop ? '⏹ 停止' : '发送';
    btn.classList.toggle('stop-mode', stop);
  }

  async function autoSaveFiles(files) {
    const results = [];
    for (const file of files) {
      const r = await App.bridge.api.files.autoSave({ fileName: file.fileName, content: file.content });
      results.push(Object.assign({}, r, { fileName: file.fileName }));
    }
    if (results.some((r) => r.success)) {
      App.avatars.setChibi(true, 1800);          // 存文件成功，形象短暂变成 Q 萌版
      App.state.petCelebrateUntil = Date.now() + 10000;   // 宠物也跟着高兴一会儿
    }
    return results;
  }

  /* 存文件失败不能把已经拿到的回答一起带走 —— 先兜住，再往下走 */
  async function saveFilesSafely(files) {
    try {
      return await autoSaveFiles(files);
    } catch (e) {
      return files.map((f) => ({ success: false, fileName: f.fileName, error: (e && e.message) || '保存失败' }));
    }
  }

  function setMode(mode) {
    App.state.currentMode = mode;
    global.document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    const isSingle = mode === 'single';
    App.dom.aiPicker.classList.toggle('hidden', !isSingle);
    App.dom.multiConfigBtn.classList.toggle('hidden', isSingle);
    if (!isSingle) App.panels.updateTeamSummary();
  }

  function stopGeneration() {
    const s = App.state;
    if (s.currentReqId) {
      App.bridge.api.ai.abort(s.currentReqId).catch(() => {});
      s.currentReqId = null;
    }
  }

  function agentOpts() {
    const s = App.state;
    return {
      agent: s.agentMode,
      workDir: s.agentMode ? s.agentWorkDir : '',
      autoApprove: s.agentMode ? s.agentAutoApprove : false,
    };
  }

  /* ==================================================================
   * 单 AI：流式
   * ================================================================== */
  async function sendSingleAI(session, userContent, startTime) {
    const providerId = currentSingleProvider();
    const provider = App.avatars.providerById(providerId);
    if (!provider) throw new Error('请先选择一个 AI 服务');
    if (!provider.configured) throw new Error(`${provider.name} 还没配置密钥，请到「设置」里填写`);

    removeLoading();

    const reqMessages = App.sessions.buildRequestMessages(session);
    const promptText = reqMessages.map((m) => m.content).join('\n');

    const msgDiv = App.messages.appendMessage('ai', '', [], Date.now(), App.avatars.aiMeta(providerId), true);
    const bubbleEl = msgDiv.querySelector('.bubble');

    let accumulated = '';
    let reasoning = '';
    let reasoningBox = null;
    let reasoningContentEl = null;

    const flush = () => {
      bubbleEl.innerHTML = App.markdown.render(accumulated) + '<span class="streaming-cursor"></span>';
      if (reasoningBox && reasoningContentEl) reasoningContentEl.textContent = reasoning;
      App.messages.scrollToBottom();
    };
    // 每帧全量重排是 O(n²)：改成最多每 60ms 一次，并且保证最后一帧一定渲染
    const scheduleRender = App.utils.throttleTrailing(flush, 60);

    App.state.currentReqId = App.utils.genId();

    let streamError = null;
    const toolSteps = [];
    const liveSteps = [];               // 研发模式下按调用顺序记每一步
    let planSteps = null;               // AI 用 set_plan 推过来的执行计划

    const result = await App.bridge.api.ai.stream(
      App.state.currentReqId,
      Object.assign({
        provider: providerId,
        messages: reqMessages,
        thinking: App.state.prefs.thinkMode,
        temperature: App.prompts.currentTemperature(),
        maxTokens: App.prompts.currentMaxTokens(),
      }, agentOpts()),
      (chunk) => {
        if (chunk.type === 'content') {
          accumulated += chunk.text;
          App.genStatus.setPhase('正在回答');
          scheduleRender();
        } else if (chunk.type === 'reasoning') {
          reasoning += chunk.text;
          App.genStatus.setPhase('正在深度思考');
          if (!reasoningBox) {
            reasoningBox = App.blocks.buildReasoningBox({ content: '', elapsed: 0 }, { open: true, live: true });
            reasoningContentEl = reasoningBox.querySelector('.reasoning-content');
            msgDiv.prepend(reasoningBox);
          }
          scheduleRender();
        } else if (chunk.type === 'error') {
          streamError = chunk.text;
        } else if (chunk.type === 'tool') {
          // 主进程在跑工具（搜索/读文件/执行命令），这里实时把过程显示出来
          App.genStatus.setPhase('正在使用工具');
          App.steps.mergeToolStep(toolSteps, chunk);
          if (App.state.agentMode) {
            App.steps.pushLiveStep(liveSteps, chunk);
            App.blocks.renderToolTimelineLive(msgDiv, liveSteps);
          } else {
            App.blocks.upsertToolChip(msgDiv, chunk);
          }
          App.messages.scrollToBottom();
        } else if (chunk.type === 'plan' && Array.isArray(chunk.steps)) {
          planSteps = chunk.steps;
          App.blocks.upsertPlanCard(msgDiv, planSteps);
        }
      },
    );

    const finalText = (result && result.content) || accumulated;
    const elapsed = Math.max(1, Math.round((Date.now() - startTime) / 1000));
    // 研发模式用 append-only 的那份（能看出每一步），普通模式用合并后的（不重复堆叠）
    const shownSteps = App.state.agentMode ? liveSteps : toolSteps;

    // 用户按了停止：把已经生成的部分留下来，标上「已停止」，不要让他白等一场
    if (result && result.aborted) {
      const partial = String(accumulated || '').trim();
      msgDiv.remove();
      if (partial && session) {
        const stoppedText = App.saveMarkers.parse(partial).cleanText;
        const stoppedUsage = App.tokens.usageOf(null, promptText, partial);
        const stoppedMsg = {
          role: 'assistant',
          content: partial,
          timestamp: Date.now(),
          aiName: provider.name,
          providerId,
          usage: stoppedUsage,
          stopped: true,
        };
        session.messages.push(stoppedMsg);
        session.updatedAt = Date.now();
        App.tokens.addSessionUsage(session, stoppedUsage);
        App.sessions.saveSessions();
        App.tokens.updateTokenChip();
        const stoppedDiv = App.messages.appendMessage('ai', stoppedText, [], stoppedMsg.timestamp, App.avatars.aiMeta(providerId), false, partial, stoppedUsage, stoppedMsg);
        if (planSteps && planSteps.length) {
          stoppedMsg.plan = planSteps.slice();
          App.blocks.upsertPlanCard(stoppedDiv, planSteps);
        }
        if (reasoning) stoppedDiv.prepend(App.blocks.buildReasoningBox({ content: reasoning, elapsed }));
        if (shownSteps.length) stoppedDiv.appendChild(App.blocks.buildToolSteps(shownSteps, App.state.agentMode));
        stoppedDiv.appendChild(App.blocks.buildStoppedTag(false));
        App.messages.scrollToBottom();
      }
      throw App.bridge.abortError();
    }

    const { files, cleanText } = App.saveMarkers.parse(finalText);
    const saveOff = files.length > 0 && App.state.prefs.autoSaveFiles === false;
    const savedResults = (files.length > 0 && !saveOff) ? await saveFilesSafely(files) : [];

    msgDiv.remove();
    if (streamError) throw new Error(streamError);

    const usage = App.tokens.usageOf(result && result.usage, promptText, finalText);
    const aiMsg = {
      role: 'assistant',
      content: finalText,
      timestamp: Date.now(),
      aiName: provider.name,
      providerId,
      usage,
    };
    if (savedResults.length > 0) aiMsg.savedFiles = savedResults;
    if (reasoning) aiMsg.reasoning = { content: reasoning, elapsed };
    if (planSteps && planSteps.length) aiMsg.plan = planSteps.slice();
    if (shownSteps.length) {
      aiMsg.tools = shownSteps.slice();
      if (App.state.agentMode) aiMsg.agent = true;
    }
    session.messages.push(aiMsg);
    session.updatedAt = Date.now();
    App.tokens.addSessionUsage(session, usage);
    App.sessions.saveSessions();
    App.tokens.updateTokenChip();

    const newMsgDiv = App.messages.appendMessage('ai', cleanText, [], aiMsg.timestamp, App.avatars.aiMeta(providerId), false, finalText, usage, aiMsg);
    // 流式那个气泡最后会被换掉，计划卡要跟着搬到新气泡上，否则做完就看不见了
    if (planSteps && planSteps.length) App.blocks.upsertPlanCard(newMsgDiv, planSteps);
    if (shownSteps.length) newMsgDiv.appendChild(App.blocks.buildToolSteps(shownSteps, App.state.agentMode));
    if (reasoning) newMsgDiv.prepend(App.blocks.buildReasoningBox({ content: reasoning, elapsed }));
    if (savedResults.length > 0) newMsgDiv.appendChild(App.blocks.buildSavedFilesCard(savedResults));
    if (saveOff) newMsgDiv.appendChild(App.blocks.buildFilesOffCard(files));

    if (session.messages.filter((m) => m.role !== 'system').length <= 2) {
      App.sessions.autoGenerateTitle(session, userContent);
    }
    App.messages.scrollToBottom();
  }

  /* ==================================================================
   * 多 AI：规划 → 专家并行 → 汇总
   * ================================================================== */
  async function sendMultiAI(session, userContent, startTime) {
    const s = App.state;
    const leader = s.multiConfig.leader;
    const workers = s.multiConfig.workers.filter((w) => App.avatars.providerById(w));
    const leaderProvider = App.avatars.providerById(leader);
    if (!leaderProvider || !leaderProvider.configured) {
      throw new Error(`${(leaderProvider || {}).name || '统领 AI'} 还没配置密钥，请到「设置」里填写`);
    }
    if (workers.length === 0) throw new Error('请先在多 AI 配置里至少选择一个被统领 AI');

    removeLoading();
    const placeholder = App.messages.appendMessage('ai', '正在启动多 AI 协作…', [], Date.now());
    App.messages.scrollToBottom(true);

    s.currentReqId = App.utils.genId();
    const workerNames = workers.map((w) => `${App.avatars.providerById(w).name}(${w})`).join('、');

    // 多 AI 下每个角色（总指挥 + 各位专家）都能用工具，过程实时汇总到同一条消息里
    const multiToolSteps = [];
    const multiLiveSteps = [];
    let multiPlanSteps = null;
    const offChunk = App.bridge.api.ai.onChunk(s.currentReqId, (chunk) => {
      if (chunk && chunk.type === 'tool') {
        App.steps.mergeToolStep(multiToolSteps, chunk);
        if (s.agentMode) {
          App.steps.pushLiveStep(multiLiveSteps, chunk);
          App.blocks.renderToolTimelineLive(placeholder, multiLiveSteps);
        } else {
          App.blocks.upsertToolChip(placeholder, chunk);
        }
        App.messages.scrollToBottom();
      } else if (chunk && chunk.type === 'plan' && Array.isArray(chunk.steps)) {
        multiPlanSteps = chunk.steps;
        App.blocks.upsertPlanCard(placeholder, multiPlanSteps);
      }
    });

    // 多 AI 一轮下来有 1 次规划 + N 次专家 + 1 次汇总，用量要累加
    const usageAcc = App.tokens.emptyTokens();
    let allExact = true;
    const accumulate = (usage, promptText, completionText) => {
      const u = App.tokens.usageOf(usage, promptText, completionText);
      usageAcc.prompt += u.prompt;
      usageAcc.completion += u.completion;
      usageAcc.total += u.total;
      if (!u.exact) allExact = false;
    };

    // 三个角色（规划 / 专家 / 汇总）共用一套参数，改一处就全跟着变
    const callOpts = () => Object.assign({
      reqId: s.currentReqId,
      thinking: s.prefs.thinkMode,
      temperature: App.prompts.currentTemperature(),
      maxTokens: App.prompts.currentMaxTokens(),
    }, agentOpts());

    // 中途被停止时要把已经跑完的阶段留下来，所以这两个放到 try 外面
    let plan = '';
    let workerResults = [];

    try {
      const planMessages = [
        {
          role: 'system',
          content: `你是一个总指挥 AI。把用户任务拆成互不重叠的子任务，分派给下面这些专家：
${workerNames}

严格按下面的格式输出，除此之外不要写任何内容：

[PLAN]
一句话说明整体思路和拆法。

[TASK:专家ID]
给这个专家的具体任务描述。

规则：
- 专家 ID 必须来自上面的列表，一个 ID 对应一个 TASK 块，不要重复。
- 每个任务要自带上下文，让专家不依赖别人的输出也能开工。
- 任务之间尽量不重叠；确实要串行的，在描述里说明先后顺序。
- 任务很小就只分一个；最多 ${workers.length} 个。
- 需要实时信息时，在任务描述里明确要求它先联网搜索，并说清楚要查什么。
- 不要输出代码块，不要加前言和解释。`,
        },
        { role: 'user', content: userContent },
      ];

      App.genStatus.setPhase('正在拆解任务');
      const planRes = await App.ai.callOnceWithRetry(leader, planMessages, callOpts());
      if (planRes.aborted) throw App.bridge.abortError();
      const planReply = planRes.content;
      accumulate(planRes.usage, planMessages.map((m) => m.content).join('\n'), planReply);
      const planText = (planReply.match(/\[PLAN\]([\s\S]*?)(?=\[TASK:|$)/) || [])[1];
      plan = (planText || '').trim();

      const taskRegex = /\[TASK:([^\]]+)\]([\s\S]*?)(?=\[TASK:|$)/g;
      const tasks = [];
      let m;
      while ((m = taskRegex.exec(planReply)) !== null) {
        const wid = m[1].trim();
        if (App.avatars.providerById(wid)) tasks.push({ workerId: wid, task: m[2].trim() });
      }
      if (tasks.length === 0) workers.forEach((w) => tasks.push({ workerId: w, task: userContent }));

      if (plan) {
        placeholder.appendChild(
          App.blocks.buildStageBox(1, `统领 ${leaderProvider.name} 规划`, plan, true, leaderProvider.avatar),
        );
      }
      const bubble = placeholder.querySelector('.bubble');
      if (bubble) bubble.textContent = '多 AI 并行处理中…';
      App.messages.scrollToBottom();

      App.genStatus.setPhase(`${tasks.length} 位专家并行处理中`);
      workerResults = await Promise.all(tasks.map(async (t, i) => {
        const worker = App.avatars.providerById(t.workerId);
        const workerMessages = [
          {
            role: 'system',
            content: `你是 ${worker.name}，一位专业助手。

输出要求：
- 只给出任务结果本身，不要「好的」「以下是」这类开场白，也不要复述任务。
- 用 Markdown 排版；结论先行，有数据就给数据，有步骤就分步骤。
- 就当用户是直接交给你的，不要提及其它专家或分工。
- 不确定就直接说不确定，不要编造事实、数据或链接。`,
          },
          { role: 'user', content: `请完成这个任务：\n${t.task}` },
        ];
        try {
          const res = await App.ai.callOnceWithRetry(t.workerId, workerMessages, callOpts());
          if (res.aborted) throw App.bridge.abortError();
          accumulate(res.usage, workerMessages.map((m) => m.content).join('\n'), res.content);
          return { workerId: t.workerId, name: worker.name, task: t.task, result: res.content, index: i };
        } catch (e) {
          return { workerId: t.workerId, name: worker.name, task: t.task, result: `[执行失败] ${(e && e.message) || e}`, index: i };
        }
      }));

      workerResults.forEach((r) => {
        placeholder.appendChild(
          App.blocks.buildStageBox(r.index + 2, `专家 ${r.name} 处理`, `【任务】\n${r.task}\n\n【结果】\n${r.result}`, false, App.avatars.providerById(r.workerId).avatar),
        );
      });
      App.messages.scrollToBottom();

      const summaryInput = workerResults.map((r) => `【${r.name} 的输出】\n${r.result}`).join('\n\n');
      const summaryMessages = [
        {
          role: 'system',
          content: `你是总指挥 AI。下面是各位专家完成子任务后的输出，请综合成一份给用户的最终答案。

要求：
- 直接给出完整、连贯、可执行的答案，就当是你一个人做完的。
- 不要出现「专家A」「某位同事」这类说法，也不要复述分工过程。
- 专家结论互相矛盾时，你自己判断并说明依据；都不靠谱就直接说不确定。
- 保留有用的细节（数据、步骤、代码、表格），删掉重复和客套话。
- 用户要文件的话，照常使用 [[SAVE:文件名.扩展名]] 标记输出。`,
        },
        { role: 'user', content: `用户原始任务：\n${userContent}\n\n各位专家的输出：\n${summaryInput}` },
      ];
      App.genStatus.setPhase('正在汇总结果');
      const finalRes = await App.ai.callOnceWithRetry(leader, summaryMessages, callOpts());
      if (finalRes.aborted) throw App.bridge.abortError();
      const finalReply = finalRes.content;
      accumulate(finalRes.usage, summaryMessages.map((m) => m.content).join('\n'), finalReply);

      offChunk();
      placeholder.remove();

      const { files, cleanText } = App.saveMarkers.parse(finalReply);
      const saveOff = files.length > 0 && s.prefs.autoSaveFiles === false;
      const savedResults = (files.length > 0 && !saveOff) ? await saveFilesSafely(files) : [];

      const usage = Object.assign({}, usageAcc, { exact: allExact });
      const aiMsg = {
        role: 'assistant',
        content: finalReply,
        timestamp: Date.now(),
        aiName: `多AI（统领：${leaderProvider.name}）`,
        providerId: leader,
        usage,
        multiStages: { plan, leader, workers: workerResults },
      };
      if (savedResults.length > 0) aiMsg.savedFiles = savedResults;
      if (multiPlanSteps && multiPlanSteps.length) aiMsg.plan = multiPlanSteps.slice();
      const multiShownSteps = s.agentMode ? multiLiveSteps : multiToolSteps;
      if (multiShownSteps.length) {
        aiMsg.tools = multiShownSteps.slice();
        if (s.agentMode) aiMsg.agent = true;
      }
      session.messages.push(aiMsg);
      session.updatedAt = Date.now();
      App.tokens.addSessionUsage(session, usage);
      App.sessions.saveSessions();
      App.tokens.updateTokenChip();

      const msgDiv = App.messages.appendMessage('ai', cleanText, [], aiMsg.timestamp, App.avatars.aiMeta(leader, aiMsg.aiName), false, finalReply, usage, aiMsg);
      msgDiv.prepend(App.blocks.buildMultiDetailBox(aiMsg.multiStages));
      if (multiPlanSteps && multiPlanSteps.length) App.blocks.upsertPlanCard(msgDiv, multiPlanSteps);
      if (multiShownSteps.length) msgDiv.appendChild(App.blocks.buildToolSteps(multiShownSteps, s.agentMode));
      if (savedResults.length > 0) msgDiv.appendChild(App.blocks.buildSavedFilesCard(savedResults));
      if (saveOff) msgDiv.appendChild(App.blocks.buildFilesOffCard(files));

      if (session.messages.filter((m) => m.role !== 'system').length <= 2) {
        App.sessions.autoGenerateTitle(session, userContent);
      }
      App.messages.scrollToBottom();
    } catch (e) {
      offChunk();
      placeholder.remove();
      // 多 AI 被手动停止：把规划 / 专家结果留下来，别让整轮白跑
      if (App.bridge.isAbort(e) && (plan || workerResults.length)) {
        const stoppedUsage = Object.assign({}, usageAcc, { exact: allExact });
        const stoppedMsg = {
          role: 'assistant',
          content: workerResults.length
            ? workerResults.map((r) => `【${r.name}】\n${r.result}`).join('\n\n')
            : plan,
          timestamp: Date.now(),
          aiName: `多AI（统领：${leaderProvider.name}）`,
          providerId: leader,
          usage: stoppedUsage,
          stopped: true,
          multiStages: { plan, leader, workers: workerResults },
        };
        session.messages.push(stoppedMsg);
        session.updatedAt = Date.now();
        App.tokens.addSessionUsage(session, stoppedUsage);
        App.sessions.saveSessions();
        App.tokens.updateTokenChip();
        const box = App.messages.appendMessage('ai', '', [], stoppedMsg.timestamp, App.avatars.aiMeta(leader, stoppedMsg.aiName), false, stoppedMsg.content, stoppedUsage, stoppedMsg);
        box.prepend(App.blocks.buildMultiDetailBox(stoppedMsg.multiStages));
        box.appendChild(App.blocks.buildStoppedTag(true));
      }
      throw e;
    }
  }

  /* ==================================================================
   * 发送外壳
   * ================================================================== */
  async function sendMessageInternal(fullContent, displayText, attachmentsSnapshot, storedContent) {
    const s = App.state;
    const session = App.sessions.getActive();
    if (!session) return;

    if (!anyConfigured()) {
      App.utils.toast('还没有配置任何 AI 密钥', 'error');
      App.settings.openView();
      return;
    }

    // 先建好消息对象再渲染：编辑/删除按钮要拿着它去定位 session 里的位置
    const userMsg = {
      role: 'user',
      content: storedContent || fullContent,
      displayText,
      attachments: attachmentsSnapshot,
      timestamp: Date.now(),
    };

    App.messages.appendMessage('user', displayText, attachmentsSnapshot, Date.now(), null, false, null, null, userMsg);
    App.messages.scrollToBottom(true);

    s.loadingDiv = App.messages.appendMessage('ai', s.currentMode === 'multi' ? '正在启动多 AI 协作…' : '正在思考…', [], Date.now());
    App.messages.scrollToBottom(true);

    session.messages.push(userMsg);
    session.updatedAt = Date.now();
    App.sessions.saveSessions();

    const startTime = Date.now();
    s.isGenerating = true;
    setSendButtonStopMode(true);
    App.avatars.setChibi(true);            // 思考过程中保持 Q 萌形态
    App.genStatus.show(s.currentMode === 'multi' ? '多 AI 协作中' : '正在思考');

    let failed = false;
    let aborted = false;
    try {
      if (s.currentMode === 'multi') await sendMultiAI(session, fullContent, startTime);
      else await sendSingleAI(session, fullContent, startTime);
    } catch (e) {
      aborted = App.bridge.isAbort(e);
      failed = !aborted;
      if (failed) s.petLastErrorAt = Date.now();
      removeLoading();
      // 用户自己按的停止，不算出错，不弹红色错误框
      if (!aborted) {
        const errDiv = App.messages.appendMessage('ai', '', [], Date.now());
        errDiv.appendChild(App.blocks.buildErrorBox((e && e.message) || '出错了'));
      }
    } finally {
      removeLoading();
      s.isGenerating = false;
      setSendButtonStopMode(false);
      s.currentReqId = null;
      // 停止是用户自己按的，单独给个状态，别和「出错」混在一起
      if (aborted) App.genStatus.stopped();
      else App.genStatus.hide();
      if (aborted || failed) App.avatars.setChibi(false);
      else App.avatars.setChibi(true, App.avatars.CHIBI_HOLD_MS);   // 回答完成：Q 萌形态亮相一会儿再切回正常版
      App.sessions.updateContextMeter();
      App.messages.scrollToBottom();
      if (s.petOpen) App.pet.buildBubble();       // 宠物的话要跟着状态变
    }
  }

  async function sendMessage(customText = null) {
    const s = App.state;
    if (s.isGenerating) {
      stopGeneration();
      return;
    }

    const text = customText !== null ? customText : App.dom.userInput.value.trim();
    const hasAttachments = s.pendingAttachments.length > 0;
    if (!text && !hasAttachments) return;

    let session = App.sessions.getActive();
    if (!session) session = App.sessions.createSession();

    let fullContent = text || '';
    let storedContent = text || '';
    if (hasAttachments) {
      const blocks = s.pendingAttachments.map((att) => `【附件：${att.name}】\n\`\`\`\n${att.content}\n\`\`\``);
      const storedBlocks = s.pendingAttachments.map((att) => `【附件：${att.name}】\n\`\`\`\n${App.prompts.clipForStore(att.content)}\n\`\`\``);
      storedContent += (storedContent ? '\n\n' : '') + storedBlocks.join('\n\n');
      fullContent += (fullContent ? '\n\n' : '') + blocks.join('\n\n');
    }

    const displayText = text || (hasAttachments ? `（发来 ${s.pendingAttachments.length} 个文件）` : '');
    const attachmentsSnapshot = s.pendingAttachments.map((a) => ({ name: a.name }));

    if (customText === null) {
      App.dom.userInput.value = '';
      App.dom.userInput.style.height = 'auto';
    }
    s.pendingAttachments = [];
    App.attachments.render();

    const realCount = session.messages.filter((m) => m.role !== 'system').length;
    if (realCount === 0) {
      session.title = App.sessions.localTitle(displayText);
      App.sessions.renderChatList();
      App.dom.welcomeScreen.classList.add('hidden');
    }

    await sendMessageInternal(fullContent, displayText, attachmentsSnapshot, storedContent);
  }

  /* ==================================================================
   * 另存为 / 重新生成 / 编辑 / 删除
   * ================================================================== */
  async function saveReplyAsFile(content) {
    const text = content || '';
    const firstLine = text.split('\n')[0].trim().slice(0, 20).replace(/[\\/:*?"<>|]/g, '');
    const result = await App.bridge.api.files.save({ defaultName: (firstLine || 'ai回复') + '.md', content: text });
    if (result.success) App.utils.toast(`已保存到：${result.path}`, 'success', 3600);
    else if (result.error) App.utils.toast(`保存失败：${result.error}`, 'error');
  }

  async function regenerateFrom(aiMsgDiv) {
    if (App.state.isGenerating) {
      App.utils.toast('正在生成中，请先停止', 'info');
      return;
    }
    const session = App.sessions.getActive();
    if (!session) return;

    const raw = aiMsgDiv.dataset.rawContent;
    const aiIdx = session.messages.findIndex((m) => m.role === 'assistant' && m.content === raw);
    if (aiIdx === -1) return;

    // 往前找最近一条用户消息，从那里截断重来
    let userIdx = -1;
    for (let i = aiIdx - 1; i >= 0; i -= 1) {
      if (session.messages[i].role === 'user') { userIdx = i; break; }
    }
    if (userIdx === -1) return;

    const userMsg = session.messages[userIdx];
    session.messages.splice(userIdx);
    App.sessions.saveSessions();
    App.messages.renderMessages();

    await sendMessageInternal(userMsg.content, userMsg.displayText, userMsg.attachments || []);
  }

  function startEditUserMessage(msgDiv, msg) {
    const session = App.sessions.getActive();
    if (!session) return;
    const idx = session.messages.indexOf(msg);
    if (idx < 0) return;

    const bubble = msgDiv.querySelector('.bubble');
    if (!bubble || bubble.dataset.editing === '1') return;
    bubble.dataset.editing = '1';

    const ta = global.document.createElement('textarea');
    ta.className = 'msg-edit-input';
    ta.value = msg.displayText || msg.content || '';
    ta.rows = 2;
    bubble.textContent = '';
    bubble.appendChild(ta);

    const bar = global.document.createElement('div');
    bar.className = 'msg-edit-bar';
    const cancel = global.document.createElement('button');
    cancel.className = 'msg-action';
    cancel.type = 'button';
    cancel.textContent = '取消';
    const save = global.document.createElement('button');
    save.className = 'msg-action primary';
    save.type = 'button';
    save.textContent = '保存并重发';
    bar.append(cancel, save);
    msgDiv.appendChild(bar);

    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    App.utils.autoGrowEl(ta);

    const finish = (commit) => {
      delete bubble.dataset.editing;
      bar.remove();
      if (!commit) { App.messages.renderMessages(); return; }
      const next = ta.value.trim();
      if (!next) { App.utils.toast('内容不能为空', 'info'); App.messages.renderMessages(); return; }
      session.messages.splice(idx);   // 从这一条起重新来
      App.messages.renderMessages();
      sendMessageInternal(next, next, msg.attachments || []);
    };
    cancel.addEventListener('click', () => finish(false));
    save.addEventListener('click', () => finish(true));
    ta.addEventListener('input', () => App.utils.autoGrowEl(ta));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
  }

  function deleteMessage(msg) {
    const session = App.sessions.getActive();
    if (!session) return;
    const idx = session.messages.indexOf(msg);
    if (idx < 0) return;
    session.messages.splice(idx, 1);
    App.sessions.saveSessions();
    App.messages.renderMessages();
    App.sessions.updateContextMeter();
  }

  function copyLastReply() {
    const session = App.sessions.getActive();
    if (!session) return;
    for (let i = session.messages.length - 1; i >= 0; i -= 1) {
      if (session.messages[i].role === 'assistant') {
        const content = session.messages[i].content || '';
        global.navigator.clipboard.writeText(content).then(
          () => App.utils.toast('已复制最后一条回答', 'success', 1600),
          () => App.utils.toast('复制失败', 'error'),
        );
        return;
      }
    }
    App.utils.toast('这个会话还没有回答', 'info');
  }

  App.chat = {
    configuredProviders,
    anyConfigured,
    currentSingleProvider,
    setMode,
    stopGeneration,
    sendMessage,
    sendMessageInternal,
    sendSingleAI,
    sendMultiAI,
    saveReplyAsFile,
    regenerateFrom,
    startEditUserMessage,
    deleteMessage,
    copyLastReply,
    setSendButtonStopMode,
    removeLoading,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

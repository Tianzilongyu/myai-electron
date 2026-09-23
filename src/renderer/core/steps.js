;(function (global) {
  'use strict';

  /**
   * 工具步骤的两种记法
   *
   * 普通模式要「去重」——同一个工具连发几条事件只留一条，界面不堆叠；
   * 研发模式要「如实」——它到底干了多少活得看得见，所以按调用顺序 append。
   */
  const App = (global.App = global.App || {});

  /** 同一步只保留最新状态，running 会被 done 覆盖 */
  function mergeToolStep(steps, chunk) {
    const idx = steps.findIndex((s) => s.name === chunk.name && s.status === 'running');
    if (idx !== -1) {
      steps[idx] = { name: chunk.name, status: chunk.status, summary: chunk.summary };
      return;
    }
    steps.push({ name: chunk.name, status: chunk.status, summary: chunk.summary });
  }

  /** 同一个工具的 running→done 合成一行，不同调用各占一行 */
  function pushLiveStep(list, chunk) {
    const last = list[list.length - 1];
    if (last && last.status === 'running' && last.name === chunk.name) {
      last.status = chunk.status;
      if (chunk.summary) last.summary = chunk.summary;
      return;
    }
    list.push({ name: chunk.name || '', status: chunk.status, summary: chunk.summary || '' });
  }

  function statusLabel(status) {
    return status === 'running' ? '进行中'
      : status === 'denied' ? '已拒绝'
        : status === 'error' ? '失败' : '完成';
  }

  App.steps = { mergeToolStep, pushLiveStep, statusLabel };
})(typeof globalThis !== 'undefined' ? globalThis : this);

;(function (global) {
  'use strict';

  /**
   * 虚拟形象
   *
   * 每个角色有两套形态：
   *   normal —— 正常版（腰部以上半身立绘），默认展示
   *   chibi  —— Q 萌版（二头身），思考中与回答完成时短暂切换，做「活起来」的反馈
   * 素材缺失时按 buildAvatar 的兜底逻辑退回 emoji。
   */
  const App = (global.App = global.App || {});

  const CHIBI_HOLD_MS = 2600;   // 回答完成后萌版停留时长

  function providerById(id) {
    return App.state.providers.find((p) => p.id === id) || null;
  }

  function avatarImageSrc(providerId, variant) {
    if (!providerById(providerId)) return null;
    if (!App.constants.AVATAR_ART.has(providerId)) return null;   // 没有素材就交给 emoji 兜底
    const v = variant || (App.state.chibiActive ? 'chibi' : 'normal');
    return v === 'chibi'
      ? `assets/avatars/${providerId}-chibi.png`
      : `assets/avatars/${providerId}.png`;
  }

  /* 桌面宠物一定要有张图，没有自家立绘时退回吉祥物 */
  function petArtSrc(providerId) {
    return avatarImageSrc(providerId) || 'assets/avatars/mascot.png';
  }

  /* 生成一个形象节点：有素材用图（加载失败自动退回 emoji），没有直接用 emoji */
  function avatarNode(providerId) {
    const p = providerById(providerId);
    const src = avatarImageSrc(providerId);
    if (!src) {
      const span = global.document.createElement('span');
      span.textContent = (p && p.avatar) || '🤖';
      return span;
    }
    const img = global.document.createElement('img');
    img.src = src;
    img.alt = '';
    img.draggable = false;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      const span = global.document.createElement('span');
      span.textContent = (p && p.avatar) || '🤖';
      if (img.parentNode) img.parentNode.replaceChild(span, img);
    });
    return img;
  }

  /** 把页面上所有已渲染的 AI 形象切到当前形态，带一个弹跳动效 */
  function refreshAvatars() {
    const suffix = App.state.chibiActive ? '-chibi' : '';
    const imgs = global.document.querySelectorAll('img[src*="/avatars/"]');
    imgs.forEach((img) => {
      if (!/(?:-chibi)?\.png$/.test(img.src)) return;
      const next = img.src.replace(/(?:-chibi)?\.png$/, suffix + '.png');
      if (next === img.src) return;
      img.src = next;
      img.classList.remove('pop');
      img.classList.add('pop');
    });
    // 强制重排一次（而不是每张图各来一次），让 pop 动画能重新触发
    if (imgs.length) void global.document.body.offsetWidth;
    if (App.providerUI && typeof App.providerUI.renderSidebarUser === 'function') {
      App.providerUI.renderSidebarUser();
    }
  }

  /** 切换全体形象的形态。holdMs 给了就自动切回，不给就一直保持 */
  function setChibi(on, holdMs) {
    const s = App.state;
    if (s.chibiTimer) { global.clearTimeout(s.chibiTimer); s.chibiTimer = null; }
    if (on !== s.chibiActive) {
      s.chibiActive = on;
      refreshAvatars();
    }
    if (on && holdMs) s.chibiTimer = global.setTimeout(() => setChibi(false), holdMs);
  }

  function buildAvatar(meta, extraClass = '') {
    const el = global.document.createElement('span');
    el.className = 'ai-avatar ' + extraClass;
    if (meta.img) {
      const img = global.document.createElement('img');
      img.src = meta.img;
      img.alt = '';
      img.draggable = false;
      img.loading = 'lazy';
      img.decoding = 'async';
      // 素材缺失（比如新厂商还没画）时退回 emoji，别留个碎图
      img.addEventListener('error', () => {
        el.classList.remove('has-img');
        el.style.backgroundColor = meta.color || '#4d6bfe';
        el.textContent = meta.avatar || '🤖';
        if (img.parentNode) img.parentNode.removeChild(img);
      });
      el.classList.add('has-img');
      el.appendChild(img);
    } else {
      el.style.backgroundColor = meta.color || '#4d6bfe';
      el.textContent = meta.avatar || '🤖';
    }
    return el;
  }

  function aiMeta(providerId, nameOverride) {
    const p = providerById(providerId);
    return {
      name: nameOverride || (p ? p.name : 'AI'),
      avatar: p ? p.avatar : '🤖',
      color: p ? p.color : '#4d6bfe',
      img: avatarImageSrc(providerId),
    };
  }

  App.avatars = {
    CHIBI_HOLD_MS,
    providerById,
    avatarImageSrc,
    petArtSrc,
    avatarNode,
    refreshAvatars,
    setChibi,
    buildAvatar,
    aiMeta,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

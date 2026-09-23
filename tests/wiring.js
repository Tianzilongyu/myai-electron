'use strict';

/**
 * 接线检查（静态）
 *
 * 这类问题编译期发现不了、运行时才炸，所以单独拎出来扫一遍：
 *   1. 渲染层引用的 DOM id 在 index.html 里必须真实存在
 *   2. 渲染层调用的 api.xxx.yyy 必须在 preload 暴露的面上
 *   3. preload 里 invoke 的通道必须有人在主进程 handle（反之给出提示）
 *   4. index.html 引用的脚本文件必须都在磁盘上
 *   5. 渲染层之间互相调用的 App.X.Y 必须在 App 上真的存在（跨模块改名最容易漏）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

function matchAll(re, text) {
  const out = [];
  let m;
  const r = new RegExp(re.source, re.flags);
  while ((m = r.exec(text)) !== null) out.push(m);
  return out;
}

/** 把 preload.js 跑起来（stub 掉 electron），拿到它真实暴露的 api 面 */
function loadPreloadSurface() {
  const src = read(path.join(ROOT, 'preload.js'));
  let captured = null;
  const fakeRequire = (name) => {
    if (name === 'electron') {
      return {
        contextBridge: { exposeInMainWorld: (n, obj) => { captured = obj; } },
        ipcRenderer: { invoke: () => Promise.resolve({}), on: () => {}, removeListener: () => {}, sendSync: () => ({}), send: () => {} },
        webUtils: { getPathForFile: () => '' },
      };
    }
    throw new Error('preload 依赖了预期外的模块：' + name);
  };
  new Function('require', src)(fakeRequire);
  return captured;
}

function functionKeys(obj) {
  const out = {};
  Object.keys(obj || {}).forEach((k) => {
    const v = obj[k];
    if (typeof v === 'function') out[k] = true;
    else if (v && typeof v === 'object') out[k] = Object.keys(v).filter((kk) => typeof v[kk] === 'function');
  });
  return out;
}

module.exports = function run(t, App) {
  const html = read(HTML);
  const rendererFiles = walk(path.join(ROOT, 'src/renderer'));
  const mainFiles = walk(path.join(ROOT, 'src/main'));
  const allRenderer = rendererFiles.map(read).join('\n');
  const allMain = mainFiles.map(read).join('\n');
  const preloadSrc = read(path.join(ROOT, 'preload.js'));

  /* ---------- 1. DOM id ---------- */
  t.group('DOM 接线');
  const htmlIds = new Set(matchAll(/id="([^"]+)"/g, html).map((m) => m[1]));
  const referenced = new Set();
  matchAll(/\bbyId\('([^']+)'\)/g, allRenderer).forEach((m) => referenced.add(m[1]));
  matchAll(/getElementById\('([^']+)'\)/g, allRenderer).forEach((m) => referenced.add(m[1]));
  const missing = [...referenced].filter((id) => !htmlIds.has(id));
  t.eq('渲染层引用的 id 全部存在', missing.length, 0, missing.length ? `缺失：${missing.join(', ')}` : '');

  /* ---------- 2. api 面 ---------- */
  t.group('API 接线');
  const surface = functionKeys(loadPreloadSurface());
  t.ok('preload 暴露了 api', Object.keys(surface).length >= 6);
  const used = new Set();
  matchAll(/App\.bridge\.api\.(\w+)\.(\w+)/g, allRenderer).forEach((m) => used.add(`${m[1]}.${m[2]}`));
  const badApi = [...used].filter((key) => {
    const [ns, fn] = key.split('.');
    const v = surface[ns];
    if (!v) return true;
    if (v === true) return false;
    return Array.isArray(v) ? !v.includes(fn) : true;
  });
  t.eq('渲染层调用的 api 方法都存在', badApi.length, 0, badApi.length ? `不存在：${badApi.join(', ')}` : '');

  /* ---------- 3. IPC 通道 ---------- */
  t.group('IPC 接线');
  const handled = new Set(matchAll(/ipcMain\.handle\('([^']+)'/g, allMain).map((m) => m[1]));
  const onChannels = new Set(matchAll(/ipcMain\.on\('([^']+)'/g, allMain).map((m) => m[1]));
  const invoked = new Set(matchAll(/ipcRenderer\.invoke\('([^']+)'/g, preloadSrc).map((m) => m[1]));
  const sent = new Set(matchAll(/ipcRenderer\.sendSync\('([^']+)'/g, preloadSrc).map((m) => m[1]));

  const noHandler = [...invoked].filter((c) => !handled.has(c));
  t.eq('preload 调用的通道都有 handler', noHandler.length, 0, noHandler.length ? `没人处理：${noHandler.join(', ')}` : '');
  const noSender = [...sent].filter((c) => !onChannels.has(c));
  t.eq('同步通道都有 ipcMain.on', noSender.length, 0, noSender.length ? `没人处理：${noSender.join(', ')}` : '');
  const unused = [...handled].filter((c) => !invoked.has(c));
  t.info('未被渲染层使用的通道（仅提示）', unused.length ? unused.join(', ') : '无');

  /* ---------- 4. 脚本引用 ---------- */
  t.group('资源引用');
  const srcs = matchAll(/<script src="([^"]+)"/g, html).map((m) => m[1]);
  const missingFiles = srcs.filter((s) => !fs.existsSync(path.join(ROOT, s)));
  t.eq('index.html 引用的脚本都存在', missingFiles.length, 0, missingFiles.length ? `缺失：${missingFiles.join(', ')}` : '');
  t.ok('脚本数量合理', srcs.length >= 20, `共 ${srcs.length} 个`);
  const cssHref = (html.match(/href="([^"]+\.css)"/) || [])[1];
  t.ok('样式表存在', cssHref && fs.existsSync(path.join(ROOT, cssHref)));

  /* ---------- 5. 跨模块 App.X.Y ---------- */
  if (App) {
    t.group('跨模块调用');
    const refs = new Set();
    matchAll(/\bApp\.(\w+)\.(\w+)/g, allRenderer).forEach((m) => refs.add(`${m[1]}.${m[2]}`));
    const broken = [...refs].filter((key) => {
      const [ns, fn] = key.split('.');
      const mod = App[ns];
      return !mod || !(fn in mod);
    });
    t.eq('模块间互调的名字都对得上', broken.length, 0, broken.length ? `对不上：${broken.join(', ')}` : '');
  }

  /* ---------- 6. 安全卫生 ---------- */
  t.group('安全卫生');
  t.eq('渲染层不出现 require(', matchAll(/\brequire\(/g, allRenderer).length, 0);
  t.eq('渲染层不出现硬编码密钥字段', matchAll(/\bapi[_-]?key\s*[:=]\s*['"][^'"]{8,}/gi, allRenderer).length, 0);
  t.ok('主进程用 safeStorage 存密钥', /safeStorage/.test(allMain));
  t.ok('窗口关闭了 nodeIntegration', /nodeIntegration:\s*false/.test(allMain));
  t.ok('窗口打开了 contextIsolation', /contextIsolation:\s*true/.test(allMain));
};

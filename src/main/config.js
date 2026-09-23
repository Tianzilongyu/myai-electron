'use strict';

/**
 * 配置与密钥的落盘存储
 *
 * 两条硬规矩：
 *   1. 写盘一律走「临时文件 + rename」的原子替换，写到一半崩了也不会留下半个 config.json。
 *   2. 密钥一律用系统级加密（Windows DPAPI / macOS Keychain）保存；
 *      系统不支持时才退回 base64，并且明确标记 enc:false，界面上会如实说明。
 *
 * 依赖全部通过工厂参数注入（dataDir / safeStorage），这样单测里可以直接塞临时目录和假的加密器。
 */
const path = require('path');
const fs = require('fs');

const CONFIG_VERSION = 1;

function defaultPrefs() {
  return {
    singleProvider: 'deepseek',
    modelOverrides: {},
    contextRounds: 6,
    thinkMode: false,
    skills: [],
    multi: { leader: 'deepseek', workers: ['zhipu'] },
    saveDir: '',
    sidebarCollapsed: true,
    tools: { enabled: false, allowCommand: false, searchProvider: 'ddg' },
    /* 对话参数：留空 / 为默认值时不发给模型，交给各家自己的默认行为 */
    temperature: 0.7,          // 0 ~ 2
    maxTokens: 0,              // 0 = 不限制，由模型决定
    requestChars: 60000,       // 单次请求携带的正文上限
    systemPrompt: '',          // 追加在内置提示词之后的自定义要求
    autoTitle: true,           // 用 AI 给会话起标题
    autoSaveFiles: true,       // 模型产出 [[SAVE:]] 时自动存盘
    /* 外观与快捷键（v2.0） */
    theme: 'system',           // 主题：system / light / dark
    shortcuts: {},             // 自定义快捷键：{ actionId: 'mod+k' }
    /* 自定义提示词库（v2.1）：{ id, title, content } */
    prompts: [],
    /* MCP 服务器（v2.3）：{ id, name, transport, command, args, cwd, url } */
    mcpServers: [],
    /* 研发模式：默认关，工作目录默认空，自动批准默认关 —— 三个都得用户自己开 */
    agentMode: false,
    agentWorkDir: '',
    agentAutoApprove: false,
  };
}

function defaultConfig() {
  return { version: CONFIG_VERSION, keys: {}, toolKeys: {}, prefs: defaultPrefs() };
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** 只对「同名的普通对象」做浅合并，其余一律用默认值顶掉，防止脏数据把 prefs 结构搅坏 */
function mergeKnown(target, defaults, loaded) {
  const out = Object.assign({}, defaults);
  if (!isPlainObject(loaded)) return out;
  Object.keys(defaults).forEach((k) => {
    const v = loaded[k];
    if (v === undefined) return;
    if (isPlainObject(defaults[k])) out[k] = isPlainObject(v) ? Object.assign({}, defaults[k], v) : defaults[k];
    else out[k] = v;
  });
  // 用户自己加的键（例如 petPos）也要留住
  Object.keys(loaded).forEach((k) => {
    if (!(k in out)) out[k] = loaded[k];
  });
  return out;
}

function createConfigStore({ dataDir, safeStorage }) {
  let cache = null;

  const storage = safeStorage || {
    isEncryptionAvailable: () => false,
    encryptString: (s) => Buffer.from(String(s), 'utf8'),
    decryptString: (b) => b.toString('utf8'),
  };

  function dataFile(name) {
    return path.join(dataDir, name);
  }

  function readJson(file, fallback) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return isPlainObject(parsed) ? parsed : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJsonAtomic(file, data) {
    const tmp = `${file}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, file);
  }

  function load() {
    if (cache) return cache;
    const loaded = readJson(dataFile('config.json'), null);
    const base = defaultConfig();
    if (!loaded) {
      cache = base;
      return cache;
    }
    cache = {
      version: CONFIG_VERSION,
      keys: isPlainObject(loaded.keys) ? loaded.keys : {},
      // 这里原来漏了 toolKeys，导致搜索服务的 key 重启就没了
      toolKeys: isPlainObject(loaded.toolKeys) ? loaded.toolKeys : {},
      prefs: mergeKnown(base.prefs, base.prefs, loaded.prefs),
    };
    return cache;
  }

  function save() {
    writeJsonAtomic(dataFile('config.json'), load());
  }

  function encryptSecret(plain) {
    if (storage.isEncryptionAvailable()) {
      return { enc: true, value: storage.encryptString(String(plain)).toString('base64') };
    }
    return { enc: false, value: Buffer.from(String(plain), 'utf8').toString('base64') };
  }

  function decryptSecret(entry) {
    if (!entry || typeof entry.value !== 'string') return '';
    const buf = Buffer.from(entry.value, 'base64');
    if (entry.enc) {
      if (!storage.isEncryptionAvailable()) {
        throw new Error('当前系统不支持安全解密，请重新填写密钥');
      }
      return storage.decryptString(buf);
    }
    return buf.toString('utf8');
  }

  function getApiKey(providerId, providerName) {
    const entry = load().keys[providerId];
    if (!entry) return '';
    try {
      return decryptSecret(entry);
    } catch (e) {
      throw new Error(`${providerName || providerId} 的密钥无法解密，请在设置中重新填写`);
    }
  }

  function setApiKey(providerId, value) {
    load().keys[providerId] = encryptSecret(value);
    save();
  }

  function removeApiKey(providerId) {
    delete load().keys[providerId];
    save();
  }

  /* 工具自己的密钥（搜索服务等），和 AI 密钥一样加密存 */
  function setToolKey(name, value) {
    const cfg = load();
    if (!cfg.toolKeys) cfg.toolKeys = {};
    const v = String(value || '').trim();
    if (!v) delete cfg.toolKeys[name];
    else cfg.toolKeys[name] = encryptSecret(v);
    save();
  }

  function getToolKey(name) {
    const entry = load().toolKeys && load().toolKeys[name];
    if (!entry) return '';
    try {
      return decryptSecret(entry) || '';
    } catch (e) {
      return '';
    }
  }

  /* 密钥末尾几位，用来在界面上证明「这把 key 真的存住了」，不暴露完整密钥 */
  function keyTail(providerId) {
    const entry = load().keys[providerId];
    if (!entry) return '';
    try {
      const plain = decryptSecret(entry);
      return plain ? plain.slice(-4) : '';
    } catch (e) {
      return '✗';   // 存得住但解不开，界面据此提示重填
    }
  }

  function setPrefs(patch) {
    const cfg = load();
    if (isPlainObject(patch)) cfg.prefs = Object.assign(cfg.prefs, patch);
    save();
    return cfg.prefs;
  }

  function setToolsPrefs(patch) {
    const cfg = load();
    const base = { enabled: false, allowCommand: false, searchProvider: 'ddg' };
    cfg.prefs.tools = Object.assign(base, isPlainObject(cfg.prefs.tools) ? cfg.prefs.tools : {}, isPlainObject(patch) ? patch : {});
    save();
    return cfg.prefs.tools;
  }

  return {
    dataFile,
    readJson,
    writeJsonAtomic,
    get: load,
    save,
    getApiKey,
    setApiKey,
    removeApiKey,
    setToolKey,
    getToolKey,
    keyTail,
    setPrefs,
    setToolsPrefs,
    encryptionAvailable: () => storage.isEncryptionAvailable(),
  };
}

module.exports = { createConfigStore, defaultConfig, defaultPrefs, mergeKnown, isPlainObject, CONFIG_VERSION };

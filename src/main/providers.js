'use strict';

/**
 * 供应商注册表
 *
 * 这里只放公开信息（地址、模型名、余额接口），任何密钥都不落在这里。
 * 密钥一律经过 config.js 的 safeStorage 加密后单独存放。
 *
 * 每家的字段含义：
 *   baseURL          —— OpenAI 兼容端点，实际请求拼 /chat/completions
 *   model / models   —— 默认模型与预设候选
 *   balance          —— 官方公开的余额接口（没有就不给，宁缺毋错，不去猜内部地址）
 *   thinkingParam    —— 深度思考开关怎么传参（各家不统一）
 *   thinkingDropsTemperature —— 思考模式下不接受 temperature
 *   optionalKey      —— 本机服务（如 Ollama）无需密钥
 *   allowCustomModel —— 允许手填模型名
 *   streamUsage      —— false 表示不认 stream_options（本地端点常见）
 */
const PROVIDERS = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    avatar: '🐳',
    color: '#4d6bfe',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-chat', 'deepseek-reasoner'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyHint: 'sk- 开头的一串字符',
    // 官方余额接口：GET /user/balance -> { balance_infos: [{ currency, total_balance }] }
    balance: {
      url: 'https://api.deepseek.com/user/balance',
      parse: (j) => {
        const list = Array.isArray(j && j.balance_infos) ? j.balance_infos : [];
        if (!list.length) throw new Error('返回里没有余额字段');
        return list.map((i) => ({ currency: i.currency || 'CNY', amount: Number(i.total_balance) || 0 }));
      },
    },
    // 官方：thinking:{type:'enabled'} + reasoning_effort；思考模式下不接受 temperature
    thinkingParam: (on) => (on ? { thinking: { type: 'enabled' }, reasoning_effort: 'high' } : { thinking: { type: 'disabled' } }),
    thinkingSupported: true,
    thinkingDropsTemperature: true,
  },
  zhipu: {
    id: 'zhipu',
    name: '智谱 GLM',
    avatar: '🧠',
    color: '#0f766e',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-plus', 'glm-4.6'],
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    keyHint: '形如 xxxxxxxx.yyyyyyyyyyyy',
    thinkingParam: (on) => (on ? { thinking: { type: 'enabled' } } : { thinking: { type: 'disabled' } }),
    thinkingSupported: true,
  },
  aliyun: {
    id: 'aliyun',
    name: '阿里 通义',
    avatar: '☁️',
    color: '#f59e0b',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
    keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key',
    keyHint: 'sk- 开头的一串字符',
    thinkingParam: (on) => (on ? { enable_thinking: true } : { enable_thinking: false }),
    thinkingSupported: true,
  },
  moonshot: {
    id: 'moonshot',
    name: 'Kimi（月之暗面）',
    avatar: '🌙',
    color: '#1f2937',
    baseURL: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    keyHint: 'sk- 开头的一串字符',
    // 官方余额接口：GET /v1/users/me/balance -> { data: { available_balance, currency } }
    balance: {
      url: 'https://api.moonshot.cn/v1/users/me/balance',
      parse: (j) => {
        const d = j && j.data;
        if (!d) throw new Error('返回里没有余额字段');
        const amount = Number(d.available_balance != null ? d.available_balance : (d.balance != null ? d.balance : d.total_balance));
        if (!Number.isFinite(amount)) throw new Error('余额字段无法解析');
        return [{ currency: d.currency || 'CNY', amount }];
      },
    },
    thinkingParam: () => ({}),
    thinkingSupported: false,   // 仅 k2-thinking 一类模型自带思考，普通模型传参无效
  },
  doubao: {
    id: 'doubao',
    name: '豆包（火山方舟）',
    avatar: '🫘',
    color: '#2563eb',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-1-5-pro-32k-250115',
    models: ['doubao-1-5-pro-32k-250115', 'doubao-1-5-lite-32k-250115', 'doubao-pro-32k-241215'],
    keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    keyHint: '模型名要填方舟控制台里的「接入点 ID」',
    thinkingParam: (on) => (on ? { thinking: { type: 'enabled' } } : { thinking: { type: 'disabled' } }),
    thinkingSupported: true,
  },
  siliconflow: {
    id: 'siliconflow',
    name: '硅基流动',
    avatar: '🔬',
    color: '#7c3aed',
    baseURL: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    models: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3', 'THUDM/glm-4-9b-chat'],
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    keyHint: 'sk- 开头的一串字符',
    // 官方余额接口：GET /v1/user/info -> { data: { balance, total_balance, currency } }
    balance: {
      url: 'https://api.siliconflow.cn/v1/user/info',
      parse: (j) => {
        const d = j && j.data;
        if (!d) throw new Error('返回里没有余额字段');
        const raw = d.balance != null ? d.balance : (d.total_balance != null ? d.total_balance : d.available_balance);
        const amount = Number(raw);
        if (!Number.isFinite(amount)) throw new Error('余额字段无法解析');
        return [{ currency: d.currency || 'CNY', amount }];
      },
    },
    thinkingParam: () => ({}),
    thinkingSupported: false,   // 取决于具体模型（R1 类自带），不伪装统一开关
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    avatar: '🌀',
    color: '#10a37f',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1'],
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk- 开头的一串字符',
    // OpenAI 用 reasoning_effort，仅 o 系列 / gpt-5 一类模型生效
    thinkingParam: (on) => (on ? { reasoning_effort: 'high' } : {}),
    thinkingSupported: true,
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama（本机）',
    avatar: '🦙',
    color: '#374151',
    baseURL: 'http://localhost:11434/v1',
    model: 'qwen2.5',
    models: ['qwen2.5', 'llama3.2', 'deepseek-r1', 'gemma2'],
    keyUrl: 'https://ollama.com/download',
    keyHint: '本机模型无需密钥，留空即可（需先启动 Ollama）',
    optionalKey: true,     // 不需要密钥
    allowCustomModel: true,
    streamUsage: false,    // 本地端点不认 stream_options
    thinkingParam: () => ({}),
    thinkingSupported: false,   // 取决于本地模型
  },

  /* ---- 以下均为 OpenAI 兼容协议 ---- */
  hunyuan: {
    id: 'hunyuan',
    name: '腾讯混元',
    avatar: '🐧',
    color: '#0052d9',
    baseURL: 'https://api.hunyuan.cloud.tencent.com/v1',
    model: 'hunyuan-turbos-latest',
    models: ['hunyuan-turbos-latest', 'hunyuan-t1-latest', 'hunyuan-standard', 'hunyuan-turbo'],
    keyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
    keyHint: '在腾讯云控制台创建的 API Key',
    allowCustomModel: true,
    thinkingParam: () => ({}),
    thinkingSupported: false,
  },
  spark: {
    id: 'spark',
    name: '讯飞星火',
    avatar: '✨',
    color: '#e1251b',
    baseURL: 'https://spark-api-open.xf-yun.com/v1',
    model: 'lite',
    models: ['lite', 'generalv3.5', 'generalv4', '4.0Ultra'],
    keyUrl: 'https://console.xfyun.cn/services/bm4',
    keyHint: '控制台里的 APIPassword（填在这里即可，不用拼 AppID）',
    allowCustomModel: true,
    thinkingParam: () => ({}),
    thinkingSupported: false,
  },
  qianfan: {
    id: 'qianfan',
    name: '百度千帆',
    avatar: '🔎',
    color: '#2932e1',
    baseURL: 'https://qianfan.baidubce.com/v2',
    model: 'ernie-speed-128k',
    models: ['ernie-speed-128k', 'ernie-4.0-8k', 'deepseek-v3'],
    keyUrl: 'https://console.bce.baidu.com/qianfan/ais/console/apiKey',
    keyHint: '模型名以千帆控制台为准，可以直接手填',
    allowCustomModel: true,
    thinkingParam: () => ({}),
    thinkingSupported: false,
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    avatar: '💎',
    color: '#4285f4',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'AI Studio 生成的 API Key',
    allowCustomModel: true,
    thinkingParam: () => ({}),
    thinkingSupported: false,
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    avatar: '⚡',
    color: '#f55036',
    baseURL: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'],
    keyUrl: 'https://console.groq.com/keys',
    keyHint: 'gsk_ 开头的一串字符',
    allowCustomModel: true,
    thinkingParam: () => ({}),
    thinkingSupported: false,
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    avatar: '🔀',
    color: '#6366f1',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash-001', 'deepseek/deepseek-chat'],
    keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'sk-or- 开头；一家 key 通吃上百个模型，模型名可直接手填',
    allowCustomModel: true,
    thinkingParam: () => ({}),
    thinkingSupported: false,
  },
  xai: {
    id: 'xai',
    name: 'xAI Grok',
    avatar: '🚀',
    color: '#111827',
    baseURL: 'https://api.x.ai/v1',
    model: 'grok-3',
    models: ['grok-3', 'grok-3-mini', 'grok-2-1212'],
    keyUrl: 'https://console.x.ai/',
    keyHint: 'xai- 开头；模型名以控制台为准',
    allowCustomModel: true,
    thinkingParam: () => ({}),
    thinkingSupported: false,
  },
};

const PROVIDER_IDS = Object.keys(PROVIDERS);

function getProvider(id) {
  return PROVIDERS[id] || null;
}

module.exports = { PROVIDERS, PROVIDER_IDS, getProvider };

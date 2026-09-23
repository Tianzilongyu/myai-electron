'use strict';

/**
 * MCP（Model Context Protocol）客户端
 *
 * 把外部 MCP 服务器（stdio 命令行 / HTTP 端点）当成「技能连接器」接进来：
 *   - 连接后列出服务器暴露的工具
 *   - 工具以 mcp_<serverId>__<toolName> 命名，注入到 agent 的 function calling 里
 *   - 模型调用时路由到对应服务器，把返回文本回填给模型
 *
 * 服务器配置存在 prefs.mcpServers（[{ id, name, transport, command, args, cwd, url }]）。
 * 连接失败不影响其它服务器，也不影响应用本身，界面上会标注错误。
 */
const { Client } = require('@modelcontextprotocol/sdk/client');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const MCP_PREFIX = 'mcp_';
const CONNECT_TIMEOUT_MS = 15000;

function safePart(s) {
  return String(s || '').replace(/[^A-Za-z0-9_]/g, '_');
}

/** 工具名编码：mcp_<serverId>__<toolName> */
function toolNameFor(serverId, toolName) {
  return `${MCP_PREFIX}${safePart(serverId)}__${safePart(toolName)}`;
}

/** 从编码名里解出 { serverId, toolName }，不是 MCP 工具返回 null */
function parseToolName(name) {
  if (typeof name !== 'string' || !name.startsWith(MCP_PREFIX)) return null;
  const rest = name.slice(MCP_PREFIX.length);
  const idx = rest.indexOf('__');
  if (idx < 0) return null;
  return { serverId: rest.slice(0, idx), toolName: rest.slice(idx + 2) };
}

function isMcpTool(name) {
  return parseToolName(name) !== null;
}

/** MCP 工具的 inputSchema -> OpenAI function calling 的 tool 定义 */
function mcpToolToDef(server, tool) {
  const params = tool.inputSchema && typeof tool.inputSchema === 'object'
    ? tool.inputSchema
    : { type: 'object', properties: {} };
  const desc = tool.description ? tool.description.slice(0, 800) : `来自「${server.name || server.id}」的工具`;
  return {
    type: 'function',
    function: {
      name: toolNameFor(server.id, tool.name),
      description: `[${server.name || server.id}] ${desc}`,
      parameters: params,
    },
  };
}

/** callTool 返回的 content 数组 -> 纯文本 */
function contentToText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => c && c.type === 'text')
    .map((c) => c.text || '')
    .join('\n');
}

function createMcpClient({ config }) {
  const clients = new Map();   // serverId -> { server, client, tools, status, error }

  function servers() {
    const list = config.get().prefs.mcpServers;
    return Array.isArray(list) ? list : [];
  }

  async function connectServer(server) {
    const id = server.id;
    const old = clients.get(id);
    if (old) {
      try { await old.client.close(); } catch (e) { /* 忽略 */ }
      clients.delete(id);
    }

    const entry = { server, client: null, tools: [], status: 'connecting', error: '' };
    clients.set(id, entry);

    try {
      const client = new Client({ name: 'myai-electron', version: '1.0.0' });
      let transport;
      if (server.transport === 'http') {
        transport = new StreamableHTTPClientTransport(new URL(server.url));
      } else {
        transport = new StdioClientTransport({
          command: server.command,
          args: Array.isArray(server.args) ? server.args : [],
          cwd: server.cwd || undefined,
          env: server.env && typeof server.env === 'object' ? server.env : undefined,
          stderr: 'pipe',
        });
      }

      const timer = setTimeout(() => {
        if (entry.status === 'connecting') {
          entry.status = 'error';
          entry.error = `连接超时（${CONNECT_TIMEOUT_MS / 1000}s）`;
          try { client.close(); } catch (e) { /* 忽略 */ }
        }
      }, CONNECT_TIMEOUT_MS);

      await client.connect(transport);
      clearTimeout(timer);

      const { tools } = await client.listTools();
      entry.client = client;
      entry.tools = Array.isArray(tools) ? tools : [];
      entry.status = 'connected';
    } catch (e) {
      entry.status = 'error';
      entry.error = (e && e.message) || '连接失败';
      try { if (entry.client) await entry.client.close(); } catch (e2) { /* 忽略 */ }
    }
    return entry;
  }

  async function connectAll() {
    for (const s of servers()) {
      await connectServer(s);
    }
  }

  /** 所有已连接服务器暴露的工具，转成 function calling 定义 */
  function toolDefs() {
    const out = [];
    for (const [serverId, entry] of clients) {
      if (entry.status !== 'connected') continue;
      for (const t of entry.tools) {
        out.push(mcpToolToDef(entry.server, t));
      }
    }
    return out;
  }

  async function callTool(name, args) {
    const parsed = parseToolName(name);
    if (!parsed) throw new Error('不是 MCP 工具：' + name);
    const entry = clients.get(parsed.serverId);
    if (!entry || entry.status !== 'connected' || !entry.client) {
      throw new Error(`MCP 服务器「${parsed.serverId}」未连接`);
    }
    const result = await entry.client.callTool({ name: parsed.toolName, arguments: args || {} });
    if (result.isError) {
      throw new Error(contentToText(result.content) || 'MCP 工具返回错误');
    }
    return contentToText(result.content);
  }

  async function status() {
    return servers().map((s) => {
      const entry = clients.get(s.id);
      return {
        id: s.id,
        name: s.name || s.id,
        transport: s.transport || 'stdio',
        status: entry ? entry.status : 'idle',
        error: entry ? entry.error : '',
        tools: entry && entry.tools ? entry.tools.map((t) => t.name) : [],
      };
    });
  }

  async function shutdown() {
    for (const [, entry] of clients) {
      try { if (entry.client) await entry.client.close(); } catch (e) { /* 忽略 */ }
    }
    clients.clear();
  }

  return { connectAll, connectServer, toolDefs, callTool, status, shutdown, isMcpTool, servers };
}

module.exports = {
  createMcpClient,
  toolNameFor,
  parseToolName,
  isMcpTool,
  mcpToolToDef,
  contentToText,
  MCP_PREFIX,
};

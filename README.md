# 我的 AI 助手（MyAI Electron）

一个**多模型聚合**的桌面 AI 客户端，基于 Electron。一个窗口接入 **15 家大模型供应商**，支持单 AI 问答、多 AI 团队协作、研发模式、MCP 技能连接器与本地文件工具。密钥只存本机并加密，数据不出本地。

## ✨ 功能

- **15 家供应商**：DeepSeek / 智谱 GLM / 通义 / Kimi / 豆包 / 硅基流动 / OpenAI / Ollama（本机）/ 腾讯混元 / 讯飞星火 / 百度千帆 / Gemini / Groq / OpenRouter / xAI Grok
- **单 AI / 多 AI 协作**：统领规划 → 专家并行 → 汇总
- **研发模式**：让 AI 自己勘察目录 → 列计划 → 改代码 → 跑验证 → 汇报
- **MCP 技能连接器**：接入外部 MCP 服务器（stdio / HTTP），AI 直接调用外部工具
- **12 个内置技能**：办公 / 编程 / 写作 / 翻译 / 数据 / 学术 / 商业 / 教学 / 创意 / 面试 / 法律 / 健康
- **自定义提示词库**、**会话置顶**、**导出会话为 Markdown**
- **生成文件**：AI 可产出 docx / xlsx / pptx / pdf / md 并自动存盘
- **联网搜索 + 本地访问**：搜索、读文件、写文件、执行命令（危险操作弹窗确认）
- **深色主题**（跟随系统）、**自定义快捷键**、命令面板（Ctrl/⌘ + K）
- **安全**：密钥系统级加密（Windows DPAPI / macOS Keychain）、上下文隔离、CSP、危险命令黑名单

## 📦 环境要求

- Node.js 18+ 与 npm
- Windows / macOS / Linux

## 🚀 从源码运行

```bash
git clone https://github.com/Tianzilongyu/myai-electron.git
cd myai-electron
npm install
npm start
```

> Windows PowerShell 若提示「无法加载 npm.ps1」（执行策略限制），先执行：
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
> 或者直接用 `npm.cmd install` / `npm.cmd start`。

## 🔑 首次使用

1. 打开应用 → 左下角「⚙️ 设置与密钥」
2. 展开一家供应商，粘贴 API Key → 保存（加密存本机，下次打开自动带上）
3. 回到对话界面开始使用

## 🔌 使用 MCP 技能连接器

1. 设置 → 「🔌 MCP 服务器」→ 添加服务器
2. stdio 示例：命令 `npx`，参数 `-y @modelcontextprotocol/server-filesystem C:\Users\you\Documents`
3. 保存并连接，状态变绿后，打开「🧰 AI 能力」总开关
4. 直接对 AI 说「看看我的 Documents 里有哪些文件」，它就会调用 MCP 工具

HTTP 型服务器则选择 HTTP 传输，填端点地址（如 `http://localhost:3000/mcp`）。

## 🧪 测试与打包

```bash
npm test          # 自检（主进程单测 + 渲染层 jsdom 冒烟 + 静态接线检查）
npm run dist      # 打包（Windows: NSIS 安装包 + 免安装版）
```

## 🗂 项目结构

```
src/main/      主进程（AI 请求、密钥、工具执行、文件生成、MCP）
src/renderer/  渲染层（core / data / ui / features 四层）
preload.js     安全桥接层（contextBridge，渲染层拿不到 Node 与密钥）
tests/         自检（单元 + 冒烟 + 接线检查）
assets/avatars 厂商立绘素材
```

## 📄 更多

- 版本历史见 [CHANGES.md](CHANGES.md)
- License：ISC

> 密钥、会话、配置都只保存在本机（`userData` 目录），不会上传到任何服务器。

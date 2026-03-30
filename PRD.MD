
# Shark Code — 开发规划

> Local First、开源的 AI Coding Agent。
> 对标 Claude Code / OpenCode，但更简单、更可黑客、支持本地 LLM。

---

## 一句话定位

**Shark Code = 用户带自己的 API Key，在本地跑的 AI 编程 Agent，开源、无服务器依赖。**

---

## 第一性原理：造这个东西的最小核心是什么？

任何 coding agent 的核心循环只有一件事：

```
用户输入
    ↓
构造 Prompt + 可用 Tool 列表
    ↓
调用 LLM API
    ↓
LLM 返回 Tool Call
    ↓
宿主程序执行 Tool（真正改文件/运行命令）
    ↓
把结果返回 LLM
    ↓
循环，直到 LLM 说"完成了"
    ↓
持久化到本地
```

**其他的一切（TUI、插件、多 provider、Web UI）都是在这个核心上加的壳。**
先把这个循环跑通，才有资格谈其他。

---

## 和 OpenCode 的核心差异

| 维度 | OpenCode | Shark Code |
|---|---|---|
| 复杂度 | 19 packages，4486 文件 | 从 1 个文件开始 |
| UI | SolidJS TUI + 桌面端 | CLI first，TUI 后加 |
| Server | 必须有 local server | 可选，默认无 server |
| 本地 LLM | 支持但非重点 | Ollama 作为一等公民 |
| 定位 | 全能 coding agent | 简单、可黑客、易贡献 |
| 技术栈 | Bun + TS + Hono | Bun + TS（复用部分选型） |

**核心差异化方向（选一个打透）：**
1. **极简可黑客** — 代码量控制在 OpenCode 的 1/5，任何人能读懂
2. **DeepSeek 原生支持** — 用户带自己的 DeepSeek API Key 即可上手，成本极低
3. **Git 原生** — 自动 branch、commit message 生成、diff review

> ⚠️ **当前 MVP 聚焦**：Ollama 本地模型暂不考虑，先把 DeepSeek API 跑通，能用再说。

---

## 架构设计（Local First 版）

```
┌─────────────────────────────────────┐
│            CLI / TUI 层              │
│  sharkcode "fix auth.ts"            │
│  交互式对话 / 单次执行               │
└──────────────┬──────────────────────┘
               │ 直接调用（无 HTTP，Local First）
┌──────────────▼──────────────────────┐
│           Agent Core 层             │
│  Session 管理                       │
│  Tool Registry                      │
│  Permission 系统                    │
│  Context 压缩（Compaction）         │
│  Prompt 构造                        │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│           Provider 层               │
│  Vercel AI SDK（不重复造轮子）       │
│  DeepSeek（MVP 首选，便宜好用）      │
│  Anthropic / OpenAI（后续扩展）     │
│  OpenRouter（中转，可接更多模型）   │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│           存储层（Local First）      │
│  SQLite + Drizzle ORM               │
│  ~/.sharkcode/sessions.db           │
│  项目级 .sharkcode/ 配置目录        │
└─────────────────────────────────────┘
```

**关键决策：不做 Client/Server 分离（与 OpenCode 最大的架构差异）**
- OpenCode 用 HTTP + SSE，换来了多端接入能力，但增加了一层复杂度
- Shark Code v1 直接在进程内调用，省掉这层，更简单
- 想要远程/多端？v2 再加，不预先设计

---

## 最小可行闭环（v0.1 目标）

```bash
# 这一行能跑通，v0.1 就算完成
sharkcode "fix the null pointer bug in auth.ts"
```

这背后要做到：
1. 读取 `auth.ts` 内容
2. 构造 prompt 发给 LLM
3. LLM 返回 `edit_file` tool call
4. 提示用户确认（permission）
5. 写入修改
6. 输出结果

**这就是 MVP。其他都不做。**

---

## 开发路线图

### Phase 0 — 核心循环（目标：2 周内跑通）

> **唯一目标**：`sharkcode "帮我改这个 bug"` 能跑通，其他都不做。

- [ ] 项目初始化（Bun + TypeScript，单包先，别上 monorepo）
- [ ] **DeepSeek API 接入**（Vercel AI SDK + `@ai-sdk/openai` 兼容层，DeepSeek 兼容 OpenAI 协议）
- [ ] 配置读取（`~/.sharkcode/config.toml`，存 `DEEPSEEK_API_KEY` + 模型名）
- [ ] Tool 系统 v1（`read_file`, `write_file`, `edit_file`, `bash`，这 4 个够了）
- [ ] Permission 系统 v1（bash 执行前展示命令 + 用户输入 `y` 确认）
- [ ] Agent 核心循环（Tool call → 执行 → 结果返回 LLM → 循环直到完成）
- [ ] CLI 入口（`sharkcode "prompt"`，流式输出到终端）

**Phase 0 完成后：能用，但很粗糙。这时候可以公开 repo，招第一批贡献者。**

#### DeepSeek 接入方式（具体实现）

DeepSeek API 兼容 OpenAI 协议，用 Vercel AI SDK 只需这样：

```typescript
import { createOpenAI } from '@ai-sdk/openai'

const deepseek = createOpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY,
})

// 用 deepseek-chat 或 deepseek-reasoner
const model = deepseek('deepseek-chat')
```

**零成本接入，不需要单独写 SDK。**

---

### Phase 1 — 可用（目标：第 1 个月）

- [ ] Session 持久化（SQLite，存历史对话）
- [ ] 交互式对话模式（不只是单次执行）
- [ ] 更多 Tool（`glob`, `grep`, `ls`, `webfetch`）
- [ ] Anthropic / OpenAI 支持（多 provider 扩展）
- [ ] Context Compaction v1（简单的：超过 80% context window 就让 LLM 摘要）
- [ ] 项目级配置（`.sharkcode/` 目录，类似 `CLAUDE.md`）

---

### Phase 2 — 生态（目标：第 2-3 个月）

- [ ] TUI（用 Ink，比 OpenCode 的 SolidJS 方案简单 10 倍）
- [ ] Plugin 系统（自定义 Tool + Agent）
- [ ] MCP 协议支持（接入 MCP 生态）
- [ ] Git 深度集成（自动 branch、commit message 生成、diff review）
- [ ] Web UI（可选，Hono server + React，这时候才加 Client/Server 分离）
- [ ] 多 Agent（Plan Agent + Build Agent，参考 OpenCode 设计）

---

## 技术栈选型

| 层 | 选型 | 理由 |
|---|---|---|
| 运行时 | Bun | 快，原生 TS，与 OpenCode 同 |
| 语言 | TypeScript | 生态最好，与 AI SDK 无缝 |
| LLM 抽象 | Vercel AI SDK | 15+ provider，不自己造轮子 |
| 本地存储 | SQLite + Drizzle ORM | Local First 的最佳选择 |
| CLI 框架 | commander.js 或直接用 Bun | 够用 |
| TUI（Phase 2） | Ink（React for terminals） | 比 OpenCode 的方案简单得多 |
| HTTP（Phase 2） | Hono | 轻量，与 OpenCode 同 |
| 测试 | Bun test | 内置，零配置 |
| 包管理 | Bun workspace | monorepo 管理 |

---

## 真正的技术风险（不要忽视）

### 风险 1：Context Compaction 难做
**问题**：长对话会把 context window 撑爆，必须压缩历史
**现实**：压缩策略错了会让 agent 失忆，压缩时机错了会浪费 token
**方案**：Phase 1 先做最简单的：超过 80% context window 就让 LLM 摘要历史

### 风险 2：不同 LLM 的 System Prompt 差异大
**问题**：Anthropic / GPT-4 / Gemini / Ollama 对 prompt 的响应差异显著
**现实**：OpenCode 为每个 provider 维护独立的 `anthropic.txt`, `gemini.txt`
**方案**：先只优化 1-2 个模型，其他用通用 prompt，有用户反馈再分开

### 风险 3：Tool 执行的安全性
**问题**：LLM 可能请求执行危险 bash 命令
**方案**：所有 bash 执行必须先展示命令，用户输入 `y` 确认，不能跳过

### 风险 4：Windows 路径问题
**问题**：Claude Code 早期在 Windows 上一塌糊涂，路径分隔符是个坑
**方案**：从第一天用 `path.join()` 和 `path.resolve()`，禁止硬编码 `/`

### 风险 5：DeepSeek Tool Call 支持
**问题**：DeepSeek 兼容 OpenAI 协议，但 tool call 的细节实现偶尔有差异
**方案**：用 Vercel AI SDK 的 `@ai-sdk/openai` createOpenAI 覆盖 baseURL，它已经处理了大部分兼容性；发现问题就 fallback 到 prompt engineering 方式

---

## 第一个可以公开的版本应该长什么样

```
sharkcode/
├── packages/
│   ├── core/          # Agent 核心循环，Tool Registry，Session
│   └── cli/           # CLI 入口
├── package.json
├── bun.lockb
├── README.md          # 如何用，如何贡献
└── .sharkcode/        # 示例配置
```

**README 要能在 30 秒内让人跑起来：**
```bash
bun install -g sharkcode
export DEEPSEEK_API_KEY=sk-xxxxxx   # 去 platform.deepseek.com 拿，比 OpenAI 便宜 10x
sharkcode "explain this codebase"
```

---

## 关于"开源"的策略

**开源不等于有人贡献。要让人贡献，需要：**

1. **代码简单** — 任何人能在 30 分钟内读懂核心循环
2. **好的 issue 标记** — `good first issue` 标签，明确告诉新人从哪里下手
3. **CONTRIBUTING.md** — 怎么设置开发环境，怎么跑测试
4. **快速 review** — PR 超过 48 小时没回复，贡献者就走了
5. **明确 roadmap** — 让贡献者知道项目要去哪里

**最快获得第一批用户的方式**：
- 发 X/Twitter 线程，讲"我为什么造了一个比 OpenCode 简单的 coding agent"
- 发 Hacker News Show HN
- 找 OpenCode、Aider 的 issue，回答问题，顺带提 Shark Code

---

## 立刻可以开始的三件事

1. **今天**：`mkdir shark-code && bun init`，把 core loop 跑通（300 行以内）
2. **本周**：接入 DeepSeek（`@ai-sdk/openai` + 自定义 baseURL），实现 `read_file + write_file + bash` 三个 tool
3. **下周**：加 permission 系统，推到 GitHub，写 README

---

## 参考资料

- [[编程学习/opencode源码拆解]] — 已拆解的 OpenCode 架构，直接借鉴
- [Vercel AI SDK 文档](https://sdk.vercel.ai/docs) — provider 抽象层
- [Ink — React for CLIs](https://github.com/vadimdemedes/ink) — TUI 方案
- [Drizzle ORM](https://orm.drizzle.team/) — SQLite 层
- [Hono](https://hono.dev/) — 未来的 server 层

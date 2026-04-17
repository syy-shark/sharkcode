# Shark Code 🦈

> Local First, open-source AI coding agent.  
> A powerful CLI inspired by Claude Code / OpenCode — 12 providers, 9 built-in tools, runs anywhere.

## Install

```bash
npm install -g sharkcode
```

Launch interactive mode:

```bash
sharkcode
```

Or single-shot mode:

```bash
sharkcode "explain this codebase"
sharkcode "fix the null pointer bug in auth.ts"
```

## Providers

Shark Code supports **12 providers** out of the box. Switch anytime with `/provider`.

| Provider | Description | Default Model | Docs |
|----------|-------------|---------------|------|
| `deepseek` | DeepSeek 官网 (default) | `deepseek-chat` | [platform.deepseek.com](https://platform.deepseek.com) |
| `ark` | 火山引擎 方舟 Coding Plan | `ark-code-latest` | [volcengine.com](https://www.volcengine.com/activity/codingplan) |
| `openai` | OpenAI | `gpt-4o` | [platform.openai.com](https://platform.openai.com) |
| `openrouter` | OpenRouter (Claude, Gemini, etc.) | `anthropic/claude-sonnet-4` | [openrouter.ai](https://openrouter.ai) |
| `siliconflow` | SiliconFlow 硅基流动 | `deepseek-ai/DeepSeek-V3` | [siliconflow.cn](https://siliconflow.cn) |
| `groq` | Groq (ultra-fast inference) | `llama-3.3-70b-versatile` | [groq.com](https://groq.com) |
| `together` | Together AI | `Llama-3.3-70B-Instruct-Turbo` | [together.ai](https://together.ai) |
| `qwen` | Qwen 通义千问 | `qwen-plus` | [dashscope.aliyun.com](https://dashscope.aliyun.com) |
| `ollama` | Ollama 本地 (no API key) | `qwen2.5-coder:7b` | [ollama.com](https://ollama.com) |
| `custom` | 自定义 (any OpenAI-compatible API) | — | — |
| `copilot` | **GitHub Copilot** (OAuth — no API key needed) | `gpt-4.1` | [github.com/features/copilot](https://github.com/features/copilot) |
| `codex` | **OpenAI Codex / ChatGPT** subscription | `gpt-5.4` | [openai.com/codex](https://openai.com/codex) |

Ark 预设模型现已内置到 SharkCode：`ark-code-latest`（控制台 / Auto 托管）、`doubao-seed-code`、`glm-4.7`、`deepseek-v3.2`、`kimi-k2-thinking`、`kimi-k2.5`。如果你仍想使用其他模型 ID，也可以在配置流程里手动输入。

---

### GitHub Copilot — 订阅登录

如果你有 GitHub Copilot 订阅，可以直接在 SharkCode 里使用，无需 API Key：

```bash
sharkcode
# 按 /，选择「切换 / 配置 Provider」，选择 copilot
# → 自动弹出授权步骤（无需再输 /login）
```

**步骤：**
1. `/provider` → 选择 `copilot`
2. SharkCode 显示一次性验证码 + GitHub 网址
3. 用任意浏览器打开该网址，输入验证码，授权 GitHub App
4. 回到 SharkCode，授权自动完成，立即可用

凭证保存在 `~/.sharkcode/copilot-auth.json`（权限 600）。  
退出登录：`/logout`  
快捷登录：`/login`（直接进入 device flow，无需 /provider）

部分 Copilot 推理模型现已支持思考强度调节：输入 `/thinking`，即可在支持的模型上切换 `None / Low / Medium (默认) / High / Xhigh`（不同模型支持的档位不同，非推理模型不会显示该子菜单）。

#### GitHub Copilot 支持的模型

| 模型 ID | Picker 显示 | 当前倍率 / 备注 |
|---------|-------------|----------------|
| `auto` | Auto | `10% discount` |
| `claude-opus-4.6` | Claude Opus 4.6 | `High · 3x` |
| `claude-sonnet-4.6` | Claude Sonnet 4.6 | `Medium · 1x` |
| `gpt-4o` | GPT-4o | `0x` |
| `gpt-5.4` | GPT-5.4 | `Xhigh · 1x` |
| `gpt-5.4-mini` | GPT-5.4 mini | `Medium · Responses-only · 1x` |
| `claude-haiku-4.5` | Claude Haiku 4.5 | `0.33x` |
| `claude-opus-4.5` | Claude Opus 4.5 | `3x` |
| `claude-sonnet-4` | Claude Sonnet 4 | `⚠ 1x` |
| `claude-sonnet-4.5` | Claude Sonnet 4.5 | `1x` |
| `gemini-2.5-pro` | Gemini 2.5 Pro | `1x` |
| `gemini-3-flash-preview` | Gemini 3 Flash (Preview) | `0.33x` |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro (Preview) | `1x` |
| `gpt-4.1` | GPT-4.1（**默认**） | `0x` |
| `gpt-5-mini` | GPT-5 mini | `Medium · 0x` |
| `gpt-5.1` | GPT-5.1 | `⚠ Medium · 1x` |
| `gpt-5.2` | GPT-5.2 | `Medium · 1x` |
| `gpt-5.2-codex` | GPT-5.2-Codex | `Medium · 1x` |
| `gpt-5.3-codex` | GPT-5.3-Codex | `Medium · 1x` |
| `grok-code-fast-1` | Grok Code Fast 1 | `0.25x` |
| `oswe-vscode-prime` | Raptor mini (Preview) | `0x` |

> 注：SharkCode 登录 GitHub Copilot 后会优先读取账号 `/models` 的实时模型表。支持 `/responses` 的模型会自动走 `/responses`，支持 `/chat/completions` 的模型继续走旧接口；`gpt-4.1` 仍保留为默认模型，便于在未启用高阶 GPT-5 模型时稳定可用。

---

### OpenAI Codex / ChatGPT — 订阅登录

如果你有 ChatGPT Plus/Pro 或 Codex 订阅，可以通过 OAuth 授权使用，无需 API Key：

```bash
sharkcode
# 按 /，选择「切换 / 配置 Provider」，选择 codex
# → 选择「通过浏览器授权 ChatGPT/Codex 订阅」
```

**步骤：**
1. `/provider` → 选择 `codex` → 选择「通过浏览器授权（推荐）」
2. SharkCode 显示一次性验证码 + OpenAI 网址
3. 用任意浏览器打开该网址，授权 OpenAI App
4. 回到 SharkCode，授权自动完成，立即可用

凭证保存在 `~/.sharkcode/codex-auth.json`（权限 600）。  
退出登录：`/logout`

**或者直接输入 OpenAI API Key：**  
`/provider` → `codex` → 选择「输入 OpenAI API Key」

如有已安装的官方 Codex CLI，SharkCode 也会自动读取 `~/.codex/auth.json`。

#### OpenAI Codex 支持的模型

| 模型 ID | 说明 | 获取方式 |
|---------|------|---------|
| `gpt-5.4` | GPT-5.4，旗舰（**默认**） | Codex Plus&Pro 订阅 |
| `gpt-5.4-mini` | GPT-5.4 mini，快速 | Codex Plus&Pro 订阅 |
| `gpt-5.3-codex` | GPT-5.3-Codex，代码专用 | Codex Plus&Pro 订阅 |
| `gpt-5.3-codex-spark` | GPT-5.3-Codex Spark，研究预览 | Codex Pro 专属 |
| `gpt-5.2` | GPT-5.2，备选高性能 | Codex Plus&Pro 订阅 |

> 注：订阅模型（`gpt-5.x`、`gpt-5.x-codex`）需通过浏览器 OAuth 授权使用 ChatGPT/Codex 订阅；标准模型需填写 OpenAI API Key。

---

## Configure

### Option 1: Interactive setup (recommended)

Start `sharkcode`, press `/`, then select **切换 / 配置 Provider**. You'll be guided through:
1. Choose a provider
2. For Copilot/Codex: directly start OAuth (browser device flow) — no separate `/login` needed
3. Select a model
4. (For Ollama/Custom) Set the base URL

### Option 2: Config file

`~/.sharkcode/config.toml`

```toml
[default]
provider = "deepseek"
permission_mode = "prompt"

[providers.deepseek]
key = "sk-xxxxxx"
model = "deepseek-chat"

[providers.openai]
key = "sk-xxxxxx"
model = "gpt-4o"

[providers.ark]
key = "sk-xxxxxx"
model = "doubao-seed-code"

[providers.ollama]
key = ""
model = "qwen2.5-coder:7b"
base_url = "http://localhost:11434/v1"

[learning]
enabled = false
verbosity = "标准"    # 简洁 | 标准 | 详细
model = ""           # 留空使用主模型
auto_cards = true    # 自动显示一行课堂提示
background = ""      # 可选：记录你的学习背景
```

### Option 3: Environment variables

```bash
export DEEPSEEK_API_KEY="sk-xxxxxx"    # deepseek
export OPENAI_API_KEY="sk-xxxxxx"      # openai / codex
export OPENROUTER_API_KEY="sk-xxxxxx"  # openrouter
export GROQ_API_KEY="gsk_xxxxxx"       # groq
export ARK_API_KEY="sk-xxxxxx"         # ark
```

## Built-in Tools

The agent automatically uses these 9 tools:

| Tool | Description |
|------|-------------|
| `read_file` | Read files with optional line ranges and line numbers |
| `write_file` | Create or overwrite files (auto-creates directories) |
| `edit_file` | Precise find-and-replace in files |
| `bash` | Execute shell commands (with user approval) |
| `glob` | Find files by pattern (`**/*.ts`, `src/**/*.{js,tsx}`) |
| `grep` | Search text/regex across files with line numbers |
| `list_directory` | Tree-view of directory structure with file sizes |
| `web_fetch` | Fetch URL content (HTML auto-converted to text) |
| `think` | Step-by-step reasoning for complex tasks |

## Slash Commands

| Command | Description |
|---------|-------------|
| `/` | Open command menu |
| `/provider` | Switch or configure provider (includes OAuth login for Copilot/Codex) |
| `/model` | Change model |
| `/thinking` | Adjust thinking level for supported OpenAI / Codex / Copilot models |
| `/session` | Manage sessions and switch history |
| `/session new` | Start a new task in pending state |
| `/session list` | List saved sessions |
| `/session current` | Show the current session |
| `/session switch <id>` | Switch to a previous session |
| `/mode <build\|plan>` | Switch Build / Plan mode |
| `/skill` | List and enable skills |
| `/key` | Set API key |
| `/login` | Quick shortcut: GitHub Copilot device flow |
| `/logout` | Log out from Copilot or Codex |
| `/learn` | Open the learning center and toggle class mode |
| `/learn on` | Enable class mode |
| `/learn off` | Disable class mode |
| `/learn progress` | Show learning progress and current learning level |
| `/learn recap` | Review the latest lesson |
| `/learn ask [question]` | Ask follow-up questions about the latest lesson |
| `/learn quiz` | Start a short Chinese quiz |
| `/learn model <name>` | Set the lesson model (e.g. `deepseek-chat`) |
| `/learn level <级别>` | Set lesson verbosity: `简洁` / `标准` / `详细` |
| `/help` | Show all commands and tools |
| `/clear` | Exit the current session |
| `exit` / `quit` | Quit |

## Sessions

SharkCode now organizes work into persistent `session`s.

- A new session is created lazily only when you send the first real work message.
- `/session new` prepares a fresh task without creating an empty session file.
- `/clear` exits the current session without deleting history.
- Previous sessions can be restored after restart with `/session switch <id>`.

## Build / Plan Mode

- `Build` mode is the normal execution mode.
- `Plan` mode is strict read-only mode.
- Press `Tab` in the REPL prompt to switch between `Build` and `Plan`.
- In `Plan` mode, SharkCode only exposes read/search/reasoning tools and will not modify files or run commands.

## Skills

SharkCode supports session-scoped skills inspired by Claude Code / OpenCode / Codex.

- Built-in and custom skills can inject `<system-reminder>...</system-reminder>` into the system prompt.
- Custom skills are loaded from `~/.sharkcode/skills/*.md` and `.sharkcode/skills/*.md`.
- Use `/skill list`, `/skill use <name>`, `/skill current`, and `/skill clear` to manage them.

## Class Mode（上课模式）

SharkCode 内置一个上课模式，在交互式 REPL 中保持普通聊天体验，并在有教学价值的回合结束后给出一条极简课堂提示。输入 `/learn` 可以进一步查看本轮讲解、学习进度和后续回顾。

```
🎓 本轮学到：先读取文件确认上下文，再决定修改路径。输入 /learn recap 查看详细讲解，或 /learn ask 继续追问。
```

### 启用方式

```bash
sharkcode          # 进入交互式 REPL
/learn on          # 开启上课模式
/learn off         # 关闭
```

### 学习中心

```bash
/learn             # 打开学习中心
/learn progress    # 查看学习进度 / 学习等级
/learn recap       # 回看最近一轮课堂讲解
/learn ask         # 继续追问本轮讲解
/learn ask 为什么先读文件？
/learn quiz        # 来一道中文小测，巩固一个学习概念
```

### 配置上课模型

上课模式必须显式设置一个教学模型。它与主 agent 的做事模型分离，用于：

- 自动 lesson 生成
- `/learn recap` 对应的课堂内容
- `/learn ask` 追问回答

例如：

```bash
/learn model deepseek-chat     # 使用 DeepSeek 生成讲解内容
/learn model gpt-4o            # 使用 GPT-4o
```

### 调节讲解详略

```bash
/learn level 简洁    # 简短摘要（适合有经验的开发者）
/learn level 标准    # 平衡（默认）
/learn level 详细    # 深入讲解（适合学习者）
```

### 配置文件（config.toml）

```toml
[learning]
enabled = false
verbosity = "标准"      # 简洁 | 标准 | 详细
model = "gpt-4o-mini"  # 必须显式设置教学模型
auto_cards = true      # 自动显示一行课堂提示
background = ""        # 可选：记录你的学习背景
```

### 注意事项

- 上课模式**仅在交互式 REPL**（`sharkcode` 无参数启动）中可用，单次运行模式不支持。
- 课堂讲解是 best-effort：若生成失败，主 agent 执行不受影响。
- 自动提示只在本轮有明显学习价值时出现，不会每轮都打断你。
- 如果未配置 `/learn model <name>`，SharkCode 会暂停新 lesson 生成和 `/learn ask`，并提示先设置教学模型。

---

## Project Instructions

Create a `.sharkcode.md` file in your project root to give the agent project-specific context:

```markdown
# Project Instructions

- This is a React + TypeScript project
- Use pnpm for package management
- Follow the existing code style (single quotes, no semicolons)
- Run `pnpm test` to verify changes
```

The agent automatically reads this file and follows the instructions.

## Run from source

```bash
git clone https://github.com/syy-shark/sharkcode.git
cd sharkcode
bun install
bun run start
```

## How It Works

```
User input → Prompt + Context + Tools → LLM → Tool execution → Result → Repeat
```

The agent automatically detects your project type, reads git context, and uses tools to explore, understand, and modify your code.

## Tech Stack

- Bun + TypeScript
- Vercel AI SDK (provider abstraction)
- 12 OpenAI-compatible providers (+ Copilot & Codex OAuth)
- Zero server dependency (100% local)

## License

MIT

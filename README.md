# Shark Code 🦈

> Local First, open-source AI coding agent.  
> A powerful CLI inspired by Claude Code / OpenCode — 10 providers, 9 built-in tools, runs anywhere.

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

Shark Code supports **10 providers** out of the box. Switch anytime with `/provider`.

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

## Configure

### Option 1: Interactive setup (recommended)

Start `sharkcode`, press `/`, then select **切换 / 配置 Provider**. You'll be guided through:
1. Choose a provider
2. Enter your API key
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

[providers.ollama]
key = ""
model = "qwen2.5-coder:7b"
base_url = "http://localhost:11434/v1"
```

### Option 3: Environment variables

```bash
export DEEPSEEK_API_KEY="sk-xxxxxx"    # deepseek
export OPENAI_API_KEY="sk-xxxxxx"      # openai
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
| `/provider` | Switch or configure provider |
| `/model` | Change model |
| `/key` | Set API key |
| `/help` | Show all commands and tools |
| `exit` / `quit` | Quit |

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
- 10 OpenAI-compatible providers
- Zero server dependency (100% local)

## License

MIT

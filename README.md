# Shark Code

> Local First, open-source AI coding agent.  
> A small CLI inspired by Claude Code / OpenCode, with DeepSeek as the default provider.

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

Shark Code supports multiple providers. Switch between them anytime with `/provider`.

| Provider | Description | Docs |
|----------|-------------|------|
| `deepseek` | DeepSeek 官网 (default) | [platform.deepseek.com](https://platform.deepseek.com) |
| `ark` | 火山引擎 方舟 Coding Plan | [volcengine.com/activity/codingplan](https://www.volcengine.com/activity/codingplan) |

## Configure

### Option 1: Slash commands (recommended)

Start `sharkcode`, then:

```
◆ /provider ark              # switch to 方舟 Coding Plan
◆ /key sk-xxxxxxxxxx         # set API key (saved automatically)
◆ /model ark-code-latest      # optionally change model
```

### Option 2: Config file

`~/.sharkcode/config.toml`

```toml
[default]
provider = "deepseek"   # or "ark"

[providers.deepseek]
# API key from https://platform.deepseek.com
key = "sk-xxxxxx"
model = "deepseek-chat"

[providers.ark]
# API key from https://ark.cn-beijing.volces.com (方舟 Coding Plan)
key = "sk-xxxxxx"
model = "ark-code-latest"
```

### Option 3: Environment variables

```powershell
$env:DEEPSEEK_API_KEY="sk-xxxxxx"   # deepseek provider
$env:ARK_API_KEY="sk-xxxxxx"         # ark provider
```

## Slash Commands

Type `/` commands anytime inside the interactive REPL:

| Command | Description |
|---------|-------------|
| `/provider` | show current provider & key status |
| `/provider <name>` | switch provider (`deepseek` \| `ark`) |
| `/key <api-key>` | set API key for current provider |
| `/model <model-id>` | set model for current provider |
| `/clear` | clear conversation history |
| `/help` | show command list |
| `/exit` | quit |

## Run from source

```bash
git clone https://github.com/syy-shark/sharkcode.git
cd sharkcode
bun install
bun run start
```

## Upgrade

```bash
npm update -g sharkcode
```

## How It Works

```
User input → Prompt + Tools → LLM → Tool execution → Result → Repeat
```

Built-in tools:

| Tool | Description |
|------|-------------|
| `read_file` | Read a file |
| `write_file` | Create or overwrite a file |
| `edit_file` | Replace an exact string in a file |
| `bash` | Execute a shell command with approval |

## Tech Stack

- Bun + TypeScript
- Vercel AI SDK
- DeepSeek API / 火山引擎 方舟 API

## License

MIT

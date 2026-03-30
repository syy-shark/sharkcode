# Shark Code

> Local First, open-source AI coding agent.
> A small CLI inspired by Claude Code / OpenCode, with DeepSeek as the default provider.

## Install

### Global install from npm

```bash
npm install -g sharkcode
```

Then run:

```bash
sharkcode "explain this codebase"
sharkcode "fix the null pointer bug in auth.ts"
sharkcode "add error handling to the API routes"
```

### Run from source

```bash
git clone https://github.com/syy-shark/sharkcode.git
cd sharkcode
bun install
bun run start "explain this codebase"
```

## Configure API Key

Shark Code reads `DEEPSEEK_API_KEY` from either an environment variable or `~/.sharkcode/config.toml`.

### Option 1: Environment variable

macOS / Linux:

```bash
export DEEPSEEK_API_KEY=sk-xxxxxx
```

Windows PowerShell:

```powershell
$env:DEEPSEEK_API_KEY="sk-xxxxxx"
```

### Option 2: Config file

`~/.sharkcode/config.toml`

```toml
[api]
key = "sk-xxxxxx"
model = "deepseek-chat"
base_url = "https://api.deepseek.com/v1"
```

## Upgrade

When you publish a new version to npm, users can upgrade with:

```bash
npm update -g sharkcode
```

## Publish

```bash
npm login
npm publish
```

Every code update is published as a new npm version. Typical flow:

1. Update code.
2. Bump `version` in `package.json`.
3. Run `npm publish`.

## How It Works

```text
User input -> Prompt + Tools -> LLM -> Tool execution -> Result -> Repeat
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
- DeepSeek API

## License

MIT

# 🦈 Shark Code

> Local First、开源的 AI Coding Agent。
> 对标 Claude Code / OpenCode，但更简单、更可黑客、支持本地 LLM。

## 30 秒上手

```bash
# 安装
git clone https://github.com/syy-ex/sharkcode.git
cd sharkcode && bun install

# 配置 API Key（DeepSeek，比 OpenAI 便宜 10x）
export DEEPSEEK_API_KEY=sk-xxxxxx   # https://platform.deepseek.com

# 使用
bun run start "explain this codebase"
bun run start "fix the null pointer bug in auth.ts"
bun run start "add error handling to the API routes"
```

## 工作原理

```
用户输入 → 构造 Prompt + Tools → 调用 LLM → 执行 Tool → 返回结果 → 循环直到完成
```

核心循环就这么简单。4 个内置工具：

| Tool | 说明 |
|------|------|
| `read_file` | 读取文件内容 |
| `write_file` | 创建/覆盖文件 |
| `edit_file` | 精确替换文件中的字符串 |
| `bash` | 执行 shell 命令（需用户确认） |

## 配置

API Key 可以通过环境变量或配置文件设置：

```bash
# 方式 1：环境变量
export DEEPSEEK_API_KEY=sk-xxxxxx

# 方式 2：配置文件 ~/.sharkcode/config.toml
[api]
key = "sk-xxxxxx"
model = "deepseek-chat"
base_url = "https://api.deepseek.com/v1"
```

## 技术栈

- **Bun** + **TypeScript** — 快速运行时
- **Vercel AI SDK** — LLM 抽象层
- **DeepSeek API** — 默认 Provider（兼容 OpenAI 协议）

## 项目结构

```
src/
├── cli.ts          # CLI 入口
├── agent.ts        # Agent 核心循环（streamText + tools + maxSteps）
├── config.ts       # 配置读取（~/.sharkcode/config.toml）
├── provider.ts     # DeepSeek Provider（Vercel AI SDK）
├── permission.ts   # 权限系统（bash 执行确认）
└── tools/
    ├── index.ts    # Tool Registry
    ├── read-file.ts
    ├── write-file.ts
    ├── edit-file.ts
    └── bash.ts
```

## License

MIT

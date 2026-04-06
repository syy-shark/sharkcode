import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
import { select, input } from "@inquirer/prompts";
import {
  readMultiConfig,
  saveMultiConfig,
  resolveConfig,
  PROVIDERS,
  type Config,
  type MultiConfig,
  type PermissionMode,
} from "./config.ts";
import { runAgent, type RunAgentResult } from "./agent.ts";
import { setPermissionMode, getPermissionMode } from "./permission.ts";
import { createInterruptController, triggerInterrupt, wasInterrupted, resetInterrupt, isAwaitingPermission } from "./interrupt.ts";
import type { ModelMessage } from "ai";

// ─── Colors ───────────────────────────────────────────────────────────────────
const PURPLE = chalk.hex("#a855f7");
const GRAY   = chalk.gray;
const YELLOW = chalk.yellow;
const GREEN  = chalk.green;
const RED    = chalk.red;
const CYAN   = chalk.cyan;

// ─── Read version from package.json ───────────────────────────────────────────
function getVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// ─── Purple pixel-art banner ──────────────────────────────────────────────────
const GLYPHS: Record<string, number[][]> = {
  S: [[0,1,1,1,1],[1,0,0,0,0],[0,1,1,1,0],[0,0,0,0,1],[1,1,1,1,0]],
  H: [[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,1],[1,0,0,0,1],[1,0,0,0,1]],
  A: [[0,1,1,1,0],[1,0,0,0,1],[1,1,1,1,1],[1,0,0,0,1],[1,0,0,0,1]],
  R: [[1,1,1,1,0],[1,0,0,0,1],[1,1,1,1,0],[1,0,1,0,0],[1,0,0,1,0]],
  K: [[1,0,0,1,0],[1,0,1,0,0],[1,1,0,0,0],[1,0,1,0,0],[1,0,0,1,0]],
  C: [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,0],[1,0,0,0,1],[0,1,1,1,0]],
  O: [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  D: [[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0]],
  E: [[1,1,1,1,1],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,1,1,1,1]],
};

function renderWord(word: string, padLeft = 2): string[] {
  const letters = word.toUpperCase().split("").map((c) => GLYPHS[c]!);
  // Use background-colored spaces instead of █ block characters.
  // Block chars (U+2588) can render as 2 columns wide on some Windows fonts,
  // causing the art to wrap and break after many lines of chat output.
  // Spaces are always exactly 1 column wide — fully stable.
  const ON  = chalk.bgHex("#a855f7")("  ");
  const OFF = "  ";
  const rows: string[] = [];
  for (let row = 0; row < 5; row++) {
    let line = " ".repeat(padLeft);
    for (let i = 0; i < letters.length; i++) {
      const letter = letters[i]!;
      for (let col = 0; col < letter[row]!.length; col++) {
        line += letter[row]![col] ? ON : OFF;
      }
      if (i < letters.length - 1) line += OFF;
    }
    rows.push(line);
  }
  return rows;
}

const BANNER = ["", ...renderWord("shark", 2), "", ...renderWord("code", 8), ""].join("\n");

// ─── Slash result type ────────────────────────────────────────────────────────
interface SlashResult {
  multiConfig: MultiConfig;
  config: Config;
  clearHistory?: boolean;
  exit?: boolean;
}

// ─── Interactive command menu (triggered by bare "/") ─────────────────────────
async function showCommandMenu(multiConfig: MultiConfig): Promise<SlashResult> {
  console.log();
  const permMode = getPermissionMode();
  const permLabel = permMode === "full-access"
    ? "⚡  权限模式：Full Access  " + chalk.dim("(点击切换回默认)")
    : "🔐  权限模式：默认         " + chalk.dim("(点击开启 Full Access)");

  try {
    const action = await select({
      message: PURPLE("◆ 选择操作"),
      choices: [
        { name: "🔌  切换 / 配置 Provider", value: "provider" },
        { name: permLabel,                  value: "permission" },
        { name: "🗑️  清空对话历史",          value: "clear"    },
        { name: "🚪  退出",                  value: "exit"     },
      ],
    });
    switch (action) {
      case "provider":   return showSetupFlow(multiConfig);
      case "permission": return togglePermissionMode(multiConfig);
      case "clear":
        console.log(GRAY("\n  ✓ 对话已清空\n"));
        return { multiConfig, config: resolveConfig(multiConfig), clearHistory: true };
      case "exit":
        console.log(GRAY("\nBye! 🦈"));
        return { multiConfig, config: resolveConfig(multiConfig), exit: true };
    }
  } catch {
    // Ctrl+C inside menu — cancel, resume REPL
    console.log(GRAY("\n  取消\n"));
  }
  return { multiConfig, config: resolveConfig(multiConfig) };
}

// ─── Toggle permission mode ───────────────────────────────────────────────────
async function togglePermissionMode(multiConfig: MultiConfig): Promise<SlashResult> {
  const current = getPermissionMode();
  const next: PermissionMode = current === "full-access" ? "prompt" : "full-access";
  setPermissionMode(next);

  const updated: MultiConfig = { ...multiConfig, permissionMode: next };
  saveMultiConfig(updated);

  if (next === "full-access") {
    console.log(
      chalk.yellow("\n  ⚡ Full Access 已开启") +
      GRAY(" — agent 将自动批准所有工具操作\n")
    );
  } else {
    console.log(
      chalk.green("\n  🔐 已恢复默认权限") +
      GRAY(" — 每次工具调用前会询问\n")
    );
  }

  return { multiConfig: updated, config: resolveConfig(updated) };
}

// ─── Setup flow: provider picker → API key input → model selection ─────────────
async function showSetupFlow(multiConfig: MultiConfig): Promise<SlashResult> {
  console.log();
  try {
    // Step 1 — choose provider
    const providerChoices = Object.entries(PROVIDERS).map(([id, meta]) => {
      const hasKey = !!multiConfig.providers[id]?.key;
      const badge  = hasKey ? GREEN("✓ 已配置") : YELLOW("✗ 未配置");
      // No key required for ollama
      const finalBadge = id === "ollama" ? GREEN("✓ 本地") : badge;
      return { name: `${meta.label}   ${finalBadge}`, value: id };
    });

    const selectedProvider = await select({
      message: PURPLE("◆ 选择 Provider"),
      choices: providerChoices,
      default: multiConfig.activeProvider,
    });

    // Step 2 — API key (skip for ollama)
    const currentKey = multiConfig.providers[selectedProvider]?.key ?? "";
    let newKey = currentKey;

    if (selectedProvider !== "ollama") {
      const hint = currentKey
        ? GRAY("(回车保留  " + currentKey.slice(0, 6) + "•••)")
        : GRAY("(必填)");

      const rawKey = await input({
        message: PURPLE("◆ API Key ") + hint,
        default: currentKey || undefined,
      });

      newKey = rawKey.trim() || currentKey;
    }

    // Step 3 — model selection
    const meta = PROVIDERS[selectedProvider];
    const currentModel = multiConfig.providers[selectedProvider]?.model ?? meta?.defaultModel ?? "";
    const modelHint = GRAY(`(回车保留 ${currentModel})`);

    const rawModel = await input({
      message: PURPLE("◆ 模型 ") + modelHint,
      default: currentModel || undefined,
    });

    const newModel = rawModel.trim() || currentModel;

    // Step 4 — base URL for custom/ollama
    let newBaseURL: string | undefined;
    if (selectedProvider === "custom" || selectedProvider === "ollama") {
      const currentURL = multiConfig.providers[selectedProvider]?.baseURL ?? meta?.baseURL ?? "";
      const urlHint = currentURL
        ? GRAY(`(回车保留 ${currentURL})`)
        : GRAY("(必填，如 http://localhost:11434/v1)");

      const rawURL = await input({
        message: PURPLE("◆ Base URL ") + urlHint,
        default: currentURL || undefined,
      });

      newBaseURL = rawURL.trim() || currentURL || undefined;
    }

    // Build updated config
    let updated: MultiConfig = { ...multiConfig, activeProvider: selectedProvider };
    updated = {
      ...updated,
      providers: {
        ...updated.providers,
        [selectedProvider]: {
          ...(updated.providers[selectedProvider] ?? {}),
          key: newKey,
          model: newModel,
          baseURL: newBaseURL,
        },
      },
    };

    saveMultiConfig(updated);
    const newConfig = resolveConfig(updated);

    const keyMsg = newKey && newKey !== currentKey ? "，API Key 已保存" : "";
    console.log(GREEN(`\n  ✓ 已切换到 ${PROVIDERS[selectedProvider]!.label} [${newModel}]${keyMsg}`) + "\n");
    if (!newConfig.apiKey && selectedProvider !== "ollama") {
      console.log(YELLOW("  ⚠ 还未填写 API Key，无法发送消息\n"));
    }

    return { multiConfig: updated, config: newConfig };
  } catch {
    console.log(GRAY("\n  取消\n"));
    return { multiConfig, config: resolveConfig(multiConfig) };
  }
}

// ─── Read one line (raw mode kept on by caller; bare "/" triggers immediately) ─
// ─── Terminal display width (CJK & fullwidth chars occupy 2 columns) ─────────
function charDisplayWidth(ch: string): number {
  const cp = ch.codePointAt(0)!;
  if (
    (cp >= 0x1100 && cp <= 0x115F) ||   // Hangul Jamo
    (cp >= 0x2E80 && cp <= 0x303E) ||   // CJK Radicals Supplement, Kangxi, etc.
    (cp >= 0x3041 && cp <= 0x33FF) ||   // Hiragana, Katakana, CJK Symbols
    (cp >= 0x3400 && cp <= 0x9FFF) ||   // CJK Unified Ideographs (+ Ext A)
    (cp >= 0xAC00 && cp <= 0xD7AF) ||   // Hangul Syllables
    (cp >= 0xF900 && cp <= 0xFAFF) ||   // CJK Compatibility Ideographs
    (cp >= 0xFF01 && cp <= 0xFF60) ||   // Fullwidth Latin / Punctuation
    (cp >= 0xFFE0 && cp <= 0xFFE6)      // Fullwidth Signs
  ) return 2;
  return 1;
}

async function readLineRaw(promptStr: string): Promise<string | null> {
  // Raw mode is assumed to already be on. We only manage the data listener.
  process.stdout.write(promptStr);

  return new Promise((resolve) => {
    let buffer = "";
    let finished = false;

    const finish = (value: string | null) => {
      if (finished) return;
      finished = true;
      process.stdin.removeListener("data", onData);
      // Do NOT touch setRawMode or pause — caller owns that
      resolve(value);
    };

    const onData = (chunk: Buffer) => {
      const str = chunk.toString("utf8");

      // Ignore escape sequences (arrow keys, F-keys, etc.)
      if (str.startsWith("\x1b")) return;

      for (const ch of str) {
        const code = ch.codePointAt(0)!;

        if (code === 3 || code === 4) {          // Ctrl+C / Ctrl+D
          process.stdout.write("\n");
          finish(null);
          return;
        }
        if (code === 13 || code === 10) {         // Enter
          process.stdout.write("\n");
          finish(buffer);
          return;
        }
        if (code === 127 || code === 8) {         // Backspace
          if (buffer.length > 0) {
            const chars = [...buffer];
            const removed = chars.pop()!;
            buffer = chars.join("");
            const w = charDisplayWidth(removed);
            // Erase `w` columns: move back, blank, move back again
            process.stdout.write("\b".repeat(w) + " ".repeat(w) + "\b".repeat(w));
          }
          continue;
        }
        if (code < 32) continue;                  // other control chars → ignore

        // Bare "/" as the very first character → trigger menu immediately
        if (ch === "/" && buffer === "") {
          process.stdout.write("\n");
          finish("/");
          return;
        }

        buffer += ch;
        process.stdout.write(ch);
      }
    };

    process.stdin.on("data", onData);
  });
}

// ─── Status line ─────────────────────────────────────────────────────────────
function statusLine(config: Config): string {
  const label = PROVIDERS[config.providerName]?.label ?? config.providerName;
  const permMode = getPermissionMode();
  const permBadge = permMode === "full-access"
    ? chalk.yellow("  ⚡ Full Access")
    : GRAY("  🔐 默认权限");
  return (
    PURPLE("  ◆") +
    GRAY(` ${label}`) +
    CYAN(`  [${config.model}]`) +
    permBadge +
    GRAY("   输入 / 调出指令菜单 · Esc 中断输出\n")
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "--help" || args[0] === "-h") {
    console.log(BANNER);
    console.log(PURPLE("  Usage:"));
    console.log("    " + PURPLE("sharkcode") + GRAY("          — 交互模式（直接启动）"));
    console.log("    " + PURPLE("sharkcode") + YELLOW(' "prompt"') + GRAY("  — 单次执行"));
    console.log(GRAY("\n  交互模式内输入 / 调出指令菜单，/help 查看所有命令"));
    console.log(GRAY("\n  支持 Provider：DeepSeek | OpenAI | OpenRouter | SiliconFlow | Groq"));
    console.log(GRAY("                Together AI | Qwen | Ollama | 方舟 | 自定义"));
    console.log(GRAY("\n  内置工具：read_file | write_file | edit_file | bash | glob"));
    console.log(GRAY("           grep | list_directory | web_fetch | think\n"));
    return;
  }

  if (args[0] === "--version" || args[0] === "-v") {
    console.log(`sharkcode v${getVersion()}`);
    return;
  }

  // ── Single-shot mode ──────────────────────────────────────────────────────
  if (args.length > 0) {
    const mc = readMultiConfig();
    const config = resolveConfig(mc);
    if (!config.apiKey) {
      console.error(RED("❌ 未配置 API Key。请先运行 sharkcode 并输入 / 配置 Provider。"));
      process.exit(1);
    }
    console.log(
      PURPLE("\n🦈 SharkCode") +
      GRAY(` | ${PROVIDERS[config.providerName]?.label ?? config.providerName} | ${config.model}\n`)
    );
    await runAgent([{ role: "user", content: args.join(" ") }], config);
    return;
  }

  // ── Interactive REPL mode ─────────────────────────────────────────────────
  console.log(BANNER);
  console.log(GRAY(`  v${getVersion()}\n`));

  let multiConfig = readMultiConfig();
  let config      = resolveConfig(multiConfig);

  // Apply saved permission mode
  setPermissionMode(multiConfig.permissionMode ?? "prompt");

  // Set raw mode ONCE for the entire REPL session.
  // readLineRaw only manages listeners; raw mode stays on throughout.
  try { process.stdin.setRawMode(true); process.stdin.resume(); } catch { /* not a TTY */ }

  console.log(statusLine(config));

  if (!config.apiKey) {
    console.log(
      YELLOW("  ⚠ 尚未配置 API Key。") +
      GRAY("输入 / 然后选择「切换 / 配置 Provider」\n")
    );
  }

  let messages: ModelMessage[] = [];

  while (true) {
    const raw = await readLineRaw(PURPLE("\n◆ "));

    if (raw === null) { console.log(GRAY("\nBye! 🦈")); break; }

    const trimmed = raw.trim();
    if (!trimmed) continue;

    // Exit shortcuts
    if (trimmed === "exit" || trimmed === "quit") { console.log(GRAY("Bye! 🦈")); break; }

    // Bare "/" → command menu
    if (trimmed === "/") {
      const r = await showCommandMenu(multiConfig);
      multiConfig = r.multiConfig; config = r.config;
      if (r.clearHistory) messages = [];
      if (r.exit) break;
      // Restore raw mode after inquirer (which may have changed it)
      try { process.stdin.setRawMode(true); process.stdin.resume(); } catch {}
      console.log(statusLine(config));
      continue;
    }

    // /provider, /model, /key → setup flow directly
    if (
      trimmed === "/provider" || trimmed.startsWith("/provider ") ||
      trimmed === "/model"    || trimmed.startsWith("/model ")    ||
      trimmed === "/key"      || trimmed.startsWith("/key ")
    ) {
      const r = await showSetupFlow(multiConfig);
      multiConfig = r.multiConfig; config = r.config;
      if (r.exit) break;
      // Restore raw mode after inquirer
      try { process.stdin.setRawMode(true); process.stdin.resume(); } catch {}
      console.log(statusLine(config));
      continue;
    }

    // /help → show help
    if (trimmed === "/help") {
      console.log(`
${PURPLE("  可用命令：")}
  ${GRAY("/")}             ${GRAY("─ 打开指令菜单")}
  ${GRAY("/provider")}     ${GRAY("─ 切换 / 配置 Provider")}
  ${GRAY("/model")}        ${GRAY("─ 切换模型")}
  ${GRAY("/help")}         ${GRAY("─ 显示此帮助")}
  ${GRAY("exit / quit")}   ${GRAY("─ 退出")}
  ${GRAY("Esc")}           ${GRAY("─ 中断当前 Agent 输出")}

${PURPLE("  可用工具 (Agent 自动调用)：")}
  ${CYAN("read_file")}     ${GRAY("─ 读取文件（支持行号范围）")}
  ${CYAN("write_file")}    ${GRAY("─ 创建/覆盖文件")}
  ${CYAN("edit_file")}     ${GRAY("─ 精确查找替换")}
  ${CYAN("bash")}          ${GRAY("─ 执行 Shell 命令")}
  ${CYAN("glob")}          ${GRAY("─ 按模式查找文件")}
  ${CYAN("grep")}          ${GRAY("─ 搜索文件内容")}
  ${CYAN("list_directory")}${GRAY("─ 目录树")}
  ${CYAN("web_fetch")}     ${GRAY("─ 抓取网页内容")}
  ${CYAN("think")}         ${GRAY("─ 复杂问题推理")}

${PURPLE("  项目配置：")}
  ${GRAY("在项目根目录创建 .sharkcode.md 文件，写入项目说明，Agent 会自动读取")}
`);
      continue;
    }

    // Unknown slash command
    if (trimmed.startsWith("/")) {
      console.log(GRAY("  未知命令。输入 / 调出指令菜单\n"));
      continue;
    }

    // ── Send message to agent ──────────────────────────────────────────────
    if (!config.apiKey) {
      console.log(YELLOW("  ⚠ 还未填写 API Key。输入 / → 切换 / 配置 Provider\n"));
      continue;
    }

    messages.push({ role: "user", content: trimmed });

    // Set up interrupt: listen for Escape key while agent is running
    const abortSignal = createInterruptController();
    const interruptListener = (chunk: Buffer) => {
      const str = chunk.toString("utf8");
      // Escape key = \x1b (but NOT escape sequences like arrow keys which are \x1b[...)
      // We check for bare Escape: exactly 1 byte = 0x1b
      if (str === "\x1b") {
        triggerInterrupt();
      }
    };
    process.stdin.on("data", interruptListener);

    try {
      const result = await runAgent(messages, config, abortSignal);
      messages = result.messages;

      if (result.interrupted) {
        process.stderr.write(
          GRAY("  按 Esc 已中断 · 可以继续输入新指令\n")
        );
      }
    } catch (err) {
      console.error(RED(`\n❌ ${String(err)}\n`));
      messages.pop();
    } finally {
      // Always clean up: remove interrupt listener, reset state, restore raw mode
      process.stdin.removeListener("data", interruptListener);
      resetInterrupt();
      try { process.stdin.setRawMode(true); process.stdin.resume(); } catch {}
    }
  }
}

main().catch((err) => {
  console.error(chalk.red(`Fatal: ${String(err)}`));
  process.exit(1);
});


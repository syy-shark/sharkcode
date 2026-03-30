import chalk from "chalk";
import { select, input } from "@inquirer/prompts";
import {
  readMultiConfig,
  saveMultiConfig,
  resolveConfig,
  PROVIDERS,
  type Config,
  type MultiConfig,
} from "./config.ts";
import { runAgent } from "./agent.ts";
import type { ModelMessage } from "ai";

// ─── Colors ───────────────────────────────────────────────────────────────────
const PURPLE = chalk.hex("#a855f7");
const GRAY   = chalk.gray;
const YELLOW = chalk.yellow;
const GREEN  = chalk.green;
const RED    = chalk.red;
const CYAN   = chalk.cyan;

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
  const rows: string[] = [];
  for (let row = 0; row < 5; row++) {
    let line = " ".repeat(padLeft);
    for (let i = 0; i < letters.length; i++) {
      const letter = letters[i]!;
      for (let col = 0; col < letter[row]!.length; col++) {
        line += letter[row]![col] ? "██" : "  ";
      }
      if (i < letters.length - 1) line += "  ";
    }
    rows.push(PURPLE(line));
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
  try {
    const action = await select({
      message: PURPLE("◆ 选择操作"),
      choices: [
        { name: "🔌  切换 / 配置 Provider", value: "provider" },
        { name: "🗑️  清空对话历史",          value: "clear"    },
        { name: "🚪  退出",                  value: "exit"     },
      ],
    });
    switch (action) {
      case "provider": return showSetupFlow(multiConfig);
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

// ─── Setup flow: provider picker → API key input ──────────────────────────────
async function showSetupFlow(multiConfig: MultiConfig): Promise<SlashResult> {
  console.log();
  try {
    // Step 1 — choose provider
    const providerChoices = Object.entries(PROVIDERS).map(([id, meta]) => {
      const hasKey = !!multiConfig.providers[id]?.key;
      const badge  = hasKey ? GREEN("✓ 已配置") : YELLOW("✗ 未配置");
      return { name: `${meta.label}   ${badge}`, value: id };
    });

    const selectedProvider = await select({
      message: PURPLE("◆ 选择 Provider"),
      choices: providerChoices,
      default: multiConfig.activeProvider,
    });

    // Step 2 — API key
    const currentKey = multiConfig.providers[selectedProvider]?.key ?? "";
    const hint = currentKey
      ? GRAY("(回车保留  " + currentKey.slice(0, 6) + "•••)")
      : GRAY("(必填)");

    const rawKey = await input({
      message: PURPLE("◆ API Key ") + hint,
      default: currentKey || undefined,
    });

    const newKey = rawKey.trim() || currentKey;

    // Build updated config
    let updated: MultiConfig = { ...multiConfig, activeProvider: selectedProvider };
    if (newKey) {
      updated = {
        ...updated,
        providers: {
          ...updated.providers,
          [selectedProvider]: {
            model: PROVIDERS[selectedProvider]?.defaultModel ?? "",
            ...(updated.providers[selectedProvider] ?? {}),
            key: newKey,
          },
        },
      };
    }

    saveMultiConfig(updated);
    const newConfig = resolveConfig(updated);

    const keyMsg = newKey && newKey !== currentKey ? "，API Key 已保存" : "";
    console.log(GREEN(`\n  ✓ 已切换到 ${PROVIDERS[selectedProvider]!.label}${keyMsg}`) + "\n");
    if (!newConfig.apiKey) {
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
  return (
    PURPLE("  ◆") +
    GRAY(` ${label}`) +
    CYAN(`  [${config.model}]`) +
    GRAY("   输入 / 调出指令菜单\n")
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
    console.log(GRAY("\n  交互模式内输入 / 调出指令菜单\n"));
    return;
  }

  if (args[0] === "--version" || args[0] === "-v") {
    console.log("sharkcode v0.3.4");
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

  let multiConfig = readMultiConfig();
  let config      = resolveConfig(multiConfig);

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
    try {
      messages = await runAgent(messages, config);
      // Ensure raw mode is still on after agent runs
      // (bash tool via askPermission uses raw mode too, so this is a safety net)
      try { process.stdin.setRawMode(true); process.stdin.resume(); } catch {}
    } catch (err) {
      console.error(RED(`\n❌ ${String(err)}\n`));
      messages.pop();
      try { process.stdin.setRawMode(true); process.stdin.resume(); } catch {}
    }
  }
}

main().catch((err) => {
  console.error(chalk.red(`Fatal: ${String(err)}`));
  process.exit(1);
});


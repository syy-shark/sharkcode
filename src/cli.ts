import chalk from "chalk";
import * as readline from "readline";
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

// ─── Purple pixel-art banner ──────────────────────────────────────────────────
const PURPLE = chalk.hex("#a855f7");
const GRAY = chalk.gray;
const YELLOW = chalk.yellow;
const GREEN = chalk.green;
const RED = chalk.red;
const CYAN = chalk.cyan;

// 5×5 bitmap glyphs, each pixel rendered as "██" (2 chars wide)
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

// ─── Slash command help ───────────────────────────────────────────────────────

function printSlashHelp(): void {
  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
  console.log(PURPLE("\n  ◆ Slash Commands\n"));
  const cmds: [string, string][] = [
    ["/provider",              "show current provider & list options"],
    ["/provider <name>",       "switch provider  (deepseek | ark)"],
    ["/key <api-key>",         "set API key for current provider"],
    ["/model <model-id>",      "set model for current provider"],
    ["/clear",                 "clear conversation history"],
    ["/help",                  "show this menu"],
    ["/exit",                  "quit"],
  ];
  for (const [cmd, desc] of cmds) {
    console.log("  " + PURPLE(pad(cmd, 26)) + GRAY(desc));
  }
  console.log();
}

// ─── Slash command handler ────────────────────────────────────────────────────

interface SlashResult {
  multiConfig: MultiConfig;
  config: Config;
  clearHistory?: boolean;
  exit?: boolean;
}

function handleSlash(
  input: string,
  multiConfig: MultiConfig
): SlashResult | null {
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0]!.toLowerCase();
  const arg = parts.slice(1).join(" ");

  // ── /help or bare / ──────────────────────────────────────────────────────
  if (cmd === "/" || cmd === "/help") {
    printSlashHelp();
    return { multiConfig, config: resolveConfig(multiConfig) };
  }

  // ── /exit ─────────────────────────────────────────────────────────────────
  if (cmd === "/exit" || cmd === "/quit") {
    console.log(GRAY("Bye! 🦈"));
    return { multiConfig, config: resolveConfig(multiConfig), exit: true };
  }

  // ── /clear ────────────────────────────────────────────────────────────────
  if (cmd === "/clear") {
    console.log(GRAY("  ✓ Conversation cleared."));
    return { multiConfig, config: resolveConfig(multiConfig), clearHistory: true };
  }

  // ── /provider ─────────────────────────────────────────────────────────────
  if (cmd === "/provider") {
    if (!arg) {
      // Show status
      const current = multiConfig.activeProvider;
      console.log(PURPLE("\n  ◆ Providers\n"));
      for (const [name, meta] of Object.entries(PROVIDERS)) {
        const entry = multiConfig.providers[name];
        const active = name === current;
        const hasKey = !!entry?.key;
        const marker = active ? PURPLE("▶") : " ";
        const keyStatus = hasKey ? GREEN("✓ key set") : YELLOW("✗ no key");
        console.log(
          `  ${marker} ${active ? PURPLE(name) : GRAY(name)}` +
          `  ${GRAY(meta.label)}` +
          `  ${keyStatus}` +
          (active ? `  ${GRAY("model: " + (entry?.model ?? meta.defaultModel))}` : "")
        );
      }
      console.log(
        `\n  ${GRAY("Usage:")} ${PURPLE("/provider deepseek")} ${GRAY("or")} ${PURPLE("/provider ark")}\n`
      );
      return { multiConfig, config: resolveConfig(multiConfig) };
    }

    const name = arg.toLowerCase();
    if (!PROVIDERS[name]) {
      console.log(RED(`  ✗ Unknown provider: "${name}". Available: ${Object.keys(PROVIDERS).join(", ")}`));
      return { multiConfig, config: resolveConfig(multiConfig) };
    }

    const updated: MultiConfig = { ...multiConfig, activeProvider: name };
    saveMultiConfig(updated);
    const newConfig = resolveConfig(updated);

    console.log(
      GREEN(`\n  ✓ Switched to ${PROVIDERS[name]!.label}`) +
      GRAY(` (${name}) — model: ${newConfig.model}`)
    );

    if (!newConfig.apiKey) {
      console.log(YELLOW(`  ⚠ No API key set. Use /key <your-key> to configure it.\n`));
    } else {
      console.log();
    }

    return { multiConfig: updated, config: newConfig };
  }

  // ── /key ──────────────────────────────────────────────────────────────────
  if (cmd === "/key") {
    if (!arg) {
      console.log(YELLOW(`  Usage: /key <your-api-key>`));
      return { multiConfig, config: resolveConfig(multiConfig) };
    }

    const name = multiConfig.activeProvider;
    const updated: MultiConfig = {
      ...multiConfig,
      providers: {
        ...multiConfig.providers,
        [name]: {
          ...(multiConfig.providers[name] ?? { model: PROVIDERS[name]?.defaultModel ?? "" }),
          key: arg,
        },
      },
    };
    saveMultiConfig(updated);

    // Mask the key for display
    const masked = arg.slice(0, 6) + "•".repeat(Math.max(0, arg.length - 10)) + arg.slice(-4);
    console.log(GREEN(`  ✓ API key saved for ${name}: ${GRAY(masked)}\n`));

    return { multiConfig: updated, config: resolveConfig(updated) };
  }

  // ── /model ────────────────────────────────────────────────────────────────
  if (cmd === "/model") {
    if (!arg) {
      const name = multiConfig.activeProvider;
      const current = multiConfig.providers[name]?.model ?? PROVIDERS[name]?.defaultModel;
      console.log(GRAY(`  Current model: `) + PURPLE(current ?? "unknown"));
      console.log(GRAY(`  Usage: /model <model-id>\n`));
      return { multiConfig, config: resolveConfig(multiConfig) };
    }

    const name = multiConfig.activeProvider;
    const updated: MultiConfig = {
      ...multiConfig,
      providers: {
        ...multiConfig.providers,
        [name]: {
          ...(multiConfig.providers[name] ?? { key: "" }),
          model: arg,
        },
      },
    };
    saveMultiConfig(updated);
    console.log(GREEN(`  ✓ Model set to ${PURPLE(arg)} for ${name}\n`));

    return { multiConfig: updated, config: resolveConfig(updated) };
  }

  // ── Unknown command ───────────────────────────────────────────────────────
  console.log(RED(`  ✗ Unknown command: "${cmd}"`));
  console.log(GRAY(`  Type /help to see available commands.\n`));
  return { multiConfig, config: resolveConfig(multiConfig) };
}

// ─── Read one line from stdin ─────────────────────────────────────────────────
async function readLine(prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    rl.question(prompt, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
    rl.on("close", () => {
      if (!answered) resolve(null);
    });
  });
}

// ─── Status line ─────────────────────────────────────────────────────────────
function statusLine(config: Config): string {
  const providerLabel = PROVIDERS[config.providerName]?.label ?? config.providerName;
  return (
    PURPLE("  ◆") +
    GRAY(` ${providerLabel}`) +
    CYAN(` [${config.model}]`) +
    GRAY('   type /help for commands\n')
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "--help" || args[0] === "-h") {
    console.log(BANNER);
    console.log(PURPLE("  Usage:"));
    console.log("    " + PURPLE("sharkcode") + GRAY("                   — interactive mode"));
    console.log("    " + PURPLE("sharkcode") + YELLOW(' "prompt"') + GRAY("         — single-shot mode"));
    console.log("\n  " + PURPLE("Slash commands (in interactive mode):"));
    printSlashHelp();
    return;
  }

  if (args[0] === "--version" || args[0] === "-v") {
    console.log("sharkcode v0.3.0");
    return;
  }

  // ── Single-shot mode ──────────────────────────────────────────────────────
  if (args.length > 0) {
    const mc = readMultiConfig();
    const config = resolveConfig(mc);

    if (!config.apiKey) {
      console.error(RED("❌ No API key found for provider: " + config.providerName));
      console.error(GRAY("   Run sharkcode in interactive mode and use /key <your-key>"));
      process.exit(1);
    }

    console.log(PURPLE("\n🦈 SharkCode") + GRAY(` | ${PROVIDERS[config.providerName]?.label ?? config.providerName} | model: ${config.model}\n`));
    const messages: ModelMessage[] = [{ role: "user", content: args.join(" ") }];
    await runAgent(messages, config);
    return;
  }

  // ── Interactive REPL mode ─────────────────────────────────────────────────
  console.log(BANNER);

  let multiConfig = readMultiConfig();
  let config = resolveConfig(multiConfig);

  console.log(statusLine(config));

  // Warn if no key configured
  if (!config.apiKey) {
    console.log(
      YELLOW("  ⚠ No API key configured for ") +
      PURPLE(PROVIDERS[config.providerName]?.label ?? config.providerName) +
      YELLOW(".")
    );
    console.log(GRAY("    Use /key <your-api-key> to set it, or /provider to switch.\n"));
  }

  let messages: ModelMessage[] = [];

  while (true) {
    const input = await readLine(PURPLE("\n◆ "));

    if (input === null) {
      console.log(GRAY("\nBye! 🦈"));
      break;
    }

    const trimmed = input.trim();
    if (!trimmed) continue;

    // ── Plain exit shortcuts ──────────────────────────────────────────────
    if (trimmed === "exit" || trimmed === "quit") {
      console.log(GRAY("Bye! 🦈"));
      break;
    }

    // ── Slash commands ────────────────────────────────────────────────────
    if (trimmed.startsWith("/")) {
      const result = handleSlash(trimmed, multiConfig);
      if (!result) continue;
      multiConfig = result.multiConfig;
      config = result.config;
      if (result.clearHistory) messages = [];
      if (result.exit) break;
      continue;
    }

    // ── Normal chat ───────────────────────────────────────────────────────
    if (!config.apiKey) {
      console.log(
        YELLOW("\n  ⚠ No API key for ") +
        PURPLE(PROVIDERS[config.providerName]?.label ?? config.providerName) +
        YELLOW(". Set it with /key <your-api-key>\n")
      );
      continue;
    }

    messages.push({ role: "user", content: trimmed });

    try {
      messages = await runAgent(messages, config);
    } catch (err: unknown) {
      const error = err as Error;
      console.error(RED(`\n❌ Error: ${error.message}`));
      if (error.message?.includes("401") || error.message?.includes("Unauthorized")) {
        console.error(YELLOW("   Check your API key with /key <your-api-key>"));
      }
      messages = messages.slice(0, -1);
    }
  }
}

main().catch((err) => {
  console.error(RED(`\n❌ Fatal: ${(err as Error).message}`));
  process.exit(1);
});

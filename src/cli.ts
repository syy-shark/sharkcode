import chalk from "chalk";
import * as readline from "readline";
import { loadConfig } from "./config.ts";
import { runAgent } from "./agent.ts";
import type { ModelMessage } from "ai";

// ─── Purple pixel-art banner ─────────────────────────────────────────────────
const PURPLE = chalk.hex("#a855f7");

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
      if (i < letters.length - 1) line += "  "; // gap between letters
    }
    rows.push(PURPLE(line));
  }
  return rows;
}

// "shark" width = 5×10 + 4×2 = 58 chars
// "code"  width = 4×10 + 3×2 = 46 chars  →  center offset = (58−46)/2 = 6
const BANNER = ["", ...renderWord("shark", 2), "", ...renderWord("code", 8), ""].join("\n");

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
      if (!answered) resolve(null); // Ctrl+D / EOF
    });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "--help" || args[0] === "-h") {
    console.log(BANNER);
    console.log(PURPLE("  Usage:"));
    console.log("    " + PURPLE("sharkcode") + chalk.gray("                   — interactive mode"));
    console.log("    " + PURPLE("sharkcode") + chalk.yellow(' "prompt"') + chalk.gray("         — single-shot mode\n"));
    return;
  }

  if (args[0] === "--version" || args[0] === "-v") {
    console.log("sharkcode v0.2.0");
    return;
  }

  const config = loadConfig();

  // ── Single-shot mode ──────────────────────────────────────────────────────
  if (args.length > 0) {
    console.log(PURPLE("\n🦈 SharkCode") + chalk.gray(` | model: ${config.model}\n`));
    const messages: ModelMessage[] = [{ role: "user", content: args.join(" ") }];
    await runAgent(messages, config);
    return;
  }

  // ── Interactive REPL mode ─────────────────────────────────────────────────
  console.log(BANNER);
  console.log(
    PURPLE("  ◆") +
      chalk.gray(` model: ${config.model}`) +
      chalk.gray('   type "exit" to quit\n')
  );

  let messages: ModelMessage[] = [];

  while (true) {
    const input = await readLine(PURPLE("\n◆ "));

    if (input === null) {
      // Ctrl+D / EOF
      console.log(chalk.gray("\nBye! 🦈"));
      break;
    }

    const trimmed = input.trim();
    if (!trimmed) continue;

    if (trimmed === "exit" || trimmed === "quit" || trimmed === "/exit") {
      console.log(chalk.gray("Bye! 🦈"));
      break;
    }

    messages.push({ role: "user", content: trimmed });

    try {
      messages = await runAgent(messages, config);
    } catch (err: unknown) {
      const error = err as Error;
      console.error(chalk.red(`\n❌ Error: ${error.message}`));
      if (error.message?.includes("401") || error.message?.includes("Unauthorized")) {
        console.error(chalk.yellow("   Check your API key in ~/.sharkcode/config.toml"));
      }
      // Drop the failed user message so history stays clean
      messages = messages.slice(0, -1);
    }
  }
}

main().catch((err) => {
  console.error(chalk.red(`\n❌ Fatal: ${err.message}`));
  process.exit(1);
});


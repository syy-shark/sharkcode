import { stepCountIs, streamText, type ModelMessage } from "ai";
import chalk from "chalk";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { tools } from "./tools/index.ts";
import { createProvider } from "./provider.ts";
import type { Config } from "./config.ts";
import { registerToolSpinner, unregisterToolSpinner } from "./spinnerState.ts";

const PURPLE = chalk.hex("#a855f7");
const PURPLE_DIM = chalk.hex("#7c3aed");

// ─── Tool display labels ──────────────────────────────────────────────────────
const TOOL_LABELS: Record<string, { icon: string; verb: string }> = {
  read_file:       { icon: "📖", verb: "reading" },
  write_file:      { icon: "✍️ ", verb: "writing" },
  edit_file:       { icon: "✏️ ", verb: "editing" },
  bash:            { icon: "⚙️ ", verb: "running" },
  glob:            { icon: "🔍", verb: "finding files" },
  grep:            { icon: "🔎", verb: "searching" },
  list_directory:  { icon: "📂", verb: "listing" },
  web_fetch:       { icon: "🌐", verb: "fetching" },
  think:           { icon: "💭", verb: "thinking" },
};

// ─── Purple scan-line animation ───────────────────────────────────────────────
function playScanLine(): Promise<void> {
  return new Promise((resolve) => {
    const cols = Math.min(process.stdout.columns ?? 80, 72);
    const steps = 12;
    const chars = "▏▎▍▌▋▊▉█▉▊▋▌▍▎▏";
    let frame = 0;
    const t = setInterval(() => {
      const pos = Math.floor((frame / steps) * cols);
      const bar =
        PURPLE_DIM("─".repeat(pos)) +
        PURPLE(chars[frame % chars.length]!) +
        chalk.dim("─".repeat(Math.max(0, cols - pos - 1)));
      process.stdout.write(`\r${bar}`);
      frame++;
      if (frame >= steps) {
        clearInterval(t);
        process.stdout.write(`\r${PURPLE("─".repeat(cols))}\n`);
        resolve();
      }
    }, 30);
  });
}

// ─── Spinner factory ──────────────────────────────────────────────────────────
function createSpinner(label: string) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      timer = setInterval(() => {
        process.stdout.write(
          `\r  ${PURPLE(frames[i++ % frames.length]!)} ${chalk.gray(label)}`
        );
      }, 80);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        process.stdout.write("\r\x1b[K"); // clear spinner line
      }
    },
  };
}

// ─── Project context detection ────────────────────────────────────────────────
function detectProject(): string {
  const cwd = process.cwd();
  const parts: string[] = [];

  if (existsSync(join(cwd, "package.json"))) {
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf-8"));
      const deps = [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ];
      parts.push(`Node.js project: ${pkg.name ?? "unknown"} v${pkg.version ?? "0.0.0"}`);
      if (deps.length > 0) parts.push(`  Key deps: ${deps.slice(0, 15).join(", ")}`);
      if (pkg.scripts) parts.push(`  Scripts: ${Object.keys(pkg.scripts).join(", ")}`);
    } catch { /* ignore */ }
  }
  if (existsSync(join(cwd, "Cargo.toml"))) parts.push("Rust project (Cargo.toml detected)");
  if (existsSync(join(cwd, "go.mod"))) parts.push("Go project (go.mod detected)");
  if (existsSync(join(cwd, "pyproject.toml"))) parts.push("Python project (pyproject.toml)");
  if (existsSync(join(cwd, "setup.py"))) parts.push("Python project (setup.py)");
  if (existsSync(join(cwd, "pom.xml"))) parts.push("Java/Maven project");
  if (existsSync(join(cwd, "build.gradle")) || existsSync(join(cwd, "build.gradle.kts"))) parts.push("Java/Gradle project");
  if (existsSync(join(cwd, "Makefile"))) parts.push("Makefile present");
  if (existsSync(join(cwd, "docker-compose.yml")) || existsSync(join(cwd, "Dockerfile"))) parts.push("Docker project");
  if (existsSync(join(cwd, "tsconfig.json"))) parts.push("TypeScript configured");

  return parts.join("\n");
}

function readProjectInstructions(): string | null {
  const candidates = [
    join(process.cwd(), ".sharkcode.md"),
    join(process.cwd(), ".sharkcode", "instructions.md"),
    join(process.cwd(), "SHARKCODE.md"),
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return readFileSync(p, "utf-8").slice(0, 8000);
      } catch { /* ignore */ }
    }
  }
  return null;
}

function getGitContext(): string | null {
  try {
    const branch = execSync("git branch --show-current", {
      encoding: "utf-8", timeout: 3000, cwd: process.cwd(),
    }).trim();
    const status = execSync("git status --porcelain", {
      encoding: "utf-8", timeout: 3000, cwd: process.cwd(),
    }).trim();

    let ctx = `Git branch: ${branch}`;
    if (status) {
      const lines = status.split("\n");
      ctx += `\nChanged files (${lines.length}):`;
      ctx += "\n" + lines.slice(0, 15).join("\n");
      if (lines.length > 15) ctx += `\n  ... and ${lines.length - 15} more`;
    } else {
      ctx += "\nWorking tree clean";
    }
    return ctx;
  } catch {
    return null;
  }
}

function buildSystemPrompt(): string {
  const os = process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux";
  const shell = process.platform === "win32" ? "PowerShell" : "bash";

  const parts: string[] = [];

  parts.push(
    `You are Shark Code 🦈, a powerful AI coding agent running locally on the user's machine. ` +
    `You help users understand, write, debug, and refactor code by reading/writing files, ` +
    `searching codebases, and running shell commands.`
  );

  // Environment
  parts.push(`
Environment:
- OS: ${os}
- Shell: ${shell}
- Working directory: ${process.cwd()}`);

  // Project context
  const projectCtx = detectProject();
  if (projectCtx) parts.push(`\nProject:\n${projectCtx}`);

  // Git context
  const gitCtx = getGitContext();
  if (gitCtx) parts.push(`\n${gitCtx}`);

  // Project instructions
  const instructions = readProjectInstructions();
  if (instructions) {
    parts.push(`\n<project_instructions>\n${instructions}\n</project_instructions>`);
  }

  // Tools
  parts.push(`
Available tools:
- read_file: Read file contents (supports line ranges and line numbers)
- write_file: Create or overwrite files (creates parent directories)
- edit_file: Find and replace an exact string in a file
- bash: Execute shell commands (may require user approval)
- glob: Find files by glob pattern (e.g. '**/*.ts', 'src/**/*.{js,tsx}')
- grep: Search for text/regex across files with line numbers
- list_directory: List directory contents as a tree with file sizes
- web_fetch: Fetch content from URLs (HTML auto-converted to text)
- think: Plan your approach before complex multi-step tasks`);

  // Guidelines
  parts.push(`
Guidelines:
1. EXPLORE FIRST: Use glob, grep, and list_directory to understand the codebase before making changes
2. ALWAYS read a file before editing it — never edit blind
3. Use think tool to plan multi-step changes before starting
4. Use edit_file for surgical changes, write_file for new files
5. After making changes, verify them (re-read the file, run tests if applicable)
6. When using bash, prefer ${shell}-compatible commands
7. Keep changes minimal and focused on the user's request
8. Summarize what you changed when done
9. If a task is unclear, ask for clarification
10. Consider edge cases and error handling
11. Respect existing code style and conventions
12. For large refactors, make changes incrementally and verify each step`);

  return parts.join("\n");
}

export async function runAgent(
  messages: ModelMessage[],
  config: Config
): Promise<ModelMessage[]> {
  const model = createProvider(config);

  const result = streamText({
    model,
    system: buildSystemPrompt(),
    messages,
    tools,
    maxRetries: 2,
    stopWhen: stepCountIs(50),
  });

  let currentStep = 0;
  const thinkingSpinner = createSpinner("thinking...");
  let thinkingDone = false;

  // Track consecutive trailing newlines written to stdout so we can collapse
  // the excess blank lines the LLM emits before/after tool calls.
  let trailingNL = 0;

  function writeOut(text: string) {
    if (!text) return;
    process.stdout.write(text);
    for (const ch of text) {
      if (ch === "\n") trailingNL++;
      else trailingNL = 0;
    }
  }

  // Collapse all but `keep` trailing blank lines using ANSI cursor-up + clear.
  function collapseNL(keep = 1) {
    if (trailingNL > keep) {
      const remove = trailingNL - keep;
      process.stdout.write(`\x1b[${remove}A\x1b[J`);
      trailingNL = keep;
    }
  }

  // Tool-level spinner (one active at a time)
  let toolSpinner: ReturnType<typeof createSpinner> | null = null;
  let currentToolName = "";

  thinkingSpinner.start();

  for await (const event of result.fullStream) {
    // Stop thinking spinner on first real output
    if (!thinkingDone && (event.type === "text-delta" || event.type === "tool-call" || event.type === "error")) {
      thinkingSpinner.stop();
      thinkingDone = true;
    }

    switch (event.type) {
      case "text-delta":
        // Collapse excess blank lines between a tool result and next paragraph
        if (trailingNL > 1 && event.text.trim() !== "") collapseNL(1);
        writeOut(event.text);
        break;

      case "tool-call": {
        const meta = TOOL_LABELS[event.toolName] ?? { icon: "🔧", verb: "running" };
        currentToolName = event.toolName;

        const argHint = getArgHint(event.toolName, event.input);

        // Collapse the LLM's excess blank lines before the scan-line (keep 1)
        if (trailingNL === 0) writeOut("\n");
        collapseNL(1);

        // Purple scan-line flash
        await playScanLine();

        // Compact tool header: icon + verb + path on ONE line
        process.stdout.write(
          `  ${meta.icon} ${PURPLE(meta.verb)}${argHint ? chalk.dim(" › ") + chalk.white(argHint) : ""}\n`
        );

        // Spinner starts immediately on next line
        toolSpinner = createSpinner(`${meta.verb}...`);
        registerToolSpinner(() => toolSpinner?.stop());
        toolSpinner.start();

        trailingNL = 0;
        break;
      }

      case "tool-result": {
        if (toolSpinner) {
          toolSpinner.stop();
          toolSpinner = null;
          unregisterToolSpinner();
        }
        const summary = truncate(String(event.output), 80);
        // Single compact result line
        process.stdout.write(
          `  ${chalk.green("✓")} ${chalk.dim(summary)}\n`
        );
        trailingNL = 1;
        break;
      }

      case "tool-error":
        if (toolSpinner) {
          toolSpinner.stop();
          toolSpinner = null;
          unregisterToolSpinner();
        }
        process.stderr.write(
          chalk.red(`  ✗ [${event.toolName}] ${String(event.error)}\n`)
        );
        trailingNL = 1;
        break;

      case "finish-step":
        currentStep++;
        break;

      case "error":
        if (toolSpinner) { toolSpinner.stop(); toolSpinner = null; unregisterToolSpinner(); }
        thinkingSpinner.stop();
        process.stderr.write(chalk.red(`\n❌ ${String(event.error)}\n`));
        trailingNL = 1;
        break;
    }
  }

  // Ensure spinners are always stopped
  thinkingSpinner.stop();
  if (toolSpinner) { toolSpinner.stop(); unregisterToolSpinner(); }

  if (trailingNL === 0) process.stdout.write("\n");

  const usage = await result.totalUsage;
  if (usage) {
    process.stderr.write(
      chalk.dim(`  📊 ${usage.inputTokens}↑ ${usage.outputTokens}↓  steps:${currentStep}\n`)
    );
  }

  // Append response messages to conversation history for multi-turn support
  try {
    const { messages: responseMessages } = await result.response;
    return [...messages, ...responseMessages] as ModelMessage[];
  } catch {
    return messages;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getArgHint(toolName: string, args: unknown): string {
  if (typeof args !== "object" || args === null) return "";
  const obj = args as Record<string, unknown>;

  switch (toolName) {
    case "read_file":
    case "write_file":
    case "edit_file":
      return truncate(String(obj.path ?? obj.file_path ?? ""), 50);
    case "bash":
      return truncate(String(obj.command ?? ""), 50);
    default: {
      const first = Object.values(obj).find((v) => typeof v === "string");
      return first ? truncate(first as string, 50) : "";
    }
  }
}

function truncate(str: string, max: number): string {
  const oneLine = str.replace(/\n/g, "↵");
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

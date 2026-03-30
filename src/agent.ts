import { stepCountIs, streamText, type ModelMessage } from "ai";
import chalk from "chalk";
import { tools } from "./tools/index.ts";
import { createProvider } from "./provider.ts";
import type { Config } from "./config.ts";
import { registerToolSpinner, unregisterToolSpinner } from "./spinnerState.ts";

const PURPLE = chalk.hex("#a855f7");
const PURPLE_DIM = chalk.hex("#7c3aed");

// ─── Tool display labels ──────────────────────────────────────────────────────
const TOOL_LABELS: Record<string, { icon: string; verb: string }> = {
  read_file:  { icon: "📖", verb: "reading" },
  write_file: { icon: "✍️ ", verb: "writing" },
  edit_file:  { icon: "✏️ ", verb: "editing" },
  bash:       { icon: "⚙️ ", verb: "running" },
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

function buildSystemPrompt(): string {
  return `You are Shark Code, an AI coding assistant. You help users with coding tasks by reading, writing, and editing files, and running shell commands.

Current working directory: ${process.cwd()}
Environment: Windows with PowerShell. Use PowerShell-compatible commands, not bash syntax.

Available tools:
- read_file: Read the contents of a file
- write_file: Create or overwrite a file (creates parent dirs)
- edit_file: Find and replace an exact string in a file
- bash: Execute a shell command (requires user approval)

Guidelines:
- Always read a file before editing it
- Explain what you plan to do before making changes
- Use edit_file for targeted changes, write_file for creating new files
- When using shell commands, prefer PowerShell built-ins or commands that work on Windows
- Keep changes minimal and focused on the user's request
- When done, summarize what you changed`;
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
    stopWhen: stepCountIs(30),
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

import { stepCountIs, streamText, type ModelMessage } from "ai";
import chalk from "chalk";
import { tools } from "./tools/index.ts";
import { createProvider } from "./provider.ts";
import type { Config } from "./config.ts";

const PURPLE = chalk.hex("#a855f7");

// ─── Tool display labels ──────────────────────────────────────────────────────
const TOOL_LABELS: Record<string, { icon: string; verb: string }> = {
  read_file:  { icon: "📖", verb: "reading file" },
  write_file: { icon: "✍️ ", verb: "writing file" },
  edit_file:  { icon: "✏️ ", verb: "editing file" },
  bash:       { icon: "⚙️ ", verb: "running command" },
};

// ─── Spinner factory ──────────────────────────────────────────────────────────
function createSpinner(label: string) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      process.stdout.write("\n");
      timer = setInterval(() => {
        process.stdout.write(
          `\r${PURPLE(frames[i++ % frames.length]!)} ${chalk.gray(label)}`
        );
      }, 80);
    },
    update(newLabel: string) {
      label = newLabel;
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        process.stdout.write("\r\x1b[K"); // clear the spinner line
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

  // Tool-level spinner (one active at a time)
  let toolSpinner: ReturnType<typeof createSpinner> | null = null;
  // Track the current tool name for the result line
  let currentToolName = "";
  let currentToolArgs: unknown = null;

  thinkingSpinner.start();

  for await (const event of result.fullStream) {
    // Stop thinking spinner on the first real output
    if (!thinkingDone && (event.type === "text-delta" || event.type === "tool-call" || event.type === "error")) {
      thinkingSpinner.stop();
      thinkingDone = true;
    }

    switch (event.type) {
      case "text-delta":
        process.stdout.write(event.text);
        break;

      case "tool-call": {
        const meta = TOOL_LABELS[event.toolName] ?? { icon: "🔧", verb: "running" };
        currentToolName = event.toolName;
        currentToolArgs = event.input;

        // Show what file / command we're acting on
        const argHint = getArgHint(event.toolName, event.input);
        const spinLabel = `${meta.verb}${argHint ? ` › ${argHint}` : ""}`;

        process.stdout.write(
          "\n" +
          chalk.cyan(`${meta.icon}  ${event.toolName}`) +
          chalk.gray(argHint ? `  ${argHint}` : "") +
          "\n"
        );

        toolSpinner = createSpinner(spinLabel);
        toolSpinner.start();
        break;
      }

      case "tool-result": {
        if (toolSpinner) {
          toolSpinner.stop();
          toolSpinner = null;
        }
        const meta = TOOL_LABELS[currentToolName] ?? { icon: "🔧", verb: "done" };
        const summary = truncate(String(event.output), 100);
        process.stdout.write(
          chalk.green(`  ✓ done`) +
          chalk.gray(`  ${summary}`) +
          "\n\n"
        );
        break;
      }

      case "tool-error":
        if (toolSpinner) {
          toolSpinner.stop();
          toolSpinner = null;
        }
        process.stderr.write(
          chalk.red(`\n  ✗ Tool error [${event.toolName}]: ${String(event.error)}\n`)
        );
        break;

      case "finish-step":
        currentStep++;
        break;

      case "error":
        if (toolSpinner) { toolSpinner.stop(); toolSpinner = null; }
        thinkingSpinner.stop();
        process.stderr.write(chalk.red(`\n❌ Error: ${String(event.error)}\n`));
        break;
    }
  }

  // Ensure spinners are always stopped
  thinkingSpinner.stop();
  if (toolSpinner) toolSpinner.stop();

  process.stdout.write("\n");

  const usage = await result.totalUsage;
  if (usage) {
    process.stderr.write(
      chalk.gray(
        `📊 ${usage.inputTokens} in / ${usage.outputTokens} out | steps: ${currentStep}\n`
      )
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

/**
 * Extract a short human-readable arg hint (e.g. the file path or command).
 */
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
      // First string value
      const first = Object.values(obj).find((v) => typeof v === "string");
      return first ? truncate(first as string, 50) : "";
    }
  }
}

function formatArgs(args: unknown): string {
  if (typeof args !== "object" || args === null) return String(args);
  const obj = args as Record<string, unknown>;
  return Object.entries(obj)
    .map(([k, v]) => {
      const val = typeof v === "string" ? truncate(v, 60) : String(v);
      return `${k}: ${val}`;
    })
    .join(", ");
}

function truncate(str: string, max: number): string {
  const oneLine = str.replace(/\n/g, "↵");
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

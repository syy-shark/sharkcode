import { stepCountIs, streamText } from "ai";
import chalk from "chalk";
import { tools } from "./tools/index.ts";
import { createProvider } from "./provider.ts";
import type { Config } from "./config.ts";

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

export async function runAgent(prompt: string, config: Config) {
  const model = createProvider(config);

  const result = streamText({
    model,
    system: buildSystemPrompt(),
    prompt,
    tools,
    stopWhen: stepCountIs(30),
  });

  let currentStep = 0;

  for await (const event of result.fullStream) {
    switch (event.type) {
      case "text-delta":
        process.stdout.write(event.text);
        break;

      case "tool-input-available":
        process.stdout.write(
          chalk.cyan(`\n🔧 ${event.toolName}`) +
            chalk.gray(`(${formatArgs(event.input)})\n`)
        );
        break;

      case "tool-output-available":
        process.stdout.write(
          chalk.green(`✅ tool`) +
            chalk.gray(` → ${truncate(String(event.output), 120)}\n\n`)
        );
        break;

      case "tool-output-error":
        process.stderr.write(chalk.red(`\n❌ Tool error: ${event.errorText}\n`));
        break;

      case "finish-step":
        currentStep++;
        break;

      case "error":
        process.stderr.write(chalk.red(`\n❌ Error: ${event.errorText}\n`));
        break;
    }
  }

  process.stdout.write("\n");

  const usage = await result.totalUsage;
  if (usage) {
    process.stderr.write(
      chalk.gray(
        `\n📊 Tokens: ${usage.inputTokens} in / ${usage.outputTokens} out | Steps: ${currentStep}\n`
      )
    );
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
  const oneLine = str.replace(/\n/g, "\\n");
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

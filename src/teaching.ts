import { type LanguageModel, streamText } from "ai";
import type { TeachingVerbosity } from "./config.ts";

type LanguageModelV1 = LanguageModel;

export type TeachingEvent =
  | { type: "teaching-start" }
  | { type: "teaching-delta"; delta: string }
  | { type: "teaching-end" }
  | { type: "teaching-error"; message: string };

export interface TeachingContext {
  userPrompt: string;
  toolCalls: Array<{ toolName: string; args: unknown }>;
  toolResults: Array<{ toolName: string; result: string }>;
  agentTextSummary: string;
}

interface TeachingOrchestratorConfig {
  model: string;
  verbosity: TeachingVerbosity;
  getProvider: () => LanguageModelV1;
}

export class TeachingOrchestrator {
  private readonly listeners = new Set<(event: TeachingEvent) => void>();

  constructor(private readonly config: TeachingOrchestratorConfig) {}

  subscribe(listener: (event: TeachingEvent) => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async teach(context: TeachingContext, signal?: AbortSignal): Promise<void> {
    this.emit({ type: "teaching-start" });

    if (signal?.aborted) {
      this.emit({ type: "teaching-end" });
      return;
    }

    const system = buildTeachingSystemPrompt(this.config.verbosity);
    const prompt = buildTeachingUserPrompt(context);

    try {
      const result = streamText({
        model: this.config.getProvider(),
        system,
        prompt,
        abortSignal: signal,
      });

      for await (const part of result.fullStream) {
        if (signal?.aborted) {
          this.emit({ type: "teaching-end" });
          return;
        }

        if (part.type === "text-delta") {
          const delta = extractTextDelta(part);
          if (delta) {
            this.emit({ type: "teaching-delta", delta });
          }
          continue;
        }

        if (part.type === "error") {
          this.emit({
            type: "teaching-error",
            message: extractErrorMessage(part),
          });
          return;
        }
      }

      this.emit({ type: "teaching-end" });
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) {
        this.emit({ type: "teaching-end" });
        return;
      }

      this.emit({
        type: "teaching-error",
        message: extractErrorMessage(error),
      });
    }
  }

  private emit(event: TeachingEvent) {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // Ignore subscriber errors so teaching stream remains isolated.
      }
    }
  }
}

function buildTeachingSystemPrompt(verbosity: TeachingVerbosity): string {
  return [
    "你是一位编程教学助手。用户正在使用 AI coding agent 完成编程任务。",
    "请用中文解释 agent 正在做什么，帮助用户学习和理解。",
    verbosity === "简洁" ? "请简洁地解释，用2-3句话。" : "",
    verbosity === "详细" ? "请详细解释每个步骤，包括为什么这样做。" : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildTeachingUserPrompt(context: TeachingContext): string {
  const toolCalls =
    context.toolCalls.length > 0
      ? context.toolCalls
          .map(
            (toolCall) =>
              `- 调用工具 ${toolCall.toolName}: ${truncateString(safeJsonStringify(toolCall.args), 200)}`,
          )
          .join("\n")
      : "- 无";

  const toolResults =
    context.toolResults.length > 0
      ? `\n\n工具结果：\n${context.toolResults
          .map(
            (toolResult) =>
              `- ${toolResult.toolName}: ${truncateString(toolResult.result, 200)}`,
          )
          .join("\n")}`
      : "";

  const summary = context.agentTextSummary
    ? `\n\nAgent 的回复摘要：${truncateString(context.agentTextSummary, 500)}`
    : "";

  return `用户的问题是：${context.userPrompt}

Agent 执行了以下操作：
${toolCalls}${toolResults}${summary}

请解释 agent 正在做什么以及为什么这样做。`;
}

function truncateString(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function safeJsonStringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    const serialized = JSON.stringify(value);
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}

function extractTextDelta(part: object): string {
  if ("delta" in part && typeof part.delta === "string") {
    return part.delta;
  }

  if ("textDelta" in part && typeof part.textDelta === "string") {
    return part.textDelta;
  }

  if ("text" in part && typeof part.text === "string") {
    return part.text;
  }

  return "";
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error) {
    return error;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message
  ) {
    return error.message;
  }

  return "教学流发生未知错误";
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("abort"))
  );
}

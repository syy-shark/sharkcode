import { type LanguageModel, streamText } from "ai";
import type { TeachingVerbosity } from "./config.ts";
import type { LearningProjectSnapshot, LearningPromptReview } from "./learning/types.ts";

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
  toolErrors?: Array<{ toolName: string; error: string }>;
  agentErrors?: string[];
  interrupted?: boolean;
  agentTextSummary: string;
  promptReview?: LearningPromptReview | null;
  projectSnapshot?: LearningProjectSnapshot | null;
}

interface TeachingOrchestratorConfig {
  model: string;
  verbosity: TeachingVerbosity;
  background?: string;
  getProvider: () => LanguageModelV1 | Promise<LanguageModelV1>;
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

    const system = buildTeachingSystemPrompt(this.config.verbosity, this.config.background);
    const prompt = buildTeachingUserPrompt(context);

    try {
      const model = await this.config.getProvider();
      const result = streamText({
        model,
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

function buildTeachingSystemPrompt(
  verbosity: TeachingVerbosity,
  background?: string,
): string {
  const verbosityInstruction = verbosity === "简洁"
    ? "每个部分 1-2 句，优先给出直接可用的判断和建议。"
    : verbosity === "详细"
    ? "每个部分 2-4 句，详细解释为什么这样提问、这样协作，以及下一步怎么做更好。"
    : "每个部分 1-3 句，兼顾问题判断、知识补给和行动建议。";

  return [
    "你是一位 Vibe Coding 教练。用户正在通过给 AI 下指令来做项目，并希望在过程中学会更好地与 AI 协作。",
    "请只根据给定的用户 prompt、prompt 质量点评、项目阶段、工具调用、工具结果和 agent 回复摘要来解释，不要臆测未发生的步骤。",
    background ? `用户背景：${background}` : "",
    "",
    "【输出格式要求】",
    "你必须使用以下三个固定标记来组织输出，每个标记单独占一行：",
    "",
    "【Prompt 点评】",
    "先评价用户这次给 AI 的指令，好在哪里，还缺什么。",
    "优先从明确性、上下文、边界条件、验证要求四个方面判断。",
    "",
    "【知识补给】",
    "提炼这轮真正值得学的 Vibe Coding 或技术知识。",
    "可以结合当前项目阶段，解释为什么这种提问方式会更有效。",
    "",
    "【下次试试】",
    "给用户一个可以直接执行的下一步建议，最好包含一句更好的提问方式或验证方式。",
    "",
    "【内容要求】",
    "- 不要空泛夸赞，不要写营销口号，不要重复用户原话。",
    "- 输出重点应该放在“用户怎么提需求更好”，而不是逐条复述 AI 调了什么工具。",
    "- 如果这轮出现失败、报错或回退，要明确指出用户下次该如何描述问题，AI 才更容易修。",
    "- 如果用户正在引导项目中，要点明当前阶段完成度，以及下一步最值得推进的事情。",
    "- " + verbosityInstruction,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildTeachingUserPrompt(context: TeachingContext): string {
  const promptReview = context.promptReview
    ? [
        `\n\nPrompt 点评输入：`,
        `- 评分：${context.promptReview.score}/5`,
        `- 概述：${context.promptReview.summary}`,
        ...context.promptReview.strengths.map((item) => `- 优点：${truncateString(item, 200)}`),
        ...context.promptReview.improvements.map((item) => `- 待改进：${truncateString(item, 200)}`),
        context.promptReview.suggestedPrompt
          ? `- 建议提法：${truncateString(context.promptReview.suggestedPrompt, 280)}`
          : "",
      ].filter(Boolean).join("\n")
    : "";

  const projectSnapshot = context.projectSnapshot
    ? [
        `\n\n引导项目阶段：`,
        `- 项目：${context.projectSnapshot.title}`,
        `- 状态：${context.projectSnapshot.status}`,
        `- 进度：${context.projectSnapshot.completedMilestones}/${context.projectSnapshot.totalMilestones}`,
        context.projectSnapshot.currentMilestoneTitle
          ? `- 当前阶段：${context.projectSnapshot.currentMilestoneTitle}`
          : "",
        context.projectSnapshot.currentMilestoneObjective
          ? `- 当前目标：${truncateString(context.projectSnapshot.currentMilestoneObjective, 220)}`
          : "",
        context.projectSnapshot.currentMilestoneHint
          ? `- 阶段提示：${truncateString(context.projectSnapshot.currentMilestoneHint, 220)}`
          : "",
      ].filter(Boolean).join("\n")
    : "";

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

  const toolErrors =
    (context.toolErrors?.length ?? 0) > 0
      ? `\n\n工具错误：\n${context.toolErrors!
          .map(
            (toolError) =>
              `- ${toolError.toolName}: ${truncateString(toolError.error, 200)}`,
          )
          .join("\n")}`
      : "";

  const agentErrors =
    (context.agentErrors?.length ?? 0) > 0
      ? `\n\nAgent 错误：\n${context.agentErrors!
          .map((message) => `- ${truncateString(message, 200)}`)
          .join("\n")}`
      : "";

  const interrupted = context.interrupted
    ? "\n\n执行状态：本次执行被用户中断。"
    : "";

  const summary = context.agentTextSummary
    ? `\n\nAgent 的回复摘要：${truncateString(context.agentTextSummary, 500)}`
    : "";

  return `用户的问题是：${context.userPrompt}

请根据下面信息，生成一段面向用户的 Vibe Coding 教练反馈：

工具调用：
${toolCalls}${toolResults}${toolErrors}${agentErrors}${interrupted}${summary}${promptReview}${projectSnapshot}

请输出一段面向用户的中文讲解：
- 先点评这次 prompt 是否足够具体，哪里说得好，哪里还可以更清楚
- 再补充这轮真正涉及的 Vibe Coding / 技术知识
- 最后给出下一次可以直接照着做的建议
- 如果有报错、失败或回退，要说明下次该如何描述问题
- 不要评价设计风格，不要空泛吹捧`;
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

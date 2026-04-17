import type { TeachingContext } from "../teaching.ts";
import type { LearningSignal } from "./types.ts";

const TOOL_TO_CONCEPT: Record<string, string[]> = {
  read_file: ["context-framing"],
  glob: ["context-framing"],
  grep: ["context-framing", "task-decomposition"],
  edit_file: ["iteration-feedback"],
  write_file: ["iteration-feedback"],
  bash: ["verification-loop"],
  list_directory: ["context-framing"],
  playwright: ["ui-expression", "verification-loop"],
  think: ["task-decomposition", "architecture-sense"],
};

export function detectLearningSignal(context: TeachingContext): LearningSignal {
  const concepts = new Set<string>();

  for (const toolCall of context.toolCalls) {
    const mapped = TOOL_TO_CONCEPT[toolCall.toolName];
    if (mapped) {
      for (const concept of mapped) {
        concepts.add(concept);
      }
    }
  }

  if ((context.toolErrors?.length ?? 0) > 0 || (context.agentErrors?.length ?? 0) > 0 || context.interrupted) {
    concepts.add("bug-reporting");
    concepts.add("verification-loop");
  }

  if (context.toolCalls.length >= 3) {
    concepts.add("task-decomposition");
  }

  if (context.promptReview) {
    for (const concept of context.promptReview.detectedConcepts) {
      concepts.add(concept);
    }

    if (context.promptReview.score <= 3) {
      concepts.add("requirement-clarity");
    }
  }

  if (context.projectSnapshot?.currentMilestoneTitle) {
    concepts.add("task-decomposition");
  }

  if (/页面|布局|样式|按钮|导航|hero|卡片/.test(context.userPrompt)) {
    concepts.add("ui-expression");
  }

  const shouldGenerate = concepts.size > 0;
  const reason = (context.toolErrors?.length ?? 0) > 0 || (context.agentErrors?.length ?? 0) > 0
    ? "本轮包含错误或补救动作，适合补一轮问题描述与验证反馈"
    : context.interrupted
    ? "本轮执行被中断，适合回顾如何把任务收窄"
    : context.promptReview && context.promptReview.score <= 3
    ? "本轮 prompt 仍有明显改进空间，值得给出教练反馈"
    : context.projectSnapshot?.currentMilestoneTitle
    ? "当前处于引导项目阶段，适合给出下一步提问建议"
    : context.toolCalls.length > 0
    ? "本轮出现了可转化为 Vibe Coding 技巧的执行路径"
    : "本轮缺少足够的教学信号";

  return {
    shouldGenerate,
    concepts: Array.from(concepts),
    reason,
  };
}

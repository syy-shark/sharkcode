import type { LanguageModel } from "ai";
import type { LearningConfig } from "../config.ts";
import { TeachingOrchestrator, type TeachingContext } from "../teaching.ts";
import { getLearningConcept } from "./curriculum.ts";
import type { LearningLesson } from "./types.ts";

type LanguageModelV1 = LanguageModel;

interface GenerateLessonOptions {
  context: TeachingContext;
  learning: LearningConfig;
  model: string;
  concepts: string[];
  getProvider: () => LanguageModelV1 | Promise<LanguageModelV1>;
}

export async function generateLearningLesson(options: GenerateLessonOptions): Promise<LearningLesson | null> {
  const orchestrator = new TeachingOrchestrator({
    model: options.model,
    verbosity: options.learning.verbosity,
    background: options.learning.background,
    getProvider: options.getProvider,
  });

  let detail = "";
  let failed = false;

  orchestrator.subscribe((event) => {
    if (event.type === "teaching-delta") {
      detail += event.delta;
    }
    if (event.type === "teaching-error") {
      failed = true;
    }
  });

  await orchestrator.teach(options.context);

  const normalizedDetail = detail.trim() || buildFallbackDetail(options.context, options.concepts);
  if (failed && !normalizedDetail) {
    return null;
  }

  return {
    id: `lesson-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    summary: buildLessonSummary(normalizedDetail, options.concepts),
    detail: normalizedDetail,
    concepts: options.concepts,
    createdAt: new Date().toISOString(),
    interrupted: Boolean(options.context.interrupted),
    sourcePrompt: options.context.userPrompt,
    promptReview: options.context.promptReview ?? null,
    projectSnapshot: options.context.projectSnapshot ?? null,
  };
}

export function formatLessonHint(lesson: LearningLesson): string {
  const reviewLabel = lesson.promptReview ? ` ${lesson.promptReview.score}/5` : "";
  return `  🎓 教练反馈${reviewLabel}：${lesson.summary} 输入 /learn recap 查看详细讲解，或 /learn ask 继续追问。\n`;
}

export function formatLessonRecap(lesson: LearningLesson | null): string {
  if (!lesson) {
    return "\n  🎓 当前还没有可回看的课堂内容。\n";
  }

  const conceptNames = lesson.concepts
    .map((conceptId) => getLearningConcept(conceptId)?.name ?? conceptId)
    .join("、");

  return [
    "",
    "  🎓 本轮回顾",
    `  时间：${lesson.createdAt}`,
    `  主题：${lesson.summary}`,
    lesson.promptReview ? `  Prompt 评分：${lesson.promptReview.score}/5` : "",
    `  关联概念：${conceptNames || "暂无"}`,
    lesson.projectSnapshot?.title ? `  引导项目：${lesson.projectSnapshot.title}` : "",
    lesson.projectSnapshot?.currentMilestoneTitle ? `  当前阶段：${lesson.projectSnapshot.currentMilestoneTitle}` : "",
    "",
    lesson.detail,
    "",
    "  可继续输入 /learn ask 追问这轮讲解。",
    "",
  ].join("\n");
}

function buildLessonSummary(detail: string, concepts: string[]): string {
  const structured = extractSummarySection(detail);
  if (structured) {
    return trimSummary(structured);
  }

  const firstSentence = detail
    .replace(/【[^】]+】/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .find(Boolean);

  if (firstSentence) {
    return trimSummary(firstSentence);
  }

  const conceptNames = concepts
    .map((conceptId) => getLearningConcept(conceptId)?.name)
    .filter((name): name is string => Boolean(name));

  if (conceptNames.length > 0) {
    return trimSummary(`这轮主要涉及${conceptNames.slice(0, 2).join("和")}`);
  }

  return "这轮得到了一次可直接复用的 Vibe Coding 反馈";
}

function extractSummarySection(detail: string): string {
  const marker = "【Prompt 点评】";
  const start = detail.indexOf(marker);
  if (start < 0) {
    return "";
  }

  const rest = detail.slice(start + marker.length).trimStart();
  const nextMarker = rest.indexOf("【");
  return (nextMarker >= 0 ? rest.slice(0, nextMarker) : rest).trim();
}

function trimSummary(summary: string): string {
  const singleLine = summary.replace(/\s+/g, " ").trim();
  if (singleLine.length <= 56) {
    return singleLine;
  }

  return singleLine.slice(0, 55).trimEnd() + "…";
}

function buildFallbackDetail(context: TeachingContext, concepts: string[]): string {
  const conceptNames = concepts
    .map((conceptId) => getLearningConcept(conceptId)?.name ?? conceptId)
    .join("、");
  const currentStep = context.projectSnapshot?.currentMilestoneTitle;
  const promptScore = context.promptReview?.score;
  const promptStrength = context.promptReview?.strengths[0];
  const promptImprovement = context.promptReview?.improvements[0];
  const suggestedPrompt = context.promptReview?.suggestedPrompt;

  return [
    "【Prompt 点评】",
    promptScore
      ? `这轮 prompt 评分约为 ${promptScore}/5。${promptStrength ?? "方向是对的，但还可以更具体。"}`
      : `这轮围绕“${context.userPrompt}”展开，方向已经明确，但 prompt 还可以更具体。`,
    promptImprovement
      ? `下次重点补上：${promptImprovement}`
      : "下次可以补充范围、上下文和验证方式，让 AI 更容易一次做对。",
    "",
    "【知识补给】",
    currentStep
      ? `当前正在推进引导项目的「${currentStep}」阶段，所以重点不是一次做完，而是把这一步说清楚。`
      : "这轮重点在于把一个想法翻译成 AI 能执行的任务说明。",
    conceptNames ? `这轮涉及的 Vibe Coding 技能包括：${conceptNames}。` : "这轮主要体现了如何把需求说得更可执行。",
    "",
    "【下次试试】",
    suggestedPrompt
      ? `你可以直接这样说：${suggestedPrompt}`
      : "你可以补一句“请基于当前项目继续实现，完成后告诉我改了哪些文件，并说明怎么验证”。",
    context.interrupted
      ? "这轮执行被中断，下一次可以先让 AI 只做一小步，再逐步推进。"
      : "本轮结果已经记录，可继续通过 /learn recap 回看详细讲解。",
  ].join("\n");
}

import { generateText, type LanguageModel } from "ai";
import type { LearningConfig } from "../config.ts";
import type { LearningLesson, LearningSessionState } from "./types.ts";

type LanguageModelV1 = LanguageModel;

interface AnswerLearningFollowUpOptions {
  question: string;
  learning: LearningConfig;
  model: string;
  sessionState: LearningSessionState;
  getProvider: () => LanguageModelV1 | Promise<LanguageModelV1>;
}

export async function answerLearningFollowUp(options: AnswerLearningFollowUpOptions): Promise<string> {
  const lesson = options.sessionState.lastLesson;
  if (!lesson) {
    throw new Error("当前 session 还没有可追问的课堂内容。");
  }

  const model = await options.getProvider();
  const result = await generateText({
    model,
    system: buildFollowUpSystemPrompt(options.learning),
    prompt: buildFollowUpPrompt(lesson, options.sessionState, options.question),
  });

  const answer = result.text.trim();
  if (!answer) {
    throw new Error("教学模型没有返回有效回答。");
  }

  return answer;
}

export function formatLearningFollowUpAnswer(answer: string): string {
  return [
    "",
    "  🎓 追问回答",
    answer.trim(),
    "",
    "  可继续使用 /learn ask 追问这轮讲解。",
    "",
  ].join("\n");
}

function buildFollowUpSystemPrompt(learning: LearningConfig): string {
  const background = learning.background?.trim();

  return [
    "你是一位中文编程教学助手，负责回答用户对最近一轮课堂讲解的追问。",
    "只允许基于提供的课堂内容、课堂历史和已有追问历史来回答。",
    "如果提供的信息不足，请明确说“根据当前这轮讲解我还不能确定”，不要脑补未发生的执行步骤。",
    "回答时先直接回答问题，再用 1-3 句补充原因或例子。",
    background ? `用户的学习背景：${background}` : "",
  ].filter(Boolean).join("\n");
}

function buildFollowUpPrompt(
  lesson: LearningLesson,
  state: LearningSessionState,
  question: string,
): string {
  const lessonHistory = state.lessonHistory
    .map((item) => `- ${item.createdAt} | ${item.summary}`)
    .join("\n");
  const followUpHistory = state.followUpMessages.length > 0
    ? state.followUpMessages
        .map((message) => `${message.role === "user" ? "用户" : "教学助手"}: ${message.content}`)
        .join("\n")
    : "- 暂无";

  return [
    `当前追问的问题：${question.trim()}`,
    "",
    "【最近一轮课堂讲解】",
    `主题：${lesson.summary}`,
    `时间：${lesson.createdAt}`,
    lesson.detail,
    "",
    "【当前 session 的课堂历史】",
    lessonHistory || "- 暂无",
    "",
    "【当前 session 的追问历史】",
    followUpHistory,
    "",
    "请基于以上内容，用中文直接回答用户的追问。",
  ].join("\n");
}

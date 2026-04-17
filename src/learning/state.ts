import type { LearningFollowUpMessage, LearningLesson, LearningSessionState } from "./types.ts";
import { normalizeLearningProject } from "./project.ts";

const LESSON_HISTORY_LIMIT = 5;
const FOLLOW_UP_HISTORY_LIMIT = 12;

export function createLearningSessionState(): LearningSessionState {
  return {
    lastLesson: null,
    lessonHistory: [],
    followUpMessages: [],
    activeProject: null,
    projectHistory: [],
  };
}

export function normalizeLearningSessionState(raw?: Partial<LearningSessionState>): LearningSessionState {
  const lessonHistory = Array.isArray(raw?.lessonHistory)
    ? raw.lessonHistory.map(normalizeLesson).filter((lesson): lesson is LearningLesson => Boolean(lesson))
    : [];
  const lastLesson = normalizeLesson(raw?.lastLesson) ?? lessonHistory.at(-1) ?? null;

  return {
    lastLesson,
    lessonHistory: clampLessonHistory(lastLesson ? [...lessonHistory.filter((lesson) => lesson.id !== lastLesson.id), lastLesson] : lessonHistory),
    followUpMessages: clampFollowUpMessages(
      Array.isArray(raw?.followUpMessages)
        ? raw.followUpMessages.map(normalizeFollowUpMessage).filter((message): message is LearningFollowUpMessage => Boolean(message))
        : [],
    ),
    activeProject: normalizeLearningProject(raw?.activeProject),
    projectHistory: clampProjectHistory(
      Array.isArray(raw?.projectHistory)
        ? raw.projectHistory.map(normalizeLearningProject).filter((project): project is NonNullable<LearningSessionState["activeProject"]> => Boolean(project))
        : [],
    ),
  };
}

export function rememberLearningLesson(
  state: LearningSessionState,
  lesson: LearningLesson,
): LearningSessionState {
  return {
    ...state,
    lastLesson: lesson,
    lessonHistory: clampLessonHistory([
      ...state.lessonHistory.filter((item) => item.id !== lesson.id),
      lesson,
    ]),
  };
}

export function rememberLearningFollowUp(
  state: LearningSessionState,
  question: string,
  answer: string,
): LearningSessionState {
  const createdAt = new Date().toISOString();

  return {
    ...state,
    followUpMessages: clampFollowUpMessages([
      ...state.followUpMessages,
      { role: "user", content: question.trim(), createdAt },
      { role: "assistant", content: answer.trim(), createdAt },
    ]),
  };
}

function clampLessonHistory(history: LearningLesson[]): LearningLesson[] {
  return history.slice(-LESSON_HISTORY_LIMIT);
}

function clampFollowUpMessages(history: LearningFollowUpMessage[]): LearningFollowUpMessage[] {
  return history.slice(-FOLLOW_UP_HISTORY_LIMIT);
}

function normalizeLesson(value: unknown): LearningLesson | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<LearningLesson>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.summary !== "string" ||
    typeof candidate.detail !== "string" ||
    !Array.isArray(candidate.concepts) ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.interrupted !== "boolean" ||
    typeof candidate.sourcePrompt !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    summary: candidate.summary,
    detail: candidate.detail,
    concepts: candidate.concepts.filter((item): item is string => typeof item === "string"),
    createdAt: candidate.createdAt,
    interrupted: candidate.interrupted,
    sourcePrompt: candidate.sourcePrompt,
    promptReview:
      candidate.promptReview && typeof candidate.promptReview === "object"
        ? normalizePromptReview(candidate.promptReview)
        : null,
    projectSnapshot:
      candidate.projectSnapshot && typeof candidate.projectSnapshot === "object"
        ? normalizeProjectSnapshot(candidate.projectSnapshot)
        : null,
  };
}

function normalizeFollowUpMessage(value: unknown): LearningFollowUpMessage | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<LearningFollowUpMessage>;
  if (
    (candidate.role !== "user" && candidate.role !== "assistant") ||
    typeof candidate.content !== "string" ||
    typeof candidate.createdAt !== "string"
  ) {
    return null;
  }

  return {
    role: candidate.role,
    content: candidate.content,
    createdAt: candidate.createdAt,
  };
}

function clampProjectHistory(history: NonNullable<LearningSessionState["projectHistory"]>): NonNullable<LearningSessionState["projectHistory"]> {
  return history.slice(-5);
}

function normalizePromptReview(value: unknown): LearningLesson["promptReview"] {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<NonNullable<LearningLesson["promptReview"]>>;
  if (
    typeof candidate.score !== "number" ||
    typeof candidate.summary !== "string" ||
    !Array.isArray(candidate.strengths) ||
    !Array.isArray(candidate.improvements) ||
    typeof candidate.suggestedPrompt !== "string" ||
    !Array.isArray(candidate.detectedConcepts)
  ) {
    return null;
  }

  return {
    score: Math.max(1, Math.min(5, Math.round(candidate.score))),
    summary: candidate.summary,
    strengths: candidate.strengths.filter((item): item is string => typeof item === "string"),
    improvements: candidate.improvements.filter((item): item is string => typeof item === "string"),
    suggestedPrompt: candidate.suggestedPrompt,
    detectedConcepts: candidate.detectedConcepts.filter((item): item is string => typeof item === "string"),
  };
}

function normalizeProjectSnapshot(value: unknown): LearningLesson["projectSnapshot"] {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<NonNullable<LearningLesson["projectSnapshot"]>>;
  if (
    typeof candidate.title !== "string" ||
    typeof candidate.description !== "string" ||
    typeof candidate.completedMilestones !== "number" ||
    typeof candidate.totalMilestones !== "number"
  ) {
    return null;
  }

  return {
    title: candidate.title,
    description: candidate.description,
    status: candidate.status === "completed" || candidate.status === "paused" ? candidate.status : "active",
    currentMilestoneTitle: typeof candidate.currentMilestoneTitle === "string" ? candidate.currentMilestoneTitle : null,
    currentMilestoneObjective: typeof candidate.currentMilestoneObjective === "string" ? candidate.currentMilestoneObjective : null,
    currentMilestoneHint: typeof candidate.currentMilestoneHint === "string" ? candidate.currentMilestoneHint : null,
    completedMilestones: Math.max(0, Math.floor(candidate.completedMilestones)),
    totalMilestones: Math.max(0, Math.floor(candidate.totalMilestones)),
  };
}

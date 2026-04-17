import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { calculateAccuracy, getLearningLevelForXp } from "./progress.ts";
import type { LearningLesson, LearningProfile } from "./types.ts";

export interface LearningQuizAttempt {
  conceptId: string;
  correct: boolean;
  xpGain: number;
}

const PROFILE_DIR = join(homedir(), ".sharkcode");
const PROFILE_FILE = join(PROFILE_DIR, "learning.json");

export function createDefaultLearningProfile(): LearningProfile {
  return {
    version: 1,
    xp: 0,
    level: "入门",
    conceptsSeen: [],
    conceptsMastered: [],
    quizAnswered: 0,
    quizCorrect: 0,
    accuracy: 0,
    promptReviews: 0,
    promptScoreTotal: 0,
    averagePromptScore: 0,
    lastLesson: null,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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

function normalizeProfile(raw?: Partial<LearningProfile>): LearningProfile {
  const xp = typeof raw?.xp === "number" && Number.isFinite(raw.xp) ? Math.max(0, Math.floor(raw.xp)) : 0;
  const quizAnswered = typeof raw?.quizAnswered === "number" && Number.isFinite(raw.quizAnswered)
    ? Math.max(0, Math.floor(raw.quizAnswered))
    : 0;
  const quizCorrect = typeof raw?.quizCorrect === "number" && Number.isFinite(raw.quizCorrect)
    ? Math.max(0, Math.floor(raw.quizCorrect))
    : 0;
  const promptReviews = typeof raw?.promptReviews === "number" && Number.isFinite(raw.promptReviews)
    ? Math.max(0, Math.floor(raw.promptReviews))
    : 0;
  const promptScoreTotal = typeof raw?.promptScoreTotal === "number" && Number.isFinite(raw.promptScoreTotal)
    ? Math.max(0, Math.floor(raw.promptScoreTotal))
    : 0;
  const averagePromptScore = promptReviews > 0
    ? Math.round((promptScoreTotal / promptReviews) * 10) / 10
    : 0;

  return {
    version: 1,
    xp,
    level: getLearningLevelForXp(xp),
    conceptsSeen: normalizeStringArray(raw?.conceptsSeen),
    conceptsMastered: normalizeStringArray(raw?.conceptsMastered),
    quizAnswered,
    quizCorrect,
    accuracy: calculateAccuracy(quizAnswered, quizCorrect),
    promptReviews,
    promptScoreTotal,
    averagePromptScore,
    lastLesson: normalizeLesson(raw?.lastLesson),
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
  };
}

function ensureProfileDir(): void {
  if (!existsSync(PROFILE_DIR)) {
    mkdirSync(PROFILE_DIR, { recursive: true });
  }
}

export function readLearningProfile(): LearningProfile {
  ensureProfileDir();

  if (!existsSync(PROFILE_FILE)) {
    const initial = createDefaultLearningProfile();
    writeFileSync(PROFILE_FILE, JSON.stringify(initial, null, 2), "utf-8");
    return initial;
  }

  try {
    const raw = JSON.parse(readFileSync(PROFILE_FILE, "utf-8")) as Partial<LearningProfile>;
    return normalizeProfile(raw);
  } catch {
    return createDefaultLearningProfile();
  }
}

export function saveLearningProfile(profile: LearningProfile): void {
  ensureProfileDir();
  const normalized = normalizeProfile(profile);
  writeFileSync(PROFILE_FILE, JSON.stringify(normalized, null, 2), "utf-8");
}

export function applyLessonToProfile(profile: LearningProfile, lesson: LearningLesson, xpGain: number): LearningProfile {
  const conceptsSeen = Array.from(new Set([...profile.conceptsSeen, ...lesson.concepts]));
  const xp = profile.xp + Math.max(0, Math.floor(xpGain));
  const promptReviews = profile.promptReviews + (lesson.promptReview ? 1 : 0);
  const promptScoreTotal = profile.promptScoreTotal + (lesson.promptReview?.score ?? 0);

  return normalizeProfile({
    ...profile,
    xp,
    conceptsSeen,
    promptReviews,
    promptScoreTotal,
    lastLesson: lesson,
    updatedAt: new Date().toISOString(),
  });
}

export function applyQuizAttemptToProfile(
  profile: LearningProfile,
  attempt: LearningQuizAttempt,
): LearningProfile {
  const conceptsSeen = Array.from(new Set([...profile.conceptsSeen, attempt.conceptId]));
  const conceptsMastered = attempt.correct
    ? Array.from(new Set([...profile.conceptsMastered, attempt.conceptId]))
    : profile.conceptsMastered;

  return normalizeProfile({
    ...profile,
    xp: profile.xp + Math.max(0, Math.floor(attempt.xpGain)),
    conceptsSeen,
    conceptsMastered,
    quizAnswered: profile.quizAnswered + 1,
    quizCorrect: profile.quizCorrect + (attempt.correct ? 1 : 0),
    updatedAt: new Date().toISOString(),
  });
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

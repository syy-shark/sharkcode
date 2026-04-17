export type LearningLevel =
  | "入门"
  | "基础"
  | "进阶"
  | "熟练"
  | "高阶"
  | "专家"
  | "导师";

export type LearningProjectStatus = "active" | "completed" | "paused";
export type LearningMilestoneStatus = "pending" | "in_progress" | "completed";

export interface LearningPromptReview {
  score: number;
  summary: string;
  strengths: string[];
  improvements: string[];
  suggestedPrompt: string;
  detectedConcepts: string[];
}

export interface LearningProjectMilestone {
  id: string;
  title: string;
  objective: string;
  hint: string;
  suggestedPrompt: string;
  concepts: string[];
  status: LearningMilestoneStatus;
}

export interface LearningProject {
  id: string;
  title: string;
  description: string;
  status: LearningProjectStatus;
  createdAt: string;
  updatedAt: string;
  milestones: LearningProjectMilestone[];
}

export interface LearningProjectSnapshot {
  title: string;
  description: string;
  status: LearningProjectStatus;
  currentMilestoneTitle: string | null;
  currentMilestoneObjective: string | null;
  currentMilestoneHint: string | null;
  completedMilestones: number;
  totalMilestones: number;
}

export interface LearningLesson {
  id: string;
  summary: string;
  detail: string;
  concepts: string[];
  createdAt: string;
  interrupted: boolean;
  sourcePrompt: string;
  promptReview: LearningPromptReview | null;
  projectSnapshot: LearningProjectSnapshot | null;
}

export interface LearningProfile {
  version: 1;
  xp: number;
  level: LearningLevel;
  conceptsSeen: string[];
  conceptsMastered: string[];
  quizAnswered: number;
  quizCorrect: number;
  accuracy: number;
  promptReviews: number;
  promptScoreTotal: number;
  averagePromptScore: number;
  lastLesson: LearningLesson | null;
  updatedAt: string;
}

export interface LearningFollowUpMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface LearningSessionState {
  lastLesson: LearningLesson | null;
  lessonHistory: LearningLesson[];
  followUpMessages: LearningFollowUpMessage[];
  activeProject: LearningProject | null;
  projectHistory: LearningProject[];
}

export interface LearningConcept {
  id: string;
  name: string;
  description: string;
}

export interface LearningSignal {
  shouldGenerate: boolean;
  concepts: string[];
  reason: string;
}

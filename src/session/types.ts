import type { ModelMessage } from "ai";
import type { LearningSessionState } from "../learning/types.ts";

export type SessionMode = "build" | "plan";

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  mode: SessionMode;
}

export interface SessionIndex {
  version: 1;
  sessions: SessionSummary[];
}

export interface PersistedSession {
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  mode: SessionMode;
  activeSkills: string[];
  messages: ModelMessage[];
  learningState: LearningSessionState;
  providerName?: string;
  model?: string;
  learningModel?: string;
}

export interface SessionDraft {
  mode: SessionMode;
  activeSkills: string[];
}

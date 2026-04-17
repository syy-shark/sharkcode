import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelMessage } from "ai";
import { createLearningSessionState, normalizeLearningSessionState } from "../learning/state.ts";
import type { PersistedSession, SessionDraft, SessionIndex, SessionMode, SessionSummary } from "./types.ts";

const SESSIONS_DIR = join(homedir(), ".sharkcode", "sessions");
const INDEX_FILE = join(SESSIONS_DIR, "index.json");

export function createSessionDraft(): SessionDraft {
  return {
    mode: "build",
    activeSkills: [],
  };
}

export function createSessionFromPrompt(options: {
  prompt: string;
  mode: SessionMode;
  activeSkills: string[];
  providerName?: string;
  model?: string;
  learningModel?: string;
}): PersistedSession {
  const now = new Date().toISOString();

  return {
    version: 1,
    id: createSessionId(),
    title: buildSessionTitle(options.prompt),
    createdAt: now,
    updatedAt: now,
    mode: options.mode,
    activeSkills: normalizeStringArray(options.activeSkills),
    messages: [],
    learningState: createLearningSessionState(),
    providerName: options.providerName,
    model: options.model,
    learningModel: options.learningModel,
  };
}

export function listSessionSummaries(): SessionSummary[] {
  return readSessionIndex().sessions;
}

export function readSession(id: string): PersistedSession | null {
  ensureSessionsDir();
  const filePath = getSessionFilePath(id);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<PersistedSession>;
    return normalizeSession(raw);
  } catch {
    return null;
  }
}

export function saveSession(session: PersistedSession): PersistedSession {
  ensureSessionsDir();
  const normalized = normalizeSession({
    ...session,
    updatedAt: new Date().toISOString(),
  });
  writeJsonAtomic(getSessionFilePath(normalized.id), normalized);

  const index = readSessionIndex();
  const summary = buildSessionSummary(normalized);
  const nextSessions = index.sessions.filter((item) => item.id !== summary.id);
  nextSessions.unshift(summary);
  writeJsonAtomic(INDEX_FILE, {
    version: 1,
    sessions: sortSessionSummaries(nextSessions),
  } satisfies SessionIndex);

  return normalized;
}

export function deleteSession(id: string): void {
  ensureSessionsDir();
  rmSync(getSessionFilePath(id), { force: true });
  const index = readSessionIndex();
  writeJsonAtomic(INDEX_FILE, {
    version: 1,
    sessions: index.sessions.filter((session) => session.id !== id),
  } satisfies SessionIndex);
}

export function readSessionIndex(): SessionIndex {
  ensureSessionsDir();

  if (!existsSync(INDEX_FILE)) {
    const initial: SessionIndex = { version: 1, sessions: [] };
    writeJsonAtomic(INDEX_FILE, initial);
    return initial;
  }

  try {
    const raw = JSON.parse(readFileSync(INDEX_FILE, "utf-8")) as Partial<SessionIndex>;
    const sessions = Array.isArray(raw.sessions)
      ? raw.sessions.map(normalizeSessionSummary).filter((item): item is SessionSummary => Boolean(item))
      : [];

    return {
      version: 1,
      sessions: sortSessionSummaries(sessions),
    };
  } catch {
    const recovered = recoverSessionSummariesFromFiles();
    const index: SessionIndex = { version: 1, sessions: recovered };
    writeJsonAtomic(INDEX_FILE, index);
    return index;
  }
}

export function createDetachedSessionState(session: PersistedSession | null): {
  messages: ModelMessage[];
  learningState: PersistedSession["learningState"];
} {
  return {
    messages: session?.messages ?? [],
    learningState: session?.learningState ?? createLearningSessionState(),
  };
}

function createSessionId(): string {
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildSessionTitle(prompt: string): string {
  const singleLine = prompt.replace(/\s+/g, " ").trim();
  if (!singleLine) {
    return "新任务";
  }

  if (singleLine.length <= 28) {
    return singleLine;
  }

  return singleLine.slice(0, 27).trimEnd() + "…";
}

function ensureSessionsDir(): void {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function getSessionFilePath(id: string): string {
  return join(SESSIONS_DIR, `${id}.json`);
}

function normalizeSession(raw?: Partial<PersistedSession>): PersistedSession {
  const id = typeof raw?.id === "string" && raw.id.trim() ? raw.id : createSessionId();
  const createdAt = typeof raw?.createdAt === "string" ? raw.createdAt : new Date().toISOString();
  const updatedAt = typeof raw?.updatedAt === "string" ? raw.updatedAt : createdAt;
  const messages = Array.isArray(raw?.messages) ? raw.messages as ModelMessage[] : [];

  return {
    version: 1,
    id,
    title: typeof raw?.title === "string" && raw.title.trim() ? raw.title : "新任务",
    createdAt,
    updatedAt,
    mode: raw?.mode === "plan" ? "plan" : "build",
    activeSkills: normalizeStringArray(raw?.activeSkills),
    messages,
    learningState: normalizeLearningSessionState(raw?.learningState),
    providerName: typeof raw?.providerName === "string" ? raw.providerName : undefined,
    model: typeof raw?.model === "string" ? raw.model : undefined,
    learningModel: typeof raw?.learningModel === "string" ? raw.learningModel : undefined,
  };
}

function normalizeSessionSummary(raw: unknown): SessionSummary | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Partial<SessionSummary>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    title: candidate.title,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    mode: candidate.mode === "plan" ? "plan" : "build",
  };
}

function buildSessionSummary(session: PersistedSession): SessionSummary {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    mode: session.mode,
  };
}

function sortSessionSummaries(sessions: SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function recoverSessionSummariesFromFiles(): SessionSummary[] {
  ensureSessionsDir();
  const sessions: SessionSummary[] = [];

  for (const entry of readdirSync(SESSIONS_DIR)) {
    if (!entry.endsWith(".json") || entry === "index.json") {
      continue;
    }

    const filePath = join(SESSIONS_DIR, entry);
    try {
      const raw = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<PersistedSession>;
      const session = normalizeSession(raw);
      sessions.push(buildSessionSummary(session));
    } catch {
      // Ignore unreadable session files and preserve the rest.
    }
  }

  return sortSessionSummaries(sessions);
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tempPath, filePath);
}

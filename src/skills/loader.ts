import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { SessionMode } from "../session/types.ts";
import type { ResolvedSkillContext, RuntimePolicy, SkillDefinition } from "./types.ts";

const GLOBAL_SKILLS_DIR = join(homedir(), ".sharkcode", "skills");
const PROJECT_SKILLS_DIR = join(process.cwd(), ".sharkcode", "skills");

const PLAN_MODE_SKILL: SkillDefinition = {
  id: "plan-mode",
  name: "Plan Mode",
  description: "Strict read-only planning mode.",
  source: "builtin",
  runtimePolicy: "read-only",
  systemReminder: [
    "<system-reminder>",
    "Plan mode is ACTIVE. You are in a strict read-only planning phase.",
    "ZERO exceptions: do not write or edit files, do not run shell commands, do not use browser automation, do not make commits, and do not perform any action with side effects.",
    "Your job is to inspect, search, reason, and produce a concrete implementation plan grounded in the current codebase.",
    "If the user asks you to build immediately while plan mode is active, explain that execution is blocked until they switch back to build mode.",
    "</system-reminder>",
  ].join("\n"),
};

export function listAvailableSkills(): SkillDefinition[] {
  return dedupeSkills([
    ...readSkillsFromDirectory(GLOBAL_SKILLS_DIR, "global"),
    ...readSkillsFromDirectory(PROJECT_SKILLS_DIR, "project"),
  ]).sort((a, b) => a.id.localeCompare(b.id));
}

export function resolveSkillContext(activeSkillIds: string[], mode: SessionMode): ResolvedSkillContext {
  const available = listAvailableSkills();
  const selected = available.filter((skill) => activeSkillIds.includes(skill.id));
  const skills = mode === "plan"
    ? [PLAN_MODE_SKILL, ...selected.filter((skill) => skill.id !== PLAN_MODE_SKILL.id)]
    : selected;
  const runtimePolicy = skills.some((skill) => skill.runtimePolicy === "read-only")
    ? "read-only"
    : "full-access";

  return {
    skills,
    runtimePolicy,
    systemReminders: skills
      .map((skill) => skill.systemReminder.trim())
      .filter(Boolean),
  };
}

export function findAvailableSkill(skillId: string): SkillDefinition | null {
  return listAvailableSkills().find((skill) => skill.id === normalizeSkillId(skillId)) ?? null;
}

export function normalizeSkillId(value: string): string {
  return value.trim().toLowerCase();
}

function readSkillsFromDirectory(directory: string, source: SkillDefinition["source"]): SkillDefinition[] {
  if (!existsSync(directory)) {
    return [];
  }

  const skills: SkillDefinition[] = [];

  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith(".md")) {
      continue;
    }

    const filePath = join(directory, entry);
    try {
      const parsed = parseSkillMarkdown(readFileSync(filePath, "utf-8"));
      skills.push({
        id: parsed.id || normalizeSkillId(basename(entry, ".md")),
        name: parsed.name || basename(entry, ".md"),
        description: parsed.description || "No description.",
        source,
        systemReminder: parsed.systemReminder,
        runtimePolicy: parsed.runtimePolicy,
        filePath,
      });
    } catch {
      // Ignore invalid skill files so one bad file does not break the session.
    }
  }

  return skills;
}

function parseSkillMarkdown(content: string): {
  id: string;
  name: string;
  description: string;
  runtimePolicy: RuntimePolicy;
  systemReminder: string;
} {
  const { body, frontmatter } = extractFrontmatter(content);
  const systemReminder = extractSystemReminder(body);

  return {
    id: typeof frontmatter.id === "string" ? normalizeSkillId(frontmatter.id) : "",
    name: typeof frontmatter.name === "string" ? frontmatter.name.trim() : "",
    description: typeof frontmatter.description === "string"
      ? frontmatter.description.trim()
      : extractFallbackDescription(body),
    runtimePolicy: normalizeRuntimePolicy(frontmatter.runtime_policy),
    systemReminder,
  };
}

function extractFrontmatter(content: string): {
  body: string;
  frontmatter: Record<string, string>;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return {
      body: content,
      frontmatter: {},
    };
  }

  const frontmatter: Record<string, string> = {};
  const frontmatterBlock = match[1] ?? "";
  for (const line of frontmatterBlock.split("\n")) {
    const index = line.indexOf(":");
    if (index <= 0) {
      continue;
    }

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['\"]|['\"]$/g, "");
    if (key) {
      frontmatter[key] = value;
    }
  }

  return {
    body: content.slice(match[0].length),
    frontmatter,
  };
}

function extractSystemReminder(content: string): string {
  const match = content.match(/<system-reminder>[\s\S]*?<\/system-reminder>/i);
  return match?.[0]?.trim() ?? "";
}

function extractFallbackDescription(content: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) {
    return heading;
  }

  const firstLine = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("<system-reminder>"));

  return firstLine ?? "No description.";
}

function normalizeRuntimePolicy(value: string | undefined): RuntimePolicy {
  return value === "read-only" ? "read-only" : "full-access";
}

function dedupeSkills(skills: SkillDefinition[]): SkillDefinition[] {
  const seen = new Set<string>();
  const deduped: SkillDefinition[] = [];

  for (const skill of skills) {
    if (!skill.systemReminder || seen.has(skill.id)) {
      continue;
    }

    seen.add(skill.id);
    deduped.push(skill);
  }

  return deduped;
}

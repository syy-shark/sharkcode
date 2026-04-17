export type RuntimePolicy = "full-access" | "read-only";

export type SkillSource = "builtin" | "global" | "project";

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  systemReminder: string;
  runtimePolicy: RuntimePolicy;
  filePath?: string;
}

export interface ResolvedSkillContext {
  skills: SkillDefinition[];
  runtimePolicy: RuntimePolicy;
  systemReminders: string[];
}

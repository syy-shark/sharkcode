import { getLearningConcept } from "./curriculum.ts";
import type {
  LearningMilestoneStatus,
  LearningProject,
  LearningProjectMilestone,
  LearningProjectSnapshot,
  LearningSessionState,
} from "./types.ts";

export interface LearningProjectPlanMilestoneInput {
  title: string;
  objective: string;
  hint: string;
  suggestedPrompt?: string;
  concepts: string[];
}

export interface LearningProjectPlan {
  title: string;
  description: string;
  milestones: LearningProjectPlanMilestoneInput[];
}

const PROJECT_HISTORY_LIMIT = 5;

export function createLearningProjectFromPlan(plan: LearningProjectPlan): LearningProject {
  const now = new Date().toISOString();
  const milestones = plan.milestones.map((milestone, index) => {
    const status: LearningMilestoneStatus = index === 0 ? "in_progress" : "pending";
    return {
      id: `milestone-${Date.now().toString(36)}-${index.toString(36)}`,
      title: milestone.title.trim() || `阶段 ${index + 1}`,
      objective: milestone.objective.trim() || milestone.hint.trim() || "推进当前这一步",
      hint: milestone.hint.trim() || milestone.objective.trim() || "补充这一步的目标和限制条件。",
      suggestedPrompt: buildDefaultMilestonePrompt({
        title: milestone.title,
        objective: milestone.objective,
        hint: milestone.hint,
        suggestedPrompt: milestone.suggestedPrompt,
      }),
      concepts: normalizeStringArray(milestone.concepts),
      status,
    } satisfies LearningProjectMilestone;
  });

  return {
    id: `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title: plan.title.trim() || "Vibe Coding 项目",
    description: plan.description.trim() || plan.title.trim() || "通过引导任务推进项目",
    status: milestones.length > 0 ? "active" : "completed",
    createdAt: now,
    updatedAt: now,
    milestones,
  };
}

export function getCurrentProjectMilestone(project: LearningProject | null | undefined): LearningProjectMilestone | null {
  if (!project) {
    return null;
  }

  return project.milestones.find((milestone) => milestone.status === "in_progress")
    ?? project.milestones.find((milestone) => milestone.status === "pending")
    ?? null;
}

export function getLearningProjectSnapshot(project: LearningProject | null | undefined): LearningProjectSnapshot | null {
  if (!project) {
    return null;
  }

  const currentMilestone = getCurrentProjectMilestone(project);
  const completedMilestones = project.milestones.filter((milestone) => milestone.status === "completed").length;

  return {
    title: project.title,
    description: project.description,
    status: project.status,
    currentMilestoneTitle: currentMilestone?.title ?? null,
    currentMilestoneObjective: currentMilestone?.objective ?? null,
    currentMilestoneHint: currentMilestone?.hint ?? null,
    completedMilestones,
    totalMilestones: project.milestones.length,
  };
}

export function rememberLearningProject(
  state: LearningSessionState,
  project: LearningProject,
): LearningSessionState {
  const previousHistory = state.activeProject && state.activeProject.id !== project.id
    ? clampProjectHistory([
        ...state.projectHistory.filter((item) => item.id !== state.activeProject?.id),
        state.activeProject,
      ])
    : clampProjectHistory(state.projectHistory.filter((item) => item.id !== project.id));

  return {
    ...state,
    activeProject: project,
    projectHistory: previousHistory,
  };
}

export function advanceLearningProject(state: LearningSessionState): {
  sessionState: LearningSessionState;
  message: string;
} {
  const project = state.activeProject;
  if (!project) {
    return {
      sessionState: state,
      message: "\n  🎯 当前还没有进行中的引导项目。先用 /learn start 开一个项目。\n",
    };
  }

  const currentIndex = project.milestones.findIndex((milestone) => milestone.status === "in_progress");
  if (currentIndex < 0) {
    return {
      sessionState: state,
      message: "\n  🎯 当前项目没有可推进的进行中阶段。\n",
    };
  }

  const milestones = project.milestones.map((milestone) => ({ ...milestone }));
  milestones[currentIndex] = {
    ...milestones[currentIndex]!,
    status: "completed",
  };

  const nextIndex = milestones.findIndex((milestone) => milestone.status === "pending");
  const updatedProject: LearningProject = {
    ...project,
    updatedAt: new Date().toISOString(),
    milestones,
  };

  if (nextIndex >= 0) {
    milestones[nextIndex] = {
      ...milestones[nextIndex]!,
      status: "in_progress",
    };

    const nextProject: LearningProject = {
      ...updatedProject,
      milestones,
      status: "active",
    };

    return {
      sessionState: {
        ...state,
        activeProject: nextProject,
      },
      message: [
        "",
        `  ✓ 已完成「${project.milestones[currentIndex]?.title ?? "当前阶段"}」`,
        formatLearningProjectCurrent(nextProject).trimEnd(),
        "  完成这一小步后可继续输入 /learn complete。",
        "",
      ].join("\n"),
    };
  }

  const completedProject: LearningProject = {
    ...updatedProject,
    status: "completed",
  };

  return {
    sessionState: {
      ...state,
      activeProject: null,
      projectHistory: clampProjectHistory([
        ...state.projectHistory.filter((item) => item.id !== completedProject.id),
        completedProject,
      ]),
    },
    message: formatCompletedProjectMessage(completedProject),
  };
}

export function formatLearningProjectLaunch(project: LearningProject): string {
  const currentMilestone = getCurrentProjectMilestone(project);

  return [
    "",
    `  🎯 已启动引导项目：${project.title}`,
    `  目标：${project.description}`,
    `  计划步数：${project.milestones.length}`,
    "",
    "  里程碑：",
    ...project.milestones.map((milestone, index) => `  ${index + 1}. ${milestone.title}`),
    "",
    currentMilestone ? `  当前阶段：${currentMilestone.title}` : "  当前阶段：暂无",
    currentMilestone ? `  目标：${currentMilestone.objective}` : "",
    currentMilestone ? "  可用 /learn hint 查看更具体的提问提示。" : "",
    "",
  ].filter(Boolean).join("\n");
}

export function formatLearningProjectCurrent(project: LearningProject | null): string {
  if (!project) {
    return "\n  🎯 当前还没有进行中的引导项目。先用 /learn start 开一个项目。\n";
  }

  const currentMilestone = getCurrentProjectMilestone(project);
  const completedCount = project.milestones.filter((milestone) => milestone.status === "completed").length;
  const conceptNames = (currentMilestone?.concepts ?? [])
    .map((conceptId) => getLearningConcept(conceptId)?.name ?? conceptId)
    .join("、");

  return [
    "",
    "  🎯 当前引导任务",
    `  项目：${project.title}`,
    `  进度：${completedCount}/${project.milestones.length}`,
    `  当前阶段：${currentMilestone?.title ?? "已完成"}`,
    currentMilestone ? `  目标：${currentMilestone.objective}` : "",
    conceptNames ? `  重点技能：${conceptNames}` : "",
    currentMilestone ? "  可用 /learn hint 查看推荐提问方式。" : "",
    "",
  ].filter(Boolean).join("\n");
}

export function formatLearningProjectHint(project: LearningProject | null): string {
  if (!project) {
    return "\n  🎯 当前还没有进行中的引导项目。先用 /learn start 开一个项目。\n";
  }

  const currentMilestone = getCurrentProjectMilestone(project);
  if (!currentMilestone) {
    return "\n  🎯 当前项目已经完成，没有新的提示了。\n";
  }

  return [
    "",
    "  💡 当前阶段提示",
    `  项目：${project.title}`,
    `  阶段：${currentMilestone.title}`,
    `  提示：${currentMilestone.hint}`,
    "",
    "  你可以直接这样对 AI 说：",
    `  ${currentMilestone.suggestedPrompt}`,
    "",
  ].join("\n");
}

export function normalizeLearningProject(value: unknown): LearningProject | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<LearningProject>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.description !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.updatedAt !== "string" ||
    !Array.isArray(candidate.milestones)
  ) {
    return null;
  }

  const milestones = candidate.milestones
    .map(normalizeLearningProjectMilestone)
    .filter((milestone): milestone is LearningProjectMilestone => Boolean(milestone));

  return {
    id: candidate.id,
    title: candidate.title,
    description: candidate.description,
    status: candidate.status === "completed" || candidate.status === "paused" ? candidate.status : "active",
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    milestones,
  };
}

function normalizeLearningProjectMilestone(value: unknown): LearningProjectMilestone | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<LearningProjectMilestone>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.objective !== "string" ||
    typeof candidate.hint !== "string" ||
    typeof candidate.suggestedPrompt !== "string" ||
    !Array.isArray(candidate.concepts)
  ) {
    return null;
  }

  return {
    id: candidate.id,
    title: candidate.title,
    objective: candidate.objective,
    hint: candidate.hint,
    suggestedPrompt: candidate.suggestedPrompt,
    concepts: normalizeStringArray(candidate.concepts),
    status: normalizeMilestoneStatus(candidate.status),
  };
}

function normalizeMilestoneStatus(value: unknown): LearningMilestoneStatus {
  return value === "completed" || value === "pending" ? value : "in_progress";
}

function clampProjectHistory(history: LearningProject[]): LearningProject[] {
  return history.slice(-PROJECT_HISTORY_LIMIT);
}

function formatCompletedProjectMessage(project: LearningProject): string {
  return [
    "",
    `  🎉 引导项目已完成：${project.title}`,
    `  共完成 ${project.milestones.length} 个阶段。`,
    "  现在可以继续自由迭代，或者再用 /learn start 开一个新项目。",
    "",
  ].join("\n");
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function buildDefaultMilestonePrompt(options: {
  title: string;
  objective: string;
  hint: string;
  suggestedPrompt?: string;
}): string {
  if (typeof options.suggestedPrompt === "string" && options.suggestedPrompt.trim()) {
    return options.suggestedPrompt.trim();
  }

  return [
    `请先帮我完成「${options.title.trim() || "当前阶段"}」这一步。`,
    options.objective.trim() ? `目标是：${options.objective.trim()}。` : "",
    options.hint.trim() ? `注意：${options.hint.trim()}。` : "",
    "完成后说明改了哪些文件，并告诉我怎么验证结果。",
  ].filter(Boolean).join("");
}

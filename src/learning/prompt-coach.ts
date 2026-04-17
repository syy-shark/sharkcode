import type {
  LearningProject,
  LearningProjectSnapshot,
  LearningPromptReview,
} from "./types.ts";
import { getCurrentProjectMilestone, getLearningProjectSnapshot } from "./project.ts";

const TECH_STACK_KEYWORDS = [
  "react",
  "next",
  "vue",
  "nuxt",
  "svelte",
  "tailwind",
  "typescript",
  "javascript",
  "node",
  "express",
  "supabase",
  "firebase",
  "postgres",
  "api",
  "html",
  "css",
] as const;

const UI_KEYWORDS = [
  "页面",
  "界面",
  "按钮",
  "卡片",
  "布局",
  "导航",
  "首页",
  "样式",
  "颜色",
  "字体",
  "响应式",
  "移动端",
  "桌面端",
  "hero",
] as const;

const ARCHITECTURE_KEYWORDS = [
  "组件",
  "路由",
  "状态",
  "store",
  "schema",
  "api",
  "接口",
  "模块",
  "文件",
  "目录",
  "结构",
  "重构",
  "拆分",
] as const;

const ISSUE_KEYWORDS = [
  "报错",
  "错误",
  "失败",
  "bug",
  "异常",
  "白屏",
  "不生效",
  "不工作",
  "undefined",
  "null",
  "崩溃",
] as const;

const FEEDBACK_KEYWORDS = [
  "改成",
  "调整",
  "优化",
  "不要",
  "保持",
  "只做",
  "先不要",
  "沿用",
  "继续",
] as const;

const DECOMPOSITION_KEYWORDS = [
  "先",
  "然后",
  "分步",
  "逐步",
  "第一步",
  "先做",
  "拆",
  "阶段",
] as const;

const VERIFICATION_KEYWORDS = [
  "验证",
  "测试",
  "检查",
  "确认",
  "跑一下",
  "build",
  "lint",
  "预览",
  "确保",
] as const;

interface ReviewLearningPromptOptions {
  prompt: string;
  project?: LearningProject | null;
}

export function reviewLearningPrompt(options: ReviewLearningPromptOptions): LearningPromptReview {
  const prompt = options.prompt.trim();
  const lowerPrompt = prompt.toLowerCase();
  const projectSnapshot = getLearningProjectSnapshot(options.project ?? null);
  const currentMilestone = getCurrentProjectMilestone(options.project ?? null);

  const hasLength = prompt.length >= 12;
  const hasSpecificGoal = prompt.length >= 20 || /做|加|创建|实现|修复|优化|改/.test(prompt);
  const hasTechStack = containsAny(lowerPrompt, TECH_STACK_KEYWORDS);
  const hasContext =
    /`[^`]+`/.test(prompt) ||
    /\b[\w./-]+\.(ts|tsx|js|jsx|css|html|json|md)\b/i.test(prompt) ||
    containsAny(prompt, ["当前项目", "这个项目", "现有", "已有", "页面", "组件", "文件"]);
  const hasConstraints =
    containsAny(prompt, FEEDBACK_KEYWORDS) ||
    containsAny(prompt, ["必须", "限制", "保留", "兼容", "只动", "不要动"]);
  const hasDecomposition = containsAny(prompt, DECOMPOSITION_KEYWORDS);
  const hasVerification = containsAny(prompt, VERIFICATION_KEYWORDS);
  const hasUiIntent = containsAny(prompt, UI_KEYWORDS);
  const hasArchitectureIntent = containsAny(prompt, ARCHITECTURE_KEYWORDS);
  const hasIssueDescription = containsAny(lowerPrompt, ISSUE_KEYWORDS);

  let score = 1;
  if (hasLength) score += 1;
  if (hasSpecificGoal) score += 1;
  if (hasContext || hasTechStack || projectSnapshot) score += 1;
  if (hasConstraints || hasDecomposition || hasVerification) score += 1;
  score = Math.max(1, Math.min(5, score));

  const strengths: string[] = [];
  const improvements: string[] = [];

  if (hasSpecificGoal) {
    strengths.push("目标已经比“帮我做一下”更明确，AI 更容易直接开干。");
  }
  if (hasContext || hasTechStack || projectSnapshot) {
    strengths.push("提供了项目背景或技术栈信息，能减少 AI 对上下文的猜测。");
  }
  if (hasConstraints || hasDecomposition) {
    strengths.push("带了边界条件或分步意图，能让 AI 少做顺手大改。");
  }
  if (hasVerification) {
    strengths.push("补上了验证意图，能帮助形成做完即验的闭环。");
  }

  if (!hasSpecificGoal) {
    improvements.push("把想要的页面、功能或修改结果说具体，别只说“做一个”“改一下”。");
  }
  if (!hasContext && !projectSnapshot) {
    improvements.push("补充当前技术栈、页面位置或文件范围，让 AI 知道应该从哪里接手。");
  }
  if (!hasConstraints && !hasDecomposition) {
    improvements.push("告诉 AI 这轮只做哪一步、哪些内容先不要动，能显著减少跑偏。");
  }
  if (!hasVerification) {
    improvements.push("结尾补一句“完成后说明改了哪些文件，并告诉我怎么验证”，效果会更稳。");
  }

  const summary = buildPromptSummary(score, projectSnapshot, currentMilestone?.title ?? null);
  const suggestedPrompt = buildSuggestedPrompt({
    prompt,
    projectSnapshot,
    milestoneTitle: currentMilestone?.title ?? null,
    milestoneObjective: currentMilestone?.objective ?? null,
    milestoneHint: currentMilestone?.hint ?? null,
    needsContext: !hasContext && !projectSnapshot,
    needsConstraints: !hasConstraints && !hasDecomposition,
    needsVerification: !hasVerification,
  });

  return {
    score,
    summary,
    strengths: strengths.slice(0, 3),
    improvements: improvements.slice(0, 3),
    suggestedPrompt,
    detectedConcepts: inferPromptConcepts(prompt, projectSnapshot, {
      hasDecomposition,
      hasContext,
      hasVerification,
      hasUiIntent,
      hasArchitectureIntent,
      hasIssueDescription,
      hasConstraints,
    }),
  };
}

export function inferPromptConcepts(
  prompt: string,
  projectSnapshot?: LearningProjectSnapshot | null,
  flags?: {
    hasDecomposition?: boolean;
    hasContext?: boolean;
    hasVerification?: boolean;
    hasUiIntent?: boolean;
    hasArchitectureIntent?: boolean;
    hasIssueDescription?: boolean;
    hasConstraints?: boolean;
  },
): string[] {
  const concepts = new Set<string>(["requirement-clarity"]);
  const lowerPrompt = prompt.toLowerCase();
  const hasDecomposition = flags?.hasDecomposition ?? containsAny(prompt, DECOMPOSITION_KEYWORDS);
  const hasContext = flags?.hasContext ?? (
    /`[^`]+`/.test(prompt) ||
    /\b[\w./-]+\.(ts|tsx|js|jsx|css|html|json|md)\b/i.test(prompt) ||
    containsAny(prompt, ["当前项目", "这个项目", "现有", "已有", "页面", "组件", "文件"])
  );
  const hasVerification = flags?.hasVerification ?? containsAny(prompt, VERIFICATION_KEYWORDS);
  const hasUiIntent = flags?.hasUiIntent ?? containsAny(prompt, UI_KEYWORDS);
  const hasArchitectureIntent = flags?.hasArchitectureIntent ?? containsAny(prompt, ARCHITECTURE_KEYWORDS);
  const hasIssueDescription = flags?.hasIssueDescription ?? containsAny(lowerPrompt, ISSUE_KEYWORDS);
  const hasConstraints = flags?.hasConstraints ?? containsAny(prompt, FEEDBACK_KEYWORDS);

  if (hasDecomposition || projectSnapshot?.currentMilestoneTitle) {
    concepts.add("task-decomposition");
  }
  if (hasContext || projectSnapshot) {
    concepts.add("context-framing");
  }
  if (hasConstraints) {
    concepts.add("iteration-feedback");
  }
  if (hasIssueDescription) {
    concepts.add("bug-reporting");
  }
  if (hasVerification) {
    concepts.add("verification-loop");
  }
  if (hasUiIntent) {
    concepts.add("ui-expression");
  }
  if (hasArchitectureIntent || containsAny(lowerPrompt, TECH_STACK_KEYWORDS)) {
    concepts.add("architecture-sense");
  }

  return Array.from(concepts);
}

function buildPromptSummary(
  score: number,
  projectSnapshot: LearningProjectSnapshot | null,
  milestoneTitle: string | null,
): string {
  const projectLine = projectSnapshot && milestoneTitle
    ? `这轮已经在围绕「${milestoneTitle}」推进项目，但 prompt 还可以更聚焦。`
    : projectSnapshot
    ? `这轮 prompt 已经能推动项目继续前进，但还可以补足上下文。`
    : "这轮 prompt 已经具备基本方向，接下来要继续提升可执行性。";

  if (score >= 5) {
    return "这轮 prompt 已经很像一份可执行 brief，AI 更容易一次做对。";
  }
  if (score === 4) {
    return projectLine;
  }
  if (score === 3) {
    return "这轮 prompt 方向对了，但缺少一些约束条件，AI 仍然需要替你做决定。";
  }
  if (score === 2) {
    return "这轮 prompt 还偏笼统，建议补充目标、上下文和验收方式再让 AI 开始。";
  }
  return "这轮 prompt 太像一句想法，还没变成能稳定驱动 AI 的任务说明。";
}

function buildSuggestedPrompt(options: {
  prompt: string;
  projectSnapshot: LearningProjectSnapshot | null;
  milestoneTitle: string | null;
  milestoneObjective: string | null;
  milestoneHint: string | null;
  needsContext: boolean;
  needsConstraints: boolean;
  needsVerification: boolean;
}): string {
  const parts: string[] = [];
  const trimmedPrompt = options.prompt.replace(/[。！？\s]+$/u, "").trim();

  if (options.projectSnapshot && options.milestoneTitle) {
    parts.push(`继续做「${options.projectSnapshot.title}」里的「${options.milestoneTitle}」这一步。`);
  }
  if (options.milestoneObjective && trimmedPrompt.length < 24) {
    parts.push(`这一步的目标是：${options.milestoneObjective}。`);
  }

  parts.push(trimmedPrompt || "请先帮我推进当前这一步。\n");

  if (options.needsContext) {
    if (options.projectSnapshot) {
      parts.push("请基于当前项目现有结构和技术栈继续实现，不要重做整个项目。\n");
    } else {
      parts.push("请先说明会改哪些页面、组件或文件，再开始实现。\n");
    }
  }
  if (options.needsConstraints) {
    parts.push(options.milestoneHint
      ? `这轮只做这一小步：${options.milestoneHint}。\n`
      : "这轮先只完成这一小步，不要顺手大改其他部分。\n");
  }
  if (options.needsVerification) {
    parts.push("完成后说明改了哪些文件，并告诉我怎么验证结果。\n");
  }

  return parts.join("").replace(/\n/g, "").trim();
}

function containsAny(input: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => input.includes(keyword));
}

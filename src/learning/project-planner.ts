import { generateText, type LanguageModel } from "ai";
import { z } from "zod";
import type { LearningConfig } from "../config.ts";
import { listLearningConcepts } from "./curriculum.ts";
import {
  createLearningProjectFromPlan,
  type LearningProjectPlan,
} from "./project.ts";
import type { LearningProject } from "./types.ts";

type LanguageModelV1 = LanguageModel;

interface PlanLearningProjectOptions {
  description: string;
  learning: LearningConfig;
  model: string;
  getProvider: () => LanguageModelV1 | Promise<LanguageModelV1>;
}

const milestoneSchema = z.object({
  title: z.string().min(1).max(80),
  objective: z.string().min(1).max(240),
  hint: z.string().min(1).max(240),
  suggestedPrompt: z.string().min(1).max(360).optional(),
  concepts: z.array(z.string().min(1)).min(1).max(3),
});

const projectPlanSchema = z.object({
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(240).optional(),
  milestones: z.array(milestoneSchema).min(4).max(8),
});

const VALID_CONCEPT_IDS = new Set(listLearningConcepts().map((concept) => concept.id));

export async function planLearningProject(options: PlanLearningProjectOptions): Promise<LearningProject> {
  try {
    const model = await options.getProvider();
    const result = await generateText({
      model,
      system: buildProjectPlannerSystemPrompt(options.learning),
      prompt: buildProjectPlannerPrompt(options.description),
    });

    const parsed = parseProjectPlan(result.text, options.description);
    if (parsed) {
      return createLearningProjectFromPlan(parsed);
    }
  } catch {
    // Fall back to a local plan so project mode remains usable.
  }

  return createLearningProjectFromPlan(buildFallbackProjectPlan(options.description));
}

function buildProjectPlannerSystemPrompt(learning: LearningConfig): string {
  const background = learning.background?.trim();
  const concepts = listLearningConcepts()
    .map((concept) => `- ${concept.id}: ${concept.name}（${concept.description}）`)
    .join("\n");

  return [
    "你是一位 Vibe Coding 项目教练，负责把用户想做的东西拆成一组适合边做边学的 milestone。",
    "目标不是写传统课程，而是让用户通过给 AI 下指令逐步完成真实项目。",
    "请返回严格 JSON，不要输出解释、标题或 Markdown 代码块。",
    "",
    "JSON 结构：",
    '{"title":"项目名","description":"项目目标","milestones":[{"title":"阶段名","objective":"这一步的明确目标","hint":"告诉用户这一步提问时该补哪些信息","suggestedPrompt":"给用户一个可以直接复制后再按需修改的 prompt","concepts":["concept-id"]}]}',
    "",
    "规则：",
    "- milestone 数量为 4 到 7 个。",
    "- 每一步都要足够小，能在一两轮 AI 协作内完成。",
    "- 第一步优先澄清范围或搭骨架，最后一步必须是验证和收尾。",
    "- hint 要强调用户该如何给 AI 说清楚。",
    "- suggestedPrompt 必须是中文、口语化、可直接发给 AI 的一句完整指令。",
    "- concepts 只能从下面这些 id 里选：",
    concepts,
    background ? `- 用户背景：${background}` : "",
  ].filter(Boolean).join("\n");
}

function buildProjectPlannerPrompt(description: string): string {
  return [
    `用户想做的项目：${description.trim()}`,
    "请输出一个面向实战的引导式项目计划。",
    "重点是让用户学会如何更好地用 AI 做项目，而不是给他一套传统编程课。",
  ].join("\n");
}

function parseProjectPlan(rawText: string, fallbackDescription: string): LearningProjectPlan | null {
  const extractedJson = extractJsonObject(rawText.trim());
  if (!extractedJson) {
    return null;
  }

  try {
    const parsed = projectPlanSchema.parse(JSON.parse(extractedJson));
    return {
      title: parsed.title.trim(),
      description: parsed.description?.trim() || fallbackDescription.trim(),
      milestones: parsed.milestones.map((milestone) => ({
        title: milestone.title.trim(),
        objective: milestone.objective.trim(),
        hint: milestone.hint.trim(),
        suggestedPrompt: milestone.suggestedPrompt?.trim(),
        concepts: normalizeConcepts(milestone.concepts),
      })),
    };
  } catch {
    return null;
  }
}

function normalizeConcepts(concepts: string[]): string[] {
  const filtered = concepts.filter((conceptId) => VALID_CONCEPT_IDS.has(conceptId));
  return filtered.length > 0 ? filtered.slice(0, 3) : ["requirement-clarity"];
}

function extractJsonObject(text: string): string {
  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return "";
  }

  return text.slice(firstBrace, lastBrace + 1);
}

function buildFallbackProjectPlan(description: string): LearningProjectPlan {
  const title = buildFallbackTitle(description);

  return {
    title,
    description: description.trim() || "做一个可迭代的小项目",
    milestones: [
      {
        title: "定清范围和技术栈",
        objective: "先告诉 AI 你要做什么、用什么技术栈、第一版只包含哪些核心页面或功能。",
        hint: "别直接说“做一个项目”，要补充页面结构、数据来源和想保留的边界。",
        suggestedPrompt: `我想做一个「${title}」，请先帮我把第一版范围定成最小可交付版本，并说明推荐的技术栈和页面结构。先不要一次做完整个项目。`,
        concepts: ["requirement-clarity", "task-decomposition"],
      },
      {
        title: "搭出可运行骨架",
        objective: "让 AI 先生成能跑起来的基础结构，包括页面骨架、路由或主要组件。",
        hint: "提醒 AI 基于当前项目继续，不要重建一套完全新的结构。",
        suggestedPrompt: `请基于当前项目结构，先帮我搭出「${title}」的基础骨架，只做路由、主要页面和占位内容。完成后告诉我改了哪些文件。`,
        concepts: ["context-framing", "architecture-sense"],
      },
      {
        title: "实现核心交互",
        objective: "把这个项目最关键的一条用户路径做通，比如添加、提交、切换或查看详情。",
        hint: "一次只推进一条核心流程，避免同时让 AI 做太多交互。",
        suggestedPrompt: `现在只推进「${title}」的核心交互流程。请先实现最关键的一条用户路径，并保持其它页面先用简单占位。`,
        concepts: ["task-decomposition", "iteration-feedback"],
      },
      {
        title: "补齐界面与异常状态",
        objective: "让 AI 优化界面表达，并补上空状态、加载状态或错误提示。",
        hint: "说清你想要的布局、视觉风格和响应式要求，不要只说“做得好看一点”。",
        suggestedPrompt: `请继续优化「${title}」这一步的界面表达，说明布局、配色和移动端表现，同时补上空状态或错误提示。`,
        concepts: ["ui-expression", "iteration-feedback"],
      },
      {
        title: "验证和收尾",
        objective: "让 AI 自查关键路径、说明验证方式，并列出还剩哪些可选优化。",
        hint: "结尾别忘了要求 AI 给出验证步骤和已知限制。",
        suggestedPrompt: `请检查「${title}」当前版本的关键流程是否可用，说明怎么验证，并列出还剩哪些可选优化项。`,
        concepts: ["verification-loop", "bug-reporting"],
      },
    ],
  };
}

function buildFallbackTitle(description: string): string {
  const cleaned = description
    .replace(/^(我想做|做一个|帮我做|请做|我想创建|创建一个)/u, "")
    .replace(/[。！？]/gu, "")
    .trim();

  if (!cleaned) {
    return "Vibe Coding 项目";
  }

  return cleaned.length <= 20 ? cleaned : `${cleaned.slice(0, 20).trimEnd()}…`;
}

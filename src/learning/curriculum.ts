import type { LearningConcept } from "./types.ts";

export const LEARNING_CONCEPTS: readonly LearningConcept[] = [
  {
    id: "requirement-clarity",
    name: "需求描述力",
    description: "把想法说得具体、可执行，让 AI 少猜测。",
  },
  {
    id: "task-decomposition",
    name: "任务拆解",
    description: "把大目标拆成适合 AI 连续完成的小步骤。",
  },
  {
    id: "context-framing",
    name: "上下文管理",
    description: "给 AI 提供当前技术栈、文件范围和已有实现，降低跑偏概率。",
  },
  {
    id: "iteration-feedback",
    name: "迭代修正",
    description: "结果不理想时，给出明确反馈而不是模糊地说“再改改”。",
  },
  {
    id: "bug-reporting",
    name: "问题诊断",
    description: "出错时准确描述现象、范围和复现方式，引导 AI 快速排查。",
  },
  {
    id: "verification-loop",
    name: "验证闭环",
    description: "让 AI 完成后自查、运行验证，并确认结果是否符合预期。",
  },
  {
    id: "ui-expression",
    name: "UI/UX 表达",
    description: "用语言说清布局、风格、交互和响应式要求。",
  },
  {
    id: "architecture-sense",
    name: "架构感知",
    description: "知道什么时候该拆组件、路由、状态或文件结构。",
  },
];

const CONCEPT_MAP = new Map(LEARNING_CONCEPTS.map((concept) => [concept.id, concept]));

export function getLearningConcept(conceptId: string): LearningConcept | undefined {
  return CONCEPT_MAP.get(conceptId);
}

export function listLearningConcepts(): readonly LearningConcept[] {
  return LEARNING_CONCEPTS;
}

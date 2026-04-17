import { getLearningConcept } from "./curriculum.ts";
import {
  applyQuizAttemptToProfile,
  type LearningQuizAttempt,
} from "./profile.ts";
import type { LearningProfile } from "./types.ts";

export interface LearningQuizQuestion {
  id: string;
  conceptId: string;
  prompt: string;
  acceptedKeywords: readonly string[];
  minimumKeywordMatches: number;
  acceptedExample: string;
  explanation: string;
}

export interface LearningQuizEvaluation {
  question: LearningQuizQuestion;
  correct: boolean;
  xpGain: number;
  profile: LearningProfile;
  message: string;
}

const LEARNING_QUIZ_QUESTIONS: readonly LearningQuizQuestion[] = [
  {
    id: "quiz-requirement-clarity-1",
    conceptId: "requirement-clarity",
    prompt: "如果你想让 AI 做一个页面，怎样的需求描述更容易让它一次做对？",
    acceptedKeywords: [
      "具体",
      "明确",
      "上下文",
      "技术栈",
      "页面结构",
      "约束",
      "验证",
      "目标",
    ],
    minimumKeywordMatches: 2,
    acceptedExample: "把目标、技术栈、页面结构和限制条件说清楚，再让 AI 开始实现。",
    explanation: "Vibe Coding 不是一句想法就够了，需求越具体，AI 越不容易替你乱做决定。",
  },
  {
    id: "quiz-task-decomposition-1",
    conceptId: "task-decomposition",
    prompt: "当你想做一个完整功能时，为什么不建议一上来就让 AI “全做完”？",
    acceptedKeywords: [
      "拆步骤",
      "分步",
      "一步一步",
      "先做",
      "范围",
      "避免跑偏",
      "小步",
    ],
    minimumKeywordMatches: 1,
    acceptedExample: "先拆成小步骤，让 AI 一次只完成一小块，结果更稳，也更容易纠偏。",
    explanation: "把大需求拆开，用户更容易掌控方向，AI 也更容易在每一轮给出可验证结果。",
  },
  {
    id: "quiz-iteration-feedback-1",
    conceptId: "iteration-feedback",
    prompt: "当 AI 做出来的页面“不太对”时，最好的反馈方式是什么？",
    acceptedKeywords: [
      "具体反馈",
      "指出哪里",
      "改成",
      "不要",
      "布局",
      "颜色",
      "交互",
      "明确",
    ],
    minimumKeywordMatches: 2,
    acceptedExample: "明确指出要改哪一块、改成什么效果、哪些部分保持不变。",
    explanation: "模糊地说“再改改”会让 AI 继续猜。好的迭代反馈要具体到位置、方向和保留项。",
  },
  {
    id: "quiz-verification-loop-1",
    conceptId: "verification-loop",
    prompt: "改完代码后，最关键的收尾动作是什么？",
    acceptedKeywords: [
      "测试",
      "跑测试",
      "验证",
      "构建",
      "检查结果",
      "运行命令验证",
      "确认改动",
    ],
    minimumKeywordMatches: 1,
    acceptedExample: "运行测试、构建或状态检查来验证改动。",
    explanation: "Vibe Coding 最容易少掉的就是验收。要求 AI 说出怎么验证，才能形成闭环。",
  },
];

export function selectLearningQuizQuestion(profile: LearningProfile): LearningQuizQuestion {
  const seenUnmastered = LEARNING_QUIZ_QUESTIONS.find((question) => {
    return profile.conceptsSeen.includes(question.conceptId)
      && !profile.conceptsMastered.includes(question.conceptId);
  });

  if (seenUnmastered) {
    return seenUnmastered;
  }

  const unmastered = LEARNING_QUIZ_QUESTIONS.find((question) => {
    return !profile.conceptsMastered.includes(question.conceptId);
  });

  return unmastered ?? LEARNING_QUIZ_QUESTIONS[0]!;
}

export function formatLearningQuizPrompt(question: LearningQuizQuestion): string {
  const conceptName = getLearningConcept(question.conceptId)?.name ?? question.conceptId;

  return [
    "",
    "  📝 学习小测",
    `  概念：${conceptName}`,
    `  题目：${question.prompt}`,
    "  请直接用一句话作答。",
    "",
  ].join("\n");
}

export function evaluateLearningQuizAnswer(
  profile: LearningProfile,
  question: LearningQuizQuestion,
  answer: string,
): LearningQuizEvaluation {
  const normalizedAnswer = normalizeAnswer(answer);
  const correct = countKeywordMatches(question, normalizedAnswer) >= question.minimumKeywordMatches;
  const conceptName = getLearningConcept(question.conceptId)?.name ?? question.conceptId;
  const newlyMastered = correct && !profile.conceptsMastered.includes(question.conceptId);
  const xpGain = correct ? (newlyMastered ? 10 : 5) : 0;
  const attempt: LearningQuizAttempt = {
    conceptId: question.conceptId,
    correct,
    xpGain,
  };
  const nextProfile = applyQuizAttemptToProfile(profile, attempt);

  const masteryLine = correct
    ? newlyMastered
      ? `  学习收获：概念「${conceptName}」已记为掌握`
      : `  学习收获：概念「${conceptName}」已得到巩固`
    : `  参考答案：${question.acceptedExample}`;

  const rewardLine = correct
    ? `  奖励：+${xpGain} XP`
    : "  奖励：0 XP（先记住解题思路，下次再试）";

  return {
    question,
    correct,
    xpGain,
    profile: nextProfile,
    message: [
      "",
      `  📝 小测结果：${correct ? "回答正确" : "还不够准确"}`,
      `  概念：${conceptName}`,
      `  你的答案：${answer.trim()}`,
      rewardLine,
      masteryLine,
      `  解析：${question.explanation}`,
      "",
    ].join("\n"),
  };
}

function normalizeAnswer(answer: string): string {
  return answer.trim().toLowerCase();
}

function countKeywordMatches(question: LearningQuizQuestion, normalizedAnswer: string): number {
  let matches = 0;

  for (const keyword of question.acceptedKeywords) {
    if (normalizedAnswer.includes(keyword.toLowerCase())) {
      matches += 1;
    }
  }

  return matches;
}

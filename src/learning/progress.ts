import type { LearningLevel, LearningProfile } from "./types.ts";

interface LevelThreshold {
  level: LearningLevel;
  minXp: number;
}

const LEVEL_THRESHOLDS: readonly LevelThreshold[] = [
  { level: "入门", minXp: 0 },
  { level: "基础", minXp: 500 },
  { level: "进阶", minXp: 1500 },
  { level: "熟练", minXp: 3500 },
  { level: "高阶", minXp: 7000 },
  { level: "专家", minXp: 12000 },
  { level: "导师", minXp: 20000 },
];

export function getLearningLevelForXp(xp: number): LearningLevel {
  let current: LearningLevel = "入门";

  for (const threshold of LEVEL_THRESHOLDS) {
    if (xp >= threshold.minXp) {
      current = threshold.level;
    }
  }

  return current;
}

export function getNextLearningThreshold(level: LearningLevel): LevelThreshold | null {
  const index = LEVEL_THRESHOLDS.findIndex((threshold) => threshold.level === level);
  if (index < 0 || index === LEVEL_THRESHOLDS.length - 1) {
    return null;
  }

  return LEVEL_THRESHOLDS[index + 1] ?? null;
}

export function calculateAccuracy(quizAnswered: number, quizCorrect: number): number {
  if (quizAnswered <= 0) {
    return 0;
  }

  return Math.round((quizCorrect / quizAnswered) * 100);
}

export function formatLearningProgress(profile: LearningProfile): string {
  const next = getNextLearningThreshold(profile.level);
  const nextLine = next
    ? `下一等级：${next.level}（还差 ${Math.max(0, next.minXp - profile.xp)} XP）`
    : "下一等级：已达到当前阶段上限";

  return [
    "",
    "  🎓 学习进度",
    `  当前等级：${profile.level}`,
    `  当前 XP：${profile.xp}`,
    `  已答小测：${profile.quizAnswered}`,
    `  已见概念：${profile.conceptsSeen.length}`,
    `  已掌握概念：${profile.conceptsMastered.length}`,
    `  小测正确率：${profile.accuracy}%`,
    `  Prompt 平均分：${profile.averagePromptScore.toFixed(1)}/5（共 ${profile.promptReviews} 次）`,
    `  ${nextLine}`,
    "",
  ].join("\n");
}

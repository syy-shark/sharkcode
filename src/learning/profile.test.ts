import { describe, expect, it } from "bun:test";
import {
  applyLessonToProfile,
  applyQuizAttemptToProfile,
  createDefaultLearningProfile,
} from "./profile.ts";

describe("learning profile", () => {
  it("applies lesson xp and concepts", () => {
    const updated = applyLessonToProfile(
      createDefaultLearningProfile(),
      {
        id: "lesson-1",
        summary: "先读文件再修改",
        detail: "detail",
        concepts: ["context-framing", "iteration-feedback"],
        createdAt: new Date().toISOString(),
        interrupted: false,
        sourcePrompt: "修复 bug",
        promptReview: {
          score: 4,
          summary: "prompt 方向明确",
          strengths: ["目标清晰"],
          improvements: ["可以补充验证方式"],
          suggestedPrompt: "请修复后告诉我如何验证。",
          detectedConcepts: ["requirement-clarity"],
        },
        projectSnapshot: null,
      },
      5,
    );

    expect(updated.xp).toBe(5);
    expect(updated.conceptsSeen).toContain("context-framing");
    expect(updated.lastLesson?.summary).toBe("先读文件再修改");
    expect(updated.averagePromptScore).toBe(4);
  });

  it("applies quiz stats and mastered concepts", () => {
    const updated = applyQuizAttemptToProfile(createDefaultLearningProfile(), {
      conceptId: "verification-loop",
      correct: true,
      xpGain: 10,
    });

    expect(updated.xp).toBe(10);
    expect(updated.quizAnswered).toBe(1);
    expect(updated.quizCorrect).toBe(1);
    expect(updated.accuracy).toBe(100);
    expect(updated.conceptsSeen).toContain("verification-loop");
    expect(updated.conceptsMastered).toContain("verification-loop");
  });
});

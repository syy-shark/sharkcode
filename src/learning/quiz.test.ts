import { describe, expect, it } from "bun:test";
import { createDefaultLearningProfile } from "./profile.ts";
import {
  evaluateLearningQuizAnswer,
  selectLearningQuizQuestion,
} from "./quiz.ts";

describe("learning quiz", () => {
  it("prefers seen but unmastered concepts", () => {
    const profile = {
      ...createDefaultLearningProfile(),
      conceptsSeen: ["iteration-feedback", "verification-loop"],
      conceptsMastered: ["verification-loop"],
    };

    const question = selectLearningQuizQuestion(profile);

    expect(question.conceptId).toBe("iteration-feedback");
  });

  it("awards mastery and xp for a correct answer", () => {
    const profile = createDefaultLearningProfile();
    const question = selectLearningQuizQuestion(profile);
    const result = evaluateLearningQuizAnswer(profile, question, "把目标、上下文和限制条件说具体，再让 AI 开始做");

    expect(result.correct).toBe(true);
    expect(result.profile.quizAnswered).toBe(1);
    expect(result.profile.quizCorrect).toBe(1);
    expect(result.profile.xp).toBe(10);
    expect(result.profile.conceptsMastered).toContain("requirement-clarity");
  });

  it("counts attempts but not mastery for an incorrect answer", () => {
    const profile = createDefaultLearningProfile();
    const question = selectLearningQuizQuestion(profile);
    const result = evaluateLearningQuizAnswer(profile, question, "直接改就行");

    expect(result.correct).toBe(false);
    expect(result.profile.quizAnswered).toBe(1);
    expect(result.profile.quizCorrect).toBe(0);
    expect(result.profile.xp).toBe(0);
    expect(result.profile.conceptsSeen).toContain("requirement-clarity");
    expect(result.profile.conceptsMastered).not.toContain("requirement-clarity");
  });
});

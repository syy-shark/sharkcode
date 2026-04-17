import { describe, expect, it } from "bun:test";
import { reviewLearningPrompt } from "./prompt-coach.ts";
import { createLearningProjectFromPlan } from "./project.ts";

describe("prompt coach", () => {
  it("scores vague prompts lower and suggests a better prompt", () => {
    const review = reviewLearningPrompt({
      prompt: "帮我做个页面",
    });

    expect(review.score).toBeLessThanOrEqual(3);
    expect(review.detectedConcepts).toContain("requirement-clarity");
    expect(review.suggestedPrompt.length).toBeGreaterThan(10);
  });

  it("uses current project milestone context", () => {
    const project = createLearningProjectFromPlan({
      title: "Todo App",
      description: "做一个 Todo App",
      milestones: [
        {
          title: "搭基础布局",
          objective: "先搭出输入框和列表区域",
          hint: "告诉 AI 这轮只做基础布局",
          concepts: ["task-decomposition", "ui-expression"],
        },
      ],
    });

    const review = reviewLearningPrompt({
      prompt: "继续做这个项目",
      project,
    });

    expect(review.detectedConcepts).toContain("task-decomposition");
    expect(review.suggestedPrompt).toContain("搭基础布局");
  });
});

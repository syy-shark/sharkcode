import { describe, expect, it, mock } from "bun:test";

const generateCalls: Array<{ system?: string; prompt?: string }> = [];

mock.module("ai", () => ({
  generateText: mock((options: { system?: string; prompt?: string }) => {
    generateCalls.push(options);
    return Promise.resolve({ text: "因为这一轮先定位上下文，再决定怎么改。" });
  }),
}));

const { answerLearningFollowUp, formatLearningFollowUpAnswer } = await import("./follow-up.ts");
const { createLearningSessionState, rememberLearningFollowUp, rememberLearningLesson } = await import("./state.ts");

describe("learning follow-up", () => {
  it("formats answer output with a follow-up hint", () => {
    expect(formatLearningFollowUpAnswer("解释内容")).toContain("/learn ask");
  });

  it("builds prompts from lesson and prior follow-up history", async () => {
    let state = rememberLearningLesson(createLearningSessionState(), {
      id: "lesson-1",
      summary: "先定位上下文再修改",
      detail: "【本轮概况】\n先读文件，再确认改动路径。",
      concepts: ["context-framing"],
      createdAt: new Date().toISOString(),
      interrupted: false,
      sourcePrompt: "修复 bug",
      promptReview: null,
      projectSnapshot: null,
    });
    state = rememberLearningFollowUp(state, "为什么先读文件？", "因为要避免盲改。");

    const answer = await answerLearningFollowUp({
      question: "那为什么不直接改？",
      learning: { enabled: true, model: "gpt-4o-mini", verbosity: "标准", autoCards: true },
      model: "gpt-4o-mini",
      sessionState: state,
      getProvider: async () => ({}) as never,
    });

    expect(answer).toContain("先定位上下文");
    expect(generateCalls[0]?.prompt).toContain("为什么先读文件");
    expect(generateCalls[0]?.prompt).toContain("那为什么不直接改");
  });
});

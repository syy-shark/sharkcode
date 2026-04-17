import { describe, expect, it } from "bun:test";
import { detectLearningSignal } from "./detector.ts";

describe("detectLearningSignal", () => {
  it("detects concepts from tool usage", () => {
    const result = detectLearningSignal({
      userPrompt: "帮我优化这个页面布局",
      toolCalls: [
        { toolName: "read_file", args: { filePath: "src/app.ts" } },
        { toolName: "edit_file", args: { filePath: "src/app.ts" } },
      ],
      toolResults: [],
      agentTextSummary: "先读文件再改实现。",
      promptReview: {
        score: 2,
        summary: "prompt 太泛",
        strengths: [],
        improvements: ["补充布局和限制条件"],
        suggestedPrompt: "请把首页改成双栏布局。",
        detectedConcepts: ["requirement-clarity", "ui-expression"],
      },
    });

    expect(result.shouldGenerate).toBe(true);
    expect(result.concepts).toContain("context-framing");
    expect(result.concepts).toContain("iteration-feedback");
    expect(result.concepts).toContain("requirement-clarity");
  });

  it("adds debugging concept on errors", () => {
    const result = detectLearningSignal({
      userPrompt: "修复命令失败",
      toolCalls: [{ toolName: "bash", args: { command: "npm test" } }],
      toolResults: [],
      toolErrors: [{ toolName: "bash", error: "exit 1" }],
      agentErrors: [],
      interrupted: false,
      agentTextSummary: "测试失败，需要修复。",
    });

    expect(result.concepts).toContain("bug-reporting");
  });
});

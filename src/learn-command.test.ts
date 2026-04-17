import { describe, expect, it } from "bun:test";
import { handleLearnCommand } from "./learning/commands.ts";
import type { MultiConfig } from "./config.ts";
import { createDefaultLearningProfile } from "./learning/profile.ts";
import { createLearningSessionState } from "./learning/state.ts";

function createMultiConfig(
  learning: Partial<MultiConfig["learning"]> = {},
): MultiConfig {
  return {
    activeProvider: "deepseek",
    permissionMode: "prompt",
    providers: {
      deepseek: {
        key: "",
        model: "deepseek-chat",
        thinkingLevel: "default",
      },
    },
    learning: {
      enabled: false,
      verbosity: "标准",
      autoCards: true,
      ...learning,
    },
  };
}

function createDeps() {
  return {
    chooseMenuAction: async () => "close" as const,
    promptForModelSelection: async () => "gpt-4o-mini",
    formatProgress: () => "progress",
    formatRecap: () => "recap",
    runQuiz: async () => ({
      profile: createDefaultLearningProfile(),
      message: "quiz",
    }),
    profile: createDefaultLearningProfile(),
    sessionState: createLearningSessionState(),
    saveConfig: () => {},
  };
}

describe("handleLearnCommand", () => {
  it("sets enabled to true with /learn on", async () => {
    const result = await handleLearnCommand("/learn on", createMultiConfig(), createDeps());

    expect(result.multiConfig?.learning.enabled).toBe(true);
    expect(result.message).toContain("开启");
  });

  it("sets enabled to false with /learn off", async () => {
    const result = await handleLearnCommand("/learn off", createMultiConfig({ enabled: true }), createDeps());

    expect(result.multiConfig?.learning.enabled).toBe(false);
    expect(result.message).toContain("关闭");
  });

  it("sets the learning model", async () => {
    const result = await handleLearnCommand("/learn model gpt-4o-mini", createMultiConfig(), createDeps());

    expect(result.multiConfig?.learning.model).toBe("gpt-4o-mini");
  });

  it("sets verbosity to 详细", async () => {
    const result = await handleLearnCommand("/learn level 详细", createMultiConfig(), createDeps());

    expect(result.multiConfig?.learning.verbosity).toBe("详细");
  });

  it("returns progress content", async () => {
    const result = await handleLearnCommand("/learn progress", createMultiConfig(), createDeps());

    expect(result.message).toBe("progress");
  });

  it("returns ask payload for /learn ask", async () => {
    const result = await handleLearnCommand("/learn ask 为什么先读文件", createMultiConfig(), createDeps());

    expect(result.askQuestion).toBe("为什么先读文件");
  });

  it("returns project payload for /learn start", async () => {
    const result = await handleLearnCommand("/learn start 做一个个人主页", createMultiConfig(), createDeps());

    expect(result.startProjectDescription).toBe("做一个个人主页");
  });

  it("returns hint payload for /learn hint", async () => {
    const result = await handleLearnCommand("/learn hint", createMultiConfig(), createDeps());

    expect(result.showProjectHint).toBe(true);
  });

  it("returns complete payload for /learn complete", async () => {
    const result = await handleLearnCommand("/learn complete", createMultiConfig(), createDeps());

    expect(result.completeProject).toBe(true);
  });

  it("runs quiz content", async () => {
    const result = await handleLearnCommand("/learn quiz", createMultiConfig(), createDeps());

    expect(result.message).toBe("quiz");
    expect(result.profile).toBeDefined();
  });

  it("returns an error for invalid level", async () => {
    const result = await handleLearnCommand("/learn level invalid", createMultiConfig(), createDeps());

    expect(result.multiConfig).toBeUndefined();
    expect(result.message).toContain("无效的讲解详略");
  });
});

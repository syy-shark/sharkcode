import { describe, expect, it } from "bun:test";
import { handleTeachCommand } from "./cli.ts";
import type { MultiConfig } from "./config.ts";

function createMultiConfig(
  teaching: Partial<MultiConfig["teaching"]> = {},
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
    teaching: {
      enabled: false,
      verbosity: "标准",
      ...teaching,
    },
  };
}

describe("handleTeachCommand", () => {
  it("toggles enabled from false to true", () => {
    const result = handleTeachCommand("/teach", createMultiConfig({ enabled: false }));

    expect(result.multiConfig?.teaching.enabled).toBe(true);
    expect(result.message).toContain("开启");
  });

  it("toggles enabled from true to false", () => {
    const result = handleTeachCommand("/teach", createMultiConfig({ enabled: true }));

    expect(result.multiConfig?.teaching.enabled).toBe(false);
    expect(result.message).toContain("关闭");
  });

  it("sets enabled to true with /teach on", () => {
    const result = handleTeachCommand("/teach on", createMultiConfig({ enabled: false }));

    expect(result.multiConfig?.teaching.enabled).toBe(true);
  });

  it("sets enabled to false with /teach off", () => {
    const result = handleTeachCommand("/teach off", createMultiConfig({ enabled: true }));

    expect(result.multiConfig?.teaching.enabled).toBe(false);
  });

  it("sets the teaching model", () => {
    const result = handleTeachCommand(
      "/teach model gpt-4o-mini",
      createMultiConfig(),
    );

    expect(result.multiConfig?.teaching.model).toBe("gpt-4o-mini");
  });

  it("sets verbosity to 简洁", () => {
    const result = handleTeachCommand("/teach level 简洁", createMultiConfig());

    expect(result.multiConfig?.teaching.verbosity).toBe("简洁");
  });

  it("sets verbosity to 标准", () => {
    const result = handleTeachCommand("/teach level 标准", createMultiConfig({ verbosity: "简洁" }));

    expect(result.multiConfig?.teaching.verbosity).toBe("标准");
  });

  it("sets verbosity to 详细", () => {
    const result = handleTeachCommand("/teach level 详细", createMultiConfig());

    expect(result.multiConfig?.teaching.verbosity).toBe("详细");
  });

  it("returns an error for invalid level and does not modify config", () => {
    const multiConfig = createMultiConfig({ verbosity: "标准" });
    const result = handleTeachCommand("/teach level invalid", multiConfig);

    expect(result.multiConfig).toBeUndefined();
    expect(result.message).toContain("无效的教学详略");
    expect(multiConfig.teaching.verbosity).toBe("标准");
  });

  it("returns an error for unknown subcommands", () => {
    const multiConfig = createMultiConfig({ enabled: true });
    const result = handleTeachCommand("/teach unknown", multiConfig);

    expect(result.multiConfig).toBeUndefined();
    expect(result.message).toContain("用法");
    expect(multiConfig.teaching.enabled).toBe(true);
  });
});

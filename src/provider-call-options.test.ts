import { describe, expect, test } from "bun:test";
import { getMaxOutputTokens, getStreamProviderOptions } from "./provider-call-options.ts";

describe("getStreamProviderOptions", () => {
  test("forces plain system prompts for Copilot GPT-5 models", () => {
    expect(getStreamProviderOptions({ providerName: "copilot", model: "gpt-5-mini", thinkingLevel: "default" })).toEqual({
      openai: {
        systemMessageMode: "system",
        forceReasoning: false,
      },
    });
  });

  test("injects Copilot reasoning effort for supported GPT-5 family models", () => {
    expect(getStreamProviderOptions({ providerName: "copilot", model: "gpt-5.4", thinkingLevel: "xhigh" })).toEqual({
      openai: {
        systemMessageMode: "system",
        forceReasoning: false,
        reasoningEffort: "xhigh",
      },
    });
  });

  test("injects Copilot reasoning effort for supported Claude 4.6 models", () => {
    expect(getStreamProviderOptions({ providerName: "copilot", model: "claude-opus-4.6", thinkingLevel: "high" })).toEqual({
      openai: {
        systemMessageMode: "system",
        forceReasoning: false,
        reasoningEffort: "high",
      },
    });
  });

  test("does not inject unsupported Copilot reasoning effort for non-reasoning models", () => {
    expect(getStreamProviderOptions({ providerName: "copilot", model: "gpt-4o", thinkingLevel: "high" })).toEqual({
      openai: {
        systemMessageMode: "system",
        forceReasoning: false,
      },
    });
  });

  test("switches Copilot responses-only models to store=false provider options", () => {
    expect(getStreamProviderOptions(
      { providerName: "copilot", model: "gpt-5.4-mini", thinkingLevel: "xhigh" },
      undefined,
      "responses",
    )).toEqual({
      openai: {
        store: false,
        reasoningEffort: "xhigh",
      },
    });
  });

  test("injects responses instructions for Codex subscription flow", () => {
    expect(getStreamProviderOptions({ providerName: "codex", model: "gpt-5.4", thinkingLevel: "default" }, "System prompt")).toEqual({
      openai: {
        instructions: "System prompt",
        store: false,
      },
    });
  });

  test("injects reasoning effort for supported OpenAI reasoning models", () => {
    expect(getStreamProviderOptions({ providerName: "openai", model: "gpt-5.4", thinkingLevel: "high" })).toEqual({
      openai: {
        reasoningEffort: "high",
      },
    });
  });

  test("combines Codex instructions and reasoning effort", () => {
    expect(getStreamProviderOptions({ providerName: "codex", model: "gpt-5.4", thinkingLevel: "low" }, "System prompt")).toEqual({
      openai: {
        instructions: "System prompt",
        store: false,
        reasoningEffort: "low",
      },
    });
  });

  test("passes through Codex extra high reasoning effort", () => {
    expect(getStreamProviderOptions({ providerName: "codex", model: "gpt-5.4", thinkingLevel: "xhigh" }, "System prompt")).toEqual({
      openai: {
        instructions: "System prompt",
        store: false,
        reasoningEffort: "xhigh",
      },
    });
  });

  test("skips reasoning effort for non-reasoning models", () => {
    expect(getStreamProviderOptions({ providerName: "openai", model: "gpt-4o", thinkingLevel: "high" })).toBeUndefined();
  });

  test("does not inject provider options for standard providers", () => {
    expect(getStreamProviderOptions({ providerName: "openai", model: "gpt-5.4", thinkingLevel: "default" })).toBeUndefined();
  });
});

describe("getMaxOutputTokens", () => {
  test("omits max output tokens for Codex subscription flow", () => {
    expect(getMaxOutputTokens({ providerName: "codex", apiKey: "" })).toBeUndefined();
  });

  test("keeps max output tokens for standard providers", () => {
    expect(getMaxOutputTokens({ providerName: "openai", apiKey: "test" })).toBe(16384);
  });
});

import { describe, expect, test } from "bun:test";
import { createProvider } from "./provider.ts";

describe("createProvider", () => {
  test("uses the chat API for DeepSeek-compatible providers", () => {
    const model = createProvider({
      providerName: "deepseek",
      apiKey: "test-key",
      model: "deepseek-chat",
      baseURL: "https://api.deepseek.com/v1",
    });

    expect(model.provider).toBe("deepseek.chat");
  });

  test("uses the correct provider name for OpenAI", () => {
    const model = createProvider({
      providerName: "openai",
      apiKey: "test-key",
      model: "gpt-4o",
      baseURL: "https://api.openai.com/v1",
    });

    expect(model.provider).toBe("openai.chat");
  });
});

import { describe, expect, test } from "bun:test";
import { createProvider } from "./provider.ts";

describe("createProvider", () => {
  test("uses the chat API for DeepSeek-compatible providers", () => {
    const model = createProvider({
      apiKey: "test-key",
      model: "deepseek-chat",
      baseURL: "https://api.deepseek.com/v1",
    });

    expect(model.provider).toBe("deepseek.chat");
  });
});

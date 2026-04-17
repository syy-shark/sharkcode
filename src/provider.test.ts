import { describe, expect, test } from "bun:test";
import { getCopilotModelTransport } from "./copilot-models.ts";

describe("Copilot provider routing", () => {
  test("routes responses-only models away from chat/completions", () => {
    expect(getCopilotModelTransport("gpt-5.4-mini")).toBe("responses");
    expect(getCopilotModelTransport("gpt-5.3-codex")).toBe("responses");
  });
});

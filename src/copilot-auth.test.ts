import { describe, expect, test } from "bun:test";
import { COPILOT_BASE_URL, resolveCopilotBaseURL } from "./copilot-auth.ts";

describe("resolveCopilotBaseURL", () => {
  test("keeps the public Copilot API for individual proxy endpoints", () => {
    expect(resolveCopilotBaseURL("proxy.individual.githubcopilot.com")).toBe(COPILOT_BASE_URL);
    expect(resolveCopilotBaseURL("https://proxy.individual.githubcopilot.com")).toBe(COPILOT_BASE_URL);
  });

  test("preserves non-individual proxy endpoints", () => {
    expect(resolveCopilotBaseURL("proxy.business.githubcopilot.com"))
      .toBe("https://proxy.business.githubcopilot.com");
  });

  test("falls back to the public Copilot API when no proxy endpoint exists", () => {
    expect(resolveCopilotBaseURL()).toBe(COPILOT_BASE_URL);
  });
});

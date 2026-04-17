import { describe, expect, test } from "bun:test";
import {
  COPILOT_FALLBACK_PRESET_MODELS,
  getCopilotModelAccessIssue,
  getCopilotModelTransport,
  normalizeCopilotModelId,
} from "./copilot-models.ts";

describe("normalizeCopilotModelId", () => {
  test("normalizes Copilot picker labels to canonical model ids", () => {
    expect(normalizeCopilotModelId("GPT-5.4 mini")).toBe("gpt-5.4-mini");
    expect(normalizeCopilotModelId(" GPT-5 mini ")).toBe("gpt-5-mini");
  });

  test("keeps unknown custom models unchanged", () => {
    expect(normalizeCopilotModelId("my-preview-model")).toBe("my-preview-model");
  });
});

describe("getCopilotModelTransport", () => {
  test("routes known responses-only Copilot models to the responses API", () => {
    expect(getCopilotModelTransport("gpt-5.4-mini")).toBe("responses");
    expect(getCopilotModelTransport("gpt-5.3-codex")).toBe("responses");
  });

  test("keeps standard Copilot chat models on chat completions", () => {
    expect(getCopilotModelTransport("gpt-4.1")).toBe("chat");
    expect(getCopilotModelTransport("gpt-5-mini")).toBe("chat");
  });

  test("prefers remote endpoint metadata over the static fallback set", () => {
    expect(getCopilotModelTransport("gpt-5.4-mini", [{
      id: "gpt-5.4-mini",
      supportedEndpoints: ["/chat/completions", "/responses"],
    }])).toBe("chat");
  });
});

describe("Copilot fallback presets", () => {
  test("include GPT-5.4 mini in the local fallback picker", () => {
    expect(COPILOT_FALLBACK_PRESET_MODELS.some((model) => model.id === "gpt-5.4-mini")).toBe(true);
  });
});

describe("getCopilotModelAccessIssue", () => {
  test("surfaces disabled policy state from the remote model list", () => {
    expect(getCopilotModelAccessIssue("gpt-5.4", [{
      id: "gpt-5.4",
      policy: { state: "disabled" },
    }])).toContain("policy.state=disabled");
  });
});

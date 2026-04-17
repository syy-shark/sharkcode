import { getAvailableThinkingLevels, type Config } from "./config.ts";
import type { CopilotTransport } from "./copilot-models.ts";

/**
 * Provider-specific call options passed through the AI SDK.
 *
 * Copilot exposes an OpenAI-compatible endpoint, but it does not implement the
 * newer GPT-5 reasoning wire format that the AI SDK auto-enables for `gpt-5*`
 * model IDs. We force plain `system` prompts and disable reasoning-mode
 * coercion so the SDK emits the older `/chat/completions` shape Copilot expects.
 */
export function getStreamProviderOptions(
  config: Pick<Config, "providerName" | "model" | "thinkingLevel">,
  codexInstructions?: string,
  copilotTransport: CopilotTransport = "chat",
) {
  const availableThinkingLevels = getAvailableThinkingLevels(config.providerName, config.model);
  const shouldApplyThinkingLevel =
    config.thinkingLevel !== "default" &&
    availableThinkingLevels.includes(config.thinkingLevel);

  const reasoningOptions = shouldApplyThinkingLevel
    ? { reasoningEffort: config.thinkingLevel }
    : undefined;

  if (config.providerName === "copilot") {
    if (copilotTransport === "responses") {
      return {
        openai: {
          store: false,
          ...reasoningOptions,
        },
      };
    }

    return {
      openai: {
        systemMessageMode: "system" as const,
        forceReasoning: false,
        ...reasoningOptions,
      },
    };
  }

  if (config.providerName === "codex" && codexInstructions) {
    return {
      openai: {
        instructions: codexInstructions,
        store: false,
        ...reasoningOptions,
      },
    };
  }

  if (reasoningOptions) {
    return {
      openai: reasoningOptions,
    };
  }

  return undefined;
}

export function getMaxOutputTokens(config: Pick<Config, "providerName" | "apiKey">): number | undefined {
  // Match OpenCode's Codex OAuth bridge: omit max output tokens for subscription flow.
  if (config.providerName === "codex" && !config.apiKey) {
    return undefined;
  }

  return 16384;
}

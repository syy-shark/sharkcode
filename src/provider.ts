import { createOpenAI } from "@ai-sdk/openai";
import type { Config } from "./config.ts";

export function createProvider(config: Config) {
  const provider = createOpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    // ARK requires a non-default name to avoid SDK header overrides
    name: config.providerName === "ark" ? "ark" : "deepseek",
  });
  return provider.chat(config.model);
}

import { createOpenAI } from "@ai-sdk/openai";
import type { Config } from "./config.ts";

export function createProvider(config: Config) {
  const provider = createOpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    name: config.providerName,
  });
  return provider.chat(config.model);
}

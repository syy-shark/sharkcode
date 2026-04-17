import { createOpenAI } from "@ai-sdk/openai";
import { getUnsupportedProviderModelMessage, normalizeProviderModel, type Config } from "./config.ts";
import { getCopilotRuntime, type CopilotExecutionMode } from "./copilot-models.ts";
import { getCopilotToken, buildCopilotHeaders, getCopilotBaseURL } from "./copilot-auth.ts";
import { getCodexAuth, getCodexToken, readCodexCliToken } from "./codex-auth.ts";

const CODEX_OAUTH_BASE_URL = "https://chatgpt.com/backend-api/codex";

function buildCodexOAuthFetch() {
  const codexFetch = Object.assign(async (
    requestInput: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const auth = await getCodexAuth();

    const headers = new Headers(init?.headers);
    headers.delete("authorization");
    headers.delete("Authorization");
    headers.delete("x-api-key");
    headers.delete("X-Api-Key");
    headers.set("authorization", `Bearer ${auth.accessToken}`);
    headers.set("originator", "sharkcode");
    headers.set("User-Agent", "sharkcode");

    if (auth.accountId) {
      headers.set("ChatGPT-Account-Id", auth.accountId);
    }

    return fetch(requestInput, {
      ...init,
      headers,
    });
  }, {
    preconnect: fetch.preconnect?.bind(fetch),
  });

  return codexFetch satisfies typeof fetch;
}

export async function getProviderExecutionMode(config: Config): Promise<CopilotExecutionMode | "stream"> {
  if (config.providerName !== "copilot") {
    return "stream";
  }

  const modelId = normalizeProviderModel(config.providerName, config.model);
  const runtime = await getCopilotRuntime(modelId);
  return runtime.executionMode;
}

// ─── Main factory ─────────────────────────────────────────────────────────────

export async function createProviderAsync(config: Config) {
  const modelId = normalizeProviderModel(config.providerName, config.model);
  const unsupportedModelMessage = getUnsupportedProviderModelMessage(config.providerName, modelId);

  if (unsupportedModelMessage) {
    throw new Error(unsupportedModelMessage);
  }

  // ── GitHub Copilot ─────────────────────────────────────────────────────────
  if (config.providerName === "copilot") {
    const runtime = await getCopilotRuntime(modelId);
    if (runtime.accessIssue) {
      throw new Error(runtime.accessIssue);
    }

    const copilotToken = await getCopilotToken();
    const extraHeaders = buildCopilotHeaders(copilotToken);

    const provider = createOpenAI({
      baseURL: getCopilotBaseURL(),
      // The real auth is in extraHeaders; apiKey is a dummy to satisfy the SDK
      apiKey:  "copilot",
      headers: extraHeaders,
      name:    "copilot",
    });
    return runtime.transport === "responses"
      ? provider.responses(modelId)
      : provider.chat(modelId);
  }

  // ── OpenAI Codex (OAuth device flow OR API Key fallback) ───────────────────
  if (config.providerName === "codex") {
    if (!config.apiKey) {
      try {
        await getCodexAuth();
        const provider = createOpenAI({
          baseURL: CODEX_OAUTH_BASE_URL,
          apiKey: "codex-oauth",
          name: "codex",
          fetch: buildCodexOAuthFetch(),
        });
        return provider.responses(modelId);
      } catch {
        // Fall through to standard API key mode.
      }
    }

    let key = config.apiKey;
    if (!key) {
      if (!key) key = process.env["OPENAI_API_KEY"] ?? "";
      if (!key) key = readCodexCliToken() ?? "";
      if (!key) {
        try { key = getCodexToken(); } catch { /* not logged in */ }
      }
    }

    const provider = createOpenAI({
      baseURL: "https://api.openai.com/v1",
      apiKey:  key,
      name:    "codex",
    });
    return provider.chat(modelId);
  }

  // ── All other OpenAI-compatible providers ──────────────────────────────────
  const provider = createOpenAI({
    baseURL: config.baseURL,
    apiKey:  config.apiKey,
    name:    config.providerName,
  });
  return provider.chat(modelId);
}

/**
 * Synchronous wrapper kept for call-sites that don't yet use async.
 * For copilot this will throw — use createProviderAsync() there.
 */
export function createProvider(config: Config) {
  const modelId = normalizeProviderModel(config.providerName, config.model);

  if (config.providerName === "copilot") {
    throw new Error("Use createProviderAsync() for the copilot provider.");
  }
  if (config.providerName === "codex") {
    if (!config.apiKey && !process.env["OPENAI_API_KEY"]) {
      throw new Error("Use createProviderAsync() for Codex subscription auth.");
    }

    let key = config.apiKey;
    if (!key) {
      if (!key) key = process.env["OPENAI_API_KEY"] ?? "";
      if (!key) key = readCodexCliToken() ?? "";
      if (!key) {
        try { key = getCodexToken(); } catch { /* not logged in */ }
      }
    }
    const provider = createOpenAI({
      baseURL: "https://api.openai.com/v1",
      apiKey:  key,
      name:    "codex",
    });
    return provider.chat(modelId);
  }
  const provider = createOpenAI({
    baseURL: config.baseURL,
    apiKey:  config.apiKey,
    name:    config.providerName,
  });
  return provider.chat(modelId);
}

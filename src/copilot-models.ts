import { buildCopilotHeaders, getCopilotBaseURL, getCopilotToken } from "./copilot-auth.ts";

export type CopilotTransport = "chat" | "responses";
export type CopilotExecutionMode = "stream" | "generate";

export interface CopilotModelDescriptor {
  id: string;
  name?: string;
  supportedEndpoints?: readonly string[];
  modelPickerEnabled?: boolean;
  preview?: boolean;
  policy?: {
    state?: string;
    terms?: string;
  };
  capabilities?: {
    supports?: {
      reasoning_effort?: readonly string[];
    };
  };
}

export const COPILOT_FALLBACK_PRESET_MODELS = [
  { id: "auto",                   label: "Auto",                     note: "Chat · 10% discount" },
  { id: "claude-opus-4.6",        label: "Claude Opus 4.6",         note: "High · Chat · 3x" },
  { id: "claude-sonnet-4.6",      label: "Claude Sonnet 4.6",       note: "Medium · Chat · 1x" },
  { id: "gpt-4o",                 label: "GPT-4o",                  note: "Chat · 0x" },
  { id: "gpt-5.4",                label: "GPT-5.4",                 note: "Xhigh · Chat/Responses · 1x" },
  { id: "gpt-5.4-mini",           label: "GPT-5.4 mini",            note: "Medium · Responses · 1x" },
  { id: "claude-haiku-4.5",       label: "Claude Haiku 4.5",        note: "Chat · 0.33x" },
  { id: "claude-opus-4.5",        label: "Claude Opus 4.5",         note: "Chat · 3x" },
  { id: "claude-sonnet-4",        label: "Claude Sonnet 4",         note: "Chat · ⚠ 1x" },
  { id: "claude-sonnet-4.5",      label: "Claude Sonnet 4.5",       note: "Chat · 1x" },
  { id: "gemini-2.5-pro",         label: "Gemini 2.5 Pro",          note: "Chat · 1x" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (Preview)",note: "Chat · 0.33x" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (Preview)",note: "Chat · 1x" },
  { id: "gpt-4.1",                label: "GPT-4.1",                 note: "Chat · 0x" },
  { id: "gpt-5-mini",             label: "GPT-5 mini",              note: "Medium · Chat/Responses · 0x" },
  { id: "gpt-5.1",                label: "GPT-5.1",                 note: "Medium · Chat/Responses · 1x" },
  { id: "gpt-5.2",                label: "GPT-5.2",                 note: "Medium · Chat/Responses · 1x" },
  { id: "gpt-5.2-codex",          label: "GPT-5.2-Codex",           note: "Medium · Responses · 1x" },
  { id: "gpt-5.3-codex",          label: "GPT-5.3-Codex",           note: "Medium · Responses · 1x" },
  { id: "grok-code-fast-1",       label: "Grok Code Fast 1",        note: "Chat · 0.25x" },
  { id: "oswe-vscode-prime",      label: "Raptor mini (Preview)",   note: "Chat · 0x" },
] as const;

const COPILOT_RESPONSES_ONLY_MODEL_IDS = new Set<string>([
  "gpt-5.2-codex",
  "gpt-5.3-codex",
  "gpt-5.4-mini",
]);

const copilotAliasMap = new Map<string, string>();

for (const model of COPILOT_FALLBACK_PRESET_MODELS) {
  copilotAliasMap.set(normalizeCopilotAliasKey(model.id), model.id);
  if (model.label) {
    copilotAliasMap.set(normalizeCopilotAliasKey(model.label), model.id);
  }
}

let copilotModelsPromise: Promise<readonly CopilotModelDescriptor[]> | null = null;

function normalizeCopilotAliasKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-");
}

function supportsEndpoint(endpoints: readonly string[] | undefined, endpoint: string): boolean {
  return endpoints?.includes(endpoint) ?? false;
}

function highestReasoningLevelLabel(levels: readonly string[] | undefined): string | undefined {
  if (!levels?.length) return undefined;
  if (levels.includes("xhigh")) return "Xhigh";
  if (levels.includes("high")) return "High";
  if (levels.includes("medium")) return "Medium";
  if (levels.includes("low")) return "Low";
  if (levels.includes("none")) return "None";
  return undefined;
}

async function fetchCopilotModels(): Promise<readonly CopilotModelDescriptor[]> {
  const token = await getCopilotToken();
  const resp = await fetch(`${getCopilotBaseURL()}/models`, {
    headers: buildCopilotHeaders(token),
  });

  if (!resp.ok) {
    throw new Error(`GitHub Copilot /models failed: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json() as { data?: readonly CopilotModelDescriptor[] };
  return data.data ?? [];
}

function toPresetModelNote(model: CopilotModelDescriptor): string | undefined {
  const transport = getCopilotModelTransport(model.id, [model]);
  const chatEnabled = supportsEndpoint(model.supportedEndpoints, "/chat/completions");
  const responsesEnabled =
    supportsEndpoint(model.supportedEndpoints, "/responses") ||
    supportsEndpoint(model.supportedEndpoints, "ws:/responses");
  const endpointLabel = chatEnabled && responsesEnabled
    ? "Chat/Responses"
    : transport === "responses"
      ? "Responses"
      : "Chat";
  const parts: string[] = [];

  if (model.policy?.state === "disabled") {
    parts.push("需启用");
  }

  const reasoningLabel = highestReasoningLevelLabel(model.capabilities?.supports?.reasoning_effort);
  if (reasoningLabel) {
    parts.push(reasoningLabel);
  }

  parts.push(endpointLabel);
  if (model.preview) {
    parts.push("Preview");
  }

  return parts.join(" · ");
}

export function normalizeCopilotModelId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  const alias = copilotAliasMap.get(normalizeCopilotAliasKey(trimmed));
  return alias ?? trimmed;
}

export function getCopilotModelTransport(
  modelId: string,
  models?: readonly CopilotModelDescriptor[],
): CopilotTransport {
  const remoteModel = models?.find((model) => model.id === modelId);

  if (remoteModel?.supportedEndpoints?.length) {
    const supportsResponses =
      supportsEndpoint(remoteModel.supportedEndpoints, "/responses") ||
      supportsEndpoint(remoteModel.supportedEndpoints, "ws:/responses");
    const supportsChat = supportsEndpoint(remoteModel.supportedEndpoints, "/chat/completions");

    if (supportsChat) {
      return "chat";
    }

    if (supportsResponses) {
      return "responses";
    }
  }

  return COPILOT_RESPONSES_ONLY_MODEL_IDS.has(modelId) ? "responses" : "chat";
}

export function getCopilotModelAccessIssue(
  modelId: string,
  models?: readonly CopilotModelDescriptor[],
): string | undefined {
  const remoteModel = models?.find((model) => model.id === modelId);
  if (!remoteModel) return undefined;

  if (remoteModel.policy?.state === "disabled") {
    return `GitHub Copilot 账号当前未启用 ${modelId}。/models 返回 policy.state=disabled。请先在 Copilot 中启用它，或改用 gpt-5.4-mini、gpt-5-mini、gpt-4.1。`;
  }

  return undefined;
}

export async function listCopilotModels(forceRefresh = false): Promise<readonly CopilotModelDescriptor[]> {
  if (!copilotModelsPromise || forceRefresh) {
    copilotModelsPromise = fetchCopilotModels().catch((error) => {
      copilotModelsPromise = null;
      throw error;
    });
  }

  return copilotModelsPromise;
}

export async function getCopilotPresetModels(): Promise<readonly { id: string; label?: string; note?: string }[]> {
  try {
    const models = await listCopilotModels();
    const remoteChoices = models
      .filter((model) => {
        const supportsResponses =
          supportsEndpoint(model.supportedEndpoints, "/responses") ||
          supportsEndpoint(model.supportedEndpoints, "ws:/responses");
        const supportsChat = supportsEndpoint(model.supportedEndpoints, "/chat/completions");
        return model.modelPickerEnabled && (supportsResponses || supportsChat);
      })
      .map((model) => ({
        id: model.id,
        label: model.name ?? model.id,
        note: toPresetModelNote(model),
      }));

    if (remoteChoices.length > 0) {
      return remoteChoices;
    }
  } catch {
    // Fall back to the baked-in list when offline or unauthenticated.
  }

  return COPILOT_FALLBACK_PRESET_MODELS;
}

export async function getCopilotRuntime(
  modelId: string,
): Promise<{ transport: CopilotTransport; executionMode: CopilotExecutionMode; accessIssue?: string }> {
  try {
    const models = await listCopilotModels();
    const transport = getCopilotModelTransport(modelId, models);
    return {
      transport,
      executionMode: transport === "responses" ? "generate" : "stream",
      accessIssue: getCopilotModelAccessIssue(modelId, models),
    };
  } catch {
    const transport = getCopilotModelTransport(modelId);
    return {
      transport,
      executionMode: transport === "responses" ? "generate" : "stream",
    };
  }
}

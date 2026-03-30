import { parse } from "smol-toml";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Config {
  providerName: string;
  apiKey: string;
  model: string;
  baseURL: string;
}

export interface ProviderEntry {
  key: string;
  model: string;
  baseURL?: string;
}

export type PermissionMode = "prompt" | "full-access";

export interface MultiConfig {
  activeProvider: string;
  providers: Record<string, ProviderEntry>;
  permissionMode: PermissionMode;
}

// ─── Provider registry ────────────────────────────────────────────────────────

export const PROVIDERS: Record<
  string,
  { baseURL: string; defaultModel: string; label: string; envKey?: string }
> = {
  deepseek: {
    baseURL: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    label: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
  },
  ark: {
    baseURL: "https://ark.cn-beijing.volces.com/api/coding/v3",
    defaultModel: "ark-code-latest",
    label: "方舟 Coding Plan",
    envKey: "ARK_API_KEY",
  },
  openai: {
    baseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-sonnet-4",
    label: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
  },
  siliconflow: {
    baseURL: "https://api.siliconflow.cn/v1",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    label: "SiliconFlow 硅基流动",
    envKey: "SILICONFLOW_API_KEY",
  },
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    label: "Groq",
    envKey: "GROQ_API_KEY",
  },
  together: {
    baseURL: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    label: "Together AI",
    envKey: "TOGETHER_API_KEY",
  },
  qwen: {
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    label: "Qwen 通义千问",
    envKey: "DASHSCOPE_API_KEY",
  },
  ollama: {
    baseURL: "http://localhost:11434/v1",
    defaultModel: "qwen2.5-coder:7b",
    label: "Ollama 本地",
  },
  custom: {
    baseURL: "",
    defaultModel: "",
    label: "Custom 自定义",
  },
};

// ─── Paths ────────────────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), ".sharkcode");
const CONFIG_FILE = join(CONFIG_DIR, "config.toml");

// ─── Serialization ────────────────────────────────────────────────────────────

function serializeConfig(mc: MultiConfig): string {
  const lines = [
    "# Shark Code Configuration",
    "# https://github.com/syy-shark/sharkcode",
    "",
    "[default]",
    `provider = "${mc.activeProvider}"`,
    `permission_mode = "${mc.permissionMode}"`,
    "",
  ];

  for (const [id, meta] of Object.entries(PROVIDERS)) {
    const entry = mc.providers[id];
    lines.push(`[providers.${id}]`);
    if (meta.envKey) lines.push(`# ENV: ${meta.envKey}`);
    lines.push(`key = "${entry?.key ?? ""}"`);
    lines.push(`model = "${entry?.model ?? meta.defaultModel}"`);
    if (id === "custom" || id === "ollama") {
      lines.push(`base_url = "${entry?.baseURL ?? meta.baseURL}"`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Ensure config dir/file exist ─────────────────────────────────────────────

function ensureConfig(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!existsSync(CONFIG_FILE)) {
    const providers: Record<string, ProviderEntry> = {};
    for (const [id, meta] of Object.entries(PROVIDERS)) {
      providers[id] = { key: "", model: meta.defaultModel };
    }
    const initial: MultiConfig = {
      activeProvider: "deepseek",
      permissionMode: "prompt",
      providers,
    };
    writeFileSync(CONFIG_FILE, serializeConfig(initial), "utf-8");
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export function readMultiConfig(): MultiConfig {
  ensureConfig();

  let toml: Record<string, unknown> = {};
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    toml = parse(raw) as Record<string, unknown>;
  } catch {
    // fall back to defaults
  }

  // Legacy [api] section migration
  const legacy = toml.api as Record<string, string> | undefined;

  const providersRaw = (toml.providers ?? {}) as Record<string, Record<string, string>>;
  const defaultSection = (toml.default ?? {}) as Record<string, string>;

  const providers: Record<string, ProviderEntry> = {};

  for (const [id, meta] of Object.entries(PROVIDERS)) {
    const raw = providersRaw[id];
    const envKey = meta.envKey ? process.env[meta.envKey] : undefined;

    let key = envKey || raw?.key || "";

    // Legacy migration for deepseek
    if (id === "deepseek" && !key && legacy?.key) {
      key = legacy.key;
    }

    providers[id] = {
      key,
      model: raw?.model || (id === "deepseek" && legacy?.model ? legacy.model : "") || meta.defaultModel,
      baseURL: raw?.base_url || undefined,
    };
  }

  // If we migrated from legacy format, the active provider is deepseek
  const activeProvider = defaultSection.provider || (legacy ? "deepseek" : "deepseek");
  const permissionMode: PermissionMode =
    (defaultSection.permission_mode as PermissionMode) === "full-access" ? "full-access" : "prompt";

  return {
    activeProvider,
    permissionMode,
    providers,
  };
}

// ─── Save ─────────────────────────────────────────────────────────────────────

export function saveMultiConfig(mc: MultiConfig): void {
  ensureConfig();
  writeFileSync(CONFIG_FILE, serializeConfig(mc), "utf-8");
}

// ─── Resolve active provider to flat Config ───────────────────────────────────

export function resolveConfig(mc: MultiConfig): Config {
  const name = mc.activeProvider;
  const entry = mc.providers[name];
  const meta = PROVIDERS[name];

  return {
    providerName: name,
    apiKey: entry?.key || "",
    model: entry?.model || meta?.defaultModel || "deepseek-chat",
    baseURL: entry?.baseURL || meta?.baseURL || PROVIDERS.deepseek!.baseURL,
  };
}

// ─── Convenience loader (keeps old call sites working) ────────────────────────

export function loadConfig(): Config {
  const mc = readMultiConfig();
  return resolveConfig(mc);
}

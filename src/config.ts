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
}

export interface MultiConfig {
  activeProvider: string;
  providers: Record<string, ProviderEntry>;
}

// ─── Provider registry ────────────────────────────────────────────────────────

export const PROVIDERS: Record<string, { baseURL: string; defaultModel: string; label: string }> = {
  deepseek: {
    baseURL: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    label: "DeepSeek 官网",
  },
  ark: {
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "deepseek-v3-250324",
    label: "方舟 Coding Plan",
  },
};

// ─── Paths ────────────────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), ".sharkcode");
const CONFIG_FILE = join(CONFIG_DIR, "config.toml");

// ─── Serialization ────────────────────────────────────────────────────────────

function serializeConfig(mc: MultiConfig): string {
  const dp = mc.providers.deepseek;
  const ap = mc.providers.ark;
  return [
    "# Shark Code Configuration",
    "# https://github.com/syy-shark/sharkcode",
    "",
    "[default]",
    `provider = "${mc.activeProvider}"`,
    "",
    "[providers.deepseek]",
    "# API key from https://platform.deepseek.com",
    `key = "${dp?.key ?? ""}"`,
    `model = "${dp?.model ?? PROVIDERS.deepseek!.defaultModel}"`,
    "",
    "[providers.ark]",
    "# API key from https://ark.cn-beijing.volces.com (方舟 Coding Plan)",
    `key = "${ap?.key ?? ""}"`,
    `model = "${ap?.model ?? PROVIDERS.ark!.defaultModel}"`,
    "",
  ].join("\n");
}

// ─── Ensure config dir/file exist ─────────────────────────────────────────────

function ensureConfig(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!existsSync(CONFIG_FILE)) {
    const initial: MultiConfig = {
      activeProvider: "deepseek",
      providers: {
        deepseek: { key: "", model: PROVIDERS.deepseek!.defaultModel },
        ark: { key: "", model: PROVIDERS.ark!.defaultModel },
      },
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

  const deepseekKey =
    process.env.DEEPSEEK_API_KEY ||
    providersRaw.deepseek?.key ||
    legacy?.key ||
    "";

  const arkKey =
    process.env.ARK_API_KEY ||
    providersRaw.ark?.key ||
    "";

  // If we migrated from legacy format, the active provider is deepseek
  const activeProvider = defaultSection.provider || (legacy ? "deepseek" : "deepseek");

  return {
    activeProvider,
    providers: {
      deepseek: {
        key: deepseekKey,
        model: providersRaw.deepseek?.model || legacy?.model || PROVIDERS.deepseek!.defaultModel,
      },
      ark: {
        key: arkKey,
        model: providersRaw.ark?.model || PROVIDERS.ark!.defaultModel,
      },
    },
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
    baseURL: meta?.baseURL || PROVIDERS.deepseek!.baseURL,
  };
}

// ─── Convenience loader (keeps old call sites working) ────────────────────────

export function loadConfig(): Config {
  const mc = readMultiConfig();
  return resolveConfig(mc);
}

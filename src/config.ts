import { parse } from "smol-toml";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface Config {
  apiKey: string;
  model: string;
  baseURL: string;
}

const CONFIG_DIR = join(homedir(), ".sharkcode");
const CONFIG_FILE = join(CONFIG_DIR, "config.toml");

const DEFAULT_CONFIG = `# Shark Code Configuration
# https://github.com/syy-ex/sharkcode

[api]
# Get your API key from https://platform.deepseek.com
# Or set DEEPSEEK_API_KEY environment variable
key = ""
model = "deepseek-chat"
base_url = "https://api.deepseek.com/v1"
`;

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!existsSync(CONFIG_FILE)) {
    writeFileSync(CONFIG_FILE, DEFAULT_CONFIG, "utf-8");
  }
}

export function loadConfig(): Config {
  ensureConfigDir();

  let toml: Record<string, unknown> = {};
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    toml = parse(raw) as Record<string, unknown>;
  } catch {
    // config file parse error, fall back to env vars
  }

  const api = (toml.api ?? {}) as Record<string, string>;
  const apiKey = process.env.DEEPSEEK_API_KEY || api.key || "";
  const model = api.model || "deepseek-chat";
  const baseURL = api.base_url || "https://api.deepseek.com/v1";

  if (!apiKey) {
    console.error("❌ No API key found.");
    console.error(`   Set DEEPSEEK_API_KEY env var or edit ${CONFIG_FILE}`);
    process.exit(1);
  }

  return { apiKey, model, baseURL };
}

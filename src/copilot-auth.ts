/**
 * GitHub Copilot authentication module.
 *
 * Flow:
 *   1.  GitHub OAuth device flow  →  github_token (ghp_xxx / gho_xxx)
 *   2.  Exchange github_token     →  copilot_token  (short-lived, ~25 min)
 *   3.  All chat calls use copilot_token as Bearer + special headers
 *   4.  Auto-refresh copilot_token before expiry
 *
 * Credentials stored in:  ~/.sharkcode/copilot-auth.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

// ─── Constants ────────────────────────────────────────────────────────────────

/** VSCode's public GitHub OAuth App client ID — the one Copilot actually accepts */
const GITHUB_CLIENT_ID = "Iv1.b507a08c87ecfe98";

const GITHUB_DEVICE_CODE_URL   = "https://github.com/login/device/code";
const GITHUB_TOKEN_POLL_URL    = "https://github.com/login/oauth/access_token";
const COPILOT_TOKEN_URL        = "https://api.github.com/copilot_internal/v2/token";

const COPILOT_VERSION          = "0.26.7";
const EDITOR_PLUGIN_VERSION    = `copilot-chat/${COPILOT_VERSION}`;
const USER_AGENT               = `GitHubCopilotChat/${COPILOT_VERSION}`;
const VSCODE_VERSION           = "1.96.2";

/** Base URL for API calls — "individual" plan; business/enterprise use a different subdomain */
export const COPILOT_BASE_URL  = "https://api.githubcopilot.com";

// ─── Persistence ──────────────────────────────────────────────────────────────

const AUTH_FILE = join(homedir(), ".sharkcode", "copilot-auth.json");

interface PersistedAuth {
  githubToken: string;
  copilotToken?: string;
  copilotTokenExpiry?: number; // Unix seconds
  proxyEndpoint?: string;      // Derived from token metadata for business/enterprise
}

function loadPersistedAuth(): PersistedAuth | null {
  try {
    if (!existsSync(AUTH_FILE)) return null;
    return JSON.parse(readFileSync(AUTH_FILE, "utf-8")) as PersistedAuth;
  } catch {
    return null;
  }
}

function savePersistedAuth(auth: PersistedAuth): void {
  const dir = dirname(AUTH_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { encoding: "utf-8", mode: 0o600 });
}

export function clearCopilotAuth(): void {
  try {
    if (existsSync(AUTH_FILE)) {
      writeFileSync(AUTH_FILE, "{}", { encoding: "utf-8", mode: 0o600 });
    }
  } catch { /* ignore */ }
}

// ─── Device code flow ─────────────────────────────────────────────────────────

export interface DeviceCodeInfo {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/**
 * Step 1: Request a device code from GitHub.
 * Returns the info needed to display to the user.
 */
export async function requestDeviceCode(): Promise<DeviceCodeInfo> {
  const resp = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Accept":        "application/json",
      "User-Agent":    USER_AGENT,
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      scope: "read:user",
    }),
  });

  if (!resp.ok) {
    throw new Error(`GitHub device code request failed: ${resp.status} ${await resp.text()}`);
  }

  return resp.json() as Promise<DeviceCodeInfo>;
}

/**
 * Step 2: Poll GitHub until the user authorizes (or times out).
 * Returns the GitHub OAuth token (ghp_xxx / gho_xxx).
 */
export async function pollForGithubToken(deviceCode: DeviceCodeInfo): Promise<string> {
  const deadline = Date.now() + deviceCode.expires_in * 1000;
  const interval = (deviceCode.interval || 5) * 1000;

  while (Date.now() < deadline) {
    await sleep(interval);

    const resp = await fetch(GITHUB_TOKEN_POLL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept":       "application/json",
        "User-Agent":   USER_AGENT,
      },
      body: JSON.stringify({
        client_id:   GITHUB_CLIENT_ID,
        device_code: deviceCode.device_code,
        grant_type:  "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data = (await resp.json()) as Record<string, string>;

    if (data.access_token) {
      return data.access_token;
    }

    if (data.error === "authorization_pending") continue;
    if (data.error === "slow_down") {
      await sleep(5000); // extra backoff
      continue;
    }
    throw new Error(`GitHub auth error: ${data.error} — ${data.error_description ?? ""}`);
  }

  throw new Error("GitHub device authorization timed out.");
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

/**
 * Ensure a Copilot proxy endpoint has a proper https:// scheme.
 * GitHub returns bare hostnames like "proxy.individual.githubcopilot.com"
 * for some account types; the AI SDK rejects these as invalid URLs.
 */
function normalizeCopilotURL(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function isIndividualCopilotProxy(proxyEndpoint: string): boolean {
  try {
    const hostname = new URL(normalizeCopilotURL(proxyEndpoint)).hostname.toLowerCase();
    return hostname === "proxy.individual.githubcopilot.com"
      || hostname.endsWith(".individual.githubcopilot.com");
  } catch {
    return false;
  }
}

export function resolveCopilotBaseURL(proxyEndpoint?: string): string {
  if (!proxyEndpoint) return COPILOT_BASE_URL;

  // GitHub includes proxy.individual.githubcopilot.com in individual/student
  // tokens, but user-facing chat models only work on api.githubcopilot.com.
  if (isIndividualCopilotProxy(proxyEndpoint)) {
    return COPILOT_BASE_URL;
  }

  return normalizeCopilotURL(proxyEndpoint);
}

// ─── Copilot token exchange ────────────────────────────────────────────────────

/**
 * Exchange a GitHub OAuth token for a short-lived Copilot chat token.
 * The Copilot token typically expires in ~25 minutes.
 */
export async function fetchCopilotToken(githubToken: string): Promise<{ token: string; expiry: number; proxyEndpoint?: string }> {
  const resp = await fetch(COPILOT_TOKEN_URL, {
    method: "GET",
    headers: {
      Authorization:          `token ${githubToken}`,
      "Editor-Version":       `vscode/${VSCODE_VERSION}`,
      "Editor-Plugin-Version": EDITOR_PLUGIN_VERSION,
      "User-Agent":           USER_AGENT,
      Accept:                 "application/json",
    },
  });

  if (!resp.ok) {
    throw new Error(`Copilot token exchange failed: ${resp.status} ${await resp.text()}`);
  }

  const data = (await resp.json()) as { token: string; expires_at?: number };

  // The token field looks like "tid=xxx;exp=1234567890;sku=xxx;proxy-ep=xxx;..."
  // Parse exp= for expiry and proxy-ep= for account-specific base URL.
  let expiry = Date.now() / 1000 + 25 * 60; // fallback: 25 min from now
  if (data.expires_at) {
    expiry = data.expires_at;
  } else {
    const match = data.token.match(/exp=(\d+)/);
    if (match) expiry = parseInt(match[1]!, 10);
  }

  // Extract proxy endpoint if present (used for business/enterprise accounts).
  // Format: proxy-ep=https://copilot-api.example.com  OR  proxy-ep=copilot-api.example.com
  let proxyEndpoint: string | undefined;
  const proxyMatch = data.token.match(/proxy-ep=([^;]+)/);
  if (proxyMatch) proxyEndpoint = normalizeCopilotURL(proxyMatch[1]!);

  return { token: data.token, expiry, proxyEndpoint };
}

// ─── Token management ─────────────────────────────────────────────────────────

let _githubToken: string | null = null;
let _copilotToken: string | null = null;
let _copilotTokenExpiry: number = 0;
let _proxyEndpoint: string | undefined;

/**
 * Load saved credentials from disk into memory.
 * Call this once at startup when copilot provider is active.
 */
export function initCopilotAuth(): boolean {
  const saved = loadPersistedAuth();
  if (!saved?.githubToken) return false;
  _githubToken        = saved.githubToken;
  _copilotToken       = saved.copilotToken ?? null;
  _copilotTokenExpiry = saved.copilotTokenExpiry ?? 0;
  _proxyEndpoint      = saved.proxyEndpoint;
  return true;
}

/** Returns true if we have a GitHub token (= user has logged in) */
export function isCopilotLoggedIn(): boolean {
  const saved = loadPersistedAuth();
  return !!saved?.githubToken;
}

/**
 * Get a valid Copilot chat token, refreshing automatically if needed.
 * Throws if not logged in.
 */
export async function getCopilotToken(): Promise<string> {
  // Load from disk if not in memory
  if (!_githubToken) {
    const saved = loadPersistedAuth();
    if (!saved?.githubToken) {
      throw new Error("Not logged in to GitHub Copilot. Run /login to authenticate.");
    }
    _githubToken        = saved.githubToken;
    _copilotToken       = saved.copilotToken ?? null;
    _copilotTokenExpiry = saved.copilotTokenExpiry ?? 0;
    _proxyEndpoint      = saved.proxyEndpoint;
  }

  const nowSeconds = Date.now() / 1000;
  const needsRefresh = !_copilotToken || _copilotTokenExpiry - nowSeconds < 60; // refresh 60s before expiry

  if (needsRefresh) {
    const { token, expiry, proxyEndpoint } = await fetchCopilotToken(_githubToken);
    _copilotToken       = token;
    _copilotTokenExpiry = expiry;
    _proxyEndpoint      = proxyEndpoint;
    // Persist updated token
    savePersistedAuth({
      githubToken:        _githubToken,
      copilotToken:       token,
      copilotTokenExpiry: expiry,
      proxyEndpoint,
    });
  }

  return _copilotToken!;
}

/**
 * Returns the Copilot API base URL, using proxy-ep from token metadata
 * for business/enterprise accounts, falling back to the individual endpoint.
 */
export function getCopilotBaseURL(): string {
  return resolveCopilotBaseURL(_proxyEndpoint);
}

/**
 * Full login flow: device code → poll → exchange → persist.
 * `onDeviceCode` callback lets the CLI display instructions to the user.
 */
export async function loginWithDeviceFlow(
  onDeviceCode: (info: DeviceCodeInfo) => void
): Promise<void> {
  const info = await requestDeviceCode();
  onDeviceCode(info);

  const githubToken = await pollForGithubToken(info);

  // Pre-fetch the Copilot token to verify the subscription works
  const { token, expiry, proxyEndpoint } = await fetchCopilotToken(githubToken);

  _githubToken        = githubToken;
  _copilotToken       = token;
  _copilotTokenExpiry = expiry;
  _proxyEndpoint      = proxyEndpoint;

  savePersistedAuth({
    githubToken,
    copilotToken:       token,
    copilotTokenExpiry: expiry,
    proxyEndpoint,
  });
}

// ─── HTTP headers for Copilot API calls ───────────────────────────────────────

export function buildCopilotHeaders(copilotToken: string): Record<string, string> {
  return {
    Authorization:                    `Bearer ${copilotToken}`,
    "content-type":                   "application/json",
    "copilot-integration-id":         "vscode-chat",
    "editor-version":                 `vscode/${VSCODE_VERSION}`,
    "editor-plugin-version":          EDITOR_PLUGIN_VERSION,
    "user-agent":                     USER_AGENT,
    "openai-intent":                  "conversation-panel",
    "x-github-api-version":           "2025-04-01",
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

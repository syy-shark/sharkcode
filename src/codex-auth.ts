/**
 * OpenAI / Codex authentication module.
 *
 * Uses OpenAI's current Codex device authorization flow:
 *   1.  POST /api/accounts/deviceauth/usercode  → device_auth_id + user_code
 *   2.  User opens https://auth.openai.com/codex/device and enters user_code
 *   3.  Poll  /api/accounts/deviceauth/token    → authorization_code + code_verifier
 *   4.  Exchange /oauth/token                   → access_token + refresh_token
 *
 * Credentials stored in:  ~/.sharkcode/codex-auth.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

// ─── Constants ────────────────────────────────────────────────────────────────

const OPENAI_AUTH_BASE  = "https://auth.openai.com";
const DEVICE_CODE_URL   = `${OPENAI_AUTH_BASE}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL  = `${OPENAI_AUTH_BASE}/api/accounts/deviceauth/token`;
const OAUTH_TOKEN_URL   = `${OPENAI_AUTH_BASE}/oauth/token`;
export const CODEX_DEVICE_VERIFICATION_URL = `${OPENAI_AUTH_BASE}/codex/device`;
const DEVICE_AUTH_CALLBACK_URL = `${OPENAI_AUTH_BASE}/deviceauth/callback`;
const DEFAULT_DEVICE_AUTH_TTL_SECONDS = 15 * 60;

// Public client_id used by the official Codex CLI.
// Keep this aligned with openai/codex current upstream login sources.
const CODEX_CLIENT_ID   = "app_EMoamEEZ73f0CkXaXp7hrann";

// ─── Persistence ──────────────────────────────────────────────────────────────

const AUTH_FILE = join(homedir(), ".sharkcode", "codex-auth.json");

interface PersistedCodexAuth {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // Unix ms
  accountId?: string;
}

interface CodexTokenResponse {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

interface CodexJwtClaims {
  chatgpt_account_id?: string;
  organizations?: Array<{ id: string }>;
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
  };
}

function loadPersistedAuth(): PersistedCodexAuth | null {
  try {
    if (!existsSync(AUTH_FILE)) return null;
    return JSON.parse(readFileSync(AUTH_FILE, "utf-8")) as PersistedCodexAuth;
  } catch {
    return null;
  }
}

function savePersistedAuth(auth: PersistedCodexAuth): void {
  const dir = dirname(AUTH_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { encoding: "utf-8", mode: 0o600 });
}

export function clearCodexAuth(): void {
  try {
    if (existsSync(AUTH_FILE)) {
      writeFileSync(AUTH_FILE, "{}", { encoding: "utf-8", mode: 0o600 });
    }
  } catch { /* ignore */ }
}

// ─── Check auth state ─────────────────────────────────────────────────────────

export function isCodexLoggedIn(): boolean {
  const saved = loadPersistedAuth();
  return !!saved?.accessToken;
}

// ─── Device code flow ─────────────────────────────────────────────────────────

export interface CodexDeviceCodeInfo {
  user_code: string;
  verification_uri: string;
  device_auth_id: string;
  expires_in: number;   // seconds
  interval: number;     // poll interval in seconds
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readPositiveNumber(value: unknown): number | undefined {
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

function deriveExpiresInSeconds(expiresAt: unknown, nowMs: number): number | undefined {
  const iso = readString(expiresAt);
  if (!iso) return undefined;

  const normalizedIso = iso.replace(/\.(\d{3})\d+([+-]\d{2}:\d{2}|Z)$/i, ".$1$2");
  const timestamp = Date.parse(normalizedIso);
  if (!Number.isFinite(timestamp)) return undefined;

  const diffSeconds = Math.ceil((timestamp - nowMs) / 1000);
  return diffSeconds > 0 ? diffSeconds : undefined;
}

function parseJwtClaims(token: string): CodexJwtClaims | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;

  try {
    return JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf-8")) as CodexJwtClaims;
  } catch {
    return undefined;
  }
}

function extractAccountIdFromClaims(claims: CodexJwtClaims): string | undefined {
  return (
    claims.chatgpt_account_id ||
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ||
    claims.organizations?.[0]?.id
  );
}

function extractAccountId(tokens: CodexTokenResponse): string | undefined {
  if (tokens.id_token) {
    const claims = parseJwtClaims(tokens.id_token);
    const accountId = claims ? extractAccountIdFromClaims(claims) : undefined;
    if (accountId) return accountId;
  }

  if (tokens.access_token) {
    const claims = parseJwtClaims(tokens.access_token);
    return claims ? extractAccountIdFromClaims(claims) : undefined;
  }

  return undefined;
}

function extractAccountIdFromAccessToken(accessToken: string): string | undefined {
  return extractAccountId({ access_token: accessToken });
}

export function normalizeCodexDeviceCodeResponse(
  raw: Record<string, unknown>,
  nowMs = Date.now(),
): CodexDeviceCodeInfo {
  const user_code =
    readString(raw["user_code"]) ??
    readString(raw["usercode"]) ??
    readString(raw["userCode"]) ??
    "";

  const device_auth_id =
    readString(raw["device_auth_id"]) ??
    readString(raw["deviceAuthId"]) ??
    // Backward compatibility with older RFC8628-style responses
    readString(raw["device_code"]) ??
    readString(raw["deviceCode"]) ??
    "";

  const verification_uri =
    readString(raw["verification_uri_complete"]) ??
    readString(raw["verification_uri"]) ??
    readString(raw["verification_url"]) ??
    readString(raw["verificationUri"] ) ??
    readString(raw["verificationUrl"]) ??
    CODEX_DEVICE_VERIFICATION_URL;

  const expires_in =
    deriveExpiresInSeconds(raw["expires_at"] ?? raw["expiresAt"], nowMs) ??
    readPositiveNumber(raw["expires_in"] ?? raw["expiresIn"]) ??
    DEFAULT_DEVICE_AUTH_TTL_SECONDS;

  const interval = readPositiveNumber(raw["interval"]) ?? 5;

  if (!user_code) {
    throw new Error(`OpenAI device auth 返回的 user_code 为空。原始响应：${JSON.stringify(raw)}`);
  }

  if (!device_auth_id) {
    throw new Error(
      `OpenAI device auth 返回的 device_auth_id 为空。原始响应：${JSON.stringify(raw)}`
    );
  }

  return {
    user_code,
    verification_uri,
    device_auth_id,
    expires_in,
    interval,
  };
}

/**
 * Step 1: Request a device code from OpenAI.
 *
 * OpenAI's device auth endpoint now returns `device_auth_id`, `user_code`,
 * optional `interval`, and sometimes `expires_at` — not a `verification_uri`.
 * We normalize that response into a UI-friendly shape and derive the browser URL.
 */
export async function requestCodexDeviceCode(): Promise<CodexDeviceCodeInfo> {
  const resp = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept":       "application/json",
    },
    body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI device code request failed (${resp.status}): ${text}`);
  }

  const raw = (await resp.json()) as Record<string, unknown>;
  return normalizeCodexDeviceCodeResponse(raw);
}

async function exchangeCodexAuthorizationCode(
  authorizationCode: string,
  codeVerifier: string,
): Promise<PersistedCodexAuth> {
  const resp = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authorizationCode,
      redirect_uri: DEVICE_AUTH_CALLBACK_URL,
      client_id: CODEX_CLIENT_ID,
      code_verifier: codeVerifier,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI token exchange failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as CodexTokenResponse;
  const accessToken = readString(data.access_token);
  if (!accessToken) {
    throw new Error(`OpenAI token exchange 未返回 access_token。原始响应：${JSON.stringify(data)}`);
  }

  const refreshToken = readString(data.refresh_token);
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : undefined;

  return {
    accessToken,
    refreshToken,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    accountId: extractAccountId(data),
  };
}

async function refreshCodexAccessToken(refreshToken: string): Promise<PersistedCodexAuth> {
  const resp = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CODEX_CLIENT_ID,
    }).toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI token refresh failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as CodexTokenResponse;
  const accessToken = readString(data.access_token);
  if (!accessToken) {
    throw new Error(`OpenAI token refresh 未返回 access_token。原始响应：${JSON.stringify(data)}`);
  }

  return {
    accessToken,
    refreshToken: readString(data.refresh_token) ?? refreshToken,
    expiresAt: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : undefined,
    accountId: extractAccountId(data),
  };
}

/**
 * Step 2: Poll OpenAI until the user authorizes (or times out).
 * Returns the access token.
 */
export async function pollForCodexToken(info: CodexDeviceCodeInfo): Promise<PersistedCodexAuth> {
  // Guard: ensure expires_in is a valid positive number before arithmetic.
  const expiresInMs = (Number.isFinite(info.expires_in) && info.expires_in > 0)
    ? info.expires_in * 1000
    : DEFAULT_DEVICE_AUTH_TTL_SECONDS * 1000;
  const deadline = Date.now() + expiresInMs;
  const interval = (Number.isFinite(info.interval) && info.interval > 0 ? info.interval : 5) * 1000;

  while (Date.now() < deadline) {
    await sleep(interval);

    const resp = await fetch(DEVICE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept":       "application/json",
      },
      body: JSON.stringify({
        device_auth_id: info.device_auth_id,
        user_code: info.user_code,
      }),
    });

    if (resp.status === 200) {
      const data = (await resp.json()) as Record<string, unknown>;

      // Backward compatibility with earlier assumptions / future endpoint changes.
      const directAccessToken = readString(data["access_token"]);
      if (directAccessToken) {
        const directRefreshToken = readString(data["refresh_token"]);
        const directExpiresIn = readPositiveNumber(data["expires_in"] ?? data["expiresIn"]);
        return {
          accessToken: directAccessToken,
          refreshToken: directRefreshToken,
          expiresAt: directExpiresIn ? Date.now() + directExpiresIn * 1000 : undefined,
          accountId: extractAccountId({
            access_token: directAccessToken,
            refresh_token: directRefreshToken,
            expires_in: directExpiresIn,
          }),
        };
      }

      const authorizationCode =
        readString(data["authorization_code"]) ??
        readString(data["authorizationCode"]);
      const codeVerifier =
        readString(data["code_verifier"]) ??
        readString(data["codeVerifier"]);

      if (authorizationCode && codeVerifier) {
        return exchangeCodexAuthorizationCode(authorizationCode, codeVerifier);
      }

      throw new Error(`OpenAI device auth token 响应缺少可用凭证。原始响应：${JSON.stringify(data)}`);
    }

    // Current official Codex flow uses 403 / 404 to signal "still pending".
    if (resp.status === 403 || resp.status === 404) {
      continue;
    }

    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    const errCode = String(data.error ?? data.code ?? resp.status);

    if (errCode === "authorization_pending" || errCode === "400") continue;
    if (errCode === "slow_down") {
      await sleep(5000);
      continue;
    }
    if (errCode === "expired_token" || errCode === "expired") {
      throw new Error("授权码已过期，请重新授权。");
    }
    throw new Error(`OpenAI auth error: ${errCode} — ${String(data.error_description ?? data.message ?? "")}`);
  }

  throw new Error("OpenAI device 授权超时。");
}

// ─── Token management ─────────────────────────────────────────────────────────

let _accessToken:  string | null = null;
let _refreshToken: string | undefined;
let _expiresAt:    number | undefined;
let _accountId:    string | undefined;

/**
 * Full login flow: device code → display to user → poll → persist.
 * `onDeviceCode` lets the CLI show instructions.
 */
export async function loginWithCodexDeviceFlow(
  onDeviceCode: (info: CodexDeviceCodeInfo) => void
): Promise<void> {
  const info = await requestCodexDeviceCode();
  onDeviceCode(info);

  const { accessToken, refreshToken, expiresAt, accountId } = await pollForCodexToken(info);

  _accessToken  = accessToken;
  _refreshToken = refreshToken;
  _expiresAt    = expiresAt;
  _accountId    = accountId;

  savePersistedAuth({ accessToken, refreshToken, expiresAt, accountId });
}

export async function getCodexAuth(): Promise<PersistedCodexAuth> {
  if (!_accessToken) {
    const saved = loadPersistedAuth();
    if (!saved?.accessToken) {
      throw new Error("未登录 OpenAI/Codex。请通过 /provider 选择 codex 并完成授权。");
    }
    _accessToken  = saved.accessToken;
    _refreshToken = saved.refreshToken;
    _expiresAt    = saved.expiresAt;
    _accountId    = saved.accountId ?? extractAccountIdFromAccessToken(saved.accessToken);

    if (_accountId !== saved.accountId) {
      savePersistedAuth({
        accessToken: _accessToken,
        refreshToken: _refreshToken,
        expiresAt: _expiresAt,
        accountId: _accountId,
      });
    }
  }

  const shouldRefresh = !!_refreshToken && (!_expiresAt || _expiresAt - Date.now() < 60_000);
  if (shouldRefresh) {
    const refreshed = await refreshCodexAccessToken(_refreshToken!);
    _accessToken = refreshed.accessToken;
    _refreshToken = refreshed.refreshToken;
    _expiresAt = refreshed.expiresAt;
    _accountId = refreshed.accountId ?? _accountId;

    savePersistedAuth({
      accessToken: _accessToken,
      refreshToken: _refreshToken,
      expiresAt: _expiresAt,
      accountId: _accountId,
    });
  }

  return {
    accessToken: _accessToken!,
    refreshToken: _refreshToken,
    expiresAt: _expiresAt,
    accountId: _accountId,
  };
}

/**
 * Get a valid access token. Throws if not logged in.
 */
export function getCodexToken(): string {
  if (_accessToken) return _accessToken;

  const saved = loadPersistedAuth();
  if (!saved?.accessToken) {
    throw new Error("未登录 OpenAI/Codex。请通过 /provider 选择 codex 并完成授权。");
  }
  _accessToken  = saved.accessToken;
  _refreshToken = saved.refreshToken;
  _expiresAt    = saved.expiresAt;
  _accountId    = saved.accountId;
  return _accessToken;
}

// ─── Also support reading from official Codex CLI auth file ──────────────────

/**
 * Read token from ~/.codex/auth.json (official Codex CLI format).
 * Returns null if not present.
 */
export function readCodexCliToken(): string | null {
  try {
    const codexPath = join(homedir(), ".codex", "auth.json");
    if (!existsSync(codexPath)) return null;
    const data = JSON.parse(readFileSync(codexPath, "utf-8")) as { token?: string; access_token?: string };
    return data.token ?? data.access_token ?? null;
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

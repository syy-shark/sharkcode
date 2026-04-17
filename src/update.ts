import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

const PACKAGE_NAME = "sharkcode";
const CONFIG_DIR = join(homedir(), ".sharkcode");
const UPDATE_CACHE_FILE = join(CONFIG_DIR, "update.json");

const UPDATE_AVAILABLE_TTL_MS = 12 * 60 * 60 * 1000;
const UP_TO_DATE_TTL_MS = 5 * 60 * 1000;
const PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const NOTICE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const FAILURE_RETRY_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 1500;

interface UpdateCache {
  latestVersion?: string;
  lastCheckedAt?: number;
  lastFailedAt?: number;
  lastPromptedVersion?: string;
  lastPromptedAt?: number;
  lastNotifiedVersion?: string;
  lastNotifiedAt?: number;
}

export interface AvailableUpdate {
  currentVersion: string;
  latestVersion: string;
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function readUpdateCache(): UpdateCache {
  try {
    const raw = readFileSync(UPDATE_CACHE_FILE, "utf-8");
    return JSON.parse(raw) as UpdateCache;
  } catch {
    return {};
  }
}

function writeUpdateCache(cache: UpdateCache): void {
  try {
    ensureConfigDir();
    writeFileSync(UPDATE_CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
  } catch {
    // best-effort only — update checks should never break startup
  }
}

function parseVersion(input: string): number[] {
  const [core = ""] = input.trim().replace(/^v/i, "").split("-");
  return core
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

export function isRemoteVersionNewer(currentVersion: string, latestVersion: string): boolean {
  const current = parseVersion(currentVersion);
  const latest = parseVersion(latestVersion);
  const length = Math.max(current.length, latest.length, 3);

  for (let i = 0; i < length; i++) {
    const c = current[i] ?? 0;
    const l = latest[i] ?? 0;
    if (l > c) return true;
    if (l < c) return false;
  }

  return false;
}

export function shouldPromptForVersion(cache: Pick<UpdateCache, "lastPromptedVersion" | "lastPromptedAt">, latestVersion: string, now = Date.now()): boolean {
  if (cache.lastPromptedVersion !== latestVersion) return true;
  if (!cache.lastPromptedAt) return true;
  return now - cache.lastPromptedAt >= PROMPT_COOLDOWN_MS;
}

export function shouldNotifyForVersion(cache: Pick<UpdateCache, "lastNotifiedVersion" | "lastNotifiedAt">, latestVersion: string, now = Date.now()): boolean {
  if (cache.lastNotifiedVersion !== latestVersion) return true;
  if (!cache.lastNotifiedAt) return true;
  return now - cache.lastNotifiedAt >= NOTICE_COOLDOWN_MS;
}

export function getSuccessfulCheckTtlMs(currentVersion: string, cachedLatestVersion?: string): number {
  if (cachedLatestVersion && isRemoteVersionNewer(currentVersion, cachedLatestVersion)) {
    return UPDATE_AVAILABLE_TTL_MS;
  }

  return UP_TO_DATE_TTL_MS;
}

export function shouldReuseCachedVersionAfterFailure(currentVersion: string, cachedLatestVersion?: string): boolean {
  return !!cachedLatestVersion && isRemoteVersionNewer(currentVersion, cachedLatestVersion);
}

async function fetchLatestVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      headers: {
        Accept: "application/json",
        "User-Agent": `${PACKAGE_NAME}-cli-update-check`,
      },
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { version?: string };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkForAvailableUpdate(currentVersion: string, mode: "prompt" | "notice" | "always" = "always"): Promise<AvailableUpdate | null> {
  const now = Date.now();
  const cache = readUpdateCache();

  let latestVersion: string | undefined;
  const cacheFresh = !!cache.lastCheckedAt && now - cache.lastCheckedAt < getSuccessfulCheckTtlMs(currentVersion, cache.latestVersion);
  const recentFailure = shouldReuseCachedVersionAfterFailure(currentVersion, cache.latestVersion)
    && !!cache.lastFailedAt
    && now - cache.lastFailedAt < FAILURE_RETRY_MS;
  if (cacheFresh && cache.latestVersion) {
    latestVersion = cache.latestVersion;
  } else if (recentFailure) {
    latestVersion = cache.latestVersion;
  } else {
    const remoteVersion = await fetchLatestVersion();
    if (remoteVersion) {
      latestVersion = remoteVersion;
      writeUpdateCache({
        ...cache,
        latestVersion,
        lastCheckedAt: now,
        lastFailedAt: undefined,
      });
    } else {
      latestVersion = cache.latestVersion;
      writeUpdateCache({
        ...cache,
        lastFailedAt: now,
      });
    }
  }

  if (!latestVersion) return null;
  if (!isRemoteVersionNewer(currentVersion, latestVersion)) return null;
  if (mode === "prompt" && !shouldPromptForVersion(cache, latestVersion, now)) return null;
  if (mode === "notice" && !shouldNotifyForVersion(cache, latestVersion, now)) return null;

  return { currentVersion, latestVersion };
}

export function markUpdatePrompted(latestVersion: string): void {
  const cache = readUpdateCache();
  writeUpdateCache({
    ...cache,
    latestVersion: latestVersion || cache.latestVersion,
    lastPromptedVersion: latestVersion,
    lastPromptedAt: Date.now(),
  });
}

export function markUpdateNotified(latestVersion: string): void {
  const cache = readUpdateCache();
  writeUpdateCache({
    ...cache,
    latestVersion: latestVersion || cache.latestVersion,
    lastNotifiedVersion: latestVersion,
    lastNotifiedAt: Date.now(),
  });
}

export function getUpdateCommand(): string {
  return `npm install -g ${PACKAGE_NAME}@latest`;
}

export function runGlobalUpdate(): { ok: true } | { ok: false; error: string } {
  try {
    execSync(`npm install -g ${PACKAGE_NAME}@latest`, { stdio: "inherit" });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

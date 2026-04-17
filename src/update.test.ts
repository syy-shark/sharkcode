import { describe, expect, test } from "bun:test";
import { getSuccessfulCheckTtlMs, isRemoteVersionNewer, shouldNotifyForVersion, shouldPromptForVersion, shouldReuseCachedVersionAfterFailure } from "./update.ts";

describe("isRemoteVersionNewer", () => {
  test("returns true when remote patch version is newer", () => {
    expect(isRemoteVersionNewer("0.7.9", "0.7.10")).toBe(true);
  });

  test("returns false when versions are equal", () => {
    expect(isRemoteVersionNewer("1.2.3", "1.2.3")).toBe(false);
  });

  test("returns false when remote version is older", () => {
    expect(isRemoteVersionNewer("1.3.0", "1.2.9")).toBe(false);
  });

  test("ignores a leading v prefix", () => {
    expect(isRemoteVersionNewer("v0.7.9", "v0.8.0")).toBe(true);
  });
});

describe("shouldPromptForVersion", () => {
  test("prompts immediately for a new version", () => {
    expect(shouldPromptForVersion({}, "0.8.0", 1_000)).toBe(true);
  });

  test("suppresses repeat prompt inside cooldown window", () => {
    expect(shouldPromptForVersion({
      lastPromptedVersion: "0.8.0",
      lastPromptedAt: 1_000,
    }, "0.8.0", 1_000 + 60_000)).toBe(false);
  });

  test("prompts again after cooldown expires", () => {
    const oneDayLater = 1_000 + 24 * 60 * 60 * 1000;
    expect(shouldPromptForVersion({
      lastPromptedVersion: "0.8.0",
      lastPromptedAt: 1_000,
    }, "0.8.0", oneDayLater)).toBe(true);
  });

  test("prompts again for a different version even inside cooldown", () => {
    expect(shouldPromptForVersion({
      lastPromptedVersion: "0.8.0",
      lastPromptedAt: 1_000,
    }, "0.9.0", 1_000 + 60_000)).toBe(true);
  });
});

describe("shouldNotifyForVersion", () => {
  test("notifies immediately for a new version", () => {
    expect(shouldNotifyForVersion({}, "0.8.0", 1_000)).toBe(true);
  });

  test("suppresses repeat notices inside cooldown window", () => {
    expect(shouldNotifyForVersion({
      lastNotifiedVersion: "0.8.0",
      lastNotifiedAt: 1_000,
    }, "0.8.0", 1_000 + 60_000)).toBe(false);
  });

  test("notifies again for a different version", () => {
    expect(shouldNotifyForVersion({
      lastNotifiedVersion: "0.8.0",
      lastNotifiedAt: 1_000,
    }, "0.9.0", 1_000 + 60_000)).toBe(true);
  });
});

describe("getSuccessfulCheckTtlMs", () => {
  test("uses a long cache window when an update is already known to exist", () => {
    expect(getSuccessfulCheckTtlMs("0.8.0", "0.8.1")).toBe(12 * 60 * 60 * 1000);
  });

  test("uses a short cache window when cache says user is already up to date", () => {
    expect(getSuccessfulCheckTtlMs("0.8.0", "0.8.0")).toBe(5 * 60 * 1000);
  });

  test("uses a short cache window when cached latest is older than current version", () => {
    expect(getSuccessfulCheckTtlMs("0.8.1", "0.8.0")).toBe(5 * 60 * 1000);
  });
});

describe("shouldReuseCachedVersionAfterFailure", () => {
  test("reuses failure backoff only when cached version already indicates an update", () => {
    expect(shouldReuseCachedVersionAfterFailure("0.8.0", "0.8.1")).toBe(true);
  });

  test("does not reuse stale no-update cache after failure", () => {
    expect(shouldReuseCachedVersionAfterFailure("0.8.0", "0.8.0")).toBe(false);
  });

  test("does not reuse cache when no cached version exists", () => {
    expect(shouldReuseCachedVersionAfterFailure("0.8.0", undefined)).toBe(false);
  });
});

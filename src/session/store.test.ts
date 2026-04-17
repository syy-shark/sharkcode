import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function withTempHome<T>(
  run: (store: typeof import("./store.ts")) => Promise<T> | T,
): Promise<T> {
  const tempHome = mkdtempSync(join(tmpdir(), "sharkcode-session-"));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  mkdirSync(join(tempHome, ".sharkcode"), { recursive: true });

  try {
    const store = await import(`./store.ts?session-test=${Date.now()}-${Math.random()}`) as typeof import("./store.ts");
    return await run(store);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;

    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;

    rmSync(tempHome, { recursive: true, force: true });
  }
}

describe("session store", () => {
  test("starts with an empty index", async () => {
    await withTempHome((store) => {
      expect(store.listSessionSummaries()).toEqual([]);
    });
  });

  test("creates and persists a session from the first prompt", async () => {
    await withTempHome((store) => {
      const session = store.saveSession(store.createSessionFromPrompt({
        prompt: "修复 CLI 的 slash 命令行为",
        mode: "build",
        activeSkills: [],
        providerName: "deepseek",
        model: "deepseek-chat",
      }));

      const reloaded = store.readSession(session.id);
      expect(reloaded?.title).toContain("修复 CLI");
      expect(store.listSessionSummaries()).toHaveLength(1);
    });
  });
});

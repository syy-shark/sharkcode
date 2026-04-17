import { describe, expect, it } from "bun:test";
import { AgentEventBus } from "./agent-events.ts";
import { ensureRunEnd, isDirectCliEntrypoint } from "./cli.ts";

describe("CLI entrypoint detection", () => {
  it("matches the direct file path", () => {
    expect(isDirectCliEntrypoint(
      "C:/repo/dist/cli.mjs",
      "file:///C:/repo/dist/cli.mjs",
      (path) => path,
    )).toBe(true);
  });

  it("matches a linked path after resolving the real file location", () => {
    const realpathMap = new Map([
      ["C:\\Users\\syy11\\AppData\\Roaming\\npm\\node_modules\\sharkcode\\dist\\cli.mjs", "C:\\Users\\syy11\\Desktop\\桌面\\项目\\SharkCode\\dist\\cli.mjs"],
      ["C:\\Users\\syy11\\Desktop\\桌面\\项目\\SharkCode\\dist\\cli.mjs", "C:\\Users\\syy11\\Desktop\\桌面\\项目\\SharkCode\\dist\\cli.mjs"],
    ]);

    expect(isDirectCliEntrypoint(
      "C:/Users/syy11/AppData/Roaming/npm/node_modules/sharkcode/dist/cli.mjs",
      "file:///C:/Users/syy11/Desktop/%E6%A1%8C%E9%9D%A2/%E9%A1%B9%E7%9B%AE/SharkCode/dist/cli.mjs",
      (path) => realpathMap.get(path) ?? path,
    )).toBe(true);
  });

  it("returns false when imported from another module", () => {
    expect(isDirectCliEntrypoint(
      "C:/repo/dist/other.mjs",
      "file:///C:/repo/dist/cli.mjs",
      (path) => path,
    )).toBe(false);
  });

  it("falls back to string comparison when realpath lookup fails", () => {
    expect(isDirectCliEntrypoint(
      "C:/repo/dist/cli.mjs",
      "file:///C:/repo/dist/cli.mjs",
      () => {
        throw new Error("boom");
      },
    )).toBe(true);
  });
});

describe("ensureRunEnd", () => {
  it("emits run-end when the agent exits without one", () => {
    const bus = new AgentEventBus();
    const events: Array<{ type: string; interrupted?: boolean }> = [];

    bus.subscribe((event) => {
      events.push(event);
    });

    const didReceiveRunEnd = ensureRunEnd(bus, false);

    expect(didReceiveRunEnd).toBe(true);
    expect(events).toEqual([{ type: "run-end", interrupted: false }]);
  });

  it("does not emit a duplicate run-end once one was already seen", () => {
    const bus = new AgentEventBus();
    const events: Array<{ type: string; interrupted?: boolean }> = [];

    bus.subscribe((event) => {
      events.push(event);
    });

    const didReceiveRunEnd = ensureRunEnd(bus, true);

    expect(didReceiveRunEnd).toBe(true);
    expect(events).toEqual([]);
  });
});

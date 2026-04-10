import { describe, expect, it, mock } from "bun:test";
import { AgentEventBus, normalizeGenerateResult } from "./agent-events.ts";

describe("integration: event bus wiring", () => {
  it("AgentEventBus delivers events to all subscribers", () => {
    const bus = new AgentEventBus();
    const first = mock(() => {});
    const second = mock(() => {});

    bus.subscribe(first);
    bus.subscribe(second);

    const event = { type: "text-delta", delta: "hello" } as const;
    bus.emit(event);

    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith(event);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(event);
  });

  it("unsubscribe removes listener", () => {
    const bus = new AgentEventBus();
    const active = mock(() => {});
    const removed = mock(() => {});

    const unsubscribe = bus.subscribe(removed);
    bus.subscribe(active);

    unsubscribe();
    bus.emit({ type: "run-start" });

    expect(removed).not.toHaveBeenCalled();
    expect(active).toHaveBeenCalledTimes(1);
    expect(active).toHaveBeenCalledWith({ type: "run-start" });
  });

  it("normalizeGenerateResult produces run-start and run-end", () => {
    const events = normalizeGenerateResult({
      text: "Done",
    });

    expect(events[0]).toEqual({ type: "run-start" });
    expect(events.at(-1)).toEqual({ type: "run-end", interrupted: false });
  });

  it("normalizeGenerateResult handles multi-step results", () => {
    expect(normalizeGenerateResult({
      steps: [
        {
          text: "Inspecting files",
          toolCalls: [{ toolName: "read_file", args: { path: "src/agent.ts" } }],
          toolResults: [{ toolName: "read_file", result: "export async function runAgent" }],
        },
        {
          text: "Wiring complete",
          toolCalls: [{ toolName: "edit_file", args: { path: "src/cli.ts" } }],
        },
      ],
    })).toEqual([
      { type: "run-start" },
      { type: "step-start", stepIndex: 0 },
      { type: "text-delta", delta: "Inspecting files" },
      { type: "tool-call", toolName: "read_file", args: { path: "src/agent.ts" } },
      { type: "tool-result", toolName: "read_file", result: "export async function runAgent" },
      { type: "step-end", stepIndex: 0 },
      { type: "step-start", stepIndex: 1 },
      { type: "text-delta", delta: "Wiring complete" },
      { type: "tool-call", toolName: "edit_file", args: { path: "src/cli.ts" } },
      { type: "step-end", stepIndex: 1 },
      { type: "run-end", interrupted: false },
    ]);
  });

  it("events are isolated: one subscriber throwing does not affect others", () => {
    const bus = new AgentEventBus();
    const healthy = mock(() => {});

    bus.subscribe(healthy);
    bus.subscribe(() => {
      throw new Error("boom");
    });

    expect(() => bus.emit({ type: "run-start" })).toThrow("boom");
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledWith({ type: "run-start" });
  });
});

import { describe, expect, test } from "bun:test";
import { AgentEventBus, normalizeGenerateResult, normalizeStreamEvent } from "./agent-events.ts";

describe("AgentEventBus", () => {
  test("subscribe receives emitted events", () => {
    const bus = new AgentEventBus();
    const received: Array<unknown> = [];

    bus.subscribe((event) => {
      received.push(event);
    });

    bus.emit({ type: "run-start" });

    expect(received).toEqual([{ type: "run-start" }]);
  });

  test("multiple subscribers all receive events", () => {
    const bus = new AgentEventBus();
    const first: Array<unknown> = [];
    const second: Array<unknown> = [];

    bus.subscribe((event) => {
      first.push(event);
    });
    bus.subscribe((event) => {
      second.push(event);
    });

    bus.emit({ type: "text-delta", delta: "hello" });

    expect(first).toEqual([{ type: "text-delta", delta: "hello" }]);
    expect(second).toEqual([{ type: "text-delta", delta: "hello" }]);
  });

  test("unsubscribe stops receiving events", () => {
    const bus = new AgentEventBus();
    const received: Array<unknown> = [];
    const unsubscribe = bus.subscribe((event) => {
      received.push(event);
    });

    bus.emit({ type: "run-start" });
    unsubscribe();
    bus.emit({ type: "run-end", interrupted: false });

    expect(received).toEqual([{ type: "run-start" }]);
  });

  test("clear removes all subscribers", () => {
    const bus = new AgentEventBus();
    const received: Array<unknown> = [];

    bus.subscribe((event) => {
      received.push(event);
    });
    bus.subscribe((event) => {
      received.push(event);
    });

    bus.clear();
    bus.emit({ type: "error", message: "boom" });

    expect(received).toEqual([]);
  });
});

describe("normalizeStreamEvent", () => {
  test("text-delta normalized correctly", () => {
    expect(normalizeStreamEvent({ type: "text-delta", textDelta: "hello" })).toEqual({
      type: "text-delta",
      delta: "hello",
    });
  });

  test("tool-call normalized correctly", () => {
    expect(normalizeStreamEvent({
      type: "tool-call",
      toolName: "grep",
      args: { pattern: "TODO" },
    })).toEqual({
      type: "tool-call",
      toolName: "grep",
      args: { pattern: "TODO" },
    });
  });

  test("tool-result normalized correctly", () => {
    expect(normalizeStreamEvent({
      type: "tool-result",
      toolName: "grep",
      result: 42,
    })).toEqual({
      type: "tool-result",
      toolName: "grep",
      result: "42",
    });
  });

  test("reasoning/thinking normalized correctly", () => {
    expect(normalizeStreamEvent({ type: "reasoning", textDelta: "thinking" })).toEqual({
      type: "thinking-delta",
      delta: "thinking",
    });
  });

  test("unknown event type returns null", () => {
    expect(normalizeStreamEvent({ type: "finish" })).toBeNull();
  });
});

describe("normalizeGenerateResult", () => {
  test("generates correct sequence of events", () => {
    expect(normalizeGenerateResult({
      steps: [
        {
          text: "Plan ready",
          toolCalls: [{ toolName: "grep", args: { pattern: "AgentEvent" } }],
          toolResults: [{ toolName: "grep", result: 2 }],
        },
        {
          text: "Done",
        },
      ],
    })).toEqual([
      { type: "run-start" },
      { type: "step-start", stepIndex: 0 },
      { type: "text-delta", delta: "Plan ready" },
      { type: "tool-call", toolName: "grep", args: { pattern: "AgentEvent" } },
      { type: "tool-result", toolName: "grep", result: "2" },
      { type: "step-end", stepIndex: 0 },
      { type: "step-start", stepIndex: 1 },
      { type: "text-delta", delta: "Done" },
      { type: "step-end", stepIndex: 1 },
      { type: "run-end", interrupted: false },
    ]);
  });

  test("empty result produces run-start + run-end", () => {
    expect(normalizeGenerateResult({})).toEqual([
      { type: "run-start" },
      { type: "run-end", interrupted: false },
    ]);
  });
});

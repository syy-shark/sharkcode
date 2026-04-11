import React from "react";
import { render } from "ink-testing-library";
import { describe, expect, it } from "bun:test";
import { ExecutionPane, aggregateEvents } from "./ExecutionPane.tsx";
import type { AgentEvent } from "../agent-events.ts";

describe("aggregateEvents", () => {
  it("aggregates consecutive text-deltas", () => {
    const events: AgentEvent[] = [
      { type: "text-delta", delta: "Hel" },
      { type: "text-delta", delta: "lo" },
    ];
    const result = aggregateEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "text", content: "Hello" });
  });

  it("aggregates consecutive thinking-deltas", () => {
    const events: AgentEvent[] = [
      { type: "thinking-delta", delta: "Hm" },
      { type: "thinking-delta", delta: "m" },
    ];
    const result = aggregateEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "thinking", content: "Hmm" });
  });

  it("handles tool state transitions to done", () => {
    const events: AgentEvent[] = [
      { type: "tool-call", toolName: "read_file", args: {} },
      { type: "tool-result", toolName: "read_file", result: "file content" },
    ];
    const result = aggregateEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "tool-done", toolName: "read_file", result: "file content" });
  });

  it("handles tool state transitions to error", () => {
    const events: AgentEvent[] = [
      { type: "tool-call", toolName: "bash", args: {} },
      { type: "tool-error", toolName: "bash", error: "command not found" },
    ];
    const result = aggregateEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "tool-error", toolName: "bash", error: "command not found" });
  });

  it("leaves unmatched tool-results as done", () => {
    const events: AgentEvent[] = [
      { type: "tool-result", toolName: "read_file", result: "ok" },
    ];
    const result = aggregateEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "tool-done", toolName: "read_file", result: "ok" });
  });
});

describe("ExecutionPane", () => {
  it("renders aggregated text-deltas", () => {
    const events: AgentEvent[] = [
      { type: "text-delta", delta: "Hel" },
      { type: "text-delta", delta: "lo" },
    ];
    const { lastFrame } = render(<ExecutionPane events={events} />);
    expect(lastFrame()?.includes("Hello")).toBe(true);
    expect(lastFrame()?.includes("Hel\nlo")).toBe(false); // Make sure they aren't on separate lines
  });

  it("renders tool-call correctly", () => {
    const events: AgentEvent[] = [
      { type: "tool-call", toolName: "read_file", args: {} },
    ];
    const { lastFrame } = render(<ExecutionPane events={events} />);
    expect(lastFrame()?.includes("正在执行: read_file")).toBe(true);
  });

  it("renders tool completion correctly", () => {
    const events: AgentEvent[] = [
      { type: "tool-call", toolName: "read_file", args: {} },
      { type: "tool-result", toolName: "read_file", result: "file content" },
    ];
    const { lastFrame } = render(<ExecutionPane events={events} />);
    expect(lastFrame()?.includes("read_file: file content")).toBe(true);
    expect(lastFrame()?.includes("正在执行")).toBe(false);
  });
});

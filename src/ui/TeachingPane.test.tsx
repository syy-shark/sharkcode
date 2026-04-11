import React from "react";
import { render } from "ink-testing-library";
import { describe, expect, it } from "bun:test";
import { TeachingPane } from "./TeachingPane.tsx";
import type { TeachingEvent } from "../teaching.ts";

describe("TeachingPane", () => {
  it("shows waiting state initially", () => {
    const { lastFrame } = render(<TeachingPane events={[]} />);
    expect(lastFrame()?.includes("等待 Agent 执行完成")).toBe(true);
  });

  it("shows generating state after teaching-start", () => {
    const events: TeachingEvent[] = [{ type: "teaching-start" }];
    const { lastFrame } = render(<TeachingPane events={events} />);
    expect(lastFrame()?.includes("正在生成教学内容")).toBe(true);
  });

  it("accumulates teaching-delta texts", () => {
    const events: TeachingEvent[] = [
      { type: "teaching-start" },
      { type: "teaching-delta", delta: "第" },
      { type: "teaching-delta", delta: "一段" },
    ];
    const { lastFrame } = render(<TeachingPane events={events} />);
    expect(lastFrame()?.includes("第一段")).toBe(true);
  });

  it("shows empty state when teaching-end has no delta", () => {
    const events: TeachingEvent[] = [
      { type: "teaching-start" },
      { type: "teaching-end" },
    ];
    const { lastFrame } = render(<TeachingPane events={events} />);
    expect(lastFrame()?.includes("无需特别讲解")).toBe(true);
  });

  it("shows done state with text when teaching-end has delta", () => {
    const events: TeachingEvent[] = [
      { type: "teaching-start" },
      { type: "teaching-delta", delta: "测试" },
      { type: "teaching-end" },
    ];
    const { lastFrame } = render(<TeachingPane events={events} />);
    expect(lastFrame()?.includes("测试")).toBe(true);
    // Should no longer show "正在生成"
    expect(lastFrame()?.includes("正在生成教学内容")).toBe(false);
  });

  it("shows error state after teaching-error", () => {
    const events: TeachingEvent[] = [
      { type: "teaching-start" },
      { type: "teaching-error", message: "failed" },
    ];
    const { lastFrame } = render(<TeachingPane events={events} />);
    expect(lastFrame()?.includes("教学讲解暂时不可用")).toBe(true);
  });
});

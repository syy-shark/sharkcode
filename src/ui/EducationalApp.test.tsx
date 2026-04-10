import { expect, it, describe } from "bun:test";
import { render } from "ink-testing-library";
import { ExecutionPane } from "./ExecutionPane.tsx";
import { TeachingPane } from "./TeachingPane.tsx";
import { EducationalApp } from "./EducationalApp.tsx";
import { AgentEventBus } from "../agent-events.ts";
import type { AgentEvent } from "../agent-events.ts";
import { TeachingOrchestrator } from "../teaching.ts";
import type { TeachingEvent } from "../teaching.ts";

describe("ExecutionPane", () => {
  it("renders text-delta", () => {
    const events: AgentEvent[] = [{ type: "text-delta", delta: "hello" }];
    const { lastFrame } = render(<ExecutionPane events={events} />);
    expect(lastFrame()).toContain("hello");
  });

  it("renders tool-call events", () => {
    const events: AgentEvent[] = [
      { type: "tool-call", toolName: "read_file", args: { path: "test.ts" } },
    ];
    const { lastFrame } = render(<ExecutionPane events={events} />);
    expect(lastFrame()).toContain("read_file");
  });
});

describe("TeachingPane", () => {
  it("renders teaching-delta events", () => {
    const events: TeachingEvent[] = [
      { type: "teaching-delta", delta: "Here is a lesson" },
    ];
    const { lastFrame } = render(<TeachingPane events={events} />);
    expect(lastFrame()).toContain("Here is a lesson");
  });

  it("shows fallback message on teaching-error", () => {
    const events: TeachingEvent[] = [
      { type: "teaching-error", message: "Failed" },
    ];
    const { lastFrame } = render(<TeachingPane events={events} />);
    expect(lastFrame()).toContain("教学讲解暂时不可用");
  });

  it("shows fallback when empty", () => {
    const { lastFrame } = render(<TeachingPane events={[]} />);
    expect(lastFrame()).toContain("等待教学内容...");
  });
});

describe("EducationalApp", () => {
  it("renders both panes", () => {
    const eventBus = new AgentEventBus();
    const teachingOrchestrator = {
      subscribe: () => () => {},
      teach: async () => {},
    } as unknown as TeachingOrchestrator;
    
    const { lastFrame } = render(
      <EducationalApp
        eventBus={eventBus}
        teachingOrchestrator={teachingOrchestrator}
      />
    );
    
    const frame = lastFrame() || "";
    expect(frame).toContain("⚡ 执行过程");
    expect(frame).toContain("📚 教学讲解");
  });
});

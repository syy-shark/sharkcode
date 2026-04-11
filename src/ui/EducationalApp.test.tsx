import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "ink-testing-library";
import { AgentEventBus, type AgentEvent } from "../agent-events.ts";
import type { TeachingEvent, TeachingOrchestrator } from "../teaching.ts";
import { EducationalApp } from "./EducationalApp.tsx";
import { ExecutionPane } from "./ExecutionPane.tsx";
import { TeachingPane } from "./TeachingPane.tsx";

afterEach(() => {
  cleanup();
});

function createTeachingOrchestratorDouble() {
  const listeners = new Set<(event: TeachingEvent) => void>();

  return {
    emit(event: TeachingEvent) {
      for (const listener of [...listeners]) {
        listener(event);
      }
    },
    orchestrator: {
      subscribe(listener: (event: TeachingEvent) => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      teach: async () => {},
    } as unknown as TeachingOrchestrator,
  };
}

async function flushUi() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

async function waitFor(condition: () => boolean, timeoutMs = 250) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }

    await flushUi();
  }

  expect(condition()).toBe(true);
}

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
      { type: "teaching-start" },
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
    expect(lastFrame()).toContain("等待 Agent 执行完成");
  });
});

describe("EducationalApp", () => {
  it("renders both panes", () => {
    const eventBus = new AgentEventBus();
    const teaching = createTeachingOrchestratorDouble();
    
    const { lastFrame } = render(
      <EducationalApp
        eventBus={eventBus}
        teachingOrchestrator={teaching.orchestrator}
      />
    );
    
    const frame = lastFrame() || "";
    expect(frame).toContain("⚡ 执行过程");
    expect(frame).toContain("📚 教学讲解");
  });

  it("does not exit immediately on run-end", async () => {
    const eventBus = new AgentEventBus();
    const teaching = createTeachingOrchestratorDouble();
    let exitCount = 0;

    render(
      <EducationalApp
        eventBus={eventBus}
        teachingOrchestrator={teaching.orchestrator}
        onExit={() => {
          exitCount += 1;
        }}
      />
    );

    await flushUi();
    eventBus.emit({ type: "run-end", interrupted: false });
    await flushUi();

    expect(exitCount).toBe(0);
  });

  it("exits after run-end followed by teaching-end", async () => {
    const eventBus = new AgentEventBus();
    const teaching = createTeachingOrchestratorDouble();
    let exitCount = 0;

    render(
      <EducationalApp
        eventBus={eventBus}
        teachingOrchestrator={teaching.orchestrator}
        onExit={() => {
          exitCount += 1;
        }}
      />
    );

    await flushUi();
    eventBus.emit({ type: "run-end", interrupted: false });
    await flushUi();
    expect(exitCount).toBe(0);

    teaching.emit({ type: "teaching-end" });
    await waitFor(() => exitCount === 1);

    expect(exitCount).toBe(1);
  });

  it("exits after run-end followed by teaching-error", async () => {
    const eventBus = new AgentEventBus();
    const teaching = createTeachingOrchestratorDouble();
    let exitCount = 0;

    render(
      <EducationalApp
        eventBus={eventBus}
        teachingOrchestrator={teaching.orchestrator}
        onExit={() => {
          exitCount += 1;
        }}
      />
    );

    await flushUi();
    eventBus.emit({ type: "run-end", interrupted: false });
    await flushUi();
    expect(exitCount).toBe(0);

    teaching.emit({ type: "teaching-error", message: "Failed" });
    await waitFor(() => exitCount === 1);

    expect(exitCount).toBe(1);
  });

  it("exits even if teaching-end arrives before run-end", async () => {
    const eventBus = new AgentEventBus();
    const teaching = createTeachingOrchestratorDouble();
    let exitCount = 0;

    render(
      <EducationalApp
        eventBus={eventBus}
        teachingOrchestrator={teaching.orchestrator}
        onExit={() => {
          exitCount += 1;
        }}
      />
    );

    await flushUi();
    teaching.emit({ type: "teaching-end" });
    await flushUi();
    expect(exitCount).toBe(0);

    eventBus.emit({ type: "run-end", interrupted: false });
    await waitFor(() => exitCount === 1);

    expect(exitCount).toBe(1);
  });

  it("only exits once when terminal events repeat", async () => {
    const eventBus = new AgentEventBus();
    const teaching = createTeachingOrchestratorDouble();
    let exitCount = 0;

    render(
      <EducationalApp
        eventBus={eventBus}
        teachingOrchestrator={teaching.orchestrator}
        onExit={() => {
          exitCount += 1;
        }}
      />
    );

    await flushUi();
    eventBus.emit({ type: "run-end", interrupted: false });
    await flushUi();
    teaching.emit({ type: "teaching-end" });
    await waitFor(() => exitCount === 1);

    teaching.emit({ type: "teaching-error", message: "Failed" });
    eventBus.emit({ type: "run-end", interrupted: false });
    await flushUi();

    expect(exitCount).toBe(1);
  });

  it("exits due to timeout if teaching doesn't complete", async () => {
    const eventBus = new AgentEventBus();
    const teaching = createTeachingOrchestratorDouble();
    let exitCount = 0;

    const { frames } = render(
      <EducationalApp
        eventBus={eventBus}
        teachingOrchestrator={teaching.orchestrator}
        teachingTimeout={100}
        onExit={() => {
          exitCount += 1;
        }}
      />
    );

    await flushUi();
    eventBus.emit({ type: "run-end", interrupted: false });
    await flushUi();
    expect(exitCount).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 150));
    await waitFor(() => exitCount === 1);

    expect(exitCount).toBe(1);
    const allFrames = frames.join("\n");
    expect(allFrames).toContain("⏰ 教学生成超时");
  });

  it("clears timeout if teaching completes before timeout", async () => {
    const eventBus = new AgentEventBus();
    const teaching = createTeachingOrchestratorDouble();
    let exitCount = 0;

    const { lastFrame } = render(
      <EducationalApp
        eventBus={eventBus}
        teachingOrchestrator={teaching.orchestrator}
        teachingTimeout={1000}
        onExit={() => {
          exitCount += 1;
        }}
      />
    );

    await flushUi();
    eventBus.emit({ type: "run-end", interrupted: false });
    await flushUi();

    await new Promise((resolve) => setTimeout(resolve, 50));
    teaching.emit({ type: "teaching-end" });
    await waitFor(() => exitCount === 1);

    expect(exitCount).toBe(1);
    const frame = lastFrame() || "";
    expect(frame).not.toContain("⏰ 教学生成超时");
  });

  it("cleans up timer on unmount", async () => {
    const eventBus = new AgentEventBus();
    const teaching = createTeachingOrchestratorDouble();

    const { unmount } = render(
      <EducationalApp
        eventBus={eventBus}
        teachingOrchestrator={teaching.orchestrator}
        teachingTimeout={100}
      />
    );

    await flushUi();
    eventBus.emit({ type: "run-end", interrupted: false });
    await flushUi();

    // unmount before timeout
    unmount();

    // wait for timeout to pass, no errors should be thrown
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
});

import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { LanguageModel } from "ai";

type LanguageModelV1 = LanguageModel;

interface MockStreamTextOptions {
  model: unknown;
  system?: string;
  prompt?: string;
  abortSignal?: AbortSignal;
}

type MockStreamPart =
  | { type: "text-delta"; delta?: string; textDelta?: string; text?: string }
  | { type: "error"; error?: unknown; message?: string };

type MockStreamResult = {
  fullStream: AsyncIterable<MockStreamPart>;
};

const streamCalls: MockStreamTextOptions[] = [];

let streamImplementation: (options: MockStreamTextOptions) => MockStreamResult = () => ({
  fullStream: (async function* () {
    yield { type: "text-delta", delta: "默认讲解" };
  })(),
});

const streamTextMock = mock((options: MockStreamTextOptions) => {
  streamCalls.push(options);
  return streamImplementation(options);
});

mock.module("ai", () => ({
  streamText: streamTextMock,
}));

const { TeachingOrchestrator } = await import("./teaching.ts");

const mockProvider = {} as LanguageModelV1;

const baseContext = {
  userPrompt: "帮我解释 agent 为什么运行这些工具",
  toolCalls: [{ toolName: "read_file", args: { filePath: "src/app.ts" } }],
  toolResults: [{ toolName: "read_file", result: "const answer = 42;" }],
  agentTextSummary: "Agent 正在读取文件并准备解释代码结构。",
};

function createOrchestrator(verbosity: "简洁" | "标准" | "详细" = "标准") {
  return new TeachingOrchestrator({
    model: "gpt-4o-mini",
    verbosity,
    getProvider: () => mockProvider,
  });
}

beforeEach(() => {
  streamCalls.length = 0;
  streamTextMock.mockClear();
  streamImplementation = () => ({
    fullStream: (async function* () {
      yield { type: "text-delta", delta: "默认讲解" };
    })(),
  });
});

describe("TeachingOrchestrator", () => {
  it("emits teaching-start, teaching-delta, teaching-end in order", async () => {
    streamImplementation = () => ({
      fullStream: (async function* () {
        yield { type: "text-delta", delta: "第一段" };
        yield { type: "text-delta", delta: "第二段" };
      })(),
    });

    const orchestrator = createOrchestrator();
    const events: Array<{ type: string; delta?: string }> = [];

    orchestrator.subscribe((event) => {
      events.push(event);
    });

    await orchestrator.teach(baseContext);

    expect(events).toEqual([
      { type: "teaching-start" },
      { type: "teaching-delta", delta: "第一段" },
      { type: "teaching-delta", delta: "第二段" },
      { type: "teaching-end" },
    ]);
  });

  it("emits teaching-error when the LLM stream fails and does not throw", async () => {
    streamImplementation = () => {
      throw new Error("mock llm failure");
    };

    const orchestrator = createOrchestrator();
    const events: Array<{ type: string; message?: string }> = [];

    orchestrator.subscribe((event) => {
      events.push(event);
    });

    await expect(orchestrator.teach(baseContext)).resolves.toBeUndefined();

    expect(events).toEqual([
      { type: "teaching-start" },
      { type: "teaching-error", message: "mock llm failure" },
    ]);
  });

  it("emits teaching-end when called with an already aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    const orchestrator = createOrchestrator();
    const events: Array<{ type: string }> = [];

    orchestrator.subscribe((event) => {
      events.push(event);
    });

    await orchestrator.teach(baseContext, controller.signal);

    expect(events).toEqual([{ type: "teaching-start" }, { type: "teaching-end" }]);
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("supports unsubscribe correctly", async () => {
    const orchestrator = createOrchestrator();
    const activeEvents: Array<{ type: string }> = [];
    const removedEvents: Array<{ type: string }> = [];

    const unsubscribe = orchestrator.subscribe((event) => {
      removedEvents.push(event);
    });

    unsubscribe();

    orchestrator.subscribe((event) => {
      activeEvents.push(event);
    });

    await orchestrator.teach(baseContext);

    expect(removedEvents).toEqual([]);
    expect(activeEvents.map((event) => event.type)).toEqual([
      "teaching-start",
      "teaching-delta",
      "teaching-end",
    ]);
  });

  it("builds different system prompts for 简洁 and 详细 verbosity", async () => {
    const concise = createOrchestrator("简洁");
    const detailed = createOrchestrator("详细");

    await concise.teach(baseContext);
    await detailed.teach(baseContext);

    expect(streamCalls).toHaveLength(2);
    expect(streamCalls[0]?.system).toContain("请简洁地解释，用2-3句话。");
    expect(streamCalls[1]?.system).toContain("请详细解释每个步骤，包括为什么这样做。");
    expect(streamCalls[0]?.system).not.toBe(streamCalls[1]?.system);
  });
});

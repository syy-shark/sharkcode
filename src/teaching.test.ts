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
  toolErrors: [],
  agentErrors: [],
  interrupted: false,
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
    // 简洁 mode should mention "1-2 句" for brevity
    expect(streamCalls[0]?.system).toContain("1-2 句");
    // 详细 mode should mention "2-4 句" for more detail
    expect(streamCalls[1]?.system).toContain("2-4 句");
    // Both should prohibit fluffy praise
    expect(streamCalls[0]?.system).toContain("不要空泛夸赞");
    expect(streamCalls[0]?.system).not.toBe(streamCalls[1]?.system);
  });

  it("requests explicit teaching sections and no fluffy praise", async () => {
    const orchestrator = createOrchestrator();
    await orchestrator.teach(baseContext);

    expect(streamCalls).toHaveLength(1);
    const systemPrompt = streamCalls[0]?.system ?? "";

    // Must require the three fixed section markers
    expect(systemPrompt).toContain("【Prompt 点评】");
    expect(systemPrompt).toContain("【知识补给】");
    expect(systemPrompt).toContain("【下次试试】");

    // Must prohibit fluffy praise and marketing language
    expect(systemPrompt).toContain("不要空泛夸赞");
    expect(systemPrompt).toContain("不要写营销口号");
    expect(systemPrompt).toContain("不要重复用户原话");
    expect(systemPrompt).toContain("用户怎么提需求更好");
  });

  it("includes tool errors in the teaching prompt", async () => {
    const orchestrator = createOrchestrator();

    await orchestrator.teach({
      ...baseContext,
      toolErrors: [{ toolName: "playwright", error: "snapshot failed" }],
      agentErrors: ["provider timeout"],
      interrupted: true,
    });

    expect(streamCalls).toHaveLength(1);
    expect(streamCalls[0]?.prompt).toContain("工具错误");
    expect(streamCalls[0]?.prompt).toContain("playwright: snapshot failed");
    expect(streamCalls[0]?.prompt).toContain("Agent 错误");
    expect(streamCalls[0]?.prompt).toContain("provider timeout");
    expect(streamCalls[0]?.prompt).toContain("本次执行被用户中断");
    expect(streamCalls[0]?.prompt).toContain("不要评价设计风格");
  });
});

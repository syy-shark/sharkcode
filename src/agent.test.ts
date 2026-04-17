import { afterEach, describe, expect, it } from "bun:test";
import { createSpinner, renderGeneratedSteps, renderSpinnerFrame, type SpinnerHost } from "./agent.ts";
import { getToolsForRuntimePolicy } from "./tools/index.ts";

function toText(chunk: string | Uint8Array): string {
  return typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
}

describe("renderGeneratedSteps", () => {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
  });

  it("returns generated text without writing to stdout when terminal rendering is disabled", () => {
    const stdoutWrites: string[] = [];

    function stdoutStub(buffer: string | Uint8Array, cb?: (err?: Error | null) => void): boolean;
    function stdoutStub(
      str: string | Uint8Array,
      encoding?: BufferEncoding,
      cb?: (err?: Error | null) => void,
    ): boolean;
    function stdoutStub(
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((err?: Error | null) => void),
      callback?: (err?: Error | null) => void,
    ): boolean {
      stdoutWrites.push(toText(chunk));
      if (typeof encodingOrCallback === "function") {
        encodingOrCallback();
      }
      if (typeof callback === "function") {
        callback();
      }
      return true;
    }

    process.stdout.write = stdoutStub;

    const printedText = renderGeneratedSteps(
      [
        {
          content: [
            { type: "tool-call", toolName: "read_file", input: { path: "src/app.ts" } },
            { type: "tool-result", toolName: "read_file", output: "const answer = 42;" },
            { type: "text", text: "已读取文件并总结。" },
          ],
        },
      ],
      false,
    );

    expect(printedText).toBe("已读取文件并总结。");
    expect(stdoutWrites).toEqual([]);
  });
});

describe("spinner rendering", () => {
  it("renders a restrained single-highlight frame", () => {
    const frame = renderSpinnerFrame(3, "running...");

    expect(frame).toContain("◇");
    expect(frame).toContain("running...");
    expect(frame).toContain("\r");
    expect(frame.match(/━/g)?.length).toBe(16);
  });

  it("does not emit late frames after stop", () => {
    const writes: string[] = [];
    let scheduledTick: (() => void) | null = null;
    let clearedTimer: unknown = null;
    const host: SpinnerHost = {
      write: (text) => {
        writes.push(text);
      },
      setTimer: (tick) => {
        scheduledTick = tick;
        return { id: 1 };
      },
      clearTimer: (handle) => {
        clearedTimer = handle;
      },
    };

    const spinner = createSpinner("running...", host);
    spinner.start();

    expect(writes.length).toBe(1);
    expect(typeof scheduledTick).toBe("function");

    spinner.stop();

    expect(clearedTimer).toEqual({ id: 1 });
    expect(writes.at(-1)).toBe("\r\x1b[K");

    const writesAfterStop = writes.length;
    const lateTick = ((value: (() => void) | null) => value)(scheduledTick);
    lateTick?.();

    expect(writes.length).toBe(writesAfterStop);
  });
});

describe("runtime tool policy", () => {
  it("removes write and bash tools in read-only mode", () => {
    const tools = getToolsForRuntimePolicy("read-only");

    expect("read_file" in tools).toBe(true);
    expect("write_file" in tools).toBe(false);
    expect("bash" in tools).toBe(false);
    expect("playwright" in tools).toBe(false);
  });
});

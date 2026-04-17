import { afterEach, describe, expect, it } from "bun:test";
import { askPermission, setPermissionMode, setSuppressAutoApprovedOutput } from "./permission.ts";

function toText(chunk: string | Uint8Array): string {
  return typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
}

describe("askPermission", () => {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    setSuppressAutoApprovedOutput(false);
    setPermissionMode("prompt");
  });

  it("suppresses auto-approved output when requested", async () => {
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
    setPermissionMode("full-access");
    setSuppressAutoApprovedOutput(true);

    await expect(askPermission("dir /a")).resolves.toBe(true);
    expect(stdoutWrites).toEqual([]);
  });
});

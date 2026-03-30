import { tool } from "ai";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

export const readFileTool = tool({
  description:
    "Read the contents of a file at the given path. Returns the file content as a string.",
  parameters: z.object({
    path: z
      .string()
      .describe("File path to read (relative to current working directory)"),
  }),
  execute: async ({ path: filePath }) => {
    const fullPath = resolve(process.cwd(), filePath);
    if (!existsSync(fullPath)) {
      return `Error: File not found: ${filePath}`;
    }
    try {
      return readFileSync(fullPath, "utf-8");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error reading file: ${msg}`;
    }
  },
});

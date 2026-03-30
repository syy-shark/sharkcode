import { tool } from "ai";
import { z } from "zod";
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

export const writeFileTool = tool({
  description:
    "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Creates parent directories as needed.",
  parameters: z.object({
    path: z
      .string()
      .describe("File path to write to (relative to current working directory)"),
    content: z.string().describe("The content to write to the file"),
  }),
  execute: async ({ path: filePath, content }) => {
    const fullPath = resolve(process.cwd(), filePath);
    try {
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content, "utf-8");
      return `Successfully wrote to ${filePath}`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error writing file: ${msg}`;
    }
  },
});

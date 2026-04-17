import { tool } from "ai";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

export const editFileTool = tool({
  description:
    "Edit a file by replacing an exact string match with new content. The old_str must match exactly one occurrence in the file.",
  inputSchema: z.object({
    path: z
      .string()
      .describe("File path to edit (relative to current working directory)"),
    old_str: z.string().describe("The exact string to find and replace"),
    new_str: z.string().describe("The replacement string"),
  }),
  execute: async ({ path: filePath, old_str, new_str }) => {
    const fullPath = resolve(process.cwd(), filePath);
    if (!existsSync(fullPath)) {
      return `Error: File not found: ${filePath}`;
    }
    try {
      const content = readFileSync(fullPath, "utf-8");
      const count = content.split(old_str).length - 1;

      if (count === 0) {
        return `Error: old_str not found in ${filePath}`;
      }
      if (count > 1) {
        return `Error: old_str found ${count} times in ${filePath}, expected exactly 1. Include more context to make it unique.`;
      }

      const newContent = content.replace(old_str, new_str);
      writeFileSync(fullPath, newContent, "utf-8");
      return `Successfully edited ${filePath}`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error editing file: ${msg}`;
    }
  },
});

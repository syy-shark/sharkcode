import { tool } from "ai";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

export const readFileTool = tool({
  description:
    "Read the contents of a file at the given path. Returns the file content as a string. " +
    "Supports optional line range selection and line numbers for targeted reading.",
  inputSchema: z.object({
    path: z
      .string()
      .describe("File path to read (relative to current working directory)"),
    start_line: z
      .number()
      .optional()
      .describe("Start line number (1-based, inclusive). Omit to read from beginning."),
    end_line: z
      .number()
      .optional()
      .describe("End line number (1-based, inclusive). Omit to read to the end."),
    show_line_numbers: z
      .boolean()
      .optional()
      .describe("Show line numbers in output (default: true when using line ranges)"),
  }),
  execute: async ({ path: filePath, start_line, end_line, show_line_numbers }) => {
    const fullPath = resolve(process.cwd(), filePath);
    if (!existsSync(fullPath)) {
      return `Error: File not found: ${filePath}`;
    }
    try {
      const content = readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");

      const hasRange = start_line !== undefined || end_line !== undefined;
      const start = Math.max(1, start_line ?? 1);
      const end = Math.min(lines.length, end_line ?? lines.length);
      const showNums = show_line_numbers ?? hasRange;

      const selected = lines.slice(start - 1, end);

      let output: string;
      if (showNums) {
        const maxWidth = String(end).length;
        output = selected
          .map((line, i) => {
            const num = String(start + i).padStart(maxWidth, " ");
            return `${num}│ ${line}`;
          })
          .join("\n");
      } else {
        output = selected.join("\n");
      }

      // Cap output to prevent token bloat in conversation history
      const MAX_CHARS = 12_000;
      if (output.length > MAX_CHARS) {
        const totalLines = selected.length;
        output = output.slice(0, MAX_CHARS) +
          `\n\n... (truncated — showing ~${MAX_CHARS} chars of ${totalLines} lines. Use start_line/end_line to read specific sections)`;
      }

      return output;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error reading file: ${msg}`;
    }
  },
});

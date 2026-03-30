import { tool } from "ai";
import { z } from "zod";
import { readFileSync, statSync } from "fs";
import { resolve, relative, extname } from "path";
import { walkFiles } from "./utils.ts";

export const grepTool = tool({
  description:
    "Search for a text pattern or regex in files. Returns matching lines with file paths " +
    "and line numbers. Use this to find function definitions, usages, imports, or any text. " +
    "Skips binary files, node_modules, .git, etc.",
  inputSchema: z.object({
    pattern: z
      .string()
      .describe("Text or regex pattern to search for"),
    path: z
      .string()
      .optional()
      .describe("File or directory to search in (default: current working directory)"),
    include: z
      .string()
      .optional()
      .describe("File extension filter (e.g. '*.ts' or '*.{js,ts,tsx}')"),
    ignore_case: z
      .boolean()
      .optional()
      .describe("Case insensitive search (default: false)"),
  }),
  execute: async ({ pattern, path: searchPath, include, ignore_case }) => {
    const basePath = resolve(process.cwd(), searchPath ?? ".");
    const maxResults = 100;

    // Build search regex
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, ignore_case ? "gi" : "g");
    } catch {
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      regex = new RegExp(escaped, ignore_case ? "gi" : "g");
    }

    // Build include filter (match against file extension or name)
    let includeExts: Set<string> | null = null;
    if (include) {
      const cleaned = include.replace(/^\*\.?/, "");
      // Handle {js,ts,tsx} brace expansion
      const braceMatch = cleaned.match(/^\{(.+)\}$/);
      if (braceMatch) {
        includeExts = new Set(braceMatch[1]!.split(",").map((e) => "." + e.trim()));
      } else if (cleaned) {
        includeExts = new Set(["." + cleaned]);
      }
    }

    // Collect files
    let files: string[];
    try {
      const stat = statSync(basePath);
      files = stat.isDirectory()
        ? walkFiles(basePath, { maxFiles: 5000 })
        : [basePath];
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }

    const results: string[] = [];

    for (const file of files) {
      if (results.length >= maxResults) break;

      // Apply extension filter
      if (includeExts && !includeExts.has(extname(file).toLowerCase())) continue;

      try {
        const content = readFileSync(file, "utf-8");
        const lines = content.split("\n");
        const relPath = relative(process.cwd(), file).replace(/\\/g, "/");

        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) break;
          const line = lines[i]!;
          regex.lastIndex = 0;
          if (regex.test(line)) {
            results.push(`${relPath}:${i + 1}: ${line.trimEnd()}`);
          }
        }
      } catch {
        // skip unreadable files
      }
    }

    if (results.length === 0) {
      return `No matches found for pattern: ${pattern}`;
    }

    const header =
      results.length >= maxResults
        ? `Found ${maxResults}+ matches (showing first ${maxResults}):\n`
        : `Found ${results.length} match(es):\n`;

    return header + results.join("\n");
  },
});

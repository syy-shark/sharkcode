import { tool } from "ai";
import { z } from "zod";
import { resolve, relative } from "path";
import { walkFiles, globToRegex } from "./utils.ts";

export const globTool = tool({
  description:
    "Find files matching a glob pattern. Use this to discover project structure and locate files. " +
    "Examples: '**/*.ts', 'src/**/*.test.ts', '*.json', 'src/{components,hooks}/**/*.tsx'. " +
    "Skips node_modules, .git, dist, and other common build/dependency directories.",
  inputSchema: z.object({
    pattern: z
      .string()
      .describe("Glob pattern to match files (e.g. '**/*.ts', 'src/**/*.{js,ts}')"),
    path: z
      .string()
      .optional()
      .describe("Directory to search in (default: current working directory)"),
  }),
  execute: async ({ pattern, path: searchPath }) => {
    const baseDir = resolve(process.cwd(), searchPath ?? ".");
    const maxResults = 500;

    try {
      const allFiles = walkFiles(baseDir, { maxFiles: maxResults * 3, includeBinary: true });
      const regex = globToRegex(pattern);

      const matched: string[] = [];
      for (const f of allFiles) {
        const rel = relative(baseDir, f).replace(/\\/g, "/");
        if (regex.test(rel)) {
          matched.push(rel);
          if (matched.length >= maxResults) break;
        }
      }

      if (matched.length === 0) {
        return `No files found matching pattern: ${pattern}`;
      }

      const truncated = matched.length >= maxResults ? ` (showing first ${maxResults})` : "";
      return `Found ${matched.length} file(s)${truncated}:\n${matched.join("\n")}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error searching files: ${msg}`;
    }
  },
});

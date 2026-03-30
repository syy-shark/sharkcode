import { tool } from "ai";
import { z } from "zod";
import { readdirSync, statSync } from "fs";
import { resolve, join } from "path";
import { SKIP_DIRS } from "./utils.ts";

function buildTree(
  dir: string,
  prefix: string,
  depth: number,
  maxDepth: number,
  lines: string[],
  fileCount: { n: number },
  maxFiles: number,
): void {
  if (depth > maxDepth || fileCount.n >= maxFiles) return;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  // Sort: directories first, then alphabetical
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // Filter out skip dirs
  entries = entries.filter((e) => !SKIP_DIRS.has(e.name));

  for (let i = 0; i < entries.length; i++) {
    if (fileCount.n >= maxFiles) {
      lines.push(`${prefix}... (truncated)`);
      return;
    }

    const entry = entries[i]!;
    const isLast = i === entries.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = prefix + (isLast ? "    " : "│   ");

    if (entry.isDirectory()) {
      lines.push(`${prefix}${connector}${entry.name}/`);
      fileCount.n++;
      buildTree(join(dir, entry.name), childPrefix, depth + 1, maxDepth, lines, fileCount, maxFiles);
    } else {
      let sizeStr = "";
      try {
        const stat = statSync(join(dir, entry.name));
        sizeStr = ` (${formatSize(stat.size)})`;
      } catch { /* ignore */ }
      lines.push(`${prefix}${connector}${entry.name}${sizeStr}`);
      fileCount.n++;
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export const listDirectoryTool = tool({
  description:
    "List the contents of a directory in a tree-like format. Shows files with sizes and " +
    "directories with nesting. Useful for understanding project structure. " +
    "Skips node_modules, .git, and other common ignored directories.",
  inputSchema: z.object({
    path: z
      .string()
      .optional()
      .describe("Directory path to list (default: current working directory)"),
    depth: z
      .number()
      .optional()
      .describe("Maximum depth to traverse (default: 3)"),
  }),
  execute: async ({ path: dirPath, depth }) => {
    const fullPath = resolve(process.cwd(), dirPath ?? ".");
    const maxDepth = Math.min(depth ?? 3, 8);
    const maxFiles = 300;

    try {
      const stat = statSync(fullPath);
      if (!stat.isDirectory()) {
        return `Error: Not a directory: ${dirPath ?? "."}`;
      }
    } catch {
      return `Error: Directory not found: ${dirPath ?? "."}`;
    }

    const lines: string[] = [];
    const fileCount = { n: 0 };
    buildTree(fullPath, "", 0, maxDepth, lines, fileCount, maxFiles);

    if (lines.length === 0) {
      return "(empty directory)";
    }

    return lines.join("\n") + `\n\n${fileCount.n} items listed`;
  },
});

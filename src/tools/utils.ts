/**
 * Shared utilities for tool implementations.
 */
import { readdirSync } from "fs";
import { join } from "path";

// Directories to skip when walking the file tree
export const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  "__pycache__", ".venv", "venv", ".tox", "target",
  ".idea", ".vscode", ".cache", "coverage", ".turbo",
  ".output", ".svelte-kit", ".parcel-cache", "vendor",
  ".pnpm", ".yarn", "bower_components",
]);

// Binary file extensions to skip when searching content
export const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp", ".bmp",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".gz", ".tar", ".rar", ".7z", ".bz2", ".xz",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".obj",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".mp3", ".mp4", ".avi", ".mkv", ".mov", ".flv", ".wav", ".ogg",
  ".db", ".sqlite", ".sqlite3",
  ".wasm", ".map", ".min.js", ".min.css",
  ".lock", ".lockb",
]);

export function isBinaryPath(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return false;
  return BINARY_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}

/**
 * Recursively walk a directory, yielding file paths.
 * Skips SKIP_DIRS and respects a max file limit.
 */
export function walkFiles(
  dir: string,
  opts: { maxFiles?: number; includeBinary?: boolean } = {},
): string[] {
  const maxFiles = opts.maxFiles ?? 10000;
  const results: string[] = [];

  function walk(d: string) {
    if (results.length >= maxFiles) return;
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return; // permission denied, etc.
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        if (!opts.includeBinary && isBinaryPath(fullPath)) continue;
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Convert a glob pattern to a RegExp.
 * Supports *, **, ?, {a,b}, and [abc].
 */
export function globToRegex(pattern: string): RegExp {
  let regex = "";
  let i = 0;
  const len = pattern.length;

  while (i < len) {
    const ch = pattern[i]!;

    if (ch === "*" && i + 1 < len && pattern[i + 1] === "*") {
      // ** — match across directory boundaries
      if (i + 2 < len && (pattern[i + 2] === "/" || pattern[i + 2] === "\\")) {
        regex += "(?:.+[\\\\/])?";
        i += 3;
      } else {
        regex += ".*";
        i += 2;
      }
    } else if (ch === "*") {
      regex += "[^\\\\/]*";
      i++;
    } else if (ch === "?") {
      regex += "[^\\\\/]";
      i++;
    } else if (ch === "{") {
      const closeIdx = pattern.indexOf("}", i);
      if (closeIdx !== -1) {
        const inner = pattern.slice(i + 1, closeIdx);
        const alts = inner.split(",").map((s) =>
          s.replace(/[.*+?^$|()[\]\\]/g, "\\$&"),
        );
        regex += "(?:" + alts.join("|") + ")";
        i = closeIdx + 1;
      } else {
        regex += "\\{";
        i++;
      }
    } else if (ch === "[") {
      const closeIdx = pattern.indexOf("]", i);
      if (closeIdx !== -1) {
        regex += pattern.slice(i, closeIdx + 1);
        i = closeIdx + 1;
      } else {
        regex += "\\[";
        i++;
      }
    } else if (".+^$|()\\".includes(ch)) {
      regex += "\\" + ch;
      i++;
    } else {
      regex += ch;
      i++;
    }
  }

  const caseInsensitive = process.platform === "win32";
  return new RegExp("^" + regex + "$", caseInsensitive ? "i" : "");
}

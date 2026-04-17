import { existsSync, readFileSync, statSync } from "fs";
import { extname, resolve, isAbsolute } from "path";
import type { ImagePart, TextPart } from "@ai-sdk/provider-utils";

// ─── Supported image extensions ───────────────────────────────────────────────
const IMAGE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg",
]);

const EXT_TO_MEDIA: Record<string, string> = {
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".bmp":  "image/bmp",
  ".svg":  "image/svg+xml",
};

const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

// ─── Image path regex ─────────────────────────────────────────────────────────
// Matches:
//   - Quoted paths: "C:\Users\foo\image.png" or 'C:\path\to\img.jpg'
//   - Unquoted absolute Windows paths: C:\Users\foo\image.png
//   - Unquoted absolute Unix paths: /home/user/image.png
//   - Unquoted relative paths: ./screenshots/bug.png, images/test.jpg
// Must end with a known image extension.
const IMAGE_PATH_RE = new RegExp(
  // Quoted (double or single)
  `(?:` +
    `"([^"]+(?:${[...IMAGE_EXTS].map(e => e.replace(".", "\\.")).join("|")}))"` +
    `|` +
    `'([^']+(?:${[...IMAGE_EXTS].map(e => e.replace(".", "\\.")).join("|")}))'` +
  `)` +
  `|` +
  // Unquoted path (Windows absolute, Unix absolute, or relative with ./ or just a path segment)
  `((?:[A-Za-z]:\\\\|/|\\.\\/|\\.\\.\\/)\\S*(?:${[...IMAGE_EXTS].map(e => e.replace(".", "\\.")).join("|")}))`,
  "gi"
);

export interface ParsedInput {
  /** The text portion of the user's message (image paths removed) */
  text: string;
  /** Parsed image parts ready for the Vercel AI SDK */
  images: ImagePart[];
  /** Original paths that were successfully loaded */
  loadedPaths: string[];
  /** Paths that were detected but failed to load */
  failedPaths: string[];
}

/**
 * Parse user input text, extract image file paths, load them as base64,
 * and return separated text + image parts for the Vercel AI SDK.
 */
export function parseImagesFromInput(input: string): ParsedInput {
  const images: ImagePart[] = [];
  const loadedPaths: string[] = [];
  const failedPaths: string[] = [];

  // Collect all matched image paths with their positions
  const matches: Array<{ start: number; end: number; path: string }> = [];

  let match: RegExpExecArray | null;
  // Reset lastIndex for global regex
  IMAGE_PATH_RE.lastIndex = 0;

  while ((match = IMAGE_PATH_RE.exec(input)) !== null) {
    // match[1] = double-quoted, match[2] = single-quoted, match[3] = unquoted
    const rawPath = match[1] ?? match[2] ?? match[3];
    if (!rawPath) continue;

    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      path: rawPath,
    });
  }

  if (matches.length === 0) {
    return { text: input, images: [], loadedPaths: [], failedPaths: [] };
  }

  // Process each matched path
  for (const m of matches) {
    const result = loadImage(m.path);
    if (result) {
      images.push(result);
      loadedPaths.push(m.path);
    } else {
      failedPaths.push(m.path);
    }
  }

  // Remove image paths from text (replace with empty, then clean up whitespace)
  let text = input;
  // Process matches in reverse order so indices stay valid
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]!;
    text = text.slice(0, m.start) + text.slice(m.end);
  }
  // Clean up resulting whitespace
  text = text.replace(/\s{2,}/g, " ").trim();

  return { text, images, loadedPaths, failedPaths };
}

/**
 * Check if a file path points to a valid, readable image file.
 * Returns an ImagePart or null.
 */
function loadImage(filePath: string): ImagePart | null {
  try {
    // Resolve relative paths against cwd
    const resolved = isAbsolute(filePath)
      ? filePath
      : resolve(process.cwd(), filePath);

    if (!existsSync(resolved)) return null;

    const stat = statSync(resolved);
    if (!stat.isFile()) return null;
    if (stat.size > MAX_IMAGE_SIZE) return null;
    if (stat.size === 0) return null;

    const ext = extname(resolved).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) return null;

    const mediaType = EXT_TO_MEDIA[ext];
    if (!mediaType) return null;

    const data = readFileSync(resolved);
    const base64 = data.toString("base64");

    return {
      type: "image" as const,
      image: base64,
      mediaType,
    };
  } catch {
    return null;
  }
}

/**
 * Build a UserContent array from parsed input.
 * If there are no images, returns just the text string (simpler).
 * If there are images, returns an array of TextPart + ImagePart.
 */
export function buildUserContent(
  parsed: ParsedInput
): string | Array<TextPart | ImagePart> {
  if (parsed.images.length === 0) {
    return parsed.text || "(empty message)";
  }

  const parts: Array<TextPart | ImagePart> = [];

  // Add text part if there's remaining text
  if (parsed.text) {
    parts.push({ type: "text" as const, text: parsed.text });
  }

  // Add all images
  for (const img of parsed.images) {
    parts.push(img);
  }

  // If no text at all, add a default prompt
  if (!parsed.text) {
    parts.unshift({ type: "text" as const, text: "请分析这张图片。" });
  }

  return parts;
}

/**
 * Quick check: does this input contain anything that looks like an image path?
 */
export function mightContainImagePath(input: string): boolean {
  IMAGE_PATH_RE.lastIndex = 0;
  return IMAGE_PATH_RE.test(input);
}

import { tool } from "ai";
import { z } from "zod";

function stripHtml(html: string): string {
  return html
    // Remove script and style blocks entirely
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    // Convert common block elements to newlines
    .replace(/<\/?(p|div|br|hr|h[1-6]|li|tr|blockquote|pre|section|article|header|footer|nav|main)[^>]*>/gi, "\n")
    // Remove remaining tags
    .replace(/<[^>]+>/g, " ")
    // Decode common HTML entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&#\d+;/g, "")
    // Collapse whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const webFetchTool = tool({
  description:
    "Fetch content from a URL and return it as text. HTML pages are automatically " +
    "converted to plain text. Useful for reading documentation, APIs, or checking " +
    "web resources. Response is truncated to 20,000 characters.",
  inputSchema: z.object({
    url: z.string().describe("The URL to fetch"),
  }),
  execute: async ({ url }) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      const response = await fetch(url, {
        headers: {
          "User-Agent": "SharkCode/0.5.0 (AI Coding Agent)",
          Accept: "text/html,application/json,text/plain,*/*",
        },
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return `Error: HTTP ${response.status} ${response.statusText}`;
      }

      const contentType = response.headers.get("content-type") ?? "";
      const text = await response.text();

      if (contentType.includes("html")) {
        const stripped = stripHtml(text);
        return stripped.length > 20_000
          ? stripped.slice(0, 20_000) + "\n\n... (truncated)"
          : stripped;
      }

      return text.length > 20_000
        ? text.slice(0, 20_000) + "\n\n... (truncated)"
        : text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("abort")) return "Error: Request timed out (15s)";
      return `Error fetching URL: ${msg}`;
    }
  },
});

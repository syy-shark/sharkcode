import { tool } from "ai";
import { z } from "zod";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

// Lazy import playwright so missing browsers give a clean error
type Browser = import("playwright").Browser;
type BrowserContext = import("playwright").BrowserContext;
type Page = import("playwright").Page;

// ─── Singleton browser state — persists across tool calls in one session ───────
let _browser: Browser | null = null;
let _context: BrowserContext | null = null;
let _page: Page | null = null;

async function ensurePage(): Promise<Page> {
  if (!_browser || !_browser.isConnected()) {
    let chromium: typeof import("playwright").chromium;
    try {
      ({ chromium } = await import("playwright"));
    } catch {
      throw new Error(
        'playwright package not found. Run: npm install playwright && npx playwright install chromium'
      );
    }
    try {
      _browser = await chromium.launch({
        headless: false,
        args: ["--start-maximized"],
      });
    } catch (err) {
      const msg = String(err);
      if (msg.includes("Executable doesn't exist") || msg.includes("browserType.launch")) {
        throw new Error(
          "Playwright browser binaries not installed. Run: npx playwright install chromium"
        );
      }
      throw err;
    }
    _context = await _browser.newContext({
      viewport: null,  // viewport follows the window size — no fixed constraint
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    _page = await _context.newPage();
  }

  if (!_page || _page.isClosed()) {
    _page = await _context!.newPage();
  }

  return _page;
}

// Auto-close browser when the process exits
process.on("exit", () => {
  _browser?.close().catch(() => {});
});

// ─── Screenshot directory ──────────────────────────────────────────────────────
function getScreenshotDir(): string {
  const dir = join(process.cwd(), ".sharkcode", "screenshots");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Tool ─────────────────────────────────────────────────────────────────────
export const playwrightTool = tool({
  description:
    "Control a visible Chromium browser window for web automation, testing, and scraping. " +
    "The browser opens on screen so the user can watch in real-time. " +
    "Navigate pages, take screenshots, click elements, fill forms, read content, and run JavaScript. " +
    "Browser session persists across calls within a conversation. " +
    "Use this to: test web apps, take screenshots, automate forms, scrape data, verify UI.",
  inputSchema: z.object({
    action: z
      .enum([
        "navigate",
        "screenshot",
        "click",
        "fill",
        "press",
        "get_text",
        "get_html",
        "eval_js",
        "wait_for",
        "go_back",
        "reload",
        "close",
      ])
      .describe(
        "Action to perform: navigate(go to URL), screenshot(save image), click(click element), " +
          "fill(type into input), press(keyboard key), get_text(read text), get_html(read HTML), " +
          "eval_js(run JavaScript), wait_for(wait for element), go_back, reload, close(close browser)"
      ),
    url: z
      .string()
      .optional()
      .describe("URL to navigate to — required for 'navigate' action"),
    selector: z
      .string()
      .optional()
      .describe(
        "CSS selector or text selector like 'text=Submit' — required for click/fill/get_text/wait_for"
      ),
    value: z
      .string()
      .optional()
      .describe("Text to type into an input — required for 'fill' action"),
    key: z
      .string()
      .optional()
      .describe("Keyboard key name e.g. 'Enter', 'Tab', 'Escape' — required for 'press' action"),
    code: z
      .string()
      .optional()
      .describe("JavaScript code to evaluate in page context — required for 'eval_js' action"),
    path: z
      .string()
      .optional()
      .describe(
        "File path to save screenshot. Defaults to .sharkcode/screenshots/<timestamp>.png"
      ),
    timeout: z
      .number()
      .optional()
      .describe("Timeout in milliseconds (default: 30000)"),
    full_page: z
      .boolean()
      .optional()
      .describe("Take full-page screenshot instead of just viewport (default: false)"),
  }),

  execute: async (input) => {
    const { action } = input;
    const timeout = input.timeout ?? 30_000;

    try {
      // close action — doesn't need an open page
      if (action === "close") {
        if (_browser) {
          await _browser.close();
          _browser = null;
          _context = null;
          _page = null;
        }
        return "Browser closed.";
      }

      const pg = await ensurePage();

      switch (action) {
        case "navigate": {
          if (!input.url) return "Error: 'url' is required for navigate action";
          await pg.goto(input.url, { timeout, waitUntil: "load" });
          // Also wait briefly for any post-load JS
          await pg.waitForLoadState("domcontentloaded").catch(() => {});
          const title = await pg.title();
          const url = pg.url();
          return `Navigated to: ${url}\nPage title: ${title}`;
        }

        case "screenshot": {
          const ts = Date.now();
          const screenshotPath =
            input.path ?? join(getScreenshotDir(), `screenshot-${ts}.png`);
          await pg.screenshot({
            path: screenshotPath,
            fullPage: input.full_page ?? false,
          });
          const title = await pg.title();
          const url = pg.url();
          return `Screenshot saved: ${screenshotPath}\nPage: "${title}"\nURL: ${url}`;
        }

        case "click": {
          if (!input.selector) return "Error: 'selector' is required for click action";
          await pg.click(input.selector, { timeout });
          await pg.waitForTimeout(500);
          const url = pg.url();
          return `Clicked: ${input.selector}\nCurrent URL: ${url}`;
        }

        case "fill": {
          if (!input.selector) return "Error: 'selector' is required for fill action";
          if (input.value === undefined) return "Error: 'value' is required for fill action";
          await pg.fill(input.selector, input.value, { timeout });
          return `Filled "${input.selector}" with "${input.value}"`;
        }

        case "press": {
          if (!input.key) return "Error: 'key' is required for press action";
          if (input.selector) {
            await pg.press(input.selector, input.key, { timeout });
          } else {
            await pg.keyboard.press(input.key);
          }
          await pg.waitForTimeout(300);
          return `Pressed key: ${input.key}`;
        }

        case "get_text": {
          if (input.selector) {
            const text = await pg.textContent(input.selector, { timeout });
            return text?.trim() ?? "(empty)";
          }
          // biome-ignore lint: DOM types not in lib — safe inside evaluate()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const bodyText = await pg.evaluate(() => (globalThis as any).document.body.innerText);
          return String(bodyText).slice(0, 8_000);
        }

        case "get_html": {
          if (input.selector) {
            const html = await pg.innerHTML(input.selector, { timeout });
            return html.slice(0, 8_000);
          }
          const html = await pg.content();
          return html.slice(0, 8_000);
        }

        case "eval_js": {
          if (!input.code) return "Error: 'code' is required for eval_js action";
          const result = await pg.evaluate(input.code);
          return result !== undefined ? JSON.stringify(result, null, 2) : "undefined";
        }

        case "wait_for": {
          if (!input.selector) return "Error: 'selector' is required for wait_for action";
          await pg.waitForSelector(input.selector, { timeout });
          return `Element visible: ${input.selector}`;
        }

        case "go_back": {
          await pg.goBack({ timeout });
          const title = await pg.title();
          return `Navigated back to: ${pg.url()}\nPage title: ${title}`;
        }

        case "reload": {
          await pg.reload({ timeout, waitUntil: "load" });
          const title = await pg.title();
          return `Reloaded: ${pg.url()}\nPage title: ${title}`;
        }

        default:
          return `Unknown action: ${action}`;
      }
    } catch (err) {
      return `Playwright error [${action}]: ${String(err)}`;
    }
  },
});

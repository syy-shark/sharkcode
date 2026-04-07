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

// ─── Ref resolution ────────────────────────────────────────────────────────────
// Refs are injected as data-shark-ref attributes in the DOM by snapshot.
// This resolves a ref like "e5" or "@e5" to a CSS selector.
function resolveTarget(input: { ref?: string; selector?: string }): string | null {
  if (input.ref) {
    const ref = input.ref.replace(/^@/, "");
    return `[data-shark-ref="${ref}"]`;
  }
  return input.selector || null;
}

// ─── Snapshot: browser-side page analysis ──────────────────────────────────────
// This function runs INSIDE the browser via page.evaluate().
// It walks the DOM, finds interactive elements, assigns refs, and returns metadata.
const SNAPSHOT_SCRIPT = `() => {
  // Remove old refs from previous snapshot
  document.querySelectorAll('[data-shark-ref]').forEach(el =>
    el.removeAttribute('data-shark-ref')
  );

  let refCounter = 0;
  const MAX_ELEMENTS = 100;

  // Determine ARIA role from tag/attributes
  function getRole(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    switch (tag) {
      case 'a': return el.hasAttribute('href') ? 'link' : 'generic';
      case 'button': return 'button';
      case 'input':
        switch (type) {
          case 'button': case 'submit': case 'reset': case 'image': return 'button';
          case 'checkbox': return 'checkbox';
          case 'radio': return 'radio';
          case 'range': return 'slider';
          case 'search': return 'searchbox';
          case 'file': return 'file';
          default: return 'textbox';
        }
      case 'select': return 'combobox';
      case 'textarea': return 'textbox';
      case 'summary': return 'disclosure';
      case 'img': return 'img';
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
      default: return tag;
    }
  }

  // Get accessible name of an element
  function getName(el) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.slice(0, 80);

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ref = document.getElementById(labelledBy);
      if (ref) return (ref.textContent || '').trim().slice(0, 80);
    }

    // <label for="id">
    if (el.id) {
      const label = document.querySelector('label[for="' + el.id + '"]');
      if (label) return (label.textContent || '').trim().slice(0, 80);
    }

    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      return el.placeholder || el.value || '';
    }
    if (tag === 'select') {
      const selected = el.options[el.selectedIndex];
      return selected ? selected.text.slice(0, 80) : '';
    }
    if (tag === 'img') return (el.alt || '').slice(0, 80);

    // Buttons, links: use text content
    const text = (el.textContent || '').trim().replace(/\\s+/g, ' ');
    return text.slice(0, 80);
  }

  // Check visibility
  function isVisible(el) {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.hidden) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // Check if element is interactive
  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (['a', 'button', 'input', 'select', 'textarea', 'summary'].includes(tag)) {
      // <a> without href is not interactive
      if (tag === 'a' && !el.hasAttribute('href')) return false;
      return true;
    }
    const role = el.getAttribute('role') || '';
    if (['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
         'menuitem', 'tab', 'switch', 'slider', 'option', 'searchbox',
         'spinbutton', 'treeitem'].includes(role)) return true;
    // Elements with click handlers or tabindex
    if (el.hasAttribute('onclick') || el.hasAttribute('tabindex')) return true;
    // Elements with cursor: pointer style (custom clickable)
    const style = window.getComputedStyle(el);
    if (style.cursor === 'pointer' && !['html', 'body'].includes(tag)) {
      // Only if it has text content and isn't a container wrapping real interactives
      if (el.children.length === 0 || el.textContent.trim().length < 100) return true;
    }
    return false;
  }

  // Get nearest landmark ancestor
  function getLandmark(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      const role = cur.getAttribute('role') || '';
      const tag = cur.tagName.toLowerCase();
      if (role === 'banner' || tag === 'header') return 'header';
      if (role === 'navigation' || tag === 'nav') return 'nav';
      if (role === 'main' || tag === 'main') return 'main';
      if (role === 'contentinfo' || tag === 'footer') return 'footer';
      if (role === 'complementary' || tag === 'aside') return 'aside';
      if (role === 'search') return 'search';
      if (tag === 'form') {
        const formName = cur.getAttribute('aria-label') || cur.getAttribute('name') || '';
        return formName ? 'form: ' + formName : 'form';
      }
      if (role === 'dialog' || tag === 'dialog') return 'dialog';
      cur = cur.parentElement;
    }
    return 'page';
  }

  // Walk the DOM and collect interactive elements
  const elements = [];
  let totalInteractive = 0;

  function walk(el) {
    if (totalInteractive >= MAX_ELEMENTS) return;

    if (isInteractive(el) && isVisible(el)) {
      totalInteractive++;
      refCounter++;
      const ref = 'e' + refCounter;
      el.setAttribute('data-shark-ref', ref);

      const info = {
        ref: ref,
        role: getRole(el),
        name: getName(el),
        landmark: getLandmark(el),
      };

      // Extra metadata for form controls
      const tag = el.tagName.toLowerCase();
      if (tag === 'input') {
        const type = (el.type || 'text').toLowerCase();
        if (type !== 'text') info.type = type;
        if (el.placeholder) info.placeholder = el.placeholder;
        if (el.checked) info.checked = true;
        if (el.disabled) info.disabled = true;
      }
      if (tag === 'textarea' && el.placeholder) {
        info.placeholder = el.placeholder;
      }
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
        info.disabled = true;
      }

      elements.push(info);
    }

    for (let i = 0; i < el.children.length; i++) {
      walk(el.children[i]);
    }
  }

  walk(document.body);

  // Count total interactive elements (might exceed MAX_ELEMENTS)
  if (totalInteractive >= MAX_ELEMENTS) {
    // Do a quick count of remaining
    function countRemaining(el) {
      if (isInteractive(el) && isVisible(el)) totalInteractive++;
      for (let i = 0; i < el.children.length; i++) countRemaining(el.children[i]);
    }
    // Skip — just note it was capped
  }

  return { elements: elements, total: totalInteractive, capped: totalInteractive >= MAX_ELEMENTS };
}`;

// ─── Tool ─────────────────────────────────────────────────────────────────────
export const playwrightTool = tool({
  description:
    "Control a visible Chromium browser. WORKFLOW: 1) navigate to URL, 2) snapshot to see interactive elements with refs, " +
    "3) interact using refs (@e1, @e2...). Always snapshot before clicking — never guess selectors. " +
    "Actions: snapshot, navigate, screenshot, click, fill, press, get_text, get_html, eval_js, wait_for, go_back, reload, close.",
  inputSchema: z.object({
    action: z
      .enum([
        "snapshot",
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
        "Action: snapshot(see page elements with refs), navigate(go to URL), screenshot(save image), " +
        "click(click ref or selector), fill(type into ref or selector), press(key), " +
        "get_text(read text), get_html(read HTML), eval_js(run JS), wait_for(wait for element), " +
        "go_back, reload, close"
      ),
    url: z
      .string()
      .optional()
      .describe("URL to navigate to — required for 'navigate' action"),
    ref: z
      .string()
      .optional()
      .describe(
        "Element ref from snapshot, e.g. 'e1' or '@e1'. Use this instead of selector — it's more reliable. " +
        "Get refs by calling snapshot first."
      ),
    selector: z
      .string()
      .optional()
      .describe(
        "CSS selector or text selector like 'text=Submit'. Prefer using ref from snapshot instead."
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
        // ─── SNAPSHOT: the key to smart browsing ─────────────────────────
        case "snapshot": {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data: any = await pg.evaluate(SNAPSHOT_SCRIPT);
          const title = await pg.title();
          const url = pg.url();

          if (!data.elements || data.elements.length === 0) {
            return `[Page] ${title}\n[URL] ${url}\n\nNo interactive elements found. The page may still be loading — try wait_for or reload.`;
          }

          // Group elements by landmark
          const groups = new Map<string, typeof data.elements>();
          for (const el of data.elements) {
            const lm = el.landmark || "page";
            if (!groups.has(lm)) groups.set(lm, []);
            groups.get(lm)!.push(el);
          }

          let output = `[Page] ${title}\n[URL]  ${url}\n`;

          for (const [landmark, elements] of groups) {
            output += `\n── ${landmark} ──\n`;
            for (const el of elements) {
              let line = `  @${el.ref}  ${el.role.padEnd(10)}  "${el.name}"`;
              const attrs: string[] = [];
              if (el.type) attrs.push(`type=${el.type}`);
              if (el.placeholder) attrs.push(`placeholder="${el.placeholder}"`);
              if (el.checked) attrs.push("checked");
              if (el.disabled) attrs.push("disabled");
              if (attrs.length) line += `  [${attrs.join(", ")}]`;
              output += line + "\n";
            }
          }

          if (data.capped) {
            output += `\n⚠ Showing first ${data.elements.length} of ${data.total}+ interactive elements.`;
          }

          output += `\n\nUse @ref to interact: click ref=@e1, fill ref=@e2 value="text"`;
          output += `\nAfter navigation or major page changes, take a new snapshot.`;

          return output;
        }

        // ─── NAVIGATE ────────────────────────────────────────────────────
        case "navigate": {
          if (!input.url) return "Error: 'url' is required for navigate action";
          await pg.goto(input.url, { timeout, waitUntil: "load" });
          await pg.waitForLoadState("domcontentloaded").catch(() => {});
          const title = await pg.title();
          const url = pg.url();
          return `Navigated to: ${url}\nPage title: ${title}\n\n→ Use snapshot to see interactive elements on this page.`;
        }

        // ─── SCREENSHOT ──────────────────────────────────────────────────
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

        // ─── CLICK ───────────────────────────────────────────────────────
        case "click": {
          const target = resolveTarget(input);
          if (!target) return "Error: 'ref' or 'selector' is required for click action. Use snapshot first to get refs.";
          try {
            await pg.click(target, { timeout });
          } catch (err) {
            const msg = String(err);
            if (input.ref && (msg.includes("not found") || msg.includes("No element") || msg.includes("waiting for"))) {
              return `Error: ref @${input.ref.replace(/^@/, "")} not found on page. The page may have changed — take a new snapshot.`;
            }
            throw err;
          }
          await pg.waitForTimeout(500);
          const url = pg.url();
          const display = input.ref ? `@${input.ref.replace(/^@/, "")}` : input.selector;
          return `Clicked: ${display}\nCurrent URL: ${url}`;
        }

        // ─── FILL ────────────────────────────────────────────────────────
        case "fill": {
          const target = resolveTarget(input);
          if (!target) return "Error: 'ref' or 'selector' is required for fill action. Use snapshot first to get refs.";
          if (input.value === undefined) return "Error: 'value' is required for fill action";
          try {
            await pg.fill(target, input.value, { timeout });
          } catch (err) {
            const msg = String(err);
            if (input.ref && (msg.includes("not found") || msg.includes("No element") || msg.includes("waiting for"))) {
              return `Error: ref @${input.ref.replace(/^@/, "")} not found on page. The page may have changed — take a new snapshot.`;
            }
            throw err;
          }
          const display = input.ref ? `@${input.ref.replace(/^@/, "")}` : input.selector;
          return `Filled ${display} with "${input.value}"`;
        }

        // ─── PRESS ───────────────────────────────────────────────────────
        case "press": {
          if (!input.key) return "Error: 'key' is required for press action";
          const target = resolveTarget(input);
          if (target) {
            await pg.press(target, input.key, { timeout });
          } else {
            await pg.keyboard.press(input.key);
          }
          await pg.waitForTimeout(300);
          return `Pressed key: ${input.key}`;
        }

        // ─── GET_TEXT ────────────────────────────────────────────────────
        case "get_text": {
          const target = resolveTarget(input);
          if (target) {
            const text = await pg.textContent(target, { timeout });
            return text?.trim() ?? "(empty)";
          }
          // Full page text
          // biome-ignore lint: DOM types not in lib
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const bodyText = await pg.evaluate(() => (globalThis as any).document.body.innerText);
          return String(bodyText).slice(0, 8_000);
        }

        // ─── GET_HTML ────────────────────────────────────────────────────
        case "get_html": {
          const target = resolveTarget(input);
          if (target) {
            const html = await pg.innerHTML(target, { timeout });
            return html.slice(0, 8_000);
          }
          const html = await pg.content();
          return html.slice(0, 8_000);
        }

        // ─── EVAL_JS ─────────────────────────────────────────────────────
        case "eval_js": {
          if (!input.code) return "Error: 'code' is required for eval_js action";
          const result = await pg.evaluate(input.code);
          return result !== undefined ? JSON.stringify(result, null, 2) : "undefined";
        }

        // ─── WAIT_FOR ────────────────────────────────────────────────────
        case "wait_for": {
          const target = resolveTarget(input);
          if (!target) return "Error: 'ref' or 'selector' is required for wait_for action";
          await pg.waitForSelector(target, { timeout });
          return `Element visible: ${input.ref ? `@${input.ref.replace(/^@/, "")}` : input.selector}`;
        }

        // ─── GO_BACK ─────────────────────────────────────────────────────
        case "go_back": {
          await pg.goBack({ timeout });
          const title = await pg.title();
          return `Navigated back to: ${pg.url()}\nPage title: ${title}\n\n→ Take a new snapshot to see current page elements.`;
        }

        // ─── RELOAD ──────────────────────────────────────────────────────
        case "reload": {
          await pg.reload({ timeout, waitUntil: "load" });
          const title = await pg.title();
          return `Reloaded: ${pg.url()}\nPage title: ${title}\n\n→ Take a new snapshot to see current page elements.`;
        }

        default:
          return `Unknown action: ${action}`;
      }
    } catch (err) {
      return `Playwright error [${action}]: ${String(err)}`;
    }
  },
});

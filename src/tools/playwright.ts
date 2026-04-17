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

// ─── Stealth init script — injected into every page before any JS runs ─────────
// Erases all Playwright/Chromium automation fingerprints that bot-detection
// services (Cloudflare, Akamai, DataDome, Kasada, PerimeterX…) check.
const STEALTH_INIT_SCRIPT = `
(function () {
  // 1. Remove the navigator.webdriver flag — the single most-checked signal
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });

  // 2. Spoof navigator.plugins (real Chrome has several)
  const makeFakePlugin = (name, filename, description, mimeTypes) => {
    const plugin = Object.create(Plugin.prototype);
    Object.defineProperties(plugin, {
      name:        { value: name,        enumerable: true },
      filename:    { value: filename,    enumerable: true },
      description: { value: description, enumerable: true },
      length:      { value: mimeTypes.length, enumerable: true },
    });
    mimeTypes.forEach((mt, i) => { plugin[i] = mt; });
    return plugin;
  };
  const fakePlugins = [
    makeFakePlugin('Chrome PDF Plugin',  'internal-pdf-viewer', 'Portable Document Format', []),
    makeFakePlugin('Chrome PDF Viewer',  'mhjfbmdgcfjbbpaeojofohoefgiehjai', '', []),
    makeFakePlugin('Native Client',      'internal-nacl-plugin', '', []),
  ];
  const fakePluginArray = Object.create(PluginArray.prototype);
  fakePlugins.forEach((p, i) => { fakePluginArray[i] = p; });
  Object.defineProperty(fakePluginArray, 'length', { value: fakePlugins.length });
  Object.defineProperty(navigator, 'plugins', { get: () => fakePluginArray, configurable: true });

  // 3. Spoof navigator.languages
  Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en-US', 'en'], configurable: true });

  // 4. Inject window.chrome (absent in headless Chromium)
  if (!window.chrome) {
    const chrome = {
      app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
      runtime: {
        OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
        PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
        RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
      },
      loadTimes: () => ({}),
      csi: () => ({}),
    };
    try { Object.defineProperty(window, 'chrome', { value: chrome, writable: true, configurable: true }); } catch {}
  }

  // 5. Fix navigator.permissions.query so it doesn't reveal automation
  try {
    const origQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (params) =>
      (params.name === 'notifications')
        ? Promise.resolve({ state: Notification.permission, onchange: null })
        : origQuery(params);
  } catch {}

  // 6. Hide that Function.prototype.toString can expose native code overrides
  const _nativeToString = Function.prototype.toString;
  Function.prototype.toString = function () {
    if (this === navigator.permissions.query) return 'function query() { [native code] }';
    return _nativeToString.call(this);
  };

  // 7. Spoof screen resolution (some fingerprinters check window vs screen)
  try {
    Object.defineProperty(screen, 'availWidth',  { get: () => window.screen.width });
    Object.defineProperty(screen, 'availHeight', { get: () => window.screen.height });
  } catch {}

  // 8. Mask headless UA cues — ensure proper mediaSession, connection etc. exist
  if (!navigator.mediaSession) {
    try { Object.defineProperty(navigator, 'mediaSession', { value: { metadata: null, playbackState: 'none' } }); } catch {}
  }
})();
`;

// ─── Human-behaviour helpers ────────────────────────────────────────────────────

function rand(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

async function sleep(pg: Page, min: number, max: number = min): Promise<void> {
  await pg.waitForTimeout(rand(min, max));
}

/**
 * Move the mouse to the element from a nearby random start point,
 * then click at a random position within the element's bounding box.
 * Mimics natural cursor approach + imprecise targeting.
 */
async function humanClick(pg: Page, target: string, timeout: number): Promise<void> {
  const loc = pg.locator(target).first();
  await loc.scrollIntoViewIfNeeded({ timeout });
  await sleep(pg, 80, 220);

  const box = await loc.boundingBox();
  if (box && box.width > 8 && box.height > 8) {
    const margin = Math.min(5, box.width * 0.15, box.height * 0.15);
    const tx = box.x + margin + Math.random() * Math.max(1, box.width  - margin * 2);
    const ty = box.y + margin + Math.random() * Math.max(1, box.height - margin * 2);

    // Approach from a slightly off-target start
    const sx = tx + (Math.random() - 0.5) * 120;
    const sy = ty + (Math.random() - 0.5) * 80;

    await pg.mouse.move(sx, sy);
    await sleep(pg, 30, 90);
    await pg.mouse.move(tx, ty, { steps: rand(4, 10) });
    await sleep(pg, 40, 130);
    await pg.mouse.click(tx, ty, {
      button: "left",
      delay: rand(40, 120),  // human hold-down time
    });
  } else {
    // Fallback: element is tiny or off-screen, use locator click
    await loc.click({ timeout, delay: rand(40, 100) });
  }
}

/**
 * Click to focus the field, select-all to clear it, then type the value
 * character-by-character with randomised per-keystroke delays.
 * Far harder to distinguish from real typing than `page.fill()`.
 */
async function humanFill(pg: Page, target: string, value: string, timeout: number): Promise<void> {
  const loc = pg.locator(target).first();
  await loc.scrollIntoViewIfNeeded({ timeout });
  await sleep(pg, 50, 150);

  await humanClick(pg, target, timeout);
  await sleep(pg, 100, 250);

  // Select all existing text and delete it
  await pg.keyboard.press("Control+a");
  await sleep(pg, 30, 80);
  await pg.keyboard.press("Delete");
  await sleep(pg, 40, 100);

  // Type each character with a random delay (simulates ~120–200 WPM variance)
  for (const char of value) {
    await pg.keyboard.type(char, { delay: 0 });
    await sleep(pg, 28, 115);
    // Occasional short pause (as if pausing to think)
    if (Math.random() < 0.08) await sleep(pg, 200, 500);
  }
}

async function ensurePage(): Promise<Page> {
  if (!_browser || !_browser.isConnected()) {
    let chromium: typeof import("playwright").chromium;
    try {
      ({ chromium } = await import("playwright"));
    } catch {
      throw new Error(
        "playwright package not found. Run: npm install playwright && npx playwright install chromium"
      );
    }
    try {
      _browser = await chromium.launch({
        headless: false,
        args: [
          "--start-maximized",
          // ── Anti-detection flags ──────────────────────────────────────────────
          "--disable-blink-features=AutomationControlled",  // removes the "Chrome is being controlled" bar
          "--no-sandbox",
          "--disable-infobars",
          "--disable-dev-shm-usage",
          "--disable-background-timer-throttling",
          "--disable-popup-blocking",
          "--disable-prompt-on-repost",
          "--disable-renderer-backgrounding",
          "--disable-hang-monitor",
          "--no-first-run",
          "--no-default-browser-check",
          // ── Exclude automation switches Chromium adds by default ──────────────
          "--exclude-switches=enable-automation",
          "--disable-automation",
          // ── Timezone / locale consistency ──────────────────────────────────────
          "--lang=zh-CN",
        ],
        // Let Playwright pass its automation switches but override the flag
        ignoreDefaultArgs: ["--enable-automation"],
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
      viewport: null,  // follows window size
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      // Extra HTTP headers that real Chrome sends
      extraHTTPHeaders: {
        "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
      },
    });

    // Inject stealth script before ANY page JS runs
    await _context.addInitScript(STEALTH_INIT_SCRIPT);

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
function resolveTarget(input: { ref?: string; selector?: string }): string | null {
  if (input.ref) {
    const ref = input.ref.replace(/^@/, "");
    return `[data-shark-ref="${ref}"]`;
  }
  return input.selector || null;
}

// ─── Snapshot: browser-side page analysis ──────────────────────────────────────
const SNAPSHOT_SCRIPT = `() => {
  document.querySelectorAll('[data-shark-ref]').forEach(el =>
    el.removeAttribute('data-shark-ref')
  );

  let refCounter = 0;
  const MAX_ELEMENTS = 100;

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

  function getName(el) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.slice(0, 80);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ref = document.getElementById(labelledBy);
      if (ref) return (ref.textContent || '').trim().slice(0, 80);
    }
    if (el.id) {
      const label = document.querySelector('label[for="' + el.id + '"]');
      if (label) return (label.textContent || '').trim().slice(0, 80);
    }
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return el.placeholder || el.value || '';
    if (tag === 'select') {
      const selected = el.options[el.selectedIndex];
      return selected ? selected.text.slice(0, 80) : '';
    }
    if (tag === 'img') return (el.alt || '').slice(0, 80);
    const text = (el.textContent || '').trim().replace(/\\s+/g, ' ');
    return text.slice(0, 80);
  }

  function isVisible(el) {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.hidden) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (['a', 'button', 'input', 'select', 'textarea', 'summary'].includes(tag)) {
      if (tag === 'a' && !el.hasAttribute('href')) return false;
      return true;
    }
    const role = el.getAttribute('role') || '';
    if (['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
         'menuitem', 'tab', 'switch', 'slider', 'option', 'searchbox',
         'spinbutton', 'treeitem'].includes(role)) return true;
    if (el.hasAttribute('onclick') || el.hasAttribute('tabindex')) return true;
    const style = window.getComputedStyle(el);
    if (style.cursor === 'pointer' && !['html', 'body'].includes(tag)) {
      if (el.children.length === 0 || el.textContent.trim().length < 100) return true;
    }
    return false;
  }

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

  const elements = [];
  let totalInteractive = 0;

  function walk(el) {
    if (totalInteractive >= MAX_ELEMENTS) return;
    if (isInteractive(el) && isVisible(el)) {
      totalInteractive++;
      refCounter++;
      const ref = 'e' + refCounter;
      el.setAttribute('data-shark-ref', ref);
      const info = { ref, role: getRole(el), name: getName(el), landmark: getLandmark(el) };
      const tag = el.tagName.toLowerCase();
      if (tag === 'input') {
        const type = (el.type || 'text').toLowerCase();
        if (type !== 'text') info.type = type;
        if (el.placeholder) info.placeholder = el.placeholder;
        if (el.checked) info.checked = true;
        if (el.disabled) info.disabled = true;
      }
      if (tag === 'textarea' && el.placeholder) info.placeholder = el.placeholder;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') info.disabled = true;
      elements.push(info);
    }
    for (let i = 0; i < el.children.length; i++) walk(el.children[i]);
  }

  walk(document.body);
  return { elements, total: totalInteractive, capped: totalInteractive >= MAX_ELEMENTS };
}`;

// ─── Tool ─────────────────────────────────────────────────────────────────────
export const playwrightTool = tool({
  description:
    "Control a visible Chromium browser with human-like interactions (randomised mouse paths, " +
    "character-by-character typing, natural delays) to avoid bot detection. " +
    "WORKFLOW: 1) navigate to URL, 2) snapshot to see interactive elements with refs, " +
    "3) interact using refs (@e1, @e2…). Always snapshot before clicking — never guess selectors. " +
    "Actions: snapshot, navigate, screenshot, click, fill, press, scroll, hover, " +
    "get_text, get_html, eval_js, wait_for, go_back, reload, close.",
  inputSchema: z.object({
    action: z
      .enum([
        "snapshot",
        "navigate",
        "screenshot",
        "click",
        "fill",
        "press",
        "scroll",
        "hover",
        "get_text",
        "get_html",
        "eval_js",
        "wait_for",
        "go_back",
        "reload",
        "close",
      ])
      .describe(
        "Action to perform. snapshot: see page elements+refs. navigate: go to URL. " +
        "click/fill/press: interact with element. scroll: scroll page or element. " +
        "hover: move mouse over element. get_text/get_html: read content. " +
        "eval_js: run JS. wait_for: wait for element. go_back/reload/close: navigation."
      ),
    url: z.string().optional().describe("URL to navigate to (required for navigate)"),
    ref: z
      .string()
      .optional()
      .describe("Element ref from snapshot, e.g. 'e1' or '@e1'. Prefer over selector."),
    selector: z
      .string()
      .optional()
      .describe("CSS selector fallback, e.g. 'button[type=submit]'. Use ref when possible."),
    value: z.string().optional().describe("Text to type (required for fill)"),
    key: z
      .string()
      .optional()
      .describe("Keyboard key, e.g. 'Enter', 'Tab', 'Escape' (required for press)"),
    code: z.string().optional().describe("JavaScript to evaluate (required for eval_js)"),
    path: z.string().optional().describe("Screenshot save path (default: .sharkcode/screenshots/)"),
    timeout: z.number().optional().describe("Timeout in ms (default: 30000)"),
    full_page: z.boolean().optional().describe("Full-page screenshot (default: false)"),
    direction: z
      .enum(["up", "down", "left", "right"])
      .optional()
      .describe("Scroll direction (default: down)"),
    distance: z.number().optional().describe("Scroll distance in pixels (default: 500)"),
  }),

  execute: async (input) => {
    const { action } = input;
    const timeout = input.timeout ?? 30_000;

    try {
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
        // ─── SNAPSHOT ──────────────────────────────────────────────────────
        case "snapshot": {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data: any = await pg.evaluate(SNAPSHOT_SCRIPT);
          const title = await pg.title();
          const url = pg.url();

          if (!data.elements || data.elements.length === 0) {
            return `[Page] ${title}\n[URL] ${url}\n\nNo interactive elements found. The page may still be loading — try wait_for or reload.`;
          }

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

        // ─── NAVIGATE ──────────────────────────────────────────────────────
        case "navigate": {
          if (!input.url) return "Error: 'url' is required for navigate action";
          await pg.goto(input.url, { timeout, waitUntil: "load" });
          await pg.waitForLoadState("domcontentloaded").catch(() => {});
          // Brief human-like pause after page load
          await sleep(pg, 400, 900);
          const title = await pg.title();
          const url = pg.url();
          return `Navigated to: ${url}\nPage title: ${title}\n\n→ Use snapshot to see interactive elements on this page.`;
        }

        // ─── SCREENSHOT ────────────────────────────────────────────────────
        case "screenshot": {
          const ts = Date.now();
          const screenshotPath = input.path ?? join(getScreenshotDir(), `screenshot-${ts}.png`);
          await pg.screenshot({ path: screenshotPath, fullPage: input.full_page ?? false });
          const title = await pg.title();
          return `Screenshot saved: ${screenshotPath}\nPage: "${title}"\nURL: ${pg.url()}`;
        }

        // ─── CLICK (human-like) ────────────────────────────────────────────
        case "click": {
          const target = resolveTarget(input);
          if (!target)
            return "Error: 'ref' or 'selector' is required for click. Use snapshot first to get refs.";
          try {
            await humanClick(pg, target, timeout);
          } catch (err) {
            const msg = String(err);
            if (
              input.ref &&
              (msg.includes("not found") ||
                msg.includes("No element") ||
                msg.includes("waiting for"))
            ) {
              return `Error: ref @${input.ref.replace(/^@/, "")} not found. Page may have changed — take a new snapshot.`;
            }
            throw err;
          }
          await sleep(pg, 300, 700);
          const display = input.ref ? `@${input.ref.replace(/^@/, "")}` : input.selector;
          return `Clicked: ${display}\nCurrent URL: ${pg.url()}`;
        }

        // ─── FILL (character-by-character) ─────────────────────────────────
        case "fill": {
          const target = resolveTarget(input);
          if (!target)
            return "Error: 'ref' or 'selector' is required for fill. Use snapshot first to get refs.";
          if (input.value === undefined) return "Error: 'value' is required for fill action";
          try {
            await humanFill(pg, target, input.value, timeout);
          } catch (err) {
            const msg = String(err);
            if (
              input.ref &&
              (msg.includes("not found") ||
                msg.includes("No element") ||
                msg.includes("waiting for"))
            ) {
              return `Error: ref @${input.ref.replace(/^@/, "")} not found. Page may have changed — take a new snapshot.`;
            }
            throw err;
          }
          const display = input.ref ? `@${input.ref.replace(/^@/, "")}` : input.selector;
          return `Filled ${display} with "${input.value}"`;
        }

        // ─── PRESS ─────────────────────────────────────────────────────────
        case "press": {
          if (!input.key) return "Error: 'key' is required for press action";
          const target = resolveTarget(input);
          await sleep(pg, 50, 150);
          if (target) {
            await pg.press(target, input.key, { timeout, delay: rand(40, 100) });
          } else {
            await pg.keyboard.press(input.key, { delay: rand(40, 100) });
          }
          await sleep(pg, 200, 500);
          return `Pressed key: ${input.key}`;
        }

        // ─── SCROLL (human-like) ───────────────────────────────────────────
        case "scroll": {
          const dir = input.direction ?? "down";
          const dist = input.distance ?? 500;
          const target = resolveTarget(input);
          const steps = rand(4, 10);
          const stepDist = Math.round(dist / steps);

          if (target) {
            const box = await pg.locator(target).first().boundingBox();
            if (box) {
              const cx = box.x + box.width / 2;
              const cy = box.y + box.height / 2;
              await pg.mouse.move(cx, cy);
              for (let i = 0; i < steps; i++) {
                await pg.mouse.wheel(
                  dir === "left" ? -stepDist : dir === "right" ? stepDist : 0,
                  dir === "up"   ? -stepDist : dir === "down"  ? stepDist : 0
                );
                await sleep(pg, 30, 80);
              }
            }
          } else {
            for (let i = 0; i < steps; i++) {
              await pg.mouse.wheel(
                dir === "left" ? -stepDist : dir === "right" ? stepDist : 0,
                dir === "up"   ? -stepDist : dir === "down"  ? stepDist : 0
              );
              await sleep(pg, 30, 80);
            }
          }
          await sleep(pg, 200, 400);
          return `Scrolled ${dir} ${dist}px`;
        }

        // ─── HOVER ─────────────────────────────────────────────────────────
        case "hover": {
          const target = resolveTarget(input);
          if (!target)
            return "Error: 'ref' or 'selector' is required for hover. Use snapshot first to get refs.";
          const loc = pg.locator(target).first();
          await loc.scrollIntoViewIfNeeded({ timeout });
          const box = await loc.boundingBox();
          if (box) {
            const tx = box.x + box.width  / 2 + (Math.random() - 0.5) * 10;
            const ty = box.y + box.height / 2 + (Math.random() - 0.5) * 8;
            await pg.mouse.move(tx + (Math.random() - 0.5) * 60, ty + (Math.random() - 0.5) * 40);
            await sleep(pg, 40, 100);
            await pg.mouse.move(tx, ty, { steps: rand(3, 7) });
          } else {
            await loc.hover({ timeout });
          }
          await sleep(pg, 200, 600);
          const display = input.ref ? `@${input.ref.replace(/^@/, "")}` : input.selector;
          return `Hovered over: ${display}`;
        }

        // ─── GET_TEXT ──────────────────────────────────────────────────────
        case "get_text": {
          const target = resolveTarget(input);
          if (target) {
            const text = await pg.textContent(target, { timeout });
            return text?.trim() ?? "(empty)";
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const bodyText = await pg.evaluate(() => (globalThis as any).document.body.innerText);
          return String(bodyText).slice(0, 8_000);
        }

        // ─── GET_HTML ──────────────────────────────────────────────────────
        case "get_html": {
          const target = resolveTarget(input);
          if (target) return (await pg.innerHTML(target, { timeout })).slice(0, 8_000);
          return (await pg.content()).slice(0, 8_000);
        }

        // ─── EVAL_JS ───────────────────────────────────────────────────────
        case "eval_js": {
          if (!input.code) return "Error: 'code' is required for eval_js action";
          const result = await pg.evaluate(input.code);
          return result !== undefined ? JSON.stringify(result, null, 2) : "undefined";
        }

        // ─── WAIT_FOR ──────────────────────────────────────────────────────
        case "wait_for": {
          const target = resolveTarget(input);
          if (!target) return "Error: 'ref' or 'selector' is required for wait_for action";
          await pg.waitForSelector(target, { timeout });
          return `Element visible: ${input.ref ? `@${input.ref.replace(/^@/, "")}` : input.selector}`;
        }

        // ─── GO_BACK ───────────────────────────────────────────────────────
        case "go_back": {
          await pg.goBack({ timeout });
          await sleep(pg, 300, 700);
          return `Navigated back to: ${pg.url()}\nPage title: ${await pg.title()}\n\n→ Take a new snapshot.`;
        }

        // ─── RELOAD ────────────────────────────────────────────────────────
        case "reload": {
          await pg.reload({ timeout, waitUntil: "load" });
          await sleep(pg, 400, 800);
          return `Reloaded: ${pg.url()}\nPage title: ${await pg.title()}\n\n→ Take a new snapshot.`;
        }

        default:
          return `Unknown action: ${action}`;
      }
    } catch (err) {
      return `Playwright error [${action}]: ${String(err)}`;
    }
  },
});

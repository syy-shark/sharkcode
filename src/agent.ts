import { stepCountIs, streamText, type ModelMessage } from "ai";
import chalk from "chalk";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { tools } from "./tools/index.ts";
import { createProvider } from "./provider.ts";
import type { Config } from "./config.ts";
import { registerToolSpinner, unregisterToolSpinner } from "./spinnerState.ts";

const PURPLE = chalk.hex("#a855f7");

// ─── Tool display labels ──────────────────────────────────────────────────────
const TOOL_LABELS: Record<string, { icon: string; verb: string }> = {
  read_file:       { icon: "📖", verb: "reading" },
  write_file:      { icon: "✍️ ", verb: "writing" },
  edit_file:       { icon: "✏️ ", verb: "editing" },
  bash:            { icon: "⚙️ ", verb: "running" },
  glob:            { icon: "🔍", verb: "finding files" },
  grep:            { icon: "🔎", verb: "searching" },
  list_directory:  { icon: "📂", verb: "listing" },
  web_fetch:       { icon: "🌐", verb: "fetching" },
  think:           { icon: "💭", verb: "thinking" },
  playwright:      { icon: "🎭", verb: "browser" },
};

// ─── Glow-beam sweep animation ────────────────────────────────────────────────
function playScanLine(): Promise<void> {
  return new Promise((resolve) => {
    const cols = Math.min(process.stdout.columns ?? 80, 72);
    const totalFrames = 20;
    let frame = 0;

    const t = setInterval(() => {
      const pos = (frame / totalFrames) * cols;
      let line = "";

      for (let i = 0; i < cols; i++) {
        const absDist = Math.abs(i - pos);
        if (absDist < 1) {
          line += chalk.hex("#f5f3ff")("█");
        } else if (absDist < 2) {
          line += chalk.hex("#e9d5ff")("▓");
        } else if (absDist < 3) {
          line += chalk.hex("#c084fc")("▒");
        } else if (absDist < 5) {
          line += chalk.hex("#7c3aed")("░");
        } else if (i < pos - 5) {
          line += PURPLE("─");
        } else {
          line += chalk.hex("#2e1065")("─");
        }
      }

      process.stdout.write(`\r${line}`);
      frame++;

      if (frame > totalFrames) {
        clearInterval(t);
        process.stdout.write(`\r${PURPLE("─".repeat(cols))}\n`);
        resolve();
      }
    }, 22);
  });
}

// ─── Streaming text cursor (subtle pulsing block during text output) ─────────
function createStreamCursor() {
  const cursorFrames = ["█", "▓", "▒", "░", "▒", "▓"];
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastCol = 0; // track how many chars to erase

  return {
    show() {
      if (timer) return;
      timer = setInterval(() => {
        const ch = cursorFrames[frame % cursorFrames.length]!;
        const colored = chalk.hex("#a855f7")(ch);
        // Erase previous cursor char, write new one
        if (lastCol > 0) process.stdout.write("\b \b");
        process.stdout.write(colored);
        lastCol = 1;
        frame++;
      }, 80);
    },
    hide() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        if (lastCol > 0) {
          process.stdout.write("\b \b");
          lastCol = 0;
        }
      }
    },
  };
}

// ─── Gradient-pulse spinner ───────────────────────────────────────────────────
function createSpinner(label: string) {
  const barLen = 18;
  const pulseW = 4;
  const gradient = [
    "#2e1065", "#4c1d95", "#5b21b6", "#6d28d9", "#7c3aed",
    "#8b5cf6", "#a855f7", "#c084fc", "#d8b4fe", "#e9d5ff",
  ];
  const sparks = ["✦", "◆", "✧", "◇"];
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      timer = setInterval(() => {
        const spark = chalk.hex("#c084fc")(sparks[frame % sparks.length]!);
        const center = (frame % (barLen + pulseW * 2)) - pulseW;
        let bar = "";
        for (let i = 0; i < barLen; i++) {
          const d = Math.abs(i - center);
          if (d <= pulseW) {
            const ratio = (pulseW - d) / pulseW;
            const idx = Math.round(ratio * (gradient.length - 1));
            bar += chalk.hex(gradient[idx]!)("━");
          } else {
            bar += chalk.hex("#2e1065")("━");
          }
        }
        process.stdout.write(`\r  ${spark} ${bar} ${chalk.gray(label)}`);
        frame++;
      }, 50);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        process.stdout.write("\r\x1b[K");
      }
    },
  };
}

// ─── File-creation matrix cascade ─────────────────────────────────────────────
function playCreateFileAnim(fileName: string): Promise<void> {
  return new Promise((resolve) => {
    const cols = Math.min(process.stdout.columns ?? 80, 60);
    const codeChars = "{}[]<>/=+_()#@&*;:01ABCDEFabcdef";
    const totalFrames = 10;
    let frame = 0;

    const t = setInterval(() => {
      let line = "  ";
      const fillTo = Math.floor(((frame + 1) / totalFrames) * (cols - 4));
      for (let i = 0; i < cols - 4; i++) {
        if (i < fillTo) {
          const ch = codeChars[Math.floor(Math.random() * codeChars.length)]!;
          if (i > fillTo - 3) {
            line += chalk.hex("#e9d5ff")(ch);
          } else if (Math.random() > 0.6) {
            line += chalk.hex("#7c3aed")(ch);
          } else {
            line += chalk.hex("#4c1d95")(ch);
          }
        } else {
          line += " ";
        }
      }
      process.stdout.write(`\r${line}`);
      frame++;

      if (frame >= totalFrames) {
        clearInterval(t);
        // Resolve to a styled "creating" message
        const label = `  📝 ${chalk.hex("#c084fc")("creating")}${chalk.dim(" › ")}${chalk.white(fileName)}`;
        process.stdout.write(`\r\x1b[K${label}\n`);
        resolve();
      }
    }, 30);
  });
}

// ─── Quick data-scan animation (for read/search tools) ────────────────────────
function playDataScanAnim(): Promise<void> {
  return new Promise((resolve) => {
    const cols = Math.min(process.stdout.columns ?? 80, 50);
    const scanChars = "░▒▓█▓▒░";
    const totalFrames = 8;
    let frame = 0;

    const t = setInterval(() => {
      let line = "  ";
      for (let i = 0; i < cols - 4; i++) {
        const wave = Math.sin((i + frame * 3) * 0.3);
        if (wave > 0.5) {
          line += chalk.hex("#c084fc")(scanChars[Math.floor(Math.random() * scanChars.length)]!);
        } else if (wave > 0) {
          line += chalk.hex("#6d28d9")("·");
        } else {
          line += chalk.hex("#2e1065")("·");
        }
      }
      process.stdout.write(`\r${line}`);
      frame++;

      if (frame >= totalFrames) {
        clearInterval(t);
        process.stdout.write(`\r\x1b[K`);
        resolve();
      }
    }, 25);
  });
}

// ─── Command execution pulse (for bash tool) ─────────────────────────────────
function playCommandPulseAnim(): Promise<void> {
  return new Promise((resolve) => {
    const cols = Math.min(process.stdout.columns ?? 80, 50);
    const totalFrames = 6;
    let frame = 0;

    const t = setInterval(() => {
      const progress = (frame + 1) / totalFrames;
      const fillLen = Math.floor(progress * (cols - 4));
      let line = "  ";
      for (let i = 0; i < cols - 4; i++) {
        if (i < fillLen) {
          line += chalk.hex("#22c55e")("▸");
        } else if (i === fillLen) {
          line += chalk.hex("#4ade80")("▸");
        } else {
          line += chalk.hex("#1a2e05")("▸");
        }
      }
      process.stdout.write(`\r${line}`);
      frame++;

      if (frame >= totalFrames) {
        clearInterval(t);
        process.stdout.write(`\r\x1b[K`);
        resolve();
      }
    }, 25);
  });
}

// ─── Project context detection ────────────────────────────────────────────────
function detectProject(): string {
  const cwd = process.cwd();
  const parts: string[] = [];

  if (existsSync(join(cwd, "package.json"))) {
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf-8"));
      const deps = [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ];
      parts.push(`Node.js project: ${pkg.name ?? "unknown"} v${pkg.version ?? "0.0.0"}`);
      if (deps.length > 0) parts.push(`  Key deps: ${deps.slice(0, 15).join(", ")}`);
      if (pkg.scripts) parts.push(`  Scripts: ${Object.keys(pkg.scripts).join(", ")}`);
    } catch { /* ignore */ }
  }
  if (existsSync(join(cwd, "Cargo.toml"))) parts.push("Rust project (Cargo.toml detected)");
  if (existsSync(join(cwd, "go.mod"))) parts.push("Go project (go.mod detected)");
  if (existsSync(join(cwd, "pyproject.toml"))) parts.push("Python project (pyproject.toml)");
  if (existsSync(join(cwd, "setup.py"))) parts.push("Python project (setup.py)");
  if (existsSync(join(cwd, "pom.xml"))) parts.push("Java/Maven project");
  if (existsSync(join(cwd, "build.gradle")) || existsSync(join(cwd, "build.gradle.kts"))) parts.push("Java/Gradle project");
  if (existsSync(join(cwd, "Makefile"))) parts.push("Makefile present");
  if (existsSync(join(cwd, "docker-compose.yml")) || existsSync(join(cwd, "Dockerfile"))) parts.push("Docker project");
  if (existsSync(join(cwd, "tsconfig.json"))) parts.push("TypeScript configured");

  return parts.join("\n");
}

function readProjectInstructions(): string | null {
  const candidates = [
    join(process.cwd(), ".sharkcode.md"),
    join(process.cwd(), ".sharkcode", "instructions.md"),
    join(process.cwd(), "SHARKCODE.md"),
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return readFileSync(p, "utf-8").slice(0, 8000);
      } catch { /* ignore */ }
    }
  }
  return null;
}

function getGitContext(): string | null {
  try {
    const branch = execSync("git branch --show-current", {
      encoding: "utf-8", timeout: 3000, cwd: process.cwd(),
    }).trim();
    const status = execSync("git status --porcelain", {
      encoding: "utf-8", timeout: 3000, cwd: process.cwd(),
    }).trim();

    let ctx = `Git branch: ${branch}`;
    if (status) {
      const lines = status.split("\n");
      ctx += `\nChanged files (${lines.length}):`;
      ctx += "\n" + lines.slice(0, 15).join("\n");
      if (lines.length > 15) ctx += `\n  ... and ${lines.length - 15} more`;
    } else {
      ctx += "\nWorking tree clean";
    }
    return ctx;
  } catch {
    return null;
  }
}

function buildSystemPrompt(): string {
  const os = process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux";
  const shell = process.platform === "win32" ? "cmd.exe" : "bash";

  const parts: string[] = [];

  parts.push(
    `You are Shark Code 🦈, a powerful AI coding agent running locally on the user's machine. ` +
    `You help users understand, write, debug, and refactor code by reading/writing files, ` +
    `searching codebases, and running shell commands.`
  );

  // Environment
  parts.push(`
Environment:
- OS: ${os}
- Shell: ${shell}
- Working directory: ${process.cwd()}`);

  // Project context
  const projectCtx = detectProject();
  if (projectCtx) parts.push(`\nProject:\n${projectCtx}`);

  // Git context
  const gitCtx = getGitContext();
  if (gitCtx) parts.push(`\n${gitCtx}`);

  // Project instructions
  const instructions = readProjectInstructions();
  if (instructions) {
    parts.push(`\n<project_instructions>\n${instructions}\n</project_instructions>`);
  }

  // Tools
  parts.push(`
Available tools:
- read_file: Read file contents (supports line ranges and line numbers)
- write_file: Create or overwrite files (creates parent directories)
- edit_file: Find and replace an exact string in a file
- bash: Execute shell commands. Set background=true for dev servers and long-running processes.
- glob: Find files by glob pattern (e.g. '**/*.ts', 'src/**/*.{js,tsx}')
- grep: Search for text/regex across files with line numbers
- list_directory: List directory contents as a tree with file sizes
- web_fetch: Fetch content from URLs (HTML auto-converted to text)
- think: Plan your approach before complex multi-step tasks
- playwright: Control a visible Chromium browser. The browser window is visible — you and the user can watch it in real-time. Session persists across calls.

  WORKFLOW (MANDATORY — follow this every time):
  1. navigate to the URL
  2. snapshot to see all interactive elements with @ref labels (e.g. @e1, @e2)
  3. Use @ref to interact: click ref=@e1, fill ref=@e2 value="text"
  4. After ANY navigation or major page change, take a new snapshot before interacting again
  NEVER guess CSS selectors. ALWAYS snapshot first, then use the @ref from snapshot output.

  Available actions:
  - snapshot: Analyze page and list all interactive elements with @ref labels. ALWAYS call this before clicking/filling anything.
  - navigate: Go to a URL. Always snapshot after navigating.
  - click: Click an element. Use ref=@e1 (from snapshot). Falls back to selector= if needed.
  - fill: Type into an input. Use ref=@e2 value="text". Always snapshot first to find the right input.
  - press: Press a keyboard key (Enter, Tab, Escape, etc.)
  - screenshot: Save a screenshot to disk.
  - get_text: Read text content from an element (ref or selector) or the full page.
  - get_html: Read HTML from an element or the full page.
  - eval_js: Execute JavaScript in page context.
  - wait_for: Wait for an element to appear.
  - go_back, reload, close: Navigation controls.

  Example workflow:
  1. playwright({ action: "navigate", url: "https://example.com" })
  2. playwright({ action: "snapshot" })
     → Returns: @e1 textbox "Search", @e2 button "Sign In", @e3 link "About"...
  3. playwright({ action: "click", ref: "@e2" })
  4. playwright({ action: "snapshot" })  // page changed — re-snapshot!
     → Returns: @e1 textbox "Username", @e2 textbox "Password", @e3 button "Login"...
  5. playwright({ action: "fill", ref: "@e1", value: "user@example.com" })

  CRITICAL — NARRATE YOUR BROWSER ACTIONS:
  You MUST explain your thinking between browser tool calls. The user is watching both the browser window AND your text output.
  - BEFORE a sequence of browser actions, briefly state your plan: "我先打开课程页面，然后找到作业入口。"
  - BETWEEN tool calls, explain what you saw and what you'll do next: "页面显示了3门课程，我点击'数据结构'进入。"
  - When something goes wrong (timeout, element not found), explain and re-snapshot: "ref找不到了，页面可能已变化，重新snapshot看看。"
  - NEVER fire more than 2-3 browser tool calls in a row without a text explanation.
  - After finishing, summarize what you accomplished.
  Bad example (NEVER do this): navigate → click selector=".btn" → click → click (guessing selectors, no snapshot, no explanation)
  Good example: "打开页面看看有什么。" → navigate → snapshot → "找到了搜索框@e1和登录按钮@e2，我先登录。" → click ref=@e2 → snapshot → "登录页加载了，有用户名@e1和密码@e2。"

  LOGIN PAGES: When you encounter a login/auth page (login form, sign-in, OAuth, CAPTCHA, etc.):
    - Do NOT guess credentials or blindly click buttons on the login page.
    - IMMEDIATELY ask the user for their username/email and password.
    - Wait for the user to provide credentials before proceeding.
    - Then use playwright fill with ref to enter the credentials and submit the form.
    - If login fails, tell the user and ask them to verify their credentials.
    - If there is a CAPTCHA or 2FA, tell the user and ask them to complete it manually in the visible browser window, then continue after they confirm.`);

  // Core behavior
  parts.push(`
Core behavior:
- ACT FIRST, explain later. When the user asks you to do something, DO IT immediately.
- NEVER explain steps you could execute. If you can run a command, run it.
- NEVER say "you can run..." or "try running..." — just run it yourself with the bash tool.
- Be concise. After completing a task, briefly state what you did, not what you're about to do.
- If a task is unclear, ask ONE clarifying question, then act.`);

  // Code editing guidelines
  parts.push(`
Code editing:
- ALWAYS read a file before editing it — never edit blind.
- Use edit_file for surgical changes, write_file for new files.
- After making changes, verify them (re-read the file, run tests if applicable).
- Keep changes minimal and focused. Respect existing code style.
- For large refactors, make changes incrementally and verify each step.`);

  // Execution guidelines
  parts.push(`
Execution:
- When using bash, use ${shell}-compatible commands. The bash tool runs commands via ${shell}.
- Run commands directly. Do not ask "should I run this?" — just run it.
- If a command fails, diagnose the error and retry with a fix.
- For dev servers and long-running processes, ALWAYS use bash with background=true.
  This spawns the process detached so it keeps running and doesn't block.
  Example: bash({ command: "python -m http.server 8080", background: true })`);

  // Project startup — the key missing piece
  parts.push(`
Project startup (CRITICAL — when user asks to "start", "run", "launch", "open" a project):
1. Check package.json scripts, Makefile, docker-compose.yml, etc. to find the start command.
2. If dependencies aren't installed, install them first (npm install / pnpm install / bun install).
3. Start the dev server with background=true so it keeps running:
   bash({ command: "npm run dev", background: true })
   Common commands: npm run dev, pnpm dev, bun run dev, npm start, python -m http.server, flask run, cargo run, go run .
4. After the server starts, open it in the browser with a SEPARATE bash call:${
    process.platform === "win32"
      ? `\n   bash({ command: 'start http://localhost:PORT' })`
      : process.platform === "darwin"
      ? `\n   bash({ command: 'open http://localhost:PORT' })`
      : `\n   bash({ command: 'xdg-open http://localhost:PORT' })`
  }
5. Do NOT explain how to start the project. Just start it.`);

  // URL & browser
  parts.push(`
Opening URLs / browsers:
- When user says "open" a URL or asks to see something in the browser, use bash to open it:${
    process.platform === "win32"
      ? `\n  bash({ command: 'start "URL"' })  — uses cmd.exe start command`
      : process.platform === "darwin"
      ? `\n  bash({ command: 'open "URL"' })`
      : `\n  bash({ command: 'xdg-open "URL"' })`
  }
- Do NOT just print the URL — actually open it.`);

  // Exploration
  parts.push(`
Exploration:
- Use glob, grep, and list_directory to understand unfamiliar codebases.
- Explore before making changes to code you haven't seen.
- Use think tool to plan multi-step changes before starting.`);

  return parts.join("\n");
}

// ─── Message history compaction ───────────────────────────────────────────────
// Truncate tool results in older messages to prevent token bloat.
// Keeps the last `keepRecent` messages intact; older tool results are capped.
function compactMessages(messages: ModelMessage[], keepRecent = 4): ModelMessage[] {
  if (messages.length <= keepRecent) return messages;

  const COMPACT_LIMIT = 1_500;
  const cutoff = messages.length - keepRecent;

  return messages.map((msg, idx) => {
    if (idx >= cutoff) return msg; // recent — keep intact
    if (msg.role !== "tool") return msg;

    // Deep-clone and truncate tool result content
    const content = (msg.content as Array<Record<string, unknown>>).map((part) => {
      if (part.type !== "tool-result") return part;

      const output = part.output as Record<string, unknown> | undefined;
      if (!output || typeof output !== "object") return part;

      if (output.type === "text" && typeof output.value === "string") {
        if ((output.value as string).length > COMPACT_LIMIT) {
          return {
            ...part,
            output: {
              ...output,
              value: (output.value as string).slice(0, COMPACT_LIMIT) + "\n...(truncated from history)",
            },
          };
        }
      } else if (output.type === "json") {
        const serialized = JSON.stringify(output.value);
        if (serialized.length > COMPACT_LIMIT) {
          return {
            ...part,
            output: {
              type: "text" as const,
              value: serialized.slice(0, COMPACT_LIMIT) + "\n...(truncated from history)",
            },
          };
        }
      }
      return part;
    });

    return { ...msg, content } as ModelMessage;
  });
}

export interface RunAgentResult {
  messages: ModelMessage[];
  interrupted: boolean;
  /** Partial assistant text collected before interruption (empty if not interrupted) */
  partialText: string;
}

export async function runAgent(
  messages: ModelMessage[],
  config: Config,
  abortSignal?: AbortSignal,
): Promise<RunAgentResult> {
  const model = createProvider(config);

  const compacted = compactMessages(messages);

  const result = streamText({
    model,
    system: buildSystemPrompt(),
    messages: compacted,
    tools,
    maxRetries: 2,
    maxOutputTokens: 16384,
    stopWhen: stepCountIs(50),
    abortSignal,
  });

  let currentStep = 0;
  const thinkingSpinner = createSpinner("thinking...");
  const streamCursor = createStreamCursor();
  let thinkingDone = false;
  let isStreaming = false;
  let interrupted = false;
  let partialText = "";

  // Track consecutive trailing newlines written to stdout so we can collapse
  // the excess blank lines the LLM emits before/after tool calls.
  let trailingNL = 0;

  // Tool-input composing state: bridges the gap between model starting to
  // generate tool arguments and the complete tool-call event arriving.
  let composingSpinner: ReturnType<typeof createSpinner> | null = null;
  let composingToolName = "";
  let composingBytes = 0;

  function writeOut(text: string) {
    if (!text) return;
    process.stdout.write(text);
    for (const ch of text) {
      if (ch === "\n") trailingNL++;
      else trailingNL = 0;
    }
  }

  // Collapse all but `keep` trailing blank lines using ANSI cursor-up + clear.
  function collapseNL(keep = 1) {
    if (trailingNL > keep) {
      const remove = trailingNL - keep;
      process.stdout.write(`\x1b[${remove}A\x1b[J`);
      trailingNL = keep;
    }
  }

  // Tool-level spinner (one active at a time)
  let toolSpinner: ReturnType<typeof createSpinner> | null = null;
  let currentToolName = "";

  thinkingSpinner.start();

  try {
    for await (const event of result.fullStream) {
      // Stop thinking spinner on first real output
      if (
        !thinkingDone &&
        (event.type === "text-delta" ||
          event.type === "tool-call" ||
          event.type === "tool-input-start" ||
          event.type === "reasoning-delta" ||
          event.type === "error")
      ) {
        thinkingSpinner.stop();
        thinkingDone = true;
      }

    switch (event.type) {
      case "text-delta":
        // Collapse excess blank lines between a tool result and next paragraph
        if (trailingNL > 1 && event.text.trim() !== "") collapseNL(1);
        // Prevent accumulating multiple blank lines — collapse immediately
        if (trailingNL >= 2) collapseNL(1);
        // Hide cursor before writing, then re-show for live effect
        streamCursor.hide();
        writeOut(event.text);
        partialText += event.text;
        if (!isStreaming) isStreaming = true;
        streamCursor.show();
        break;

      case "tool-call": {
        // Hide streaming cursor when transitioning to tool execution
        streamCursor.hide();
        isStreaming = false;

        // Stop composing spinner if still running
        if (composingSpinner) {
          composingSpinner.stop();
          composingSpinner = null;
          composingToolName = "";
          composingBytes = 0;
        }

        const meta = TOOL_LABELS[event.toolName] ?? { icon: "🔧", verb: "running" };
        currentToolName = event.toolName;

        const argHint = getArgHint(event.toolName, event.input);

        // Collapse ALL trailing blank lines — keep zero so tool header is tight
        collapseNL(0);
        if (trailingNL === 0) writeOut("\n");

        // Thin separator + compact tool header on ONE line
        const cols = Math.min(process.stdout.columns ?? 80, 60);
        process.stdout.write(`  ${chalk.hex("#4c1d95")("─".repeat(cols - 4))}\n`);
        process.stdout.write(
          `  ${meta.icon} ${PURPLE(meta.verb)}${argHint ? chalk.dim(" › ") + chalk.white(argHint) : ""}\n`
        );

        // Spinner starts immediately on next line
        toolSpinner = createSpinner(`${meta.verb}...`);
        registerToolSpinner(() => toolSpinner?.stop());
        toolSpinner.start();

        trailingNL = 0;
        break;
      }

      case "tool-result": {
        if (toolSpinner) {
          toolSpinner.stop();
          toolSpinner = null;
          unregisterToolSpinner();
        }
        const summary = truncate(String(event.output), 80);
        // Single compact result line
        process.stdout.write(
          `  ${chalk.green("✓")} ${chalk.dim(summary)}\n`
        );
        trailingNL = 1;
        break;
      }

      case "tool-error":
        if (toolSpinner) {
          toolSpinner.stop();
          toolSpinner = null;
          unregisterToolSpinner();
        }
        process.stderr.write(
          chalk.red(`  ✗ [${event.toolName}] ${String(event.error)}\n`)
        );
        trailingNL = 1;
        break;

      // ── Tool-input streaming (bridges the "frozen" gap during large arg generation) ──
      case "tool-input-start": {
        // Model just started generating tool arguments — show a composing spinner
        streamCursor.hide();
        isStreaming = false;

        // Collapse ALL trailing blank lines so spinner appears tight below content
        collapseNL(0);
        if (trailingNL === 0) writeOut("\n");

        composingToolName = event.toolName;
        composingBytes = 0;

        const meta = TOOL_LABELS[event.toolName] ?? { icon: "🔧", verb: "running" };
        const label = `composing ${meta.verb} input...`;
        composingSpinner = createSpinner(label);
        composingSpinner.start();
        break;
      }

      case "tool-input-delta": {
        // Model is still generating tool arguments — keep spinner alive,
        // update byte counter so user sees continuous progress
        composingBytes += event.delta.length;
        if (composingSpinner && composingBytes > 500) {
          // Update the spinner label with byte count, but only every ~2KB to avoid thrash
          const kb = (composingBytes / 1024).toFixed(1);
          const kbRounded = Math.floor(composingBytes / 2048);
          const prevKbRounded = Math.floor((composingBytes - event.delta.length) / 2048);
          if (kbRounded !== prevKbRounded || composingBytes - event.delta.length <= 500) {
            const meta = TOOL_LABELS[composingToolName] ?? { icon: "🔧", verb: "running" };
            composingSpinner.stop();
            composingSpinner = createSpinner(`composing ${meta.verb} input... ${kb}KB`);
            composingSpinner.start();
          }
        }
        break;
      }

      case "tool-input-end": {
        // Tool argument generation complete — clean up composing spinner
        // (tool-call event will follow immediately and start its own animation)
        if (composingSpinner) {
          composingSpinner.stop();
          composingSpinner = null;
        }
        composingToolName = "";
        composingBytes = 0;
        break;
      }

      // ── Reasoning/thinking events (for models like DeepSeek R1, o1) ──
      case "reasoning-start": {
        // Model entered reasoning mode — show a thinking indicator
        if (!thinkingDone) {
          // Already have thinkingSpinner running
        } else {
          // Restart thinking spinner for multi-step reasoning
          streamCursor.hide();
          thinkingSpinner.start();
        }
        break;
      }

      case "reasoning-delta": {
        // Could optionally display reasoning text; for now just keep spinner alive
        break;
      }

      case "reasoning-end": {
        thinkingSpinner.stop();
        break;
      }

      // ── Step lifecycle ──
      case "start-step": {
        // New step — no separator; the tool header line is enough visual break
        break;
      }

      case "finish-step":
        streamCursor.hide();
        isStreaming = false;
        currentStep++;
        break;

      case "error":
        streamCursor.hide();
        if (composingSpinner) { composingSpinner.stop(); composingSpinner = null; }
        if (toolSpinner) { toolSpinner.stop(); toolSpinner = null; unregisterToolSpinner(); }
        thinkingSpinner.stop();
        process.stderr.write(chalk.red(`\n❌ ${String(event.error)}\n`));
        trailingNL = 1;
        break;
    }
  }
  } catch (err: unknown) {
    // Handle abort (user pressed Escape)
    if (
      err instanceof Error &&
      (err.name === "AbortError" || err.message.includes("abort"))
    ) {
      interrupted = true;
    } else {
      // Re-throw non-abort errors
      throw err;
    }
  }

  // Ensure spinners are always stopped
  thinkingSpinner.stop();
  streamCursor.hide();
  if (composingSpinner) { composingSpinner.stop(); composingSpinner = null; }
  if (toolSpinner) { toolSpinner.stop(); unregisterToolSpinner(); }

  if (interrupted) {
    // Show interruption indicator
    process.stdout.write(chalk.yellow("\n  ⏹ 已中断\n"));

    // Return partial conversation — include whatever assistant text we got
    if (partialText.trim()) {
      return {
        messages: [
          ...messages,
          { role: "assistant" as const, content: partialText + "\n\n[interrupted by user]" },
        ],
        interrupted: true,
        partialText,
      };
    }
    return { messages, interrupted: true, partialText };
  }

  if (trailingNL === 0) process.stdout.write("\n");

  // Detect truncated output (e.g. CSS file written halfway because token limit hit)
  const finishReason = await result.finishReason;
  if (finishReason === "length") {
    process.stderr.write(
      chalk.yellow("\n  ⚠ 输出因 token 限制被截断。") +
      chalk.gray(" 大文件可能未完整写入，请检查并重试（可尝试分段生成）。\n")
    );
  } else if (finishReason === "content-filter") {
    process.stderr.write(
      chalk.yellow("\n  ⚠ 输出被内容过滤器截断。\n")
    );
  }

  const usage = await result.totalUsage;
  if (usage) {
    process.stderr.write(
      chalk.dim(`  📊 ${usage.inputTokens}↑ ${usage.outputTokens}↓  steps:${currentStep}\n`)
    );
  }

  // Append response messages to conversation history for multi-turn support
  try {
    const { messages: responseMessages } = await result.response;
    return {
      messages: [...messages, ...responseMessages] as ModelMessage[],
      interrupted: false,
      partialText,
    };
  } catch {
    return { messages, interrupted: false, partialText };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getArgHint(toolName: string, args: unknown): string {
  if (typeof args !== "object" || args === null) return "";
  const obj = args as Record<string, unknown>;

  switch (toolName) {
    case "read_file":
    case "write_file":
    case "edit_file":
      return truncate(String(obj.path ?? obj.file_path ?? ""), 50);
    case "bash":
      return truncate(String(obj.command ?? ""), 50);
    default: {
      const first = Object.values(obj).find((v) => typeof v === "string");
      return first ? truncate(first as string, 50) : "";
    }
  }
}

function truncate(str: string, max: number): string {
  const oneLine = str.replace(/\n/g, "↵");
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

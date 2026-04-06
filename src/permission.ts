import chalk from "chalk";
import { stopToolSpinner } from "./spinnerState.ts";
import { setAwaitingPermission } from "./interrupt.ts";

const PURPLE = chalk.hex("#a855f7");
const GRAY   = chalk.gray;
const GREEN  = chalk.green;
const RED    = chalk.red;
const YELLOW = chalk.yellow;
const DIM    = chalk.dim;

// ─── Permission mode (set by CLI, read by tools) ──────────────────────────────
let _permissionMode: "prompt" | "full-access" = "prompt";

export function setPermissionMode(mode: "prompt" | "full-access"): void {
  _permissionMode = mode;
}

export function getPermissionMode(): "prompt" | "full-access" {
  return _permissionMode;
}

// ─── Ask user to approve a shell command ──────────────────────────────────────
export async function askPermission(command: string): Promise<boolean> {
  // Full-access mode: silently allow everything
  if (_permissionMode === "full-access") {
    process.stdout.write(
      PURPLE("  ◆ ") + DIM("auto-approved") + GRAY(" › ") + chalk.white(command) + "\n"
    );
    return true;
  }

  // ── Draw the permission box ───────────────────────────────────────────────
  // Stop any active tool spinner first so it doesn't corrupt the box
  stopToolSpinner();
  const width = Math.min(72, process.stdout.columns ?? 80);
  const innerWidth = width - 4; // 2 border chars + 2 padding

  const line  = (s: string) => `  ${s}\n`;
  const bar   = PURPLE("─".repeat(width));

  const label = YELLOW("  ⚡ 执行命令");
  const cmd   = chalk.white.bold(command.length > innerWidth
    ? command.slice(0, innerWidth - 1) + "…"
    : command);

  process.stderr.write("\n");
  process.stderr.write(bar + "\n");
  process.stderr.write(line(label));
  process.stderr.write(line("  " + cmd));
  process.stderr.write(bar + "\n");
  process.stderr.write(
    "  " +
    GREEN("[ y ] 允许") +
    "   " +
    RED("[ n ] 拒绝") +
    "   " +
    DIM("[ a ] 本次全部允许") +
    "\n\n"
  );
  process.stderr.write(PURPLE("  ◆ ") + GRAY("按键决定 › "));

  return new Promise((resolve) => {
    setAwaitingPermission(true);
    const onData = (chunk: Buffer) => {
      const ch = chunk.toString("utf8")[0]?.toLowerCase() ?? "";
      process.stdin.removeListener("data", onData);
      setAwaitingPermission(false);

      if (ch === "y") {
        process.stderr.write(GREEN("y  允许\n\n"));
        resolve(true);
      } else if (ch === "a") {
        // Escalate to full-access for the rest of this session
        process.stderr.write(YELLOW("a  已切换为 Full Access（本次会话）\n\n"));
        _permissionMode = "full-access";
        resolve(true);
      } else {
        process.stderr.write(RED("n  拒绝\n\n"));
        resolve(false);
      }
    };
    // One-shot listener — raw mode is already on (managed by REPL)
    process.stdin.once("data", onData);
  });
}

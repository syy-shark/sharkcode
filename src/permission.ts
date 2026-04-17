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
let _suppressAutoApprovedOutput = false;

export function setPermissionMode(mode: "prompt" | "full-access"): void {
  _permissionMode = mode;
}

export function getPermissionMode(): "prompt" | "full-access" {
  return _permissionMode;
}

export function setSuppressAutoApprovedOutput(suppress: boolean): void {
  _suppressAutoApprovedOutput = suppress;
}

// ─── In-shell permission adapter ─────────────────────────────────────────────
// When the educational shell is active, it can register itself as the permission handler
// to render permission prompts inside the shell instead of using stderr

export type PermissionDecision = "allow" | "deny" | "allow-all";

export interface PermissionRequest {
  command: string;
  resolve: (decision: PermissionDecision) => void;
}

export type PermissionHandler = (request: PermissionRequest) => void;

let _shellPermissionHandler: PermissionHandler | null = null;

/**
 * Register an in-shell permission handler.
 * When registered, askPermission() will delegate to the shell instead of using stderr.
 */
export function registerShellPermissionHandler(handler: PermissionHandler): void {
  _shellPermissionHandler = handler;
}

/**
 * Unregister the in-shell permission handler.
 * Should be called when the shell unmounts.
 */
export function unregisterShellPermissionHandler(): void {
  _shellPermissionHandler = null;
}

/**
 * Check if a shell permission handler is registered.
 */
export function hasShellPermissionHandler(): boolean {
  return _shellPermissionHandler !== null;
}

// ─── Ask user to approve a shell command ──────────────────────────────────────
export async function askPermission(command: string): Promise<boolean> {
  // Full-access mode: silently allow everything
  if (_permissionMode === "full-access") {
    if (!_suppressAutoApprovedOutput) {
      process.stdout.write(
        PURPLE("  ◆ ") + DIM("auto-approved") + GRAY(" › ") + chalk.white(command) + "\n"
      );
    }
    return true;
  }

  // If shell handler is registered, delegate to it
  if (_shellPermissionHandler) {
    return new Promise((resolve) => {
      setAwaitingPermission(true);
      _shellPermissionHandler!({
        command,
        resolve: (decision) => {
          setAwaitingPermission(false);
          if (decision === "allow") {
            resolve(true);
          } else if (decision === "allow-all") {
            _permissionMode = "full-access";
            resolve(true);
          } else {
            resolve(false);
          }
        },
      });
    });
  }

  // ── Fallback: Draw the permission box on stderr ────────────────────────────
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

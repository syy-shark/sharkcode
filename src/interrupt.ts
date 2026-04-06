/**
 * Shared interrupt state for mid-conversation abort.
 *
 * cli.ts        → calls triggerInterrupt() when user presses Escape during agent run
 * agent.ts      → passes abortSignal to streamText()
 * permission.ts → calls setAwaitingPermission() to gate the interrupt listener
 *
 * Flow:
 *   1. cli.ts calls createInterruptController() before runAgent()
 *   2. cli.ts attaches a temporary stdin listener for Escape key
 *   3. On Escape keypress, cli.ts calls triggerInterrupt()
 *   4. streamText aborts, agent.ts catches the abort and returns partial results
 *   5. cli.ts detects the interruption via wasInterrupted()
 *   6. During permission prompts, the Escape listener is gated (won't interrupt)
 */

let _controller: AbortController | null = null;
let _interrupted = false;
let _awaitingPermission = false;

/**
 * Create a fresh AbortController for the upcoming agent run.
 * Returns the AbortSignal to pass into runAgent / streamText.
 */
export function createInterruptController(): AbortSignal {
  _controller = new AbortController();
  _interrupted = false;
  _awaitingPermission = false;
  return _controller.signal;
}

/**
 * Trigger an interrupt — aborts the current agent run.
 * No-op if awaiting a permission prompt (those keypresses belong to askPermission).
 */
export function triggerInterrupt(): void {
  if (_awaitingPermission) return;
  if (_controller && !_controller.signal.aborted) {
    _interrupted = true;
    _controller.abort();
  }
}

/**
 * Check if the last agent run was interrupted by the user.
 */
export function wasInterrupted(): boolean {
  return _interrupted;
}

/**
 * Clean up after an agent run completes (normally or interrupted).
 */
export function resetInterrupt(): void {
  _controller = null;
  _interrupted = false;
  _awaitingPermission = false;
}

/**
 * Gate the interrupt listener during permission prompts.
 * permission.ts calls this so that y/n/a keypresses don't trigger abort.
 */
export function setAwaitingPermission(waiting: boolean): void {
  _awaitingPermission = waiting;
}

/**
 * Check if a permission prompt is currently active.
 */
export function isAwaitingPermission(): boolean {
  return _awaitingPermission;
}

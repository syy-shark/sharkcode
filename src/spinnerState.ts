/**
 * Shared spinner control bridge.
 * Lets permission.ts stop an active tool spinner without creating a
 * circular dependency between agent.ts ↔ permission.ts.
 *
 * agent.ts      → calls registerToolSpinner / unregisterToolSpinner
 * permission.ts → calls stopToolSpinner
 */

type StopFn = () => void;

let _stop: StopFn | null = null;

export function registerToolSpinner(stop: StopFn): void {
  _stop = stop;
}

export function unregisterToolSpinner(): void {
  _stop = null;
}

export function stopToolSpinner(): void {
  if (_stop) {
    _stop();
    _stop = null;
  }
}

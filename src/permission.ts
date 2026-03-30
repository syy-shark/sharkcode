import chalk from "chalk";

/**
 * Ask the user to approve a shell command.
 * Uses raw-mode stdin (already active in REPL) so a single keypress suffices.
 */
export async function askPermission(command: string): Promise<boolean> {
  process.stderr.write(
    chalk.yellow(`\n⚠️  Will execute: `) + chalk.white(command) + "\n"
  );
  process.stderr.write(chalk.yellow("   Allow? [y/N] "));

  return new Promise((resolve) => {
    const onData = (chunk: Buffer) => {
      const ch = chunk.toString("utf8")[0] ?? "";
      process.stdin.removeListener("data", onData);
      const yes = ch.toLowerCase() === "y";
      process.stderr.write(yes ? "y\n" : "N\n");
      resolve(yes);
    };
    // One-shot listener — raw mode is already on (set by REPL main loop)
    process.stdin.once("data", onData);
  });
}

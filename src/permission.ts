import * as readline from "readline";
import chalk from "chalk";

export async function askPermission(command: string): Promise<boolean> {
  process.stderr.write(
    chalk.yellow(`\n⚠️  Will execute: `) + chalk.white(command) + "\n"
  );

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    rl.question(chalk.yellow("   Allow? [y/N] "), (answer) => {
      rl.close();
      const yes = answer.trim().toLowerCase();
      resolve(yes === "y" || yes === "yes");
    });
  });
}

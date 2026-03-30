#!/usr/bin/env bun
import chalk from "chalk";
import { loadConfig } from "./config.ts";
import { runAgent } from "./agent.ts";

const BANNER = chalk.bold.cyan(`
  🦈 Shark Code v0.1
  AI Coding Agent — Local First, Open Source
`);

const HELP = `${BANNER}
${chalk.white("Usage:")}
  ${chalk.green("sharkcode")} ${chalk.yellow('"your prompt here"')}

${chalk.white("Examples:")}
  sharkcode "explain this codebase"
  sharkcode "fix the null pointer bug in auth.ts"
  sharkcode "add error handling to the API routes"

${chalk.white("Config:")}
  Set ${chalk.yellow("DEEPSEEK_API_KEY")} env var, or edit ${chalk.gray("~/.sharkcode/config.toml")}
  Get your key at ${chalk.underline("https://platform.deepseek.com")}
`;

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(HELP);
    return;
  }

  if (args[0] === "--version" || args[0] === "-v") {
    console.log("sharkcode v0.1.0");
    return;
  }

  const prompt = args.join(" ");
  const config = loadConfig();

  process.stdout.write(
    chalk.cyan("🦈 Shark Code") + chalk.gray(` | model: ${config.model}\n\n`)
  );

  await runAgent(prompt, config);
}

main().catch((err) => {
  console.error(chalk.red(`\n❌ Fatal: ${err.message}`));
  if (err.message?.includes("401") || err.message?.includes("Unauthorized")) {
    console.error(chalk.yellow("   Check your API key in ~/.sharkcode/config.toml"));
  }
  process.exit(1);
});

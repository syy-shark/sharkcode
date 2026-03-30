import { tool } from "ai";
import { z } from "zod";
import { exec } from "child_process";
import { askPermission } from "../permission.ts";

export const bashTool = tool({
  description:
    "Execute a shell command. The command will be shown to the user for approval before execution. Use this for running tests, installing packages, checking git status, etc.",
  inputSchema: z.object({
    command: z.string().describe("The shell command to execute"),
  }),
  execute: async ({ command }) => {
    const allowed = await askPermission(command);
    if (!allowed) {
      return "Command execution denied by user.";
    }

    return new Promise<string>((resolve) => {
      exec(
        command,
        {
          cwd: process.cwd(),
          timeout: 120_000,
          maxBuffer: 1024 * 1024 * 5,
        },
        (error, stdout, stderr) => {
          let result = "";
          if (stdout) result += stdout;
          if (stderr) result += (result ? "\n" : "") + `[stderr]: ${stderr}`;
          if (error && error.code !== null) {
            result += (result ? "\n" : "") + `[exit code]: ${error.code}`;
          }
          resolve(result || "(no output)");
        }
      );
    });
  },
});

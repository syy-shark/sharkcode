import { tool } from "ai";
import { z } from "zod";
import { exec, spawn } from "child_process";
import { askPermission } from "../permission.ts";

export const bashTool = tool({
  description:
    "Execute a shell command. Set background=true for long-running processes like dev servers " +
    "— the process will run independently and not block. " +
    "The command will be shown to the user for approval before execution.",
  inputSchema: z.object({
    command: z.string().describe("The shell command to execute"),
    background: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Run as a detached background process. Use for dev servers and long-running processes that should keep running."
      ),
  }),
  execute: async ({ command, background }) => {
    const allowed = await askPermission(command);
    if (!allowed) {
      return "Command execution denied by user.";
    }

    // ── Background mode: spawn detached process that survives independently ──
    if (background) {
      return new Promise<string>((resolve) => {
        try {
          const child = spawn(command, [], {
            shell: true,
            detached: true,
            stdio: "ignore",
            cwd: process.cwd(),
            windowsHide: true,
          });

          const pid = child.pid;
          child.unref();

          // Wait briefly to check if process crashes immediately
          setTimeout(() => {
            if (pid) {
              try {
                process.kill(pid, 0); // signal 0 = check if alive
                resolve(
                  `Background process started (PID: ${pid}). It will keep running independently.`
                );
              } catch {
                resolve(
                  `Background process (PID: ${pid}) started but exited quickly. Check the command for errors.`
                );
              }
            } else {
              resolve(
                "Failed to start background process. The command may be invalid."
              );
            }
          }, 2000);
        } catch (err) {
          resolve(`Failed to start background process: ${String(err)}`);
        }
      });
    }

    // ── Normal (foreground) mode ──
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
          result = result || "(no output)";

          // Cap output to prevent token bloat
          const MAX_CHARS = 10_000;
          if (result.length > MAX_CHARS) {
            result =
              result.slice(0, MAX_CHARS) +
              `\n\n... (output truncated at ${MAX_CHARS} chars)`;
          }

          resolve(result);
        }
      );
    });
  },
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const entry = join(repoRoot, "dist", "cli.mjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runNode(args, extraEnv = {}) {
  return spawnSync(process.execPath, [entry, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 20_000,
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
}

function runNodeAt(customEntry, args, extraEnv = {}) {
  return spawnSync(process.execPath, [customEntry, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 20_000,
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
}

const isolatedHome = mkdtempSync(join(tmpdir(), "sharkcode-release-smoke-"));

try {
  const help = runNode(["--help"]);
  assert(help.status === 0, `--help exited with ${String(help.status)}\n${help.stderr}`);
  assert(help.stdout.includes("Usage:"), "--help output did not include Usage");

  if (process.platform === "win32") {
    const junctionDir = join(isolatedHome, "linked-package");
    const mklink = spawnSync("cmd.exe", ["/c", "mklink", "/J", junctionDir, repoRoot], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 20_000,
    });
    assert(mklink.status === 0, `mklink /J failed\nstdout:\n${mklink.stdout}\nstderr:\n${mklink.stderr}`);

    const linkedHelp = runNodeAt(join(junctionDir, "dist", "cli.mjs"), ["--help"]);
    assert(linkedHelp.status === 0, `linked --help exited with ${String(linkedHelp.status)}\n${linkedHelp.stderr}`);
    assert(linkedHelp.stdout.includes("Usage:"), "linked --help output did not include Usage");
  }

  const isolatedEnv = {
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    HOMEDRIVE: isolatedHome.slice(0, 2),
    HOMEPATH: isolatedHome.slice(2) || "\\",
  };

  const missingConfig = runNode(["release-smoke"], isolatedEnv);
  assert(missingConfig.status === 1, `missing-config run exited with ${String(missingConfig.status)}\nstdout:\n${missingConfig.stdout}\nstderr:\n${missingConfig.stderr}`);
  assert(
    missingConfig.stderr.includes("未配置 API Key"),
    `missing-config stderr did not explain the API key problem\n${missingConfig.stderr}`,
  );
  assert(
    !missingConfig.stderr.includes("Assertion failed"),
    `missing-config stderr still hit the Windows/libuv assertion\n${missingConfig.stderr}`,
  );

  console.log("release smoke passed");
} finally {
  rmSync(isolatedHome, { recursive: true, force: true });
}

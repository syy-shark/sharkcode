import { readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { select, input } from "@inquirer/prompts";
import {
  readMultiConfig,
  saveMultiConfig,
  resolveConfig,
  PROVIDERS,
  clampThinkingLevel,
  getDefaultThinkingLevel,
  getAvailableThinkingLevels,
  supportsThinkingLevel,
  isReasoningModel,
  type Config,
  type MultiConfig,
  type PermissionMode,
  type TeachingVerbosity,
  type ThinkingLevel,
} from "./config.ts";
import { runAgent } from "./agent.ts";
import { setPermissionMode, getPermissionMode } from "./permission.ts";
import { createInterruptController, triggerInterrupt, resetInterrupt } from "./interrupt.ts";
import { parseImagesFromInput, buildUserContent } from "./image.ts";
import { checkForAvailableUpdate, getUpdateCommand, runGlobalUpdate, type AvailableUpdate } from "./update.ts";
import { loginWithDeviceFlow, isCopilotLoggedIn, clearCopilotAuth } from "./copilot-auth.ts";
import { getCopilotPresetModels } from "./copilot-models.ts";
import { loginWithCodexDeviceFlow, isCodexLoggedIn, clearCodexAuth } from "./codex-auth.ts";
import { createProvider } from "./provider.ts";
import { AgentEventBus } from "./agent-events.ts";
import { TeachingOrchestrator } from "./teaching.ts";
import { canUseEducationalMode, printFallbackNotice } from "./teaching-fallback.ts";
import { startEducationalApp } from "./ui/EducationalApp.tsx";
import type { ModelMessage } from "ai";

// ─── Colors ───────────────────────────────────────────────────────────────────
const PURPLE = chalk.hex("#a855f7");
const GRAY   = chalk.gray;
const YELLOW = chalk.yellow;
const GREEN  = chalk.green;
const RED    = chalk.red;
const CYAN   = chalk.cyan;

// ─── Read version from package.json ───────────────────────────────────────────
function getVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// ─── Purple pixel-art banner (Clean Chunky 3D style) ───────────────────────
const GLYPHS: Record<string, number[][]> = {
  S: [[0,1,1,1,1],[1,0,0,0,0],[0,1,1,1,0],[0,0,0,0,1],[1,1,1,1,0]],
  H: [[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,1],[1,0,0,0,1],[1,0,0,0,1]],
  A: [[0,1,1,1,0],[1,0,0,0,1],[1,1,1,1,1],[1,0,0,0,1],[1,0,0,0,1]],
  R: [[1,1,1,1,0],[1,0,0,0,1],[1,1,1,1,0],[1,0,1,0,0],[1,0,0,1,0]],
  K: [[1,0,0,1,0],[1,0,1,0,0],[1,1,0,0,0],[1,0,1,0,0],[1,0,0,1,0]],
  C: [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,0],[1,0,0,0,1],[0,1,1,1,0]],
  O: [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  D: [[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0]],
  E: [[1,1,1,1,1],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,1,1,1,1]],
};

/**
 * Renders a word in a crisp, upright 3D style.
 * Uses high-resolution horizontal rendering (1 array cell = 1 space instead of 2)
 * to create a thin, sharp 3D extrusion that stands up without looking bloated.
 */
function renderThin3D(word: string, padLeft: number, topC: string, botC: string, shadowC: string): string[] {
  const letters = word.toUpperCase().split("").map((c) => GLYPHS[c]!);
  const h = 5;
  const w = letters.length * 12; // 5 cols * 2 spaces + 2 spaces gap = 12 per letter

  // Grid: 0=empty, 1=top face, 2=bot face, 3=shadow
  const grid = Array.from({ length: h + 1 }, () => new Array(w + 2).fill(0));

  let offset = 0;
  for (let i = 0; i < letters.length; i++) {
    const letter = letters[i]!;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        if (letter[r]![c]) {
          const C = offset + c * 2;
          const val = r < 3 ? 1 : 2;
          grid[r]![C] = val;
          grid[r]![C + 1] = val;
        }
      }
    }
    offset += 12;
  }

  // Add thin 3D extrusion (1 space right, 1 row down)
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (grid[r]![c] === 1 || grid[r]![c] === 2) {
        if (grid[r]![c + 1] === 0) grid[r]![c + 1] = 3; // Right shadow
        if (grid[r + 1]![c] === 0) grid[r + 1]![c] = 3; // Bottom shadow
        if (grid[r + 1]![c + 1] === 0) grid[r + 1]![c + 1] = 3; // Corner shadow
      }
    }
  }

  const lines: string[] = [];
  for (let r = 0; r < h + 1; r++) {
    let line = " ".repeat(padLeft);
    let hasContent = false;
    for (let c = 0; c < w + 2; c++) {
      if (grid[r]![c] !== 0) hasContent = true;
    }
    if (!hasContent && r >= h) continue;

    for (let c = 0; c < w + 2; c++) {
      const val = grid[r]![c];
      if (val === 1) line += chalk.bgHex(topC)(" ");
      else if (val === 2) line += chalk.bgHex(botC)(" ");
      else if (val === 3) line += chalk.bgHex(shadowC)(" ");
      else line += " ";
    }
    lines.push(line);
  }
  return lines;
}

const BANNER = [
  "",
  ...renderThin3D("shark", 2, "#c084fc", "#9333ea", "#4c1d95"),
  "",
  ...renderThin3D("code", 8, "#e9d5ff", "#a855f7", "#5b21b6"),
  "",
].join("\n");

// ─── Slash result type ────────────────────────────────────────────────────────
interface SlashResult {
  multiConfig: MultiConfig;
  config: Config;
  clearHistory?: boolean;
  exit?: boolean;
}

const CUSTOM_MODEL_VALUE = "__custom_model__";

function formatThinkingLevelLabel(level: ThinkingLevel): string {
  switch (level) {
    case "none": return "None";
    case "low": return "Low";
    case "medium": return "Medium";
    case "high": return "High";
    case "xhigh": return "Xhigh";
    default: return "Medium";
  }
}

async function promptForThinkingLevelSelection(
  selectedProvider: string,
  currentThinkingLevel: ThinkingLevel,
  modelId: string,
): Promise<ThinkingLevel> {
  if (!supportsThinkingLevel(selectedProvider)) {
    return "default";
  }

  const availableThinkingLevels = getAvailableThinkingLevels(selectedProvider, modelId);
  if (availableThinkingLevels.length <= 1) {
    return currentThinkingLevel;
  }

  const defaultThinkingLevel = getDefaultThinkingLevel(selectedProvider, modelId);
  const normalizedCurrentThinkingLevel = availableThinkingLevels.includes(currentThinkingLevel)
    ? currentThinkingLevel
    : "default";

  const modelHint = isReasoningModel(modelId)
    ? GRAY(`(${modelId} 支持思考强度调节)`)
    : GRAY(`(${modelId} 不是 OpenAI GPT 推理模型，但当前 Copilot 模型支持思考强度调节)`);

  const labels: Record<ThinkingLevel, string> = {
    default: `${formatThinkingLevelLabel(defaultThinkingLevel)} (默认)    平衡推理和速度`,
    none: "None             未应用推理",
    low: "Low              响应速度更快，推理更少",
    medium: "Medium          平衡推理和速度",
    high: "High             最大推理深度",
    xhigh: "Xhigh            xhigh",
  };

  const choices = availableThinkingLevels.map((level) => ({
    name: labels[level],
    value: level,
  }));

  const selectedValue = await select({
    message: PURPLE("◆ 思考水平 ") + modelHint,
    choices,
    default: normalizedCurrentThinkingLevel,
  });

  return selectedValue as ThinkingLevel;
}

async function showThinkingSetupFlow(multiConfig: MultiConfig): Promise<SlashResult> {
  const providerName = multiConfig.activeProvider;
  const providerLabel = PROVIDERS[providerName]?.label ?? providerName;
  const currentEntry = multiConfig.providers[providerName];
  const currentModel = currentEntry?.model ?? PROVIDERS[providerName]?.defaultModel ?? "";

  if (!supportsThinkingLevel(providerName)) {
    console.log(
      YELLOW(`\n  ⚠ ${providerLabel} 当前不支持思考水平调节。`) +
      GRAY(" 目前仅 OpenAI / Codex / GitHub Copilot 的部分模型支持。\n")
    );
    return { multiConfig, config: resolveConfig(multiConfig) };
  }

  if (!supportsThinkingLevel(providerName, currentModel)) {
    console.log(
      YELLOW(`\n  ⚠ ${providerLabel} 当前模型 ${currentModel} 不支持思考水平调节。`) +
      GRAY(" 请选择支持思考的 GPT-5 / Claude 4.6 / Copilot 推理模型后再调整。\n")
    );
    return { multiConfig, config: resolveConfig(multiConfig) };
  }

  const currentThinkingLevel = clampThinkingLevel(
    providerName,
    currentModel,
    currentEntry?.thinkingLevel,
  );
  const newThinkingLevel = await promptForThinkingLevelSelection(
    providerName,
    currentThinkingLevel,
    currentModel,
  );
  const effectiveThinkingLevel = clampThinkingLevel(providerName, currentModel, newThinkingLevel);

  const updated: MultiConfig = {
    ...multiConfig,
    providers: {
      ...multiConfig.providers,
      [providerName]: {
        ...(multiConfig.providers[providerName] ?? {}),
        key: multiConfig.providers[providerName]?.key ?? "",
        model: currentModel,
        thinkingLevel: effectiveThinkingLevel,
      },
    },
  };

  saveMultiConfig(updated);
  const config = resolveConfig(updated);
  const displayThinkingLevel = effectiveThinkingLevel === "default"
    ? getDefaultThinkingLevel(providerName, currentModel)
    : effectiveThinkingLevel;
  console.log(GREEN(`\n  ✓ ${providerLabel} 思考水平已切换为 ${formatThinkingLevelLabel(displayThinkingLevel)}\n`));
  return { multiConfig: updated, config };
}

// ─── Interactive command menu (triggered by bare "/") ─────────────────────────
async function showCommandMenu(multiConfig: MultiConfig): Promise<SlashResult> {
  console.log();
  const permMode = getPermissionMode();
  const permLabel = permMode === "full-access"
    ? "⚡  权限模式：Full Access  " + chalk.dim("(点击切换回默认)")
    : "🔐  权限模式：默认         " + chalk.dim("(点击开启 Full Access)");

  try {
    const action = await select({
      message: PURPLE("◆ 选择操作") + GRAY("  (Esc / Ctrl+C 返回)"),
      choices: [
        { name: "↩   返回聊天",                value: "back"      },
        { name: "🔌  切换 / 配置 Provider",    value: "provider"  },
        { name: "🧠  调整思考水平",            value: "thinking"  },
        { name: permLabel,                      value: "permission"},
        { name: "🗑️  清空对话历史",              value: "clear"     },
        { name: "🚪  退出",                      value: "exit"      },
      ],
    });
    switch (action) {
      case "back":
        console.log(GRAY(""));
        return { multiConfig, config: resolveConfig(multiConfig) };
      case "provider":   return showSetupFlow(multiConfig);
      case "thinking":   return showThinkingSetupFlow(multiConfig);
      case "permission": return togglePermissionMode(multiConfig);
      case "clear":
        console.log(GRAY("\n  ✓ 对话已清空\n"));
        return { multiConfig, config: resolveConfig(multiConfig), clearHistory: true };
      case "exit":
        console.log(GRAY("\nBye! 🦈"));
        return { multiConfig, config: resolveConfig(multiConfig), exit: true };
    }
  } catch {
    // Ctrl+C / Esc inside menu — cancel, resume REPL
    console.log(GRAY(""));
  }
  return { multiConfig, config: resolveConfig(multiConfig) };
}

// ─── Toggle permission mode ───────────────────────────────────────────────────
async function togglePermissionMode(multiConfig: MultiConfig): Promise<SlashResult> {
  const current = getPermissionMode();
  const next: PermissionMode = current === "full-access" ? "prompt" : "full-access";
  setPermissionMode(next);

  const updated: MultiConfig = { ...multiConfig, permissionMode: next };
  saveMultiConfig(updated);

  if (next === "full-access") {
    console.log(
      chalk.yellow("\n  ⚡ Full Access 已开启") +
      GRAY(" — agent 将自动批准所有工具操作\n")
    );
  } else {
    console.log(
      chalk.green("\n  🔐 已恢复默认权限") +
      GRAY(" — 每次工具调用前会询问\n")
    );
  }

  return { multiConfig: updated, config: resolveConfig(updated) };
}

function formatPresetModelChoiceName(
  model: { id: string; label?: string; note?: string },
  currentModel: string,
  defaultModel: string,
): string {
  const title = model.label ? `${model.label} (${model.id})` : model.id;
  const tags: string[] = [];

  if (model.id === currentModel) tags.push("当前");
  if (model.id === defaultModel && model.id !== currentModel) tags.push("默认");
  if (model.note) tags.push(model.note);

  return tags.length > 0 ? `${title}  [${tags.join(" · ")}]` : title;
}

async function promptForModelSelection(selectedProvider: string, currentModel: string): Promise<string> {
  const meta = PROVIDERS[selectedProvider];
  const presetModels = selectedProvider === "copilot"
    ? await getCopilotPresetModels()
    : meta?.presetModels ?? [];
  const modelHint = GRAY(`(回车保留 ${currentModel})`);

  if (presetModels.length === 0) {
    const rawModel = await input({
      message: PURPLE("◆ 模型 ") + modelHint,
      default: currentModel || undefined,
    });

    return rawModel.trim() || currentModel;
  }

  const presetIds = new Set(presetModels.map((model) => model.id));
  const choices: Array<{ name: string; value: string }> = [];

  if (currentModel && !presetIds.has(currentModel)) {
    choices.push({
      name: `保留当前自定义模型 (${currentModel})`,
      value: currentModel,
    });
  }

  choices.push(
    ...presetModels.map((model) => ({
      name: formatPresetModelChoiceName(model, currentModel, meta?.defaultModel ?? ""),
      value: model.id,
    })),
  );
  choices.push({ name: "手动输入其他模型", value: CUSTOM_MODEL_VALUE });

  const selectedValue = await select({
    message: PURPLE("◆ 模型"),
    choices,
    default: currentModel && choices.some((choice) => choice.value === currentModel)
      ? currentModel
      : meta?.defaultModel,
  });

  if (selectedValue !== CUSTOM_MODEL_VALUE) {
    return selectedValue;
  }

  const rawModel = await input({
    message: PURPLE("◆ 模型 ") + modelHint,
    default: currentModel || undefined,
  });

  return rawModel.trim() || currentModel;
}

// ─── GitHub Copilot inline device flow (used from showSetupFlow) ─────────────

/**
 * Runs the Copilot device flow inline (no separate /login needed).
 * Returns true on success, false on user cancel / error.
 */
async function runCopilotDeviceFlow(): Promise<boolean> {
  console.log(GRAY("  将通过 GitHub Device Flow 授权。浏览器可选，不强制要求。\n"));
  try {
    try { process.stdin.setRawMode(false); } catch { /* not a TTY */ }

    await loginWithDeviceFlow((info) => {
      console.log(
        YELLOW("\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n") +
        PURPLE("  步骤 1：") + chalk.white("在任意浏览器中打开：\n") +
        "          " + CYAN(info.verification_uri) + "\n\n" +
        PURPLE("  步骤 2：") + chalk.white("输入以下一次性代码：\n") +
        "          " + chalk.bgHex("#4c1d95").hex("#e9d5ff").bold(` ${info.user_code} `) + "\n\n" +
        GRAY(`  代码有效期：${info.expires_in}秒。等待授权中...`) + "\n" +
        YELLOW("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
      );
    });

    console.log(GREEN("\n  ✓ GitHub Copilot 授权成功！\n"));
    return true;
  } catch (err) {
    console.log(RED(`\n  ✗ Copilot 登录失败：${String(err)}\n`));
    return false;
  } finally {
    try { process.stdin.setRawMode(true); process.stdin.resume(); } catch { /* not a TTY */ }
  }
}

// ─── OpenAI Codex inline device flow (used from showSetupFlow) ───────────────

/**
 * Runs the OpenAI/Codex device flow inline.
 * Returns true on success, false on user cancel / error.
 */
async function runCodexDeviceFlow(): Promise<boolean> {
  console.log(GRAY("  将通过 OpenAI Device Flow 授权 ChatGPT/Codex 订阅。\n"));
  try {
    try { process.stdin.setRawMode(false); } catch { /* not a TTY */ }

    await loginWithCodexDeviceFlow((info) => {
      console.log(
        YELLOW("\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n") +
        PURPLE("  步骤 1：") + chalk.white("在任意浏览器中打开：\n") +
        "          " + CYAN(info.verification_uri) + "\n\n" +
        PURPLE("  步骤 2：") + chalk.white("输入以下一次性代码（如页面未自动填入）：\n") +
        "          " + chalk.bgHex("#4c1d95").hex("#e9d5ff").bold(` ${info.user_code} `) + "\n\n" +
        GRAY(`  代码有效期：${info.expires_in}秒。等待授权中...`) + "\n" +
        YELLOW("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
      );
    });

    console.log(GREEN("\n  ✓ OpenAI Codex 授权成功！\n"));
    return true;
  } catch (err) {
    console.log(RED(`\n  ✗ Codex 登录失败：${String(err)}\n`));
    return false;
  } finally {
    try { process.stdin.setRawMode(true); process.stdin.resume(); } catch { /* not a TTY */ }
  }
}

// ─── Setup flow: provider picker → API key input → model selection ─────────────
async function showSetupFlow(multiConfig: MultiConfig): Promise<SlashResult> {
  console.log();
  try {
    // Step 1 — choose provider
    const providerChoices = Object.entries(PROVIDERS).map(([id, meta]) => {
      const hasKey = !!multiConfig.providers[id]?.key;
      const badge  = hasKey ? GREEN("✓ 已配置") : YELLOW("✗ 未配置");
      // No key required for ollama or copilot (copilot uses device flow auth)
      let finalBadge = badge;
      if (id === "ollama") finalBadge = GREEN("✓ 本地");
      else if (id === "copilot") finalBadge = isCopilotLoggedIn() ? GREEN("✓ 已授权") : YELLOW("✗ 未登录");
      else if (id === "codex")   finalBadge = isCodexLoggedIn()   ? GREEN("✓ 已授权") : (multiConfig.providers[id]?.key ? GREEN("✓ API Key") : YELLOW("✗ 未配置"));
      return { name: `${meta.label}   ${finalBadge}`, value: id };
    });

    const selectedProvider = await select({
      message: PURPLE("◆ 选择 Provider"),
      choices: providerChoices,
      default: multiConfig.activeProvider,
    });

    // Step 2 — API key / OAuth (skip for ollama/copilot/codex subscription login)
    const currentKey = multiConfig.providers[selectedProvider]?.key ?? "";
    let newKey = currentKey;

    if (selectedProvider === "copilot") {
      // Inline Copilot device flow
      if (isCopilotLoggedIn()) {
        console.log(GREEN("\n  ✓ GitHub Copilot 已授权\n"));
        const relogin = await select({
          message: PURPLE("◆ 是否重新授权？"),
          choices: [
            { name: "继续使用当前账号",   value: "keep"    },
            { name: "重新授权（切换账号）", value: "relogin" },
          ],
        });
        if (relogin === "relogin") {
          clearCopilotAuth();
          const result = await runCopilotDeviceFlow();
          if (!result) return { multiConfig, config: resolveConfig(multiConfig) };
        }
      } else {
        console.log(PURPLE("\n  🐙 GitHub Copilot — 订阅登录\n"));
        const doLogin = await select({
          message: PURPLE("◆ 操作"),
          choices: [
            { name: "🔑  通过浏览器授权（推荐）", value: "login" },
            { name: "↩   跳过（稍后再登录）",      value: "skip"  },
          ],
        });
        if (doLogin === "login") {
          const result = await runCopilotDeviceFlow();
          if (!result) return { multiConfig, config: resolveConfig(multiConfig) };
        } else {
          console.log(YELLOW("\n  ⚠ 跳过 Copilot 授权。Provider 已切换，但发消息前需要先登录。\n"));
        }
      }
    } else if (selectedProvider === "codex") {
      // Inline Codex device flow
      if (isCodexLoggedIn()) {
        console.log(GREEN("\n  ✓ OpenAI Codex 已授权\n"));
        const relogin = await select({
          message: PURPLE("◆ 操作"),
          choices: [
            { name: "继续使用当前账号",   value: "keep"    },
            { name: "重新授权（切换账号）", value: "relogin" },
            { name: "改用 API Key 代替订阅授权", value: "apikey" },
          ],
        });
        if (relogin === "relogin") {
          clearCodexAuth();
          const result = await runCodexDeviceFlow();
          if (!result) return { multiConfig, config: resolveConfig(multiConfig) };
        } else if (relogin === "apikey") {
          const hint = currentKey ? GRAY("(回车保留  " + currentKey.slice(0, 6) + "•••)") : GRAY("(必填)");
          const rawKey = await input({ message: PURPLE("◆ API Key ") + hint, default: currentKey || undefined });
          newKey = rawKey.trim() || currentKey;
        }
      } else {
        console.log(PURPLE("\n  🤖 OpenAI Codex — 订阅登录\n"));
        const loginMethod = await select({
          message: PURPLE("◆ 登录方式"),
          choices: [
            { name: "🔑  通过浏览器授权 ChatGPT/Codex 订阅（推荐）", value: "oauth"  },
            { name: "🗝️  输入 OpenAI API Key",                          value: "apikey" },
            { name: "↩   跳过",                                          value: "skip"   },
          ],
        });
        if (loginMethod === "oauth") {
          const result = await runCodexDeviceFlow();
          if (!result) return { multiConfig, config: resolveConfig(multiConfig) };
        } else if (loginMethod === "apikey") {
          const hint = currentKey ? GRAY("(回车保留  " + currentKey.slice(0, 6) + "•••)") : GRAY("(必填)");
          const rawKey = await input({ message: PURPLE("◆ API Key ") + hint, default: currentKey || undefined });
          newKey = rawKey.trim() || currentKey;
        } else {
          console.log(YELLOW("\n  ⚠ 跳过授权。如有 ~/.codex/auth.json 会自动读取，否则请输入 API Key。\n"));
        }
      }
    } else if (selectedProvider !== "ollama") {
      const hint = currentKey
        ? GRAY("(回车保留  " + currentKey.slice(0, 6) + "•••)")
        : GRAY("(必填)");

      const rawKey = await input({
        message: PURPLE("◆ API Key ") + hint,
        default: currentKey || undefined,
      });

      newKey = rawKey.trim() || currentKey;
    }

    // Step 3 — model selection
    const meta = PROVIDERS[selectedProvider];
    const currentModel = multiConfig.providers[selectedProvider]?.model ?? meta?.defaultModel ?? "";
    const newModel = await promptForModelSelection(selectedProvider, currentModel);

    // Step 4 — thinking level for reasoning-capable GPT providers
    const currentThinkingLevel = clampThinkingLevel(
      selectedProvider,
      newModel,
      multiConfig.providers[selectedProvider]?.thinkingLevel,
    );
    const newThinkingLevel = await promptForThinkingLevelSelection(
      selectedProvider,
      currentThinkingLevel,
      newModel,
    );
    const effectiveThinkingLevel = clampThinkingLevel(selectedProvider, newModel, newThinkingLevel);

    // Step 5 — base URL for custom/ollama
    let newBaseURL: string | undefined;
    if (selectedProvider === "custom" || selectedProvider === "ollama") {
      const currentURL = multiConfig.providers[selectedProvider]?.baseURL ?? meta?.baseURL ?? "";
      const urlHint = currentURL
        ? GRAY(`(回车保留 ${currentURL})`)
        : GRAY("(必填，如 http://localhost:11434/v1)");

      const rawURL = await input({
        message: PURPLE("◆ Base URL ") + urlHint,
        default: currentURL || undefined,
      });

      newBaseURL = rawURL.trim() || currentURL || undefined;
    }

    // Build updated config
    let updated: MultiConfig = { ...multiConfig, activeProvider: selectedProvider };
    updated = {
      ...updated,
      providers: {
        ...updated.providers,
        [selectedProvider]: {
          ...(updated.providers[selectedProvider] ?? {}),
          key: newKey,
          model: newModel,
          baseURL: newBaseURL,
          thinkingLevel: effectiveThinkingLevel,
        },
      },
    };

    saveMultiConfig(updated);
    const newConfig = resolveConfig(updated);

    const keyMsg = newKey && newKey !== currentKey ? "，API Key 已保存" : "";
    const thinkingMsg = supportsThinkingLevel(selectedProvider)
      ? ` · 思考:${formatThinkingLevelLabel(
        effectiveThinkingLevel === "default"
          ? getDefaultThinkingLevel(selectedProvider, newModel)
          : effectiveThinkingLevel,
      )}`
      : "";
    console.log(GREEN(`\n  ✓ 已切换到 ${PROVIDERS[selectedProvider]!.label} [${newModel}]${thinkingMsg}${keyMsg}`) + "\n");
    if (selectedProvider === "ark" && newModel === "ark-code-latest") {
      console.log(GRAY("  ℹ 已使用方舟控制台托管模型 ID；如需切换 Auto / 具体模型，请到方舟 Coding Plan 控制台调整。\n"));
    }
    if (!newConfig.apiKey && selectedProvider !== "ollama" && selectedProvider !== "copilot" && selectedProvider !== "codex") {
      console.log(YELLOW("  ⚠ 还未填写 API Key，无法发送消息\n"));
    }

    return { multiConfig: updated, config: newConfig };
  } catch {
    console.log(GRAY("\n  取消\n"));
    return { multiConfig, config: resolveConfig(multiConfig) };
  }
}

// ─── Slash Palette ───────────────────────────────────────────────────────────

interface SlashCommand {
  name: string;       // e.g. "/provider"
  description: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/provider",   description: "切换 / 配置 Provider（含订阅登录）" },
  { name: "/model",      description: "切换模型" },
  { name: "/thinking",   description: "调整 OpenAI / Codex / Copilot 思考水平" },
  { name: "/teach",      description: "开启/关闭教育模式" },
  { name: "/teach off",  description: "关闭教育模式" },
  { name: "/teach model", description: "设置教学模型（如 gpt-4o-mini）" },
  { name: "/teach level", description: "设置教学详略 (简洁/标准/详细)" },
  { name: "/key",        description: "设置 API Key" },
  { name: "/login",      description: "登录 GitHub Copilot（快捷方式）" },
  { name: "/logout",     description: "退出 Copilot / Codex 登录" },
  { name: "/update",     description: "更新到最新版本" },
  { name: "/help",       description: "显示帮助" },
  { name: "/clear",      description: "清空对话历史" },
  { name: "/exit",       description: "退出" },
];

/** Returns the terminal display width of a string (CJK = 2 cols) */
function strDisplayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += charDisplayWidth(ch);
  return w;
}

/**
 * Inline slash palette — shown below the prompt line.
 * Returns:
 *   - a slash command string (e.g. "/update") if user selects one
 *   - the raw typed string (may start with "/") if user hits Enter without selection
 *   - null if Ctrl+C / Ctrl+D
 */
async function readLineWithPalette(promptStr: string): Promise<string | null> {
  process.stdout.write(promptStr);

  return new Promise((resolve) => {
    let buffer = "";       // full typed buffer (including leading "/")
    let finished = false;
    let inPalette = false;
    let paletteIdx = 0;   // selected index in filtered list
    let filtered: SlashCommand[] = [];

    const finish = (value: string | null) => {
      if (finished) return;
      finished = true;
      process.stdin.removeListener("data", onData);
      // Clear palette rows if visible
      if (inPalette) clearPalette();
      resolve(value);
    };

    /** Render the palette rows below current line */
    const renderPalette = () => {
      const query = buffer.slice(1).toLowerCase(); // strip leading "/"
      filtered = SLASH_COMMANDS.filter(
        (c) => c.name.slice(1).startsWith(query) || c.description.toLowerCase().includes(query)
      );
      if (filtered.length === 0) {
        clearPalette();
        return;
      }

      // Clamp selection
      if (paletteIdx >= filtered.length) paletteIdx = filtered.length - 1;
      if (paletteIdx < 0) paletteIdx = 0;

      const rows = filtered.map((cmd, i) => {
        const sel = i === paletteIdx;
        const bar   = sel ? chalk.hex("#a855f7")("▌ ") : "  ";
        const name  = sel
          ? chalk.hex("#e9d5ff").bold(cmd.name.padEnd(12))
          : chalk.hex("#7c3aed")(cmd.name.padEnd(12));
        const desc  = sel
          ? chalk.hex("#c084fc")(cmd.description)
          : chalk.gray(cmd.description);
        return "  " + bar + name + "  " + desc;
      });

      // Move down, render rows, move back up
      const n = rows.length;
      process.stdout.write(
        "\n" +                                         // move to next line
        rows.join("\n") +                              // all rows
        `\x1b[${n}A` +                                // move up n lines
        `\x1b[${strDisplayWidth(promptStr) + strDisplayWidth(buffer)}G` // restore cursor col
      );
    };

    /** Erase palette rows (called before resolve or when palette should disappear) */
    const clearPalette = () => {
      if (filtered.length === 0) return;
      const n = filtered.length;
      // Move down, clear each line, move back up
      let seq = "";
      for (let i = 0; i < n; i++) {
        seq += "\n\x1b[2K"; // next line + clear line
      }
      seq += `\x1b[${n}A`; // back up
      process.stdout.write(seq);
      filtered = [];
    };

    const onData = (chunk: Buffer) => {
      const str = chunk.toString("utf8");

      // ── Arrow keys (Up/Down) ──────────────────────────────────────────────
      if (str === "\x1b[A") {  // Up
        if (inPalette && filtered.length > 0) {
          paletteIdx = (paletteIdx - 1 + filtered.length) % filtered.length;
          renderPalette();
        }
        return;
      }
      if (str === "\x1b[B") {  // Down
        if (inPalette && filtered.length > 0) {
          paletteIdx = (paletteIdx + 1) % filtered.length;
          renderPalette();
        }
        return;
      }

      // ── Escape (bare, not a sequence) ────────────────────────────────────
      if (str === "\x1b") {
        if (inPalette) {
          // Cancel palette: clear display, restore cursor
          clearPalette();
          inPalette = false;
          // Erase the "/" prefix already printed
          const w = strDisplayWidth(buffer);
          process.stdout.write("\b".repeat(w) + " ".repeat(w) + "\b".repeat(w));
          buffer = "";
        }
        // (Don't finish — let them keep typing)
        return;
      }

      // ── Other escape sequences → ignore ──────────────────────────────────
      if (str.startsWith("\x1b")) return;

      for (const ch of str) {
        const code = ch.codePointAt(0)!;

        // Ctrl+C / Ctrl+D
        if (code === 3 || code === 4) {
          process.stdout.write("\n");
          finish(null);
          return;
        }

        // Enter
        if (code === 13 || code === 10) {
          if (inPalette && filtered.length > 0) {
            // Select the highlighted command
            const chosen = filtered[paletteIdx]!.name;
            // Clear palette, then erase current typed buffer & reprint chosen
            clearPalette();
            const w = strDisplayWidth(buffer);
            process.stdout.write(
              "\b".repeat(w) + " ".repeat(w) + "\b".repeat(w) + // erase typed
              chosen                                               // show selected
            );
            process.stdout.write("\n");
            finish(chosen);
          } else {
            process.stdout.write("\n");
            finish(buffer);
          }
          return;
        }

        // Backspace
        if (code === 127 || code === 8) {
          if (buffer.length > 0) {
            const chars = [...buffer];
            const removed = chars.pop()!;
            buffer = chars.join("");
            const w = charDisplayWidth(removed);
            process.stdout.write("\b".repeat(w) + " ".repeat(w) + "\b".repeat(w));

            if (buffer === "") {
              // Left palette mode
              if (inPalette) {
                clearPalette();
                inPalette = false;
              }
            } else if (inPalette) {
              paletteIdx = 0;
              renderPalette();
            }
          }
          continue;
        }

        // Other control chars → ignore
        if (code < 32) continue;

        buffer += ch;
        process.stdout.write(ch);

        // Enter palette mode when first "/" is typed on an empty buffer
        if (buffer === "/") {
          inPalette = true;
          paletteIdx = 0;
          renderPalette();
        } else if (inPalette) {
          // Update filtered list on each keystroke
          paletteIdx = 0;
          renderPalette();
        }
      }
    };

    process.stdin.on("data", onData);
  });
}

// ─── Terminal display width (CJK & fullwidth chars occupy 2 columns) ─────────
function charDisplayWidth(ch: string): number {
  const cp = ch.codePointAt(0)!;
  if (
    (cp >= 0x1100 && cp <= 0x115F) ||   // Hangul Jamo
    (cp >= 0x2E80 && cp <= 0x303E) ||   // CJK Radicals Supplement, Kangxi, etc.
    (cp >= 0x3041 && cp <= 0x33FF) ||   // Hiragana, Katakana, CJK Symbols
    (cp >= 0x3400 && cp <= 0x9FFF) ||   // CJK Unified Ideographs (+ Ext A)
    (cp >= 0xAC00 && cp <= 0xD7AF) ||   // Hangul Syllables
    (cp >= 0xF900 && cp <= 0xFAFF) ||   // CJK Compatibility Ideographs
    (cp >= 0xFF01 && cp <= 0xFF60) ||   // Fullwidth Latin / Punctuation
    (cp >= 0xFFE0 && cp <= 0xFFE6)      // Fullwidth Signs
  ) return 2;
  return 1;
}

async function readLineRaw(promptStr: string): Promise<string | null> {
  // Raw mode is assumed to already be on. We only manage the data listener.
  process.stdout.write(promptStr);

  return new Promise((resolve) => {
    let buffer = "";
    let finished = false;

    const finish = (value: string | null) => {
      if (finished) return;
      finished = true;
      process.stdin.removeListener("data", onData);
      // Do NOT touch setRawMode or pause — caller owns that
      resolve(value);
    };

    const onData = (chunk: Buffer) => {
      const str = chunk.toString("utf8");

      // Ignore escape sequences (arrow keys, F-keys, etc.)
      if (str.startsWith("\x1b")) return;

      for (const ch of str) {
        const code = ch.codePointAt(0)!;

        if (code === 3 || code === 4) {          // Ctrl+C / Ctrl+D
          process.stdout.write("\n");
          finish(null);
          return;
        }
        if (code === 13 || code === 10) {         // Enter
          process.stdout.write("\n");
          finish(buffer);
          return;
        }
        if (code === 127 || code === 8) {         // Backspace
          if (buffer.length > 0) {
            const chars = [...buffer];
            const removed = chars.pop()!;
            buffer = chars.join("");
            const w = charDisplayWidth(removed);
            // Erase `w` columns: move back, blank, move back again
            process.stdout.write("\b".repeat(w) + " ".repeat(w) + "\b".repeat(w));
          }
          continue;
        }
        if (code < 32) continue;                  // other control chars → ignore

        buffer += ch;
        process.stdout.write(ch);
      }
    };

    process.stdin.on("data", onData);
  });
}

// ─── Status line (enhanced purple palette) ──────────────────────────────────
function statusLine(config: Config): string {
  const label = PROVIDERS[config.providerName]?.label ?? config.providerName;
  const permMode = getPermissionMode();
  const permBadge = permMode === "full-access"
    ? chalk.hex("#fbbf24")("  ⚡ Full Access")
    : chalk.hex("#7c3aed")("  🔐 默认权限");
  const BRIGHT_PURPLE = chalk.hex("#c084fc");
  const DEEP_PURPLE   = chalk.hex("#7c3aed");
  const effectiveThinkingLevel = config.thinkingLevel === "default"
    ? getDefaultThinkingLevel(config.providerName, config.model)
    : config.thinkingLevel;
  const thinkingBadge = supportsThinkingLevel(config.providerName, config.model)
    ? chalk.hex("#22c55e")(`  🧠 ${formatThinkingLevelLabel(effectiveThinkingLevel)}`)
    : "";
  return (
    chalk.hex("#d8b4fe")("  ◆ ") +
    BRIGHT_PURPLE(label) +
    DEEP_PURPLE(`  [${config.model}]`) +
    thinkingBadge +
    permBadge +
    chalk.hex("#6b21a8")("   / 指令菜单 · Esc 中断\n")
  );
}

// ─── Startup update notice (Codex-style: visible every launch) ───────────────
function printUpdateNotice(update: AvailableUpdate, interactive: boolean): void {
  const command = getUpdateCommand();

  if (!interactive) {
    if (!process.stderr.isTTY) return;
    console.error(
      YELLOW(`\n  ↑ Update available: v${update.currentVersion} → v${update.latestVersion}\n`) +
      GRAY(`    Run ${command} to update\n`)
    );
    return;
  }

  console.log(
    YELLOW(`  ↑ Update available: v${update.currentVersion} → v${update.latestVersion}`) +
    GRAY(`   输入 /update 立即升级`) + "\n"
  );
}

function runCliUpdate(): boolean {
  const command = getUpdateCommand();
  console.log(GRAY(`\n  正在执行 ${command} ...\n`));
  const result = runGlobalUpdate();
  if (result.ok) {
    console.log(GREEN("\n  ✓ 更新完成，请重新启动 SharkCode 以使用新版本。\n"));
    return true;
  }

  console.log(
    YELLOW(`\n  ⚠ 自动更新失败：${result.error}\n`) +
    GRAY(`    你也可以手动运行：${command}\n`)
  );
  return false;
}

function isTeachingVerbosity(value: string): value is TeachingVerbosity {
  return value === "简洁" || value === "标准" || value === "详细";
}

function saveTeachingConfig(
  multiConfig: MultiConfig,
  teaching: MultiConfig["teaching"],
  message: string,
): { multiConfig: MultiConfig; message: string } {
  const updated: MultiConfig = {
    ...multiConfig,
    teaching,
  };
  saveMultiConfig(updated);
  return { multiConfig: updated, message };
}

export function handleTeachCommand(
  input: string,
  multiConfig: MultiConfig,
): { multiConfig?: MultiConfig; message: string } {
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);

  if (parts[0] !== "/teach") {
    return {
      message:
        "  ✗ 用法：/teach | /teach on | /teach off | /teach model <name> | /teach level <简洁|标准|详细>\n",
    };
  }

  if (parts.length === 1) {
    const enabled = !multiConfig.teaching.enabled;
    return saveTeachingConfig(
      multiConfig,
      { ...multiConfig.teaching, enabled },
      `  ✓ 教育模式已${enabled ? "开启" : "关闭"}\n`,
    );
  }

  if (parts[1] === "on" && parts.length === 2) {
    return saveTeachingConfig(
      multiConfig,
      { ...multiConfig.teaching, enabled: true },
      "  ✓ 教育模式已开启\n",
    );
  }

  if (parts[1] === "off" && parts.length === 2) {
    return saveTeachingConfig(
      multiConfig,
      { ...multiConfig.teaching, enabled: false },
      "  ✓ 教育模式已关闭\n",
    );
  }

  if (parts[1] === "model") {
    const model = parts.slice(2).join(" ").trim();
    if (!model) {
      return {
        message: "  ✗ 用法：/teach model <name>\n",
      };
    }

    return saveTeachingConfig(
      multiConfig,
      { ...multiConfig.teaching, model },
      `  ✓ 教学模型已设置为 ${model}\n`,
    );
  }

  if (parts[1] === "level") {
    const level = parts.slice(2).join(" ").trim();
    if (!isTeachingVerbosity(level)) {
      return {
        message: `  ✗ 无效的教学详略：${level || "(空)"}。可选：简洁 / 标准 / 详细\n`,
      };
    }

    return saveTeachingConfig(
      multiConfig,
      { ...multiConfig.teaching, verbosity: level },
      `  ✓ 教学详略已设置为 ${level}\n`,
    );
  }

  return {
    message:
      "  ✗ 用法：/teach | /teach on | /teach off | /teach model <name> | /teach level <简洁|标准|详细>\n",
  };
}

// ─── GitHub Copilot login flow ───────────────────────────────────────────────

async function runCopilotLogin(multiConfig: MultiConfig): Promise<{ multiConfig: MultiConfig; config: Config }> {
  console.log();

  if (isCopilotLoggedIn()) {
    console.log(GREEN("  ✓ 已登录 GitHub Copilot\n"));
    console.log(GRAY("  使用 /logout 可以退出登录，然后重新 /login 切换账号\n"));

    // Auto-switch provider to copilot
    try {
      const action = await select({
        message: PURPLE("◆ 是否切换到 GitHub Copilot Provider？"),
        choices: [
          { name: "✅  切换到 GitHub Copilot", value: "switch" },
          { name: "↩   保持当前 Provider",     value: "back"   },
        ],
      });
      if (action === "switch") {
        const updated: MultiConfig = { ...multiConfig, activeProvider: "copilot" };
        saveMultiConfig(updated);
        const newConfig = resolveConfig(updated);
        console.log(GREEN(`\n  ✓ 已切换到 GitHub Copilot [${newConfig.model}]\n`));
        return { multiConfig: updated, config: newConfig };
      }
    } catch { /* Esc / cancel */ }

    return { multiConfig, config: resolveConfig(multiConfig) };
  }

  console.log(PURPLE("  🐙 GitHub Copilot 登录\n"));
  console.log(GRAY("  将通过 GitHub Device Flow 授权。浏览器可选，不强制要求。\n"));

  try {
    // Suspend raw mode so user can see the printed code normally
    try { process.stdin.setRawMode(false); } catch { /* not a TTY */ }

    let deviceCodePrinted = false;

    await loginWithDeviceFlow((info) => {
      deviceCodePrinted = true;
      console.log(
        YELLOW("\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n") +
        PURPLE("  步骤 1：") + chalk.white("在任意设备的浏览器中打开：\n") +
        "          " + CYAN(info.verification_uri) + "\n\n" +
        PURPLE("  步骤 2：") + chalk.white("输入以下一次性代码：\n") +
        "          " + chalk.bgHex("#4c1d95").hex("#e9d5ff").bold(` ${info.user_code} `) + "\n\n" +
        GRAY(`  代码有效期：${info.expires_in}秒。等待授权中...`) + "\n" +
        YELLOW("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
      );
    });

    if (deviceCodePrinted) {
      console.log(GREEN("\n  ✓ GitHub Copilot 授权成功！\n"));
    }

    // Switch provider to copilot
    const updated: MultiConfig = { ...multiConfig, activeProvider: "copilot" };
    saveMultiConfig(updated);
    const newConfig = resolveConfig(updated);
    console.log(GREEN(`  ✓ 已切换到 GitHub Copilot [${newConfig.model}]\n`));

    return { multiConfig: updated, config: newConfig };
  } catch (err) {
    console.log(RED(`\n  ✗ 登录失败：${String(err)}\n`));
    return { multiConfig, config: resolveConfig(multiConfig) };
  } finally {
    // Restore raw mode
    try { process.stdin.setRawMode(true); process.stdin.resume(); } catch { /* not a TTY */ }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const currentVersion = getVersion();

  if (args[0] === "--help" || args[0] === "-h") {
    console.log(BANNER);
    console.log(PURPLE("  Usage:"));
    console.log("    " + PURPLE("sharkcode") + GRAY("          — 交互模式（直接启动）"));
    console.log("    " + PURPLE("sharkcode") + YELLOW(' "prompt"') + GRAY("  — 单次执行"));
    console.log(GRAY("\n  交互模式内输入 / 调出指令菜单，/help 查看所有命令"));
    console.log(GRAY("\n  支持 Provider：DeepSeek | OpenAI | OpenRouter | SiliconFlow | Groq"));
    console.log(GRAY("                Together AI | Qwen | Ollama | 方舟 | 自定义"));
    console.log(GRAY("\n  内置工具：read_file | write_file | edit_file | bash | glob"));
    console.log(GRAY("           grep | list_directory | web_fetch | think | playwright"));
    console.log(GRAY("\n  图片输入：消息中包含图片路径即可自动识别发送 (.png .jpg .webp 等)\n"));
    console.log(GRAY("  启动时会自动检查新版本；有更新时会直接显示提示，交互模式可用 /update 升级\n"));
    return;
  }

  if (args[0] === "--version" || args[0] === "-v") {
    console.log(`sharkcode v${currentVersion}`);
    return;
  }

  // ── Single-shot mode ──────────────────────────────────────────────────────
  if (args.length > 0) {
    const update = await checkForAvailableUpdate(currentVersion, "always");
    if (update) printUpdateNotice(update, false);
    const mc = readMultiConfig();
    const config = resolveConfig(mc);
    const codexReady = config.providerName === "codex" && (isCodexLoggedIn() || !!config.apiKey);
    if (!config.apiKey && config.providerName !== "ollama" && config.providerName !== "copilot" && !codexReady) {
      console.error(RED("❌ 未配置 API Key。请先运行 sharkcode 并输入 / 配置 Provider。"));
      process.exit(1);
    }
    console.log(
      chalk.hex("#c084fc")("\n🦈 SharkCode") +
      chalk.hex("#7c3aed")(` │ `) +
      chalk.hex("#a855f7")(`${PROVIDERS[config.providerName]?.label ?? config.providerName}`) +
      chalk.hex("#7c3aed")(` │ `) +
      chalk.hex("#d8b4fe")(`${config.model}\n`)
    );
    const singleInput = args.join(" ");
    const parsed = parseImagesFromInput(singleInput);
    const userContent = buildUserContent(parsed);
    if (parsed.loadedPaths.length > 0) {
      console.log(GRAY(`  📎 已加载 ${parsed.loadedPaths.length} 张图片`));
    }
    if (parsed.failedPaths.length > 0) {
      console.log(YELLOW(`  ⚠ 无法读取: ${parsed.failedPaths.join(", ")}`));
    }
    await runAgent([{ role: "user", content: userContent }], config);
    return;
  }

  // ── Interactive REPL mode ─────────────────────────────────────────────────
  console.log(BANNER);
  console.log(chalk.hex("#7c3aed")(`  v${currentVersion}`) + chalk.hex("#3b0764")("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━") + "\n");
  let availableUpdate = await checkForAvailableUpdate(currentVersion, "always");
  if (availableUpdate) {
    printUpdateNotice(availableUpdate, process.stdin.isTTY && process.stdout.isTTY);
  }

  let multiConfig = readMultiConfig();
  let config      = resolveConfig(multiConfig);

  // Apply saved permission mode
  setPermissionMode(multiConfig.permissionMode ?? "prompt");

  // Set raw mode ONCE for the entire REPL session.
  // readLineRaw only manages listeners; raw mode stays on throughout.
  try { process.stdin.setRawMode(true); process.stdin.resume(); } catch { /* not a TTY */ }

  console.log(statusLine(config));

  if (!config.apiKey && config.providerName !== "ollama" && config.providerName !== "copilot" &&
      !(config.providerName === "codex" && isCodexLoggedIn())) {
    console.log(
      YELLOW("  ⚠ 尚未配置 API Key。") +
      GRAY("输入 / 然后选择「切换 / 配置 Provider」\n")
    );
  }

  let messages: ModelMessage[] = [];

  while (true) {
    const raw = await readLineWithPalette("\n" + chalk.hex("#7c3aed")("❯ "));

    if (raw === null) { console.log(GRAY("\nBye! 🦈")); break; }

    const trimmed = raw.trim();
    if (!trimmed) continue;

    // Exit shortcuts
    if (trimmed === "exit" || trimmed === "quit" || trimmed === "/exit") { console.log(GRAY("Bye! 🦈")); break; }

    // /clear — clear history (also available from palette)
    if (trimmed === "/clear") {
      messages = [];
      console.log(GRAY("\n  ✓ 对话已清空\n"));
      continue;
    }

    // Bare "/" → command menu
    if (trimmed === "/") {
      const r = await showCommandMenu(multiConfig);
      multiConfig = r.multiConfig; config = r.config;
      if (r.clearHistory) messages = [];
      if (r.exit) break;
      // Restore raw mode after inquirer (which may have changed it)
      try { process.stdin.setRawMode(true); process.stdin.resume(); } catch {}
      console.log(statusLine(config));
      continue;
    }

    // /provider, /model, /key → setup flow directly
    if (
      trimmed === "/provider" || trimmed.startsWith("/provider ") ||
      trimmed === "/model"    || trimmed.startsWith("/model ")    ||
      trimmed === "/key"      || trimmed.startsWith("/key ")      ||
      trimmed === "/thinking" || trimmed.startsWith("/thinking ")
    ) {
      const r = trimmed === "/thinking" || trimmed.startsWith("/thinking ")
        ? await showThinkingSetupFlow(multiConfig)
        : await showSetupFlow(multiConfig);
      multiConfig = r.multiConfig; config = r.config;
      if (r.exit) break;
      // Restore raw mode after inquirer
      try { process.stdin.setRawMode(true); process.stdin.resume(); } catch {}
      console.log(statusLine(config));
      continue;
    }

    // /login → GitHub Copilot device flow
    if (trimmed === "/login") {
      const r = await runCopilotLogin(multiConfig);
      multiConfig = r.multiConfig; config = r.config;
      try { process.stdin.setRawMode(true); process.stdin.resume(); } catch {}
      console.log(statusLine(config));
      continue;
    }

    // /logout → clear Copilot / Codex credentials
    if (trimmed === "/logout") {
      const logoutTarget = multiConfig.activeProvider === "codex" ? "codex" : "copilot";
      if (logoutTarget === "codex") {
        clearCodexAuth();
        console.log(GRAY("\n  ✓ OpenAI Codex 登录已清除\n"));
        const updated: MultiConfig = { ...multiConfig, activeProvider: "deepseek" };
        saveMultiConfig(updated);
        multiConfig = updated; config = resolveConfig(updated);
        console.log(GRAY(`  已自动切换回 ${PROVIDERS.deepseek!.label}\n`));
        console.log(statusLine(config));
      } else {
        clearCopilotAuth();
        console.log(GRAY("\n  ✓ GitHub Copilot 登录已清除\n"));
        if (multiConfig.activeProvider === "copilot") {
          const updated: MultiConfig = { ...multiConfig, activeProvider: "deepseek" };
          saveMultiConfig(updated);
          multiConfig = updated; config = resolveConfig(updated);
          console.log(GRAY(`  已自动切换回 ${PROVIDERS.deepseek!.label}\n`));
          console.log(statusLine(config));
        }
      }
      continue;
    }

    if (trimmed === "/update") {      if (!availableUpdate) {
        console.log(GRAY("  当前未检测到可更新版本，仍将尝试安装 sharkcode@latest ...\n"));
      }

      const updated = runCliUpdate();
      if (updated) {
        availableUpdate = null;
      }
      continue;
    }

    if (trimmed === "/help") {
      const copilotStatus = isCopilotLoggedIn() ? GREEN("✓ 已登录") : GRAY("未登录");
      const codexStatus   = isCodexLoggedIn()   ? GREEN("✓ 已登录") : GRAY("未登录");

      console.log(`
${PURPLE("  可用命令：")}
  ${GRAY("/")}             ${GRAY("─ 打开指令菜单")}
  ${GRAY("/provider")}     ${GRAY("─ 切换 / 配置 Provider（含订阅登录）")}
  ${GRAY("/model")}        ${GRAY("─ 切换模型")}
  ${GRAY("/thinking")}     ${GRAY("─ 调整 OpenAI / Codex / Copilot 思考水平")}
  ${GRAY("/teach")}        ${GRAY("─ 开启/关闭教育模式")}
  ${GRAY("/login")}        ${GRAY("─ Copilot 快捷登录")} ${copilotStatus}
  ${GRAY("/logout")}       ${GRAY("─ 退出 Copilot / Codex 登录")}
  ${GRAY("/update")}       ${GRAY("─ 更新到最新版本")}
  ${GRAY("/help")}         ${GRAY("─ 显示此帮助")}
  ${GRAY("exit / quit")}   ${GRAY("─ 退出")}
  ${GRAY("Esc")}           ${GRAY("─ 中断当前 Agent 输出")}

${PURPLE("  订阅登录 — GitHub Copilot：")} ${copilotStatus}
  ${GRAY("输入 /provider → 选择 copilot → 直接弹出浏览器授权码")}
  ${GRAY("也可以输入 /login 快速进入授权流程")}
  ${GRAY("授权后直接使用 GitHub Copilot 订阅，无需 API Key")}
  ${GRAY("部分 Copilot 推理模型支持 /thinking 调整思考强度")}

${PURPLE("  订阅登录 — OpenAI Codex：")} ${codexStatus}
  ${GRAY("输入 /provider → 选择 codex → 选择「通过浏览器授权」")}
  ${GRAY("授权后使用 ChatGPT Plus/Pro/Codex 订阅，无需 API Key")}
  ${GRAY("也可以直接输入 OpenAI API Key 使用标准 API")}

${PURPLE("  教育模式：")}
  ${GRAY("/teach")}                 ${GRAY("─ 开启/关闭教育模式")}
  ${GRAY("/teach on")}              ${GRAY("─ 显式开启教育模式")}
  ${GRAY("/teach off")}             ${GRAY("─ 关闭教育模式")}
  ${GRAY("/teach model <name>")}    ${GRAY("─ 设置教学模型（如 gpt-4o-mini）")}
  ${GRAY("/teach level <level>")}   ${GRAY("─ 设置教学详略：简洁 / 标准 / 详细")}

${PURPLE("  可用工具 (Agent 自动调用)：")}
  ${CYAN("read_file")}     ${GRAY("─ 读取文件（支持行号范围）")}
  ${CYAN("write_file")}    ${GRAY("─ 创建/覆盖文件")}
  ${CYAN("edit_file")}     ${GRAY("─ 精确查找替换")}
  ${CYAN("bash")}          ${GRAY("─ 执行 Shell 命令")}
  ${CYAN("glob")}          ${GRAY("─ 按模式查找文件")}
  ${CYAN("grep")}          ${GRAY("─ 搜索文件内容")}
  ${CYAN("list_directory")}${GRAY("─ 目录树")}
  ${CYAN("web_fetch")}     ${GRAY("─ 抓取网页内容")}
  ${CYAN("think")}         ${GRAY("─ 复杂问题推理")}
  ${CYAN("playwright")}    ${GRAY("─ 控制可见浏览器")}

${PURPLE("  图片输入：")}
  ${GRAY("在消息中直接包含图片路径，自动识别并发送给 Agent：")}
  ${CYAN('分析这张截图 C:\\screenshots\\bug.png')}
  ${CYAN('这个UI有什么问题 ./design.png')}
  ${GRAY("支持格式: .png .jpg .jpeg .gif .webp .bmp .svg")}

${PURPLE("  版本更新：")}
  ${GRAY("启动时如果有新版本，会像 Codex 一样直接显示更新提示")}
  ${GRAY("在交互模式中输入 /update 可立即执行升级")}

${PURPLE("  项目配置：")}
  ${GRAY("在项目根目录创建 .sharkcode.md 文件，写入项目说明，Agent 会自动读取")}
`);
      continue;
    }

    // /teach — toggle/configure educational mode
    if (trimmed === "/teach" || trimmed.startsWith("/teach ")) {
      const result = handleTeachCommand(trimmed, multiConfig);
      if (result.multiConfig) {
        multiConfig = result.multiConfig;
        config = resolveConfig(result.multiConfig);
      }
      console.log(result.message);
      continue;
    }

    // Unknown slash command
    if (trimmed.startsWith("/")) {
      console.log(GRAY("  未知命令。输入 / 调出指令菜单\n"));
      continue;
    }

    // ── Send message to agent ──────────────────────────────────────────────
    const isCodexReady = config.providerName === "codex" && (isCodexLoggedIn() || !!config.apiKey);
    if (!config.apiKey && config.providerName !== "ollama" && config.providerName !== "copilot" && !isCodexReady) {
      console.log(YELLOW("  ⚠ 还未填写 API Key。输入 / → 切换 / 配置 Provider\n"));
      continue;
    }

    // ── Parse images from input and send message to agent ────────────────────
    const parsed = parseImagesFromInput(trimmed);
    const userContent = buildUserContent(parsed);

    if (parsed.loadedPaths.length > 0) {
      console.log(GRAY(`  📎 已加载 ${parsed.loadedPaths.length} 张图片: ${parsed.loadedPaths.map(p => p.split(/[/\\]/).pop()).join(", ")}`));
    }
    if (parsed.failedPaths.length > 0) {
      console.log(YELLOW(`  ⚠ 无法读取: ${parsed.failedPaths.join(", ")}`));
    }

    messages.push({ role: "user", content: userContent });

    // Set up interrupt: listen for Escape key while agent is running
    const abortSignal = createInterruptController();
    const interruptListener = (chunk: Buffer) => {
      const str = chunk.toString("utf8");
      // Escape key = \x1b (but NOT escape sequences like arrow keys which are \x1b[...)
      // We check for bare Escape: exactly 1 byte = 0x1b
      if (str === "\x1b") {
        triggerInterrupt();
      }
    };
    process.stdin.on("data", interruptListener);

    const teachingEnabled = multiConfig.teaching.enabled;
    const fallbackCheck = canUseEducationalMode({
      teachingEnabled,
      isTTY: process.stdout.isTTY,
      terminalWidth: process.stdout.columns,
    });

    let educationalApp: { unmount: () => void } | null = null;
    let eventBus: AgentEventBus | undefined;

    if (fallbackCheck.canUse) {
      const teachingModel = multiConfig.teaching.model ?? config.model;
      const teachingConfig = { ...config, model: teachingModel };

      eventBus = new AgentEventBus();
      const teachingOrchestrator = new TeachingOrchestrator({
        model: teachingModel,
        verbosity: multiConfig.teaching.verbosity,
        getProvider: () => createProvider(teachingConfig),
      });

      const toolCalls: Array<{ toolName: string; args: unknown }> = [];
      const toolResults: Array<{ toolName: string; result: string }> = [];
      let agentTextSummary = "";

      const unsubscribeContext = eventBus.subscribe((event) => {
        if (event.type === "tool-call") {
          toolCalls.push({ toolName: event.toolName, args: event.args });
        }
        if (event.type === "tool-result") {
          toolResults.push({ toolName: event.toolName, result: event.result });
        }
        if (event.type === "text-delta") {
          agentTextSummary += event.delta;
        }
        if (event.type === "run-end") {
          unsubscribeContext();
          void teachingOrchestrator.teach({
            userPrompt: trimmed,
            toolCalls,
            toolResults,
            agentTextSummary: agentTextSummary.slice(0, 500),
          }, abortSignal);
        }
      });

      educationalApp = startEducationalApp(eventBus, teachingOrchestrator, {
        onExit: () => {
          educationalApp?.unmount();
          educationalApp = null;
        },
      });
    } else if (teachingEnabled && fallbackCheck.reason) {
      printFallbackNotice(fallbackCheck.reason);
    }

    try {
      const result = await runAgent(messages, config, abortSignal, eventBus);
      messages = result.messages;

      if (result.interrupted) {
        process.stderr.write(
          GRAY("  按 Esc 已中断 · 可以继续输入新指令\n")
        );
      }
    } catch (err) {
      console.error(RED(`\n❌ ${String(err)}\n`));
      messages.pop();
    } finally {
      // Always clean up: remove interrupt listener, reset state, restore raw mode
      process.stdin.removeListener("data", interruptListener);
      resetInterrupt();
      if (educationalApp) {
        educationalApp.unmount();
        educationalApp = null;
      }
      try { process.stdin.setRawMode(true); process.stdin.resume(); } catch {}
    }
  }
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(chalk.red(`Fatal: ${String(err)}`));
    process.exit(1);
  });
}

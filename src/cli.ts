import { readFileSync, realpathSync } from "node:fs";
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
  type LearningVerbosity,
  type ThinkingLevel,
} from "./config.ts";
import { createSpinner, runAgent } from "./agent.ts";
import { setPermissionMode, getPermissionMode } from "./permission.ts";
import { createInterruptController, triggerInterrupt, resetInterrupt } from "./interrupt.ts";
import { parseImagesFromInput, buildUserContent } from "./image.ts";
import { checkForAvailableUpdate, getUpdateCommand, runGlobalUpdate, type AvailableUpdate } from "./update.ts";
import { loginWithDeviceFlow, isCopilotLoggedIn, clearCopilotAuth } from "./copilot-auth.ts";
import { getCopilotPresetModels } from "./copilot-models.ts";
import { loginWithCodexDeviceFlow, isCodexLoggedIn, clearCodexAuth } from "./codex-auth.ts";
import { createProvider, createProviderAsync } from "./provider.ts";
import { AgentEventBus } from "./agent-events.ts";
import type { TeachingContext } from "./teaching.ts";
import { handleLearnCommand, type LearnMenuAction } from "./learning/commands.ts";
import { detectLearningSignal } from "./learning/detector.ts";
import { formatLessonHint, formatLessonRecap, generateLearningLesson } from "./learning/lesson.ts";
import { answerLearningFollowUp, formatLearningFollowUpAnswer } from "./learning/follow-up.ts";
import { planLearningProject } from "./learning/project-planner.ts";
import {
  applyLessonToProfile,
  readLearningProfile,
  saveLearningProfile,
} from "./learning/profile.ts";
import { reviewLearningPrompt } from "./learning/prompt-coach.ts";
import { formatLearningProgress } from "./learning/progress.ts";
import {
  advanceLearningProject,
  formatLearningProjectCurrent,
  formatLearningProjectHint,
  formatLearningProjectLaunch,
  getLearningProjectSnapshot,
  rememberLearningProject,
} from "./learning/project.ts";
import {
  evaluateLearningQuizAnswer,
  formatLearningQuizPrompt,
  selectLearningQuizQuestion,
} from "./learning/quiz.ts";
import {
  createLearningSessionState,
  rememberLearningFollowUp,
  rememberLearningLesson,
} from "./learning/state.ts";
import type { LearningProfile, LearningSessionState } from "./learning/types.ts";
import type { ModelMessage } from "ai";
import {
  createDetachedSessionState,
  createSessionDraft,
  createSessionFromPrompt,
  listSessionSummaries,
  readSession,
  saveSession,
} from "./session/store.ts";
import type { PersistedSession, SessionDraft, SessionMode } from "./session/types.ts";
import { findAvailableSkill, listAvailableSkills, normalizeSkillId, resolveSkillContext } from "./skills/loader.ts";

// ─── Colors ───────────────────────────────────────────────────────────────────
const PURPLE = chalk.hex("#a855f7");
const GRAY   = chalk.gray;
const YELLOW = chalk.yellow;
const GREEN  = chalk.green;
const RED    = chalk.red;
const CYAN   = chalk.cyan;

export function ensureRunEnd(
  eventBus: AgentEventBus | undefined,
  didReceiveRunEnd: boolean,
): boolean {
  if (!eventBus || didReceiveRunEnd) {
    return didReceiveRunEnd;
  }

  eventBus.emit({ type: "run-end", interrupted: false });
  return true;
}

function restoreStdinRawMode(): void {
  try {
    process.stdin.setRawMode(true);
    process.stdin.resume();
  } catch {
    // Ignore non-TTY stdin so tests and piped execution keep working.
  }
}

async function withSpinner<T>(label: string, task: () => Promise<T>): Promise<T> {
  if (!process.stdout.isTTY) {
    return task();
  }

  const spinner = createSpinner(label);
  spinner.start();
  try {
    return await task();
  } finally {
    spinner.stop();
  }
}

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

interface SessionRuntimeState {
  currentSession: PersistedSession | null;
  pendingSessionDraft: SessionDraft | null;
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

// ─── Quick model switch (for /model command) ─────────────────────────────────
async function showModelSwitchFlow(multiConfig: MultiConfig): Promise<SlashResult> {
  const providerName = multiConfig.activeProvider;
  const providerLabel = PROVIDERS[providerName]?.label ?? providerName;
  const currentEntry = multiConfig.providers[providerName];
  const currentModel = currentEntry?.model ?? PROVIDERS[providerName]?.defaultModel ?? "";

  console.log(GRAY(`\n  当前 Provider: ${providerLabel}\n`));

  try {
    const newModel = await promptForModelSelection(providerName, currentModel);

    if (newModel === currentModel) {
      console.log(GRAY("\n  模型未更改\n"));
      return { multiConfig, config: resolveConfig(multiConfig) };
    }

    const updated: MultiConfig = {
      ...multiConfig,
      providers: {
        ...multiConfig.providers,
        [providerName]: {
          ...(multiConfig.providers[providerName] ?? {}),
          key: multiConfig.providers[providerName]?.key ?? "",
          model: newModel,
        },
      },
    };

    saveMultiConfig(updated);
    const config = resolveConfig(updated);
    console.log(GREEN(`\n  ✓ 模型已切换为 ${newModel}\n`));
    return { multiConfig: updated, config };
  } catch {
    console.log(GRAY("\n  取消\n"));
    return { multiConfig, config: resolveConfig(multiConfig) };
  }
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
        { name: "🗂  Session",                 value: "session"   },
        { name: "⚒  Build / Plan",            value: "mode"      },
        { name: "🧩  Skill",                   value: "skill"     },
        { name: "🔌  切换 / 配置 Provider",    value: "provider"  },
        { name: "🧠  调整思考水平",            value: "thinking"  },
        { name: multiConfig.learning.enabled ? "🎓  关闭上课模式" : "🎓  开启上课模式", value: "learn" },
        { name: permLabel,                      value: "permission"},
        { name: "🗑️  退出当前 Session",          value: "clear"     },
        { name: "🚪  退出",                      value: "exit"      },
      ],
    });
    switch (action) {
      case "back":
        console.log(GRAY(""));
        return { multiConfig, config: resolveConfig(multiConfig) };
      case "provider":   return showSetupFlow(multiConfig);
      case "thinking":   return showThinkingSetupFlow(multiConfig);
      case "session":
        console.log(GRAY("\n  提示：使用 /session new | /session list | /session switch <id>\n"));
        return { multiConfig, config: resolveConfig(multiConfig) };
      case "mode":
        console.log(GRAY("\n  提示：使用 Tab 或 /mode <build|plan> 切换模式\n"));
        return { multiConfig, config: resolveConfig(multiConfig) };
      case "skill":
        console.log(GRAY("\n  提示：使用 /skill list | /skill use <name> 管理 skills\n"));
        return { multiConfig, config: resolveConfig(multiConfig) };
      case "learn": {
        const updated: MultiConfig = {
          ...multiConfig,
          learning: { ...multiConfig.learning, enabled: !multiConfig.learning.enabled },
        };
        saveMultiConfig(updated);
        console.log(GREEN(`\n  ✓ 上课模式已${updated.learning.enabled ? "开启" : "关闭"}\n`));
        return { multiConfig: updated, config: resolveConfig(updated) };
      }
      case "permission": return togglePermissionMode(multiConfig);
      case "clear":
        console.log(GRAY("\n  ✓ 已退出当前 session\n"));
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

async function promptForLearningModelSelection(multiConfig: MultiConfig): Promise<string> {
  const providerName = multiConfig.activeProvider;
  const meta = PROVIDERS[providerName];
  const currentModel = multiConfig.learning.model?.trim() ?? "";
  const presetModels = providerName === "copilot"
    ? await getCopilotPresetModels()
    : PROVIDERS[providerName]?.presetModels ?? [];
  const modelHint = currentModel
    ? GRAY(`(回车保留 ${currentModel})`)
    : GRAY("(必须显式设置上课模型)");

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
    message: PURPLE("◆ 上课模型"),
    choices,
    default: currentModel && choices.some((choice) => choice.value === currentModel)
      ? currentModel
      : meta?.defaultModel,
  });

  if (selectedValue !== CUSTOM_MODEL_VALUE) {
    return selectedValue;
  }

  const rawModel = await input({
    message: PURPLE("◆ 上课模型 ") + modelHint,
    default: currentModel || undefined,
  });

  return rawModel.trim() || currentModel || meta?.defaultModel || "";
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
  { name: "/session",    description: "查看 / 切换历史任务" },
  { name: "/session new", description: "开始一个新任务" },
  { name: "/session list", description: "列出历史任务" },
  { name: "/session current", description: "查看当前任务" },
  { name: "/mode",       description: "切换 Build / Plan 模式" },
  { name: "/skill",      description: "查看 / 启用技能" },
  { name: "/provider",   description: "切换 / 配置 Provider（含订阅登录）" },
  { name: "/model",      description: "切换模型" },
  { name: "/thinking",   description: "调整思考水平" },
  { name: "/permission", description: "切换权限模式（默认 / Full Access）" },
  { name: "/learn",      description: "打开学习中心 / 开启或关闭上课模式" },
  { name: "/learn start", description: "启动一个 Vibe Coding 引导项目" },
  { name: "/learn next", description: "查看当前引导阶段" },
  { name: "/learn hint", description: "查看当前阶段的提问提示" },
  { name: "/learn complete", description: "完成当前阶段并推进下一步" },
  { name: "/learn progress", description: "查看学习进度和学习等级" },
  { name: "/learn recap", description: "查看本轮课堂回顾" },
  { name: "/learn ask", description: "追问本轮课堂讲解" },
  { name: "/learn quiz", description: "来一道中文学习小测" },
  { name: "/learn model", description: "选择 / 设置上课模型" },
  { name: "/learn level", description: "设置讲解详略（简洁/标准/详细）" },
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

        if (code === 9 && buffer.length === 0) {
          process.stdout.write("\n");
          finish("__toggle_mode__");
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
function statusLine(
  config: Config,
  multiConfig: MultiConfig,
  runtimeState?: SessionRuntimeState,
): string {
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
  const learningModel = multiConfig.learning.model?.trim() ?? "";
  const learningBadge = multiConfig.learning.enabled
    ? chalk.hex("#22c55e")(learningModel ? `  🎓 上课:${learningModel}` : "  🎓 上课:未配置模型")
    : "";
  const activeProject = runtimeState?.currentSession?.learningState.activeProject ?? null;
  const projectBadge = activeProject
    ? chalk.hex("#f97316")(`  🎯 ${activeProject.title}`)
    : "";
  const mode = runtimeState?.currentSession?.mode ?? runtimeState?.pendingSessionDraft?.mode ?? "build";
  const modeBadge = mode === "plan"
    ? chalk.hex("#f59e0b")("  🧭 Plan")
    : chalk.hex("#38bdf8")("  ⚒ Build");
  const sessionLabel = runtimeState?.currentSession?.title
    ?? (runtimeState?.pendingSessionDraft ? "新任务待开始" : "无活动任务");
  const sessionBadge = chalk.hex("#d8b4fe")(`  🗂 ${sessionLabel}`);
  return (
    chalk.hex("#d8b4fe")("  ◆ ") +
    BRIGHT_PURPLE(label) +
    DEEP_PURPLE(`  [${config.model}]`) +
    thinkingBadge +
    projectBadge +
    modeBadge +
    sessionBadge +
    permBadge +
    learningBadge +
    chalk.hex("#6b21a8")("   / 指令菜单 · Tab 切换 Build/Plan · Esc 中断\n")
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

function createTeachingContextCollector() {
  const toolCalls: Array<{ toolName: string; args: unknown }> = [];
  const toolResults: Array<{ toolName: string; result: string }> = [];
  const toolErrors: Array<{ toolName: string; error: string }> = [];
  const agentErrors: string[] = [];
  let agentTextSummary = "";
  let interrupted = false;

  return {
    capture(event: Parameters<AgentEventBus["emit"]>[0]) {
      if (event.type === "tool-call") {
        toolCalls.push({ toolName: event.toolName, args: event.args });
      }
      if (event.type === "tool-result") {
        toolResults.push({ toolName: event.toolName, result: event.result });
      }
      if (event.type === "tool-error") {
        toolErrors.push({ toolName: event.toolName, error: event.error });
      }
      if (event.type === "text-delta") {
        agentTextSummary += event.delta;
      }
      if (event.type === "error") {
        agentErrors.push(event.message);
      }
      if (event.type === "run-end") {
        interrupted = event.interrupted;
      }
    },
    build(userPrompt: string, options?: {
      promptReview?: TeachingContext["promptReview"];
      projectSnapshot?: TeachingContext["projectSnapshot"];
    }): TeachingContext {
      return {
        userPrompt,
        toolCalls,
        toolResults,
        toolErrors,
        agentErrors,
        interrupted,
        agentTextSummary: agentTextSummary.slice(0, 500),
        promptReview: options?.promptReview ?? null,
        projectSnapshot: options?.projectSnapshot ?? null,
      };
    },
  };
}

async function chooseLearnMenuAction(multiConfig: MultiConfig): Promise<LearnMenuAction> {
  return select({
    message: PURPLE("◆ 学习中心"),
    choices: [
      { name: multiConfig.learning.enabled ? "关闭上课模式" : "开启上课模式", value: "toggle" },
      { name: "启动引导项目", value: "start" },
      { name: "查看当前阶段", value: "next" },
      { name: "查看阶段提示", value: "hint" },
      { name: "完成当前阶段", value: "complete" },
      { name: "查看学习进度", value: "progress" },
      { name: "查看本轮回顾", value: "recap" },
      { name: "追问本轮讲解", value: "ask" },
      { name: "来一道小测", value: "quiz" },
      { name: "设置上课模型", value: "model" },
      { name: "设置讲解详略", value: "level" },
      { name: "返回", value: "close" },
    ],
  }) as Promise<LearnMenuAction>;
}

function formatLearningRecap(state: LearningSessionState): string {
  return formatLessonRecap(state.lastLesson);
}

function formatLearningProgressSummary(profile: LearningProfile, state: LearningSessionState): string {
  return `${formatLearningProgress(profile).trimEnd()}\n${formatLearningProjectCurrent(state.activeProject).trimEnd()}\n`;
}

async function runLearningQuiz(profile: LearningProfile): Promise<{
  message: string;
  profile?: LearningProfile;
}> {
  const question = selectLearningQuizQuestion(profile);
  console.log(formatLearningQuizPrompt(question));

  const answer = await input({
    message: PURPLE("◆ 你的答案") + GRAY(" (一句话即可)"),
  });

  if (!answer.trim()) {
    return { message: "  本次未作答，小测已取消。\n" };
  }

  const result = evaluateLearningQuizAnswer(profile, question, answer);
  saveLearningProfile(result.profile);
  return {
    message: result.message,
    profile: result.profile,
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

  if (args.length > 0) {
    const update = await checkForAvailableUpdate(currentVersion, "always");
    if (update) printUpdateNotice(update, false);
    const mc = readMultiConfig();
    const config = resolveConfig(mc);
    const codexReady = config.providerName === "codex" && (isCodexLoggedIn() || !!config.apiKey);
    if (!config.apiKey && config.providerName !== "ollama" && config.providerName !== "copilot" && !codexReady) {
      console.error(RED("❌ 未配置 API Key。请先运行 sharkcode 并输入 / 配置 Provider。"));
      process.exitCode = 1;
      return;
    }

    console.log(
      chalk.hex("#c084fc")("\n🦈 SharkCode") +
      chalk.hex("#7c3aed")(` │ `) +
      chalk.hex("#a855f7")(`${PROVIDERS[config.providerName]?.label ?? config.providerName}`) +
      chalk.hex("#7c3aed")(` │ `) +
      chalk.hex("#d8b4fe")(`${config.model}\n`),
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

  console.log(BANNER);
  console.log(chalk.hex("#7c3aed")(`  v${currentVersion}`) + chalk.hex("#3b0764")("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━") + "\n");
  let availableUpdate = await checkForAvailableUpdate(currentVersion, "always");
  if (availableUpdate) {
    printUpdateNotice(availableUpdate, process.stdin.isTTY && process.stdout.isTTY);
  }

  let multiConfig = readMultiConfig();
  let config = resolveConfig(multiConfig);
  let learningProfile = readLearningProfile();
  let sessionRuntime: SessionRuntimeState = {
    currentSession: null,
    pendingSessionDraft: createSessionDraft(),
  };
  let learningSessionState = createLearningSessionState();

  setPermissionMode(multiConfig.permissionMode ?? "prompt");
  try { process.stdin.setRawMode(true); process.stdin.resume(); } catch {}

  console.log(statusLine(config, multiConfig, sessionRuntime));

  if (!config.apiKey && config.providerName !== "ollama" && config.providerName !== "copilot" &&
      !(config.providerName === "codex" && isCodexLoggedIn())) {
    console.log(
      YELLOW("  ⚠ 尚未配置 API Key。") +
      GRAY("输入 / 然后选择「切换 / 配置 Provider」\n"),
    );
  }

  let messages: ModelMessage[] = [];

  while (true) {
    const raw = await readLineWithPalette("\n" + chalk.hex("#7c3aed")("❯ "));
    if (raw === null) {
      console.log(GRAY("\nBye! 🦈"));
      break;
    }

    if (raw === "__toggle_mode__") {
      const activeMode = sessionRuntime.currentSession?.mode ?? sessionRuntime.pendingSessionDraft?.mode ?? "build";
      const nextMode: SessionMode = activeMode === "plan" ? "build" : "plan";

      if (sessionRuntime.currentSession) {
        sessionRuntime.currentSession = saveSession({
          ...sessionRuntime.currentSession,
          mode: nextMode,
        });
      } else {
        sessionRuntime = {
          ...sessionRuntime,
          pendingSessionDraft: {
            mode: nextMode,
            activeSkills: sessionRuntime.pendingSessionDraft?.activeSkills ?? [],
          },
        };
      }

      console.log(GREEN(`  ✓ 已切换到 ${nextMode === "plan" ? "Plan" : "Build"} 模式\n`));
      console.log(statusLine(config, multiConfig, sessionRuntime));
      continue;
    }

    const trimmed = raw.trim();
    if (!trimmed) continue;

    if (trimmed === "exit" || trimmed === "quit" || trimmed === "/exit") {
      console.log(GRAY("Bye! 🦈"));
      break;
    }

    if (trimmed === "/clear") {
      sessionRuntime = {
        currentSession: null,
        pendingSessionDraft: createSessionDraft(),
      };
      messages = [];
      learningSessionState = createLearningSessionState();
      console.log(GRAY("\n  ✓ 已退出当前 session\n"));
      console.log(statusLine(config, multiConfig, sessionRuntime));
      continue;
    }

    if (trimmed === "/") {
      const r = await showCommandMenu(multiConfig);
      multiConfig = r.multiConfig;
      config = r.config;
      if (r.clearHistory) messages = [];
      if (r.exit) break;
      restoreStdinRawMode();
      console.log(statusLine(config, multiConfig, sessionRuntime));
      continue;
    }

    if (trimmed === "/session" || trimmed.startsWith("/session ")) {
      const command = trimmed.split(/\s+/);

      if (command[1] === "new" || trimmed === "/session") {
        sessionRuntime = {
          currentSession: null,
          pendingSessionDraft: createSessionDraft(),
        };
        messages = [];
        learningSessionState = createLearningSessionState();
        console.log(GREEN("  ✓ 已进入新任务待开始状态\n"));
        console.log(statusLine(config, multiConfig, sessionRuntime));
        continue;
      }

      if (command[1] === "list") {
        const sessions = listSessionSummaries();
        if (sessions.length === 0) {
          console.log("\n  🗂 暂无历史 session。\n");
        } else {
          console.log(["", "  🗂 历史 session", ...sessions.map((session) => `  - ${session.id} | ${session.title} | ${session.updatedAt} | ${session.mode}`), ""].join("\n"));
        }
        continue;
      }

      if (command[1] === "current") {
        const current = sessionRuntime.currentSession;
        if (!current) {
          console.log("\n  🗂 当前没有活动任务。\n");
        } else {
          console.log(["", "  🗂 当前任务", `  id：${current.id}`, `  标题：${current.title}`, `  模式：${current.mode}`, `  更新时间：${current.updatedAt}`, ""].join("\n"));
        }
        continue;
      }

      if (command[1] === "switch") {
        const id = command.slice(2).join(" ").trim();
        if (!id) {
          console.log("  ✗ 用法：/session switch <id>\n");
          continue;
        }

        const nextSession = readSession(id);
        if (!nextSession) {
          console.log(`  ✗ 未找到 session：${id}\n`);
          continue;
        }

        sessionRuntime = {
          currentSession: nextSession,
          pendingSessionDraft: null,
        };
        messages = nextSession.messages;
        learningSessionState = nextSession.learningState;
        console.log(GREEN(`  ✓ 已切换到 session：${nextSession.title}\n`));
        console.log(statusLine(config, multiConfig, sessionRuntime));
        continue;
      }

      console.log("  ✗ 用法：/session | /session new | /session list | /session current | /session switch <id>\n");
      continue;
    }

    if (trimmed === "/mode" || trimmed.startsWith("/mode ")) {
      const next = trimmed.split(/\s+/)[1];
      if (next !== "build" && next !== "plan") {
        console.log("  ✗ 用法：/mode <build|plan>\n");
        continue;
      }

      if (sessionRuntime.currentSession) {
        sessionRuntime.currentSession = saveSession({
          ...sessionRuntime.currentSession,
          mode: next,
        });
      } else {
        sessionRuntime = {
          ...sessionRuntime,
          pendingSessionDraft: {
            mode: next,
            activeSkills: sessionRuntime.pendingSessionDraft?.activeSkills ?? [],
          },
        };
      }

      console.log(GREEN(`  ✓ 已切换到 ${next === "plan" ? "Plan" : "Build"} 模式\n`));
      console.log(statusLine(config, multiConfig, sessionRuntime));
      continue;
    }

    if (trimmed === "/skill" || trimmed.startsWith("/skill ")) {
      const command = trimmed.split(/\s+/);
      const activeSkills = sessionRuntime.currentSession?.activeSkills ?? sessionRuntime.pendingSessionDraft?.activeSkills ?? [];

      if (command.length === 1 || command[1] === "list") {
        const skills = listAvailableSkills();
        console.log([
          "",
          "  🧩 可用 skills",
          ...(skills.length === 0
            ? ["  - 暂无自定义 skill"]
            : skills.map((skill) => `  - ${skill.id} [${skill.source}]${activeSkills.includes(skill.id) ? "  (当前)" : ""}: ${skill.description}`)),
          "",
        ].join("\n"));
        continue;
      }

      if (command[1] === "current") {
        const context = resolveSkillContext(activeSkills, sessionRuntime.currentSession?.mode ?? sessionRuntime.pendingSessionDraft?.mode ?? "build");
        console.log([
          "",
          "  🧩 当前 skills",
          ...(context.skills.length === 0 ? ["  - 暂无"] : context.skills.map((skill) => `  - ${skill.id}`)),
          "",
        ].join("\n"));
        continue;
      }

      if (command[1] === "clear") {
        if (sessionRuntime.currentSession) {
          sessionRuntime.currentSession = saveSession({
            ...sessionRuntime.currentSession,
            activeSkills: [],
          });
        } else {
          sessionRuntime = {
            ...sessionRuntime,
            pendingSessionDraft: {
              mode: sessionRuntime.pendingSessionDraft?.mode ?? "build",
              activeSkills: [],
            },
          };
        }
        console.log(GREEN("  ✓ 已清空当前 session 的 skills\n"));
        continue;
      }

      if (command[1] === "use") {
        const skillId = normalizeSkillId(command.slice(2).join(" "));
        if (!skillId) {
          console.log("  ✗ 用法：/skill use <name>\n");
          continue;
        }

        const skill = findAvailableSkill(skillId);
        if (!skill) {
          console.log(`  ✗ 未找到 skill：${skillId}\n`);
          continue;
        }

        const nextSkills = Array.from(new Set([...activeSkills, skill.id]));
        if (sessionRuntime.currentSession) {
          sessionRuntime.currentSession = saveSession({
            ...sessionRuntime.currentSession,
            activeSkills: nextSkills,
          });
        } else {
          sessionRuntime = {
            ...sessionRuntime,
            pendingSessionDraft: {
              mode: sessionRuntime.pendingSessionDraft?.mode ?? "build",
              activeSkills: nextSkills,
            },
          };
        }
        console.log(GREEN(`  ✓ 已启用 skill：${skill.id}\n`));
        continue;
      }

      console.log("  ✗ 用法：/skill | /skill list | /skill use <name> | /skill current | /skill clear\n");
      continue;
    }

    if (trimmed === "/provider" || trimmed.startsWith("/provider ")) {
      const r = await showSetupFlow(multiConfig);
      multiConfig = r.multiConfig;
      config = r.config;
      if (r.exit) break;
      restoreStdinRawMode();
      console.log(statusLine(config, multiConfig, sessionRuntime));
      continue;
    }

    if (trimmed === "/model" || trimmed.startsWith("/model ")) {
      const r = await showModelSwitchFlow(multiConfig);
      multiConfig = r.multiConfig;
      config = r.config;
      restoreStdinRawMode();
      console.log(statusLine(config, multiConfig, sessionRuntime));
      continue;
    }

    if (trimmed === "/thinking" || trimmed.startsWith("/thinking ")) {
      const r = await showThinkingSetupFlow(multiConfig);
      multiConfig = r.multiConfig;
      config = r.config;
      try { process.stdin.setRawMode(true); process.stdin.resume(); } catch {}
      console.log(statusLine(config, multiConfig, sessionRuntime));
      continue;
    }

    if (trimmed === "/permission") {
      const r = await togglePermissionMode(multiConfig);
      multiConfig = r.multiConfig;
      config = r.config;
      console.log(statusLine(config, multiConfig, sessionRuntime));
      continue;
    }

    if (trimmed === "/update") {
      if (!availableUpdate) {
        console.log(GRAY("  当前未检测到可更新版本，仍将尝试安装 sharkcode@latest ...\n"));
      }

      const updated = runCliUpdate();
      if (updated) {
        availableUpdate = null;
      }
      continue;
    }

    if (trimmed === "/help") {
      console.log(`
${PURPLE("  可用命令：")}
  ${GRAY("/session")}      ${GRAY("─ 查看 / 切换历史任务")}
  ${GRAY("/session new")}  ${GRAY("─ 开始一个新任务")}
  ${GRAY("/session list")} ${GRAY("─ 列出历史任务")}
  ${GRAY("/session current")} ${GRAY("─ 查看当前任务")}
  ${GRAY("/mode")}         ${GRAY("─ 切换 Build / Plan 模式")}
  ${GRAY("/skill")}        ${GRAY("─ 查看 / 启用技能")}
  ${GRAY("/")}             ${GRAY("─ 打开指令菜单")}
  ${GRAY("/provider")}     ${GRAY("─ 切换 / 配置 Provider（含订阅登录）")}
  ${GRAY("/model")}        ${GRAY("─ 切换模型")}
  ${GRAY("/thinking")}     ${GRAY("─ 调整思考水平")}
  ${GRAY("/permission")}   ${GRAY("─ 切换权限模式（默认 / Full Access）")}
  ${GRAY("/learn")}        ${GRAY("─ 打开学习中心 / 开启或关闭上课模式")}
  ${GRAY("/update")}       ${GRAY("─ 更新到最新版本")}
  ${GRAY("/help")}         ${GRAY("─ 显示此帮助")}
  ${GRAY("exit / quit")}   ${GRAY("─ 退出")}
  ${GRAY("Esc")}           ${GRAY("─ 中断当前 Agent 输出")}

${PURPLE("  上课模式：")}
  ${GRAY("/learn")}                 ${GRAY("─ 打开学习中心")}
  ${GRAY("/learn on")}              ${GRAY("─ 显式开启上课模式")}
  ${GRAY("/learn off")}             ${GRAY("─ 关闭上课模式")}
  ${GRAY("/learn start [项目描述]")} ${GRAY("─ 启动一个引导式 Vibe Coding 项目")}
  ${GRAY("/learn next")}            ${GRAY("─ 查看当前引导阶段")}
  ${GRAY("/learn hint")}            ${GRAY("─ 查看当前阶段推荐提问方式")}
  ${GRAY("/learn complete")}        ${GRAY("─ 完成当前阶段并推进下一步")}
  ${GRAY("/learn progress")}        ${GRAY("─ 查看学习进度和学习等级")}
  ${GRAY("/learn recap")}           ${GRAY("─ 查看本轮课堂讲解")}
  ${GRAY("/learn ask [问题]")}      ${GRAY("─ 追问本轮课堂讲解")}
  ${GRAY("/learn quiz")}            ${GRAY("─ 来一道中文学习小测")}
  ${GRAY("/learn model [name]")}    ${GRAY("─ 选择 / 设置上课模型")}
  ${GRAY("/learn level <level>")}   ${GRAY("─ 设置讲解详略：简洁 / 标准 / 详细")}

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
  ${GRAY("启动时如果有新版本，会直接显示更新提示")}
  ${GRAY("在交互模式中输入 /update 可立即执行升级")}

${PURPLE("  项目配置：")}
  ${GRAY("在项目根目录创建 .sharkcode.md 文件，写入项目说明，Agent 会自动读取")}
`);
      continue;
    }

    if (trimmed === "/learn" || trimmed.startsWith("/learn ")) {
      const result = await handleLearnCommand(trimmed, multiConfig, {
        chooseMenuAction: chooseLearnMenuAction,
        promptForModelSelection: promptForLearningModelSelection,
        formatProgress: formatLearningProgressSummary,
        formatRecap: (state) => formatLearningRecap(state),
        runQuiz: runLearningQuiz,
        profile: learningProfile,
        sessionState: learningSessionState,
        saveConfig: saveMultiConfig,
      });
      restoreStdinRawMode();
      if (result.multiConfig) {
        multiConfig = result.multiConfig;
        config = resolveConfig(result.multiConfig);
      }
      if (result.profile) {
        learningProfile = result.profile;
      }

      if (result.showProjectCurrent) {
        console.log(formatLearningProjectCurrent(learningSessionState.activeProject));
        continue;
      }

      if (result.showProjectHint) {
        console.log(formatLearningProjectHint(learningSessionState.activeProject));
        continue;
      }

      if (result.completeProject) {
        const advanced = advanceLearningProject(learningSessionState);
        learningSessionState = advanced.sessionState;
        if (sessionRuntime.currentSession) {
          sessionRuntime.currentSession = saveSession({
            ...sessionRuntime.currentSession,
            learningState: learningSessionState,
            providerName: config.providerName,
            model: config.model,
            learningModel: multiConfig.learning.model?.trim(),
          });
        }
        console.log(advanced.message);
        continue;
      }

      if (typeof result.startProjectDescription === "string") {
        const lessonModel = multiConfig.learning.model?.trim();
        if (!lessonModel) {
          console.log("\n  🎓 尚未设置上课模型。请先使用 /learn model <name>。\n");
          continue;
        }

        let description = result.startProjectDescription.trim();
        if (!description) {
          let prompted = "";
          try {
            prompted = await input({
              message: PURPLE("◆ 你想做什么项目") + GRAY(" (一句话描述即可)"),
            });
          } catch {
            restoreStdinRawMode();
            console.log("  取消\n");
            continue;
          }
          restoreStdinRawMode();
          description = prompted.trim();
        }

        if (!description) {
          console.log("  取消\n");
          continue;
        }

        try {
          const project = await withSpinner("正在生成项目计划...", () =>
            planLearningProject({
              description,
              learning: multiConfig.learning,
              model: lessonModel,
              getProvider: () => createProviderAsync({ ...config, model: lessonModel }),
            })
          );
          learningSessionState = rememberLearningProject(learningSessionState, project);
          if (sessionRuntime.currentSession) {
            sessionRuntime.currentSession = saveSession({
              ...sessionRuntime.currentSession,
              learningState: learningSessionState,
              providerName: config.providerName,
              model: config.model,
              learningModel: lessonModel,
            });
          }
          console.log(formatLearningProjectLaunch(project));
        } catch (error) {
          console.log(RED(`\n  ✗ ${String(error)}\n`));
        }
        continue;
      }

      if (typeof result.askQuestion === "string") {
        if (!sessionRuntime.currentSession) {
          console.log("\n  🎓 当前没有活动 session，先开始一个任务或切换历史 session。\n");
          continue;
        }

        const lessonModel = multiConfig.learning.model?.trim();
        if (!lessonModel) {
          console.log("\n  🎓 尚未设置上课模型。请先使用 /learn model <name>。\n");
          continue;
        }

        let question = result.askQuestion.trim();
        if (!question) {
          let prompted = "";
          try {
            prompted = await input({
              message: PURPLE("◆ 继续追问") + GRAY(" (直接输入问题)"),
            });
          } catch {
            restoreStdinRawMode();
            console.log("  取消\n");
            continue;
          }
          restoreStdinRawMode();
          question = prompted.trim();
        }

        if (!question) {
          console.log("  取消\n");
          continue;
        }

        try {
          const answer = await withSpinner("正在回答追问...", () =>
            answerLearningFollowUp({
              question,
              learning: multiConfig.learning,
              model: lessonModel,
              sessionState: learningSessionState,
              getProvider: () => createProviderAsync({ ...config, model: lessonModel }),
            })
          );
          learningSessionState = rememberLearningFollowUp(learningSessionState, question, answer);
          sessionRuntime.currentSession = saveSession({
            ...sessionRuntime.currentSession,
            learningState: learningSessionState,
            learningModel: lessonModel,
            providerName: config.providerName,
            model: config.model,
          });
          console.log(formatLearningFollowUpAnswer(answer));
        } catch (error) {
          console.log(RED(`\n  ✗ ${String(error)}\n`));
        }
        continue;
      }

      console.log(result.message);
      continue;
    }

    if (trimmed.startsWith("/")) {
      console.log(GRAY("  未知命令。输入 / 调出指令菜单\n"));
      continue;
    }

    const isCodexReady = config.providerName === "codex" && (isCodexLoggedIn() || !!config.apiKey);
    if (!config.apiKey && config.providerName !== "ollama" && config.providerName !== "copilot" && !isCodexReady) {
      console.log(YELLOW("  ⚠ 还未填写 API Key。输入 / → 切换 / 配置 Provider\n"));
      continue;
    }

    const parsed = parseImagesFromInput(trimmed);
    const userContent = buildUserContent(parsed);

    if (!sessionRuntime.currentSession) {
      const draft = sessionRuntime.pendingSessionDraft ?? createSessionDraft();
      const created = saveSession(createSessionFromPrompt({
        prompt: trimmed,
        mode: draft.mode,
        activeSkills: draft.activeSkills,
        providerName: config.providerName,
        model: config.model,
        learningModel: multiConfig.learning.model?.trim(),
      }));
      sessionRuntime = {
        currentSession: created,
        pendingSessionDraft: null,
      };
      const detached = createDetachedSessionState(created);
      messages = detached.messages;
      learningSessionState = detached.learningState;
    }

    if (parsed.loadedPaths.length > 0) {
      console.log(GRAY(`  📎 已加载 ${parsed.loadedPaths.length} 张图片: ${parsed.loadedPaths.map((p) => p.split(/[/\\]/).pop()).join(", ")}`));
    }
    if (parsed.failedPaths.length > 0) {
      console.log(YELLOW(`  ⚠ 无法读取: ${parsed.failedPaths.join(", ")}`));
    }

    messages.push({ role: "user", content: userContent });

    const abortSignal = createInterruptController();
    const interruptListener = (chunk: Buffer) => {
      if (chunk.toString("utf8") === "\x1b") {
        triggerInterrupt();
      }
    };
    process.stdin.on("data", interruptListener);

    const collector = createTeachingContextCollector();
    const eventBus = new AgentEventBus();
    let didReceiveRunEnd = false;
    eventBus.subscribe((event) => {
      collector.capture(event);
      if (event.type === "run-end") {
        didReceiveRunEnd = true;
      }
    });

    try {
      try {
        const skillContext = resolveSkillContext(
          sessionRuntime.currentSession?.activeSkills ?? [],
          sessionRuntime.currentSession?.mode ?? "build",
        );
        const result = await runAgent(messages, config, abortSignal, eventBus, true, {
          runtimePolicy: skillContext.runtimePolicy,
          systemReminders: skillContext.systemReminders,
        });
        messages = result.messages;
        if (sessionRuntime.currentSession) {
          sessionRuntime.currentSession = saveSession({
            ...sessionRuntime.currentSession,
            messages,
            learningState: learningSessionState,
            providerName: config.providerName,
            model: config.model,
            learningModel: multiConfig.learning.model?.trim(),
          });
        }

        if (result.interrupted) {
          process.stderr.write(GRAY("  按 Esc 已中断 · 可以继续输入新指令\n"));
        }
      } catch (err) {
        eventBus.emit({ type: "error", message: String(err) });
        didReceiveRunEnd = ensureRunEnd(eventBus, didReceiveRunEnd);
        console.error(RED(`\n❌ ${String(err)}\n`));
        messages.pop();
      }

      if (multiConfig.learning.enabled) {
        const lessonModel = multiConfig.learning.model?.trim();
        const promptReview = reviewLearningPrompt({
          prompt: trimmed,
          project: learningSessionState.activeProject,
        });
        const lessonContext = collector.build(trimmed, {
          promptReview,
          projectSnapshot: getLearningProjectSnapshot(learningSessionState.activeProject),
        });
        const signal = detectLearningSignal(lessonContext);
        if (!lessonModel && signal.shouldGenerate) {
          process.stdout.write("\n  🎓 尚未设置上课模型，课堂讲解已暂停。请先使用 /learn model <name>。\n");
        }
        if (signal.shouldGenerate && lessonModel) {
          const lesson = await withSpinner("正在生成课堂讲解...", () =>
            generateLearningLesson({
              context: lessonContext,
              learning: multiConfig.learning,
              model: lessonModel,
              concepts: signal.concepts,
              getProvider: () => createProviderAsync({ ...config, model: lessonModel }),
            })
          );

          if (lesson) {
            learningSessionState = rememberLearningLesson(learningSessionState, lesson);
            learningProfile = applyLessonToProfile(learningProfile, lesson, 5);
            saveLearningProfile(learningProfile);
            if (sessionRuntime.currentSession) {
              sessionRuntime.currentSession = saveSession({
                ...sessionRuntime.currentSession,
                messages,
                learningState: learningSessionState,
                providerName: config.providerName,
                model: config.model,
                learningModel: lessonModel,
              });
            }

            if (multiConfig.learning.autoCards) {
              process.stdout.write(formatLessonHint(lesson));
            }
          }
        }
      }
    } finally {
      process.stdin.removeListener("data", interruptListener);
      resetInterrupt();
      restoreStdinRawMode();
    }
  }
}

export function isDirectCliEntrypoint(
  argv1: string | undefined,
  moduleUrl: string,
  resolveRealPath: (path: string) => string = realpathSync,
): boolean {
  if (!argv1) {
    return false;
  }

  const modulePath = fileURLToPath(moduleUrl);

  try {
    return resolveRealPath(resolvePath(argv1)) === resolveRealPath(modulePath);
  } catch {
    return resolvePath(argv1) === modulePath;
  }
}

if (isDirectCliEntrypoint(process.argv[1], import.meta.url)) {
  main().catch((err) => {
    console.error(chalk.red(`Fatal: ${String(err)}`));
    process.exitCode = 1;
  });
}

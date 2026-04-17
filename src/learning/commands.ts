import type { LearningConfig, LearningVerbosity, MultiConfig } from "../config.ts";
import type { LearningProfile, LearningSessionState } from "./types.ts";

export interface LearnCommandResult {
  multiConfig?: MultiConfig;
  profile?: LearningProfile;
  message: string;
  askQuestion?: string;
  startProjectDescription?: string;
  showProjectCurrent?: boolean;
  showProjectHint?: boolean;
  completeProject?: boolean;
}

export type LearnMenuAction =
  | "toggle"
  | "progress"
  | "recap"
  | "ask"
  | "quiz"
  | "model"
  | "level"
  | "start"
  | "next"
  | "hint"
  | "complete"
  | "close";

export interface LearnCommandDependencies {
  chooseMenuAction: (multiConfig: MultiConfig) => Promise<LearnMenuAction>;
  promptForModelSelection: (multiConfig: MultiConfig) => Promise<string>;
  formatProgress: (profile: LearningProfile, state: LearningSessionState) => string;
  formatRecap: (state: LearningSessionState, profile: LearningProfile) => string;
  runQuiz: (profile: LearningProfile) => Promise<LearnCommandResult>;
  profile: LearningProfile;
  sessionState: LearningSessionState;
  saveConfig: (multiConfig: MultiConfig) => void;
}

export function isLearningVerbosity(value: string): value is LearningVerbosity {
  return value === "简洁" || value === "标准" || value === "详细";
}

export async function handleLearnCommand(
  input: string,
  multiConfig: MultiConfig,
  deps: LearnCommandDependencies,
): Promise<LearnCommandResult> {
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);

  if (parts[0] !== "/learn") {
    return { message: buildUsageMessage() };
  }

  if (parts.length === 1) {
    let action: LearnMenuAction;
    try {
      action = await deps.chooseMenuAction(multiConfig);
    } catch {
      return { message: "  取消\n" };
    }

    switch (action) {
      case "toggle": {
        const enabled = !multiConfig.learning.enabled;
        return saveLearningConfig(
          multiConfig,
          { ...multiConfig.learning, enabled },
          deps.saveConfig,
          `  ✓ 上课模式已${enabled ? "开启" : "关闭"}\n`,
        );
      }
      case "progress":
        return { message: deps.formatProgress(deps.profile, deps.sessionState) };
      case "recap":
        return { message: deps.formatRecap(deps.sessionState, deps.profile) };
      case "ask":
        return { message: "", askQuestion: "" };
      case "start":
        return { message: "", startProjectDescription: "" };
      case "next":
        return { message: "", showProjectCurrent: true };
      case "hint":
        return { message: "", showProjectHint: true };
      case "complete":
        return { message: "", completeProject: true };
      case "quiz":
        try {
          return await deps.runQuiz(deps.profile);
        } catch {
          return { message: "  取消\n" };
        }
      case "model": {
        let model: string;
        try {
          model = await deps.promptForModelSelection(multiConfig);
        } catch {
          return { message: "  取消\n" };
        }

        return saveLearningConfig(
          multiConfig,
          { ...multiConfig.learning, model },
          deps.saveConfig,
          `  ✓ 上课模型已设置为 ${model}\n`,
        );
      }
      case "level":
        return { message: "  提示：使用 /learn level <简洁|标准|详细> 调整讲解详略\n" };
      default:
        return { message: "  取消\n" };
    }
  }

  if (parts[1] === "on" && parts.length === 2) {
    return saveLearningConfig(
      multiConfig,
      { ...multiConfig.learning, enabled: true },
      deps.saveConfig,
      "  ✓ 上课模式已开启\n",
    );
  }

  if (parts[1] === "off" && parts.length === 2) {
    return saveLearningConfig(
      multiConfig,
      { ...multiConfig.learning, enabled: false },
      deps.saveConfig,
      "  ✓ 上课模式已关闭\n",
    );
  }

  if (parts[1] === "progress" && parts.length === 2) {
    return { message: deps.formatProgress(deps.profile, deps.sessionState) };
  }

  if (parts[1] === "recap" && parts.length === 2) {
    return { message: deps.formatRecap(deps.sessionState, deps.profile) };
  }

  if (parts[1] === "start") {
    return {
      message: "",
      startProjectDescription: parts.slice(2).join(" ").trim(),
    };
  }

  if (parts[1] === "next" && parts.length === 2) {
    return { message: "", showProjectCurrent: true };
  }

  if (parts[1] === "hint" && parts.length === 2) {
    return { message: "", showProjectHint: true };
  }

  if (parts[1] === "complete" && parts.length === 2) {
    return { message: "", completeProject: true };
  }

  if (parts[1] === "ask") {
    return {
      message: "",
      askQuestion: parts.slice(2).join(" ").trim(),
    };
  }

  if (parts[1] === "quiz" && parts.length === 2) {
    try {
      return await deps.runQuiz(deps.profile);
    } catch {
      return { message: "  取消\n" };
    }
  }

  if (parts[1] === "model") {
    const model = parts.slice(2).join(" ").trim();
    if (!model) {
      let selectedModel: string;
      try {
        selectedModel = await deps.promptForModelSelection(multiConfig);
      } catch {
        return { message: "  取消\n" };
      }

      return saveLearningConfig(
        multiConfig,
        { ...multiConfig.learning, model: selectedModel },
        deps.saveConfig,
        `  ✓ 上课模型已设置为 ${selectedModel}\n`,
      );
    }

    return saveLearningConfig(
      multiConfig,
      { ...multiConfig.learning, model },
      deps.saveConfig,
      `  ✓ 上课模型已设置为 ${model}\n`,
    );
  }

  if (parts[1] === "level") {
    const level = parts.slice(2).join(" ").trim();
    if (!isLearningVerbosity(level)) {
      return {
        message: `  ✗ 无效的讲解详略：${level || "(空)"}。可选：简洁 / 标准 / 详细\n`,
      };
    }

    return saveLearningConfig(
      multiConfig,
      { ...multiConfig.learning, verbosity: level },
      deps.saveConfig,
      `  ✓ 讲解详略已设置为 ${level}\n`,
    );
  }

  return { message: buildUsageMessage() };
}

export function formatRecapFromState(state: LearningSessionState, profile: LearningProfile): string {
  const lesson = state.lastLesson ?? profile.lastLesson;
  if (!lesson) {
    return "\n  🎓 当前还没有可回看的课堂内容。\n";
  }

  return [
    "",
    "  🎓 本轮回顾",
    `  主题：${lesson.summary}`,
    "",
    lesson.detail,
    "",
    "  可继续输入 /learn ask 追问这轮讲解。",
    "",
  ].join("\n");
}

function saveLearningConfig(
  multiConfig: MultiConfig,
  learning: LearningConfig,
  saveConfig: (multiConfig: MultiConfig) => void,
  message: string,
): LearnCommandResult {
  const updated: MultiConfig = {
    ...multiConfig,
    learning,
  };
  saveConfig(updated);
  return { multiConfig: updated, message };
}

function buildUsageMessage(): string {
  return "  ✗ 用法：/learn | /learn on | /learn off | /learn start [项目] | /learn next | /learn hint | /learn complete | /learn progress | /learn recap | /learn ask [问题] | /learn quiz | /learn model [name] | /learn level <简洁|标准|详细>\n";
}

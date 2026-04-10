import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import {
	COPILOT_FALLBACK_PRESET_MODELS,
	normalizeCopilotModelId,
} from "./copilot-models.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Config {
	providerName: string;
	apiKey: string;
	model: string;
	baseURL: string;
	thinkingLevel: ThinkingLevel;
}

export interface ProviderEntry {
	key: string;
	model: string;
	baseURL?: string;
	thinkingLevel?: ThinkingLevel;
}

export interface ProviderModelOption {
	id: string;
	label?: string;
	note?: string;
}

export interface ProviderMeta {
	baseURL: string;
	defaultModel: string;
	label: string;
	envKey?: string;
	presetModels?: readonly ProviderModelOption[];
}

export type PermissionMode = "prompt" | "full-access";
export type ThinkingLevel =
	| "default"
	| "none"
	| "low"
	| "medium"
	| "high"
	| "xhigh";
export type TeachingVerbosity = "简洁" | "标准" | "详细";

export interface TeachingConfig {
	enabled: boolean;
	model?: string;
	verbosity: TeachingVerbosity;
}

export interface SharkCodeConfig {
	activeProvider: string;
	providers: Record<string, ProviderEntry>;
	permissionMode: PermissionMode;
	teaching?: TeachingConfig;
}

export interface MultiConfig extends SharkCodeConfig {
	teaching: TeachingConfig;
}

export const THINKING_LEVELS: readonly ThinkingLevel[] = [
	"default",
	"none",
	"low",
	"medium",
	"high",
	"xhigh",
];

const TEACHING_VERBOSITIES: readonly TeachingVerbosity[] = [
	"简洁",
	"标准",
	"详细",
];

export const COPILOT_OPENAI_THINKING_MODELS = [
	"gpt-5-mini",
	"gpt-5.1",
	"gpt-5.2",
	"gpt-5.2-codex",
	"gpt-5.3-codex",
	"gpt-5.4-mini",
	"gpt-5.4",
] as const;

export const COPILOT_ANTHROPIC_THINKING_MODELS = [
	"claude-opus-4.6",
	"claude-sonnet-4.6",
] as const;

// ─── Provider registry ────────────────────────────────────────────────────────

export const ARK_CODING_PLAN_MODELS: readonly ProviderModelOption[] = [
	{
		id: "ark-code-latest",
		label: "Auto / 控制台管理",
		note: "通过方舟控制台切换 Auto 或指定模型",
	},
	{ id: "doubao-seed-code", label: "Doubao-Seed-Code" },
	{ id: "glm-4.7", label: "GLM-4.7" },
	{ id: "deepseek-v3.2", label: "DeepSeek-V3.2" },
	{ id: "kimi-k2-thinking", label: "Kimi-K2-Thinking" },
	{ id: "kimi-k2.5", label: "Kimi-K2.5" },
];

export const PROVIDERS: Record<string, ProviderMeta> = {
	copilot: {
		baseURL: "https://api.githubcopilot.com",
		defaultModel: "gpt-4.1",
		label: "GitHub Copilot",
		presetModels: COPILOT_FALLBACK_PRESET_MODELS,
	},
	codex: {
		baseURL: "https://api.openai.com/v1",
		defaultModel: "gpt-5.4",
		label: "OpenAI Codex / ChatGPT",
		presetModels: [
			// ── Codex 订阅推荐模型 (Plus/Pro) ─────────────────────────────────────
			{ id: "gpt-5.4", label: "GPT-5.4", note: "旗舰 · Plus+" },
			{ id: "gpt-5.4-mini", label: "GPT-5.4 mini", note: "快速 · Plus+" },
			{ id: "gpt-5.3-codex", label: "GPT-5.3-Codex", note: "代码专用 · Plus+" },
			{
				id: "gpt-5.3-codex-spark",
				label: "GPT-5.3-Codex Spark",
				note: "研究预览 · Pro 专属",
			},
			{ id: "gpt-5.2", label: "GPT-5.2", note: "备选 · Plus+" },
			// ── 标准 API 模型（API Key 方式使用） ──────────────────────────────────
			{ id: "gpt-4.1", label: "GPT-4.1", note: "API Key" },
			{ id: "gpt-4o", label: "GPT-4o", note: "API Key" },
			{ id: "gpt-4o-mini", label: "GPT-4o mini", note: "API Key 轻量" },
			{ id: "o3", label: "o3", note: "最强推理 · API Key" },
			{ id: "o4-mini", label: "o4-mini", note: "推理 · API Key" },
		],
	},
	deepseek: {
		baseURL: "https://api.deepseek.com/v1",
		defaultModel: "deepseek-chat",
		label: "DeepSeek",
		envKey: "DEEPSEEK_API_KEY",
	},
	ark: {
		baseURL: "https://ark.cn-beijing.volces.com/api/coding/v3",
		defaultModel: "ark-code-latest",
		label: "方舟 Coding Plan",
		envKey: "ARK_API_KEY",
		presetModels: ARK_CODING_PLAN_MODELS,
	},
	openai: {
		baseURL: "https://api.openai.com/v1",
		defaultModel: "gpt-4o",
		label: "OpenAI",
		envKey: "OPENAI_API_KEY",
	},
	openrouter: {
		baseURL: "https://openrouter.ai/api/v1",
		defaultModel: "anthropic/claude-sonnet-4",
		label: "OpenRouter",
		envKey: "OPENROUTER_API_KEY",
	},
	siliconflow: {
		baseURL: "https://api.siliconflow.cn/v1",
		defaultModel: "deepseek-ai/DeepSeek-V3",
		label: "SiliconFlow 硅基流动",
		envKey: "SILICONFLOW_API_KEY",
	},
	groq: {
		baseURL: "https://api.groq.com/openai/v1",
		defaultModel: "llama-3.3-70b-versatile",
		label: "Groq",
		envKey: "GROQ_API_KEY",
	},
	together: {
		baseURL: "https://api.together.xyz/v1",
		defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
		label: "Together AI",
		envKey: "TOGETHER_API_KEY",
	},
	qwen: {
		baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		defaultModel: "qwen-plus",
		label: "Qwen 通义千问",
		envKey: "DASHSCOPE_API_KEY",
	},
	ollama: {
		baseURL: "http://localhost:11434/v1",
		defaultModel: "qwen2.5-coder:7b",
		label: "Ollama 本地",
	},
	custom: {
		baseURL: "",
		defaultModel: "",
		label: "Custom 自定义",
	},
};

export function normalizeProviderModel(
	providerName: string,
	model: string,
): string {
	const meta = PROVIDERS[providerName];
	const trimmed = model.trim();

	if (!meta) return trimmed;
	if (!trimmed) return meta.defaultModel;

	if (providerName === "copilot") {
		return normalizeCopilotModelId(trimmed);
	}

	return trimmed;
}

export function getUnsupportedProviderModelMessage(
	providerName: string,
	modelId: string,
): string | undefined {
	void providerName;
	void modelId;
	return undefined;
}

function isCopilotOpenAIThinkingModel(modelId: string): boolean {
	return COPILOT_OPENAI_THINKING_MODELS.includes(
		modelId as (typeof COPILOT_OPENAI_THINKING_MODELS)[number],
	);
}

function isCopilotAnthropicThinkingModel(modelId: string): boolean {
	return COPILOT_ANTHROPIC_THINKING_MODELS.includes(
		modelId as (typeof COPILOT_ANTHROPIC_THINKING_MODELS)[number],
	);
}

export function getAvailableThinkingLevels(
	providerName: string,
	modelId: string,
): readonly ThinkingLevel[] {
	if (providerName === "copilot") {
		if (isCopilotOpenAIThinkingModel(modelId)) {
			return ["none", "low", "default", "high", "xhigh"];
		}
		if (isCopilotAnthropicThinkingModel(modelId)) {
			return ["low", "default", "high"];
		}
		return ["default"];
	}

	if (
		(providerName === "openai" || providerName === "codex") &&
		isReasoningModel(modelId)
	) {
		const levels: ThinkingLevel[] = ["low", "default", "high"];
		if (supportsExtraHighThinking(providerName, modelId)) {
			levels.push("xhigh");
		}
		return levels;
	}

	return ["default"];
}

export function getDefaultThinkingLevel(
	providerName: string,
	modelId: string,
): ThinkingLevel {
	if (providerName === "copilot") {
		const note =
			PROVIDERS.copilot?.presetModels?.find((model) => model.id === modelId)
				?.note ?? "";
		if (note.startsWith("Xhigh")) return "xhigh";
		if (note.startsWith("High")) return "high";
		if (note.startsWith("Low")) return "low";
		if (note.startsWith("None")) return "none";
		return "default";
	}

	return "default";
}

export function supportsThinkingLevel(
	providerName: string,
	modelId?: string,
): boolean {
	if (!modelId) {
		return (
			providerName === "openai" ||
			providerName === "codex" ||
			providerName === "copilot"
		);
	}

	return getAvailableThinkingLevels(providerName, modelId).length > 1;
}

export function supportsExtraHighThinking(
	providerName: string,
	modelId: string,
): boolean {
	if (providerName === "copilot") {
		return isCopilotOpenAIThinkingModel(modelId);
	}

	return (
		providerName === "codex" &&
		(modelId.startsWith("gpt-5.4") ||
			modelId.startsWith("gpt-5.3-codex") ||
			modelId.startsWith("gpt-5.2-codex"))
	);
}

export function isReasoningModel(modelId: string): boolean {
	return (
		modelId.startsWith("o1") ||
		modelId.startsWith("o3") ||
		modelId.startsWith("o4-mini") ||
		(modelId.startsWith("gpt-5") && !modelId.startsWith("gpt-5-chat"))
	);
}

export function normalizeThinkingLevel(
	providerName: string,
	value?: string,
): ThinkingLevel {
	if (!supportsThinkingLevel(providerName)) return "default";
	if (!value) return "default";

	if (value === "minimal") return "low";
	if (value === "medium") return "default";
	if (value === "xhigh" && providerName === "copilot") return "xhigh";
	if (value === "none" && providerName !== "copilot") return "default";
	if (value === "xhigh" && providerName !== "codex") return "high";

	return THINKING_LEVELS.includes(value as ThinkingLevel)
		? (value as ThinkingLevel)
		: "default";
}

export function clampThinkingLevel(
	providerName: string,
	modelId: string,
	value?: string,
): ThinkingLevel {
	const normalized = normalizeThinkingLevel(providerName, value);
	const available = getAvailableThinkingLevels(providerName, modelId);
	return available.includes(normalized) ? normalized : "default";
}

function normalizeTeachingVerbosity(value?: unknown): TeachingVerbosity {
	return TEACHING_VERBOSITIES.includes(value as TeachingVerbosity)
		? (value as TeachingVerbosity)
		: "标准";
}

function normalizeTeachingConfig(raw?: {
	enabled?: unknown;
	model?: unknown;
	verbosity?: unknown;
}): TeachingConfig {
	const model =
		typeof raw?.model === "string" && raw.model.trim()
			? raw.model.trim()
			: undefined;

	return {
		enabled: typeof raw?.enabled === "boolean" ? raw.enabled : false,
		model,
		verbosity: normalizeTeachingVerbosity(raw?.verbosity),
	};
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), ".sharkcode");
const CONFIG_FILE = join(CONFIG_DIR, "config.toml");

// ─── Serialization ────────────────────────────────────────────────────────────

function serializeConfig(mc: MultiConfig): string {
	const teaching = normalizeTeachingConfig(mc.teaching);
	const lines = [
		"# Shark Code Configuration",
		"# https://github.com/syy-shark/sharkcode",
		"",
		"[default]",
		`provider = "${mc.activeProvider}"`,
		`permission_mode = "${mc.permissionMode}"`,
		"",
		"[teaching]",
		`enabled = ${teaching.enabled}`,
		`verbosity = "${teaching.verbosity}"`,
	];

	if (teaching.model) {
		lines.push(`model = "${teaching.model}"`);
	}

	lines.push("");

	for (const [id, meta] of Object.entries(PROVIDERS)) {
		const entry = mc.providers[id];
		const model = normalizeProviderModel(id, entry?.model ?? meta.defaultModel);
		const thinkingLevel = clampThinkingLevel(id, model, entry?.thinkingLevel);
		lines.push(`[providers.${id}]`);
		if (meta.envKey) lines.push(`# ENV: ${meta.envKey}`);
		if (meta.presetModels?.length) {
			lines.push(
				`# Presets: ${meta.presetModels.map((model) => model.id).join(", ")}`,
			);
		}
		lines.push(`key = "${entry?.key ?? ""}"`);
		lines.push(`model = "${model}"`);
		lines.push(`thinking_level = "${thinkingLevel}"`);
		if (id === "custom" || id === "ollama") {
			lines.push(`base_url = "${entry?.baseURL ?? meta.baseURL}"`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

// ─── Ensure config dir/file exist ─────────────────────────────────────────────

function ensureConfig(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
	}
	if (!existsSync(CONFIG_FILE)) {
		const providers: Record<string, ProviderEntry> = {};
		for (const [id, meta] of Object.entries(PROVIDERS)) {
			providers[id] = {
				key: "",
				model: meta.defaultModel,
				thinkingLevel: "default",
			};
		}
		const initial: MultiConfig = {
			activeProvider: "deepseek",
			permissionMode: "prompt",
			providers,
			teaching: normalizeTeachingConfig(),
		};
		writeFileSync(CONFIG_FILE, serializeConfig(initial), "utf-8");
	}
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export function readMultiConfig(): MultiConfig {
	ensureConfig();

	let toml: Record<string, unknown> = {};
	try {
		const raw = readFileSync(CONFIG_FILE, "utf-8");
		toml = parse(raw) as Record<string, unknown>;
	} catch {
		// fall back to defaults
	}

	// Legacy [api] section migration
	const legacy = toml.api as Record<string, string> | undefined;

	const providersRaw = (toml.providers ?? {}) as Record<
		string,
		Record<string, string>
	>;
	const defaultSection = (toml.default ?? {}) as Record<string, string>;
	const teachingRaw = (toml.teaching ?? {}) as {
		enabled?: unknown;
		model?: unknown;
		verbosity?: unknown;
	};

	const providers: Record<string, ProviderEntry> = {};

	for (const [id, meta] of Object.entries(PROVIDERS)) {
		const raw = providersRaw[id];
		const envKey = meta.envKey ? process.env[meta.envKey] : undefined;

		let key = envKey || raw?.key || "";

		// Legacy migration for deepseek
		if (id === "deepseek" && !key && legacy?.key) {
			key = legacy.key;
		}

		const model = normalizeProviderModel(
			id,
			raw?.model ||
				(id === "deepseek" && legacy?.model ? legacy.model : "") ||
				meta.defaultModel,
		);

		providers[id] = {
			key,
			model,
			baseURL: raw?.base_url || undefined,
			thinkingLevel: clampThinkingLevel(id, model, raw?.thinking_level),
		};
	}

	// If we migrated from legacy format, the active provider is deepseek
	const activeProvider =
		defaultSection.provider || (legacy ? "deepseek" : "deepseek");
	const permissionMode: PermissionMode =
		(defaultSection.permission_mode as PermissionMode) === "full-access"
			? "full-access"
			: "prompt";
	const teaching = normalizeTeachingConfig(teachingRaw);

	return {
		activeProvider,
		permissionMode,
		providers,
		teaching,
	};
}

// ─── Save ─────────────────────────────────────────────────────────────────────

export function saveMultiConfig(mc: MultiConfig): void {
	ensureConfig();
	writeFileSync(
		CONFIG_FILE,
		serializeConfig({
			...mc,
			teaching: normalizeTeachingConfig(mc.teaching),
		}),
		"utf-8",
	);
}

// ─── Resolve active provider to flat Config ───────────────────────────────────

export function resolveConfig(mc: MultiConfig): Config {
	const name = mc.activeProvider;
	const entry = mc.providers[name];
	const meta = PROVIDERS[name];

	return {
		providerName: name,
		apiKey: entry?.key || "",
		model: normalizeProviderModel(
			name,
			entry?.model || meta?.defaultModel || "deepseek-chat",
		),
		baseURL:
			entry?.baseURL ||
			meta?.baseURL ||
			PROVIDERS.deepseek?.baseURL ||
			"https://api.deepseek.com/v1",
		thinkingLevel: clampThinkingLevel(
			name,
			normalizeProviderModel(
				name,
				entry?.model || meta?.defaultModel || "deepseek-chat",
			),
			entry?.thinkingLevel,
		),
	};
}

// ─── Convenience loader (keeps old call sites working) ────────────────────────

export function loadConfig(): Config {
	const mc = readMultiConfig();
	return resolveConfig(mc);
}

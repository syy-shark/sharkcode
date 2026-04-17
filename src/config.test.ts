import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ARK_CODING_PLAN_MODELS,
	clampThinkingLevel,
	getAvailableThinkingLevels,
	getDefaultThinkingLevel,
	getUnsupportedProviderModelMessage,
	isReasoningModel,
	normalizeProviderModel,
	normalizeThinkingLevel,
	PROVIDERS,
	supportsExtraHighThinking,
	supportsThinkingLevel,
} from "./config.ts";

async function withTempHome<T>(
	run: (
		config: typeof import("./config.ts"),
		tempHome: string,
	) => Promise<T> | T,
): Promise<T> {
	const tempHome = mkdtempSync(join(tmpdir(), "sharkcode-config-"));
	const originalHome = process.env.HOME;
	const originalUserProfile = process.env.USERPROFILE;
	const originalHomeDrive = process.env.HOMEDRIVE;
	const originalHomePath = process.env.HOMEPATH;

	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
	delete process.env.HOMEDRIVE;
	delete process.env.HOMEPATH;

	try {
		const config = (await import(
			`./config.ts?learning-test=${Date.now()}-${Math.random()}`
		)) as typeof import("./config.ts");
		return await run(config, tempHome);
	} finally {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;

		if (originalUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = originalUserProfile;

		if (originalHomeDrive === undefined) delete process.env.HOMEDRIVE;
		else process.env.HOMEDRIVE = originalHomeDrive;

		if (originalHomePath === undefined) delete process.env.HOMEPATH;
		else process.env.HOMEPATH = originalHomePath;

		rmSync(tempHome, { recursive: true, force: true });
	}
}

describe("ARK_CODING_PLAN_MODELS", () => {
	test("exposes the curated Coding Plan presets", () => {
		expect(ARK_CODING_PLAN_MODELS.map((model) => model.id)).toEqual([
			"ark-code-latest",
			"doubao-seed-code",
			"glm-4.7",
			"deepseek-v3.2",
			"kimi-k2-thinking",
			"kimi-k2.5",
		]);
	});

	test("keeps ark-code-latest as the default provider model", () => {
		expect(PROVIDERS.ark?.defaultModel).toBe("ark-code-latest");
		expect(PROVIDERS.ark?.presetModels).toBe(ARK_CODING_PLAN_MODELS);
	});
});

describe("normalizeProviderModel", () => {
	test("normalizes Copilot picker labels to canonical ids", () => {
		expect(normalizeProviderModel("copilot", "GPT-5.4 mini")).toBe(
			"gpt-5.4-mini",
		);
		expect(normalizeProviderModel("copilot", "gpt-5.4-mini")).toBe(
			"gpt-5.4-mini",
		);
	});

	test("keeps Codex gpt-5.4-mini unchanged", () => {
		expect(normalizeProviderModel("codex", "gpt-5.4-mini")).toBe(
			"gpt-5.4-mini",
		);
	});

	test("keeps Copilot auto unchanged", () => {
		expect(normalizeProviderModel("copilot", "auto")).toBe("auto");
	});
});

describe("Copilot preset models", () => {
	test("matches the curated Copilot models SharkCode can call reliably", () => {
		expect(PROVIDERS.copilot?.presetModels?.map((model) => model.id)).toEqual([
			"auto",
			"claude-opus-4.6",
			"claude-sonnet-4.6",
			"gpt-4o",
			"gpt-5.4",
			"gpt-5.4-mini",
			"claude-haiku-4.5",
			"claude-opus-4.5",
			"claude-sonnet-4",
			"claude-sonnet-4.5",
			"gemini-2.5-pro",
			"gemini-3-flash-preview",
			"gemini-3.1-pro-preview",
			"gpt-4.1",
			"gpt-5-mini",
			"gpt-5.1",
			"gpt-5.2",
			"gpt-5.2-codex",
			"gpt-5.3-codex",
			"grok-code-fast-1",
			"oswe-vscode-prime",
		]);
	});

	test("does not hardcode stale Copilot unsupported-model messages", () => {
		expect(
			getUnsupportedProviderModelMessage("copilot", "gpt-5.4-mini"),
		).toBeUndefined();
		expect(
			getUnsupportedProviderModelMessage("copilot", "gpt-4.1"),
		).toBeUndefined();
	});
});

describe("thinking level helpers", () => {
	test("supports thinking level for OpenAI, Codex, and Copilot", () => {
		expect(supportsThinkingLevel("openai")).toBe(true);
		expect(supportsThinkingLevel("codex")).toBe(true);
		expect(supportsThinkingLevel("copilot")).toBe(true);
	});

	test("keeps supported Copilot thinking levels and normalizes none for non-Copilot providers", () => {
		expect(normalizeThinkingLevel("copilot", "high")).toBe("high");
		expect(normalizeThinkingLevel("copilot", "xhigh")).toBe("xhigh");
		expect(normalizeThinkingLevel("openai", "none")).toBe("default");
	});

	test("keeps supported thinking levels for OpenAI/Codex", () => {
		expect(normalizeThinkingLevel("openai", "high")).toBe("high");
		expect(normalizeThinkingLevel("codex", "xhigh")).toBe("xhigh");
	});

	test("migrates legacy minimal/medium and downgrades unsupported xhigh", () => {
		expect(normalizeThinkingLevel("codex", "minimal")).toBe("low");
		expect(normalizeThinkingLevel("codex", "medium")).toBe("default");
		expect(normalizeThinkingLevel("openai", "xhigh")).toBe("high");
	});

	test("identifies reasoning models", () => {
		expect(isReasoningModel("gpt-5.4")).toBe(true);
		expect(isReasoningModel("o3")).toBe(true);
		expect(isReasoningModel("gpt-4o")).toBe(false);
	});

	test("restricts extra high to Codex reasoning models", () => {
		expect(supportsExtraHighThinking("codex", "gpt-5.4")).toBe(true);
		expect(supportsExtraHighThinking("codex", "gpt-5.3-codex")).toBe(true);
		expect(supportsExtraHighThinking("copilot", "gpt-5.4-mini")).toBe(true);
		expect(supportsExtraHighThinking("openai", "gpt-5.4")).toBe(false);
		expect(supportsExtraHighThinking("codex", "gpt-5.2")).toBe(false);
		expect(supportsExtraHighThinking("codex", "gpt-4o")).toBe(false);
	});

	test("returns Copilot GPT-5 thinking levels including none and xhigh", () => {
		expect(getAvailableThinkingLevels("copilot", "gpt-5.4")).toEqual([
			"none",
			"low",
			"default",
			"high",
			"xhigh",
		]);
	});

	test("returns Copilot GPT-5.4 mini thinking levels", () => {
		expect(getAvailableThinkingLevels("copilot", "gpt-5.4-mini")).toEqual([
			"none",
			"low",
			"default",
			"high",
			"xhigh",
		]);
	});

	test("returns Copilot Claude 4.6 thinking levels without none/xhigh", () => {
		expect(getAvailableThinkingLevels("copilot", "claude-opus-4.6")).toEqual([
			"low",
			"default",
			"high",
		]);
	});

	test("returns no adjustable thinking submenu for non-reasoning Copilot models", () => {
		expect(getAvailableThinkingLevels("copilot", "gpt-4o")).toEqual([
			"default",
		]);
	});

	test("derives Copilot default thinking level from preset metadata", () => {
		expect(getDefaultThinkingLevel("copilot", "gpt-5.4")).toBe("xhigh");
		expect(getDefaultThinkingLevel("copilot", "claude-opus-4.6")).toBe("high");
		expect(getDefaultThinkingLevel("copilot", "gpt-5.4-mini")).toBe("default");
	});

	test("clamps stale thinking levels to the current model's supported set", () => {
		expect(clampThinkingLevel("copilot", "gpt-4o", "xhigh")).toBe("default");
		expect(clampThinkingLevel("copilot", "claude-opus-4.6", "xhigh")).toBe(
			"default",
		);
		expect(clampThinkingLevel("copilot", "gpt-5.4-mini", "xhigh")).toBe(
			"xhigh",
		);
	});
});

describe("learning config", () => {
	test("defaults learning settings when the section is missing", async () => {
		await withTempHome(async (config, tempHome) => {
			const configDir = join(tempHome, ".sharkcode");
			const configFile = join(configDir, "config.toml");

			mkdirSync(configDir, { recursive: true });
			writeFileSync(
				configFile,
				[
					"[default]",
					'provider = "deepseek"',
					'permission_mode = "prompt"',
					"",
				].join("\n"),
				"utf-8",
			);

			const multiConfig = config.readMultiConfig();

			expect(multiConfig.learning.enabled).toBe(false);
			expect(multiConfig.learning.verbosity).toBe("标准");
			expect(multiConfig.learning.autoCards).toBe(true);
		});
	});

	test("round-trips learning settings through saveMultiConfig and readMultiConfig", async () => {
		await withTempHome(async (config) => {
			const initial = config.readMultiConfig();

			config.saveMultiConfig({
				...initial,
				activeProvider: "codex",
				learning: {
					enabled: true,
					model: "gpt-4o-mini",
					verbosity: "详细",
					autoCards: false,
					background: "前端开发",
				},
			});

			const reloaded = config.readMultiConfig();

			expect(reloaded.learning).toEqual({
				enabled: true,
				model: "gpt-4o-mini",
				verbosity: "详细",
				autoCards: false,
				background: "前端开发",
			});
		});
	});

	test("reads legacy [teaching] section into learning config", async () => {
		await withTempHome(async (config, tempHome) => {
			const configDir = join(tempHome, ".sharkcode");
			const configFile = join(configDir, "config.toml");

			mkdirSync(configDir, { recursive: true });
			writeFileSync(
				configFile,
				[
					"[default]",
					'provider = "deepseek"',
					'permission_mode = "prompt"',
					"",
					"[teaching]",
					"enabled = true",
					'model = "gpt-4o-mini"',
					'verbosity = "啰嗦"',
					"",
				].join("\n"),
				"utf-8",
			);

			const multiConfig = config.readMultiConfig();

				expect(multiConfig.learning.enabled).toBe(true);
				expect(multiConfig.learning.model).toBe("gpt-4o-mini");
				expect(multiConfig.learning.verbosity).toBe("标准");
				expect(multiConfig.learning.autoCards).toBe(true);
		});
	});
});

import { join } from "node:path";
import { loadConfig, setConfigPath, type Config } from "structured-context/api";

/** Bundled schema used for built-in spaces that don't set one; structured-context requires an explicit schema. */
export const DEFAULT_SCHEMA = "strategy_general.json";

/**
 * Where the space configuration comes from.
 * - auto: the system config when it defines spaces, otherwise the spaces managed in the plugin settings
 * - builtin: the spaces managed in the plugin settings
 * - custom: a structured-context config file at a chosen path
 * - system: the config structured-context discovers (SCTX_CONFIG, then the XDG config folder)
 */
export type ConfigMode = "auto" | "builtin" | "custom" | "system";
export const CONFIG_MODES: ConfigMode[] = ["auto", "builtin", "custom", "system"];

export interface SpaceSetting {
	name: string;
	path: string;    // vault-relative
	schema?: string; // vault-relative, optional
}

export interface ConfigSettings {
	configMode: ConfigMode;
	spaces: SpaceSetting[];
	configPath: string;
}

/** The source a resolved config actually came from. */
export type ConfigSource = "builtin" | "custom" | "system";

export interface ResolvedConfig {
	config: Config;
	source: ConfigSource;
	/** Why the chosen source could not be loaded. The config is then empty, or the built-in one in auto mode. */
	error?: string;
}

/** Load a structured-context config file: from `path`, or by discovery when undefined. Throws if it is invalid. */
export type ConfigLoader = (path: string | undefined) => Config;

const loadFromDisk: ConfigLoader = (path) => {
	setConfigPath(path);
	return loadConfig();
};

function builtinConfig(spaces: SpaceSetting[], basePath: string | null): Config {
	if (!basePath) return { spaces: [] };
	return {
		spaces: spaces.map(s => ({
			name: s.name,
			path: join(basePath, s.path),
			// Anchors relative schema and plugin paths; required for configs not loaded from a file.
			sourceDir: basePath,
			schema: s.schema ? join(basePath, s.schema) : DEFAULT_SCHEMA,
		})),
	};
}

function load(path: string | undefined, loader: ConfigLoader): { config: Config; error?: string } {
	try {
		return { config: loader(path) };
	} catch (e) {
		return { config: { spaces: [] }, error: e instanceof Error ? e.message : String(e) };
	}
}

export function resolveConfig(
	settings: ConfigSettings,
	basePath: string | null,
	loader: ConfigLoader = loadFromDisk,
): ResolvedConfig {
	const { configMode, configPath, spaces } = settings;

	switch (configMode) {
		case "builtin":
			return { config: builtinConfig(spaces, basePath), source: "builtin" };
		case "custom": {
			if (!configPath.trim()) {
				return { config: { spaces: [] }, source: "custom", error: "No config file path is set." };
			}
			return { ...load(configPath, loader), source: "custom" };
		}
		case "system":
			return { ...load(undefined, loader), source: "system" };
		case "auto": {
			const system = load(undefined, loader);
			if (!system.error && system.config.spaces.length > 0) {
				return { config: system.config, source: "system" };
			}
			// A system config that exists but is broken is reported, not skipped silently
			return { config: builtinConfig(spaces, basePath), source: "builtin", ...(system.error ? { error: system.error } : {}) };
		}
	}
}

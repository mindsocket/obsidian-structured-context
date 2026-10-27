import { loadConfig, resolveConfigPath, setConfigPath, type Config } from "structured-context/api";

/** Bundled schema given to spaces added without one; structured-context requires an explicit schema. */
export const DEFAULT_SCHEMA = "strategy_general.json";

/**
 * Where the space configuration comes from.
 * - discovered: the config structured-context discovers: SCTX_CONFIG, then the nearest .sctx.json walking up from
 *   the vault folder, then the global config. Spaces added from the plugin are written to the vault's .sctx.json.
 * - custom: a structured-context config file at a chosen path
 */
export type ConfigMode = "discovered" | "custom";
export const CONFIG_MODES: ConfigMode[] = ["discovered", "custom"];

export interface SpaceSetting {
	name: string;
	path: string;    // vault-relative
	schema?: string; // vault-relative, optional
}

export interface ConfigSettings {
	configMode: ConfigMode;
	configPath: string;
}

/** The source a resolved config actually came from. */
export type ConfigSource = ConfigMode;

export interface ResolvedConfig {
	config: Config;
	source: ConfigSource;
	/** Why the chosen source could not be loaded. The config is then empty. */
	error?: string;
	/** The config file in use, when there is one. */
	file?: string;
}

/**
 * Load a structured-context config file: from `path`, or by discovery from `startDir` when `path` is undefined.
 * Throws if it is invalid.
 */
export type ConfigLoader = (path: string | undefined, startDir?: string) => Config;

/** Where discovery lands from `startDir`, or undefined when no config file exists. */
export type ConfigLocator = (startDir: string | undefined) => string | undefined;

const loadFromDisk: ConfigLoader = (path, startDir) => {
	setConfigPath(path);
	return loadConfig({ startDir });
};

const locateOnDisk: ConfigLocator = (startDir) => {
	setConfigPath(undefined);
	const { path, source } = resolveConfigPath(startDir);
	return source === "none" ? undefined : path;
};

function load(path: string | undefined, startDir: string | undefined, loader: ConfigLoader): { config: Config; error?: string } {
	try {
		return { config: loader(path, startDir) };
	} catch (e) {
		return { config: { spaces: [] }, error: e instanceof Error ? e.message : String(e) };
	}
}

export function resolveConfig(
	settings: ConfigSettings,
	basePath: string | null,
	loader: ConfigLoader = loadFromDisk,
	locate: ConfigLocator = locateOnDisk,
): ResolvedConfig {
	const { configMode, configPath } = settings;
	const startDir = basePath ?? undefined;

	if (configMode === "custom") {
		if (!configPath.trim()) {
			return { config: { spaces: [] }, source: "custom", error: "No config file path is set." };
		}
		return { ...load(configPath, startDir, loader), source: "custom", file: configPath };
	}
	// With no config file anywhere there is nothing to load or report: the first added space creates one
	const file = locate(startDir);
	if (!file) return { config: { spaces: [] }, source: "discovered" };
	return { ...load(undefined, startDir, loader), source: "discovered", file };
}

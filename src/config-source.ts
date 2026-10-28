import { type Config, loadConfig, resolveConfigPath, setConfigPath } from "structured-context/api";

/** Bundled schema given to spaces added without one; structured-context requires an explicit schema. */
export const DEFAULT_SCHEMA = "strategy_general.json";

export interface SpaceSetting {
	name: string;
	path: string; // vault-relative
	schema?: string; // a bundled or plugin schema by name, or a vault-relative path
}

export interface ResolvedConfig {
	config: Config;
	/** Why the config could not be loaded. The config is then empty. */
	error?: string;
	/** The config file in use. Not set when none exists yet. */
	file?: string;
}

/** Load the config structured-context discovers from `startDir`. Throws if it is invalid. */
export type ConfigLoader = (startDir: string) => Config;

/** Where discovery lands from `startDir`, or undefined when no config file exists. */
export type ConfigLocator = (startDir: string) => string | undefined;

const loadFromDisk: ConfigLoader = (startDir) => {
	setConfigPath(undefined);
	return loadConfig({ startDir });
};

const locateOnDisk: ConfigLocator = (startDir) => {
	setConfigPath(undefined);
	const { path, source } = resolveConfigPath(startDir);
	return source === "none" ? undefined : path;
};

/**
 * The config structured-context discovers from the vault folder: the nearest .sctx.json walking up, then the
 * global config. With none, there are no spaces and no error: adding a space creates one.
 */
export function resolveConfig(
	basePath: string,
	loader: ConfigLoader = loadFromDisk,
	locate: ConfigLocator = locateOnDisk,
): ResolvedConfig {
	const file = locate(basePath);
	if (!file) return { config: { spaces: [] } };
	try {
		return { config: loader(basePath), file };
	} catch (e) {
		return { config: { spaces: [] }, file, error: e instanceof Error ? e.message : String(e) };
	}
}

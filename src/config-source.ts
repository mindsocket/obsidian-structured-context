import { isAbsolute, relative, resolve } from "node:path";
import { type Config, loadConfig, resolveConfigPath, type SpaceConfig, setConfigPath } from "structured-context/api";

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

/** The config structured-context discovers from the vault folder. With none, there are no spaces and no error: adding a space creates one. */
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

/**
 * Find the first configured local space whose folder holds `filePath`, returning the space and its
 * space-relative path. Matches structured-context's `validateFile`.
 */
export function resolveVaultFile(config: Config, filePath: string): { space: SpaceConfig; label: string } | null {
	const absFile = isAbsolute(filePath) ? filePath : resolve(filePath);
	for (const space of config.spaces) {
		if (/^https?:\/\//i.test(space.path)) continue;
		const absSpace = isAbsolute(space.path) ? space.path : resolve(space.path);
		const rel = relative(absSpace, absFile);
		if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
			return { space, label: rel.replace(/\\/g, "/") };
		}
	}
	return null;
}

/**
 * The name of the space a file is validated in. Matches structured-context's `validateFile`, which takes the first
 * space whose folder holds the file. Paths are absolute, as the loaded config's space paths are.
 */
export function spaceOf(config: Config, filePath: string): string | undefined {
	return resolveVaultFile(config, filePath)?.space.name;
}

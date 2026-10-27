import { dirname, join } from "node:path";
import { addSpace, LOCAL_CONFIG_FILE } from "structured-context/api";
import { DEFAULT_SCHEMA, type SpaceSetting } from "./config-source";

/** The `.sctx.json` at the vault root: where a space goes when there is no config yet. */
export function vaultConfigPath(basePath: string): string {
	return join(basePath, LOCAL_CONFIG_FILE);
}

/** The file a new space is saved to: the discovered config, else (or when asked for) a new one at the vault root. */
export function addSpaceTarget(basePath: string, discoveredFile: string | undefined, useVaultConfig = false): string {
	return useVaultConfig || !discoveredFile ? vaultConfigPath(basePath) : discoveredFile;
}

/**
 * The schema as the target config file needs it. A bundled or plugin schema (in `named`) is written by name. A
 * vault file is relative to the target's folder when that is the vault root, and absolute anywhere else.
 */
function schemaFor(basePath: string, schema: string | undefined, named: readonly string[], configFile: string): string {
	if (!schema) return DEFAULT_SCHEMA;
	if (named.includes(schema)) return schema;
	return dirname(configFile) === basePath ? `./${schema}` : join(basePath, schema);
}

/** Writes a space to a config file; structured-context's addSpace unless a test passes its own. */
export type SpaceWriter = typeof addSpace;
type AddSpaceResult = ReturnType<typeof addSpace>;

/** Add a space defined with vault-relative paths to `configFile`, creating the file if needed. */
export function addSpaceToConfig(
	basePath: string,
	configFile: string,
	space: SpaceSetting,
	named: readonly string[] = [],
	write: SpaceWriter = addSpace,
): AddSpaceResult {
	return write({
		name: space.name,
		path: join(basePath, space.path),
		schema: schemaFor(basePath, space.schema, named, configFile),
		configFile,
		startDir: basePath,
	});
}

import { join } from "node:path";
import { addSpace, LOCAL_CONFIG_FILE } from "structured-context/api";
import { DEFAULT_SCHEMA, type SpaceSetting } from "./config-source";

/** The `.sctx.json` at the vault root: where spaces added from the plugin are written. */
export function vaultConfigPath(basePath: string): string {
	return join(basePath, LOCAL_CONFIG_FILE);
}

/** Writes a space to a config file; structured-context's addSpace unless a test passes its own. */
export type SpaceWriter = typeof addSpace;
type AddSpaceResult = ReturnType<typeof addSpace>;

/**
 * Add a space defined with vault-relative paths to the vault's `.sctx.json`, creating the file if needed.
 * A schema in `named` (bundled or from a plugin) is written as it is. Any other schema is a path relative to the
 * vault, which is the config file's folder, so it is written as `./path`.
 */
export function addSpaceToVaultConfig(
	basePath: string,
	space: SpaceSetting,
	named: readonly string[] = [],
	write: SpaceWriter = addSpace,
): AddSpaceResult {
	return write({
		name: space.name,
		path: join(basePath, space.path),
		schema: !space.schema ? DEFAULT_SCHEMA : named.includes(space.schema) ? space.schema : `./${space.schema}`,
		configFile: vaultConfigPath(basePath),
		startDir: basePath,
	});
}

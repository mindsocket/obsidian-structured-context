import { sep } from "node:path";
import type { Config } from "structured-context/api";

type SpaceConfig = Config["spaces"][number];

function contains(spacePath: string, filePath: string): boolean {
	const dir = spacePath.endsWith(sep) ? spacePath : `${spacePath}${sep}`;
	return filePath === spacePath || filePath.startsWith(dir);
}

/**
 * The space a file is validated in. Matches structured-context's `validateFile`, which takes the first space whose
 * folder holds the file. Paths are absolute, as the loaded config's space paths are.
 */
function spaceOf(config: Config, filePath: string): SpaceConfig | undefined {
	return config.spaces.find((space) => contains(space.path, filePath));
}

/** Whether a change to any of `changedPaths` can alter the validation of `openPath`: they share its space. */
export function affectsOpenNote(config: Config, openPath: string, changedPaths: string[]): boolean {
	const space = spaceOf(config, openPath);
	return space !== undefined && changedPaths.some((path) => contains(space.path, path));
}

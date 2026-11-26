import { sep } from "node:path";
import type { Config } from "structured-context/api";

function contains(spacePath: string, filePath: string): boolean {
	const dir = spacePath.endsWith(sep) ? spacePath : `${spacePath}${sep}`;
	return filePath === spacePath || filePath.startsWith(dir);
}

/**
 * The name of the space a file is validated in. Matches structured-context's `validateFile`, which takes the first
 * space whose folder holds the file. Paths are absolute, as the loaded config's space paths are.
 */
export function spaceOf(config: Config, filePath: string): string | undefined {
	return config.spaces.find((space) => contains(space.path, filePath))?.name;
}

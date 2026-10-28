import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const FOLDER_PREFIX = "schemas";

/**
 * Write the schema files embedded at build time into a folder of pluginDir named after their contents, and remove
 * folders left by other builds (so a schema renamed or removed in a later structured-context release is not still
 * offered). Returns the folder. Throws if it cannot be written; removing old folders is best effort.
 */
export function writeSchemaFiles(pluginDir: string, files: Record<string, string>): string {
	const dir = join(pluginDir, `${FOLDER_PREFIX}-${contentHash(files)}`);
	for (const [relPath, contents] of Object.entries(files)) {
		const file = join(dir, relPath);
		if (existsSync(file) && readFileSync(file, "utf8") === contents) continue;
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, contents);
	}
	for (const name of readdirSync(pluginDir)) {
		const old = join(pluginDir, name);
		if (old === dir || !(name === FOLDER_PREFIX || name.startsWith(`${FOLDER_PREFIX}-`))) continue;
		try {
			rmSync(old, { recursive: true, force: true });
		} catch (e) {
			console.warn(`[structured-context] Could not remove old schemas folder ${old}:`, e);
		}
	}
	return dir;
}

function contentHash(files: Record<string, string>): string {
	const hash = createHash("sha256");
	for (const relPath of Object.keys(files).sort())
		hash.update(relPath)
			.update("\0")
			.update(files[relPath] ?? "")
			.update("\0");
	return hash.digest("hex").slice(0, 12);
}

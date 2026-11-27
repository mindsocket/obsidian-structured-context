import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
	type Config,
	createSpaceContext,
	type ReadSpaceResult,
	readSpace,
	refreshReadResult,
	type SpaceContext,
	validateSpace,
} from "structured-context/api";
import type { FileValidationResult } from "structured-context/types";
import { resolveVaultFile } from "./config-source";

interface SpaceCacheEntry {
	context: SpaceContext;
	readResult: ReadSpaceResult;
	schemaMtimeMs: number | undefined;
	/** Space-relative file paths modified since `readResult` was last updated. */
	pendingFiles: Set<string>;
}

function mtimeOf(filePath: string): number | undefined {
	try {
		return statSync(filePath).mtimeMs;
	} catch {
		return undefined;
	}
}

/**
 * Keeps one `SpaceContext` and `ReadSpaceResult` per space so saves refresh only the changed files via
 * `refreshReadResult` instead of re-reading the whole space. Rebuilds the context and re-reads when the config
 * or the space's schema file changes.
 */
export class Validator {
	private config: Config;
	private configKey: string;
	private spaces = new Map<string, SpaceCacheEntry>();

	constructor(config: Config) {
		this.config = config;
		this.configKey = JSON.stringify(config);
	}

	/** Replace the active config, clearing cached spaces only when the config actually changed. */
	updateConfig(config: Config): void {
		const nextKey = JSON.stringify(config);
		if (nextKey === this.configKey) return;
		this.config = config;
		this.configKey = nextKey;
		this.spaces.clear();
	}

	/** Record that a vault file (absolute path) was created, modified, deleted or renamed. */
	recordChange(filePath: string): void {
		const absFile = isAbsolute(filePath) ? filePath : resolve(filePath);
		const match = resolveVaultFile(this.config, absFile);
		if (!match) return;
		const entry = this.spaces.get(match.space.name);
		if (!entry) return;
		entry.pendingFiles.add(match.label);
	}

	async validate(filePath: string): Promise<FileValidationResult | null> {
		const absFile = isAbsolute(filePath) ? filePath : resolve(filePath);
		const match = resolveVaultFile(this.config, absFile);
		if (!match) return null;

		const { space, label } = match;
		let entry = this.spaces.get(space.name);
		const schemaChanged = entry !== undefined && mtimeOf(entry.context.resolvedSchemaPath) !== entry.schemaMtimeMs;

		if (!entry || schemaChanged) {
			const context = createSpaceContext(space.name, this.config);
			const readResult = await readSpace(context);
			entry = {
				context,
				readResult,
				schemaMtimeMs: mtimeOf(context.resolvedSchemaPath),
				pendingFiles: new Set(),
			};
			this.spaces.set(space.name, entry);
		} else if (entry.pendingFiles.size > 0) {
			const changed = [...entry.pendingFiles];
			entry.pendingFiles.clear();
			try {
				entry.readResult = await refreshReadResult(entry.context, entry.readResult, changed);
			} catch (err) {
				// Drop the cached space so the next run recovers cleanly with a full read.
				this.spaces.delete(space.name);
				throw err;
			}
		}

		// Editor feedback: show cheap rule results even where an ancestor failed (includeGated). No judge is
		// passed, so semantic rules never run here.
		const full = await validateSpace(entry.context, { readResult: entry.readResult, includeGated: true });
		const issues = full.issues.filter((issue) => issue.nodeId === label);
		const errorCount = issues.filter((issue) => issue.severity === "error").length;

		return {
			file: absFile,
			label,
			space: space.name,
			issues,
			errorCount,
			warningCount: issues.length - errorCount,
			inSpace: true,
		};
	}
}

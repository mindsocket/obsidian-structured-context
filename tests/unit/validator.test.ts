import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { Config } from "structured-context/api";
import { Validator } from "../../src/validator";

const tempDirs: string[] = [];

const TEST_SCHEMA = {
	oneOf: [
		{
			type: "object",
			required: ["type", "title", "status"],
			properties: {
				type: { const: "vision" },
				title: { type: "string" },
				status: { type: "string" },
			},
		},
		{
			type: "object",
			required: ["type", "title", "status"],
			properties: {
				type: { const: "goal" },
				title: { type: "string" },
				status: { type: "string" },
				parent: { type: "string" },
			},
		},
	],
	$metadata: {
		hierarchy: {
			levels: ["vision", "goal"],
		},
	},
};

function makeVault(files: Record<string, string>, schemaPath?: string) {
	const root = mkdtempSync(join(tmpdir(), "sctx-obs-val-"));
	tempDirs.push(root);
	const resolvedSchema = schemaPath ?? join(root, "schema.json");
	if (!schemaPath) {
		writeFileSync(resolvedSchema, JSON.stringify(TEST_SCHEMA), "utf-8");
	}
	const spaceDir = join(root, "notes");
	mkdirSync(spaceDir, { recursive: true });
	for (const [rel, content] of Object.entries(files)) {
		const full = join(spaceDir, rel);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, content, "utf-8");
	}
	const config: Config = {
		spaces: [
			{
				name: "notes",
				path: spaceDir,
				schema: resolvedSchema,
				sourceDir: root,
			},
		],
	};
	return { root, spaceDir, config };
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("Validator", () => {
	it("returns null for files outside any configured space", async () => {
		const { root, config } = makeVault({
			"vision.md": "---\ntype: vision\ntitle: V\nstatus: active\n---\n",
		});
		const validator = new Validator(config);
		assert.equal(await validator.validate(join(root, "other.md")), null);
	});

	it("refreshes incrementally on modify, create, rename and delete", async () => {
		const { spaceDir, config } = makeVault({
			"vision.md": "---\ntype: vision\ntitle: Our Vision\nstatus: active\n---\n",
			"goal.md": '---\ntype: goal\ntitle: Goal A\nstatus: active\nparent: "[[Missing Vision]]"\n---\n',
		});
		const validator = new Validator(config);
		const goalPath = join(spaceDir, "goal.md");

		const initial = await validator.validate(goalPath);
		assert.ok(initial);
		assert.equal(initial.errorCount, 1);

		// Create the missing target and record the change
		const missingPath = join(spaceDir, "missing.md");
		writeFileSync(missingPath, "---\ntype: vision\ntitle: Missing Vision\nstatus: active\n---\n");
		validator.recordChange(missingPath);

		const afterCreate = await validator.validate(goalPath);
		assert.ok(afterCreate);
		assert.equal(afterCreate.errorCount, 0);

		// Rename missing.md -> renamed.md (same title, still valid)
		const renamedPath = join(spaceDir, "renamed.md");
		renameSync(missingPath, renamedPath);
		validator.recordChange(missingPath);
		validator.recordChange(renamedPath);

		const afterRename = await validator.validate(goalPath);
		assert.ok(afterRename);
		assert.equal(afterRename.errorCount, 0);

		// Delete renamed.md -> broken link returns
		unlinkSync(renamedPath);
		validator.recordChange(renamedPath);

		const afterDelete = await validator.validate(goalPath);
		assert.ok(afterDelete);
		assert.equal(afterDelete.errorCount, 1);
	});

	it("rebuilds context when the schema file changes on disk", async () => {
		const root = mkdtempSync(join(tmpdir(), "sctx-obs-schema-"));
		tempDirs.push(root);
		const schemaPath = join(root, "custom.json");
		const writeSchema = (required: string[]) =>
			writeFileSync(
				schemaPath,
				JSON.stringify({
					type: "object",
					required,
					properties: {
						type: { const: "note" },
						title: { type: "string" },
						owner: { type: "string" },
					},
				}),
			);
		writeSchema(["type", "title"]);
		const spaceDir = join(root, "notes");
		mkdirSync(spaceDir, { recursive: true });
		const notePath = join(spaceDir, "n.md");
		writeFileSync(notePath, "---\ntype: note\ntitle: Hello\n---\n");

		const config: Config = {
			spaces: [{ name: "notes", path: spaceDir, schema: schemaPath, sourceDir: root }],
		};
		const validator = new Validator(config);

		const first = await validator.validate(notePath);
		assert.equal(first?.errorCount, 0);

		// Update schema to require `owner` and bump mtime so statSync reliably observes the change
		writeSchema(["type", "title", "owner"]);
		const future = new Date(Date.now() + 2000);
		utimesSync(schemaPath, future, future);

		const second = await validator.validate(notePath);
		assert.equal(second?.errorCount, 1);
	});

	// Tracked in https://github.com/mindsocket/obsidian-structured-context/issues/24
	it.skip("rebuilds context when an imported local schema partial changes on disk", async () => {
		const root = mkdtempSync(join(tmpdir(), "sctx-obs-partial-"));
		tempDirs.push(root);
		const partialPath = join(root, "_base.json");
		const writePartial = (required: string[]) =>
			writeFileSync(
				partialPath,
				JSON.stringify({
					$id: "local/_base.json",
					type: "object",
					required,
					properties: {
						type: { const: "note" },
						title: { type: "string" },
						owner: { type: "string" },
					},
				}),
			);
		writePartial(["type", "title"]);
		const schemaPath = join(root, "root.json");
		writeFileSync(schemaPath, JSON.stringify({ $ref: "local/_base.json" }));

		const spaceDir = join(root, "notes");
		mkdirSync(spaceDir, { recursive: true });
		const notePath = join(spaceDir, "n.md");
		writeFileSync(notePath, "---\ntype: note\ntitle: Hello\n---\n");

		const config: Config = {
			spaces: [{ name: "notes", path: spaceDir, schema: schemaPath, sourceDir: root }],
		};
		const validator = new Validator(config);

		const first = await validator.validate(notePath);
		assert.equal(first?.errorCount, 0);

		// Edit only the imported partial; root.json's mtime is unchanged
		writePartial(["type", "title", "owner"]);
		const future = new Date(Date.now() + 2000);
		utimesSync(partialPath, future, future);

		const second = await validator.validate(notePath);
		assert.equal(second?.errorCount, 1);
	});
});

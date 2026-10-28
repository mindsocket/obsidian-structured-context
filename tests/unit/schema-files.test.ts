import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { writeSchemaFiles } from "../../src/schema-files";

let pluginDir = "";
const files = { "a.json": '{"a":1}', "generated/latest/meta.json": "{}" };

beforeEach(() => {
	pluginDir = mkdtempSync(join(tmpdir(), "sctx-schemas-"));
});
afterEach(() => rmSync(pluginDir, { recursive: true, force: true }));

describe("writeSchemaFiles", () => {
	it("writes every file, nested ones included, into one folder", () => {
		const dir = writeSchemaFiles(pluginDir, files);
		assert.equal(readFileSync(join(dir, "a.json"), "utf8"), '{"a":1}');
		assert.equal(readFileSync(join(dir, "generated/latest/meta.json"), "utf8"), "{}");
	});

	it("uses the same folder for the same files, and another one when they change", () => {
		const first = writeSchemaFiles(pluginDir, files);
		assert.equal(writeSchemaFiles(pluginDir, files), first);
		const changed = writeSchemaFiles(pluginDir, { ...files, "a.json": '{"a":2}' });
		assert.notEqual(changed, first);
	});

	it("removes folders from other builds, the old unversioned one included, and nothing else", () => {
		mkdirSync(join(pluginDir, "schemas"));
		writeFileSync(join(pluginDir, "schemas", "removed.json"), "{}");
		const old = writeSchemaFiles(pluginDir, { "removed.json": "{}" });
		writeFileSync(join(pluginDir, "main.js"), "");
		writeFileSync(join(pluginDir, "data.json"), "{}");

		const dir = writeSchemaFiles(pluginDir, files);

		assert.equal(existsSync(old), false);
		assert.deepEqual(
			readdirSync(pluginDir).sort(),
			["data.json", "main.js", dir.slice(pluginDir.length + 1)].sort(),
		);
	});

	it("throws when the folder cannot be written", () => {
		writeFileSync(join(pluginDir, "blocker"), "");
		assert.throws(() => writeSchemaFiles(join(pluginDir, "blocker"), files));
	});
});

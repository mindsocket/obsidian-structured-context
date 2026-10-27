import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setBundledSchemasDir } from "structured-context/api";
import { addSpaceTarget, addSpaceToConfig, vaultConfigPath } from "../../src/vault-config";

// Uses structured-context's real addSpace, which checks that the schema resolves from the file it writes to.
let root = "";
let vault = "";
let elsewhere = "";
const read = (file: string) => JSON.parse(readFileSync(file, "utf8")) as { spaces: { name: string; path: string; schema: string }[] };

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "sctx-add-")));
	vault = join(root, "vault");
	elsewhere = join(root, "global", "config.json");
	mkdirSync(join(vault, "notes"), { recursive: true });
	mkdirSync(join(vault, "schemas"), { recursive: true });
	writeFileSync(join(vault, "schemas", "mine.json"), "{}");
	// A bundled schema to name; the real set is written by the plugin at load
	const bundled = join(root, "bundled");
	mkdirSync(bundled);
	writeFileSync(join(bundled, "strategy_general.json"), "{}");
	setBundledSchemasDir(bundled);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("adding a space with the real addSpace", () => {
	it("creates a vault root config with vault-relative paths", () => {
		const target = addSpaceTarget(vault, undefined);
		addSpaceToConfig(vault, target, { name: "notes", path: "notes", schema: "schemas/mine.json" });
		assert.equal(target, vaultConfigPath(vault));
		assert.deepEqual(read(target).spaces, [{ name: "notes", path: "notes", schema: "./schemas/mine.json" }]);
	});

	it("saves a vault schema as an absolute path in a config elsewhere, and the space path too", () => {
		addSpaceToConfig(vault, elsewhere, { name: "notes", path: "notes", schema: "schemas/mine.json" });
		assert.deepEqual(read(elsewhere).spaces, [
			{ name: "notes", path: join(vault, "notes"), schema: join(vault, "schemas", "mine.json") },
		]);
	});

	it("saves a bundled schema by name, and the default when none is chosen", () => {
		const named = ["strategy_general.json"];
		addSpaceToConfig(vault, elsewhere, { name: "a", path: "notes", schema: "strategy_general.json" }, named);
		addSpaceToConfig(vault, elsewhere, { name: "b", path: "notes" }, named);
		assert.deepEqual(read(elsewhere).spaces.map(s => s.schema), ["strategy_general.json", "strategy_general.json"]);
	});

	it("refuses a duplicate name, leaving the file as it was", () => {
		const target = vaultConfigPath(vault);
		addSpaceToConfig(vault, target, { name: "notes", path: "notes" });
		const before = readFileSync(target, "utf8");
		assert.throws(() => addSpaceToConfig(vault, target, { name: "notes", path: "notes" }), /already defines a space named/);
		assert.equal(readFileSync(target, "utf8"), before);
	});

	it("refuses a config that is not strict JSON, leaving it as it was", () => {
		mkdirSync(join(root, "global"), { recursive: true });
		writeFileSync(elsewhere, "{ // comment\n \"spaces\": [] }");
		assert.throws(() => addSpaceToConfig(vault, elsewhere, { name: "notes", path: "notes" }), /not strict JSON/);
		assert.equal(readFileSync(elsewhere, "utf8"), "{ // comment\n \"spaces\": [] }");
	});
});

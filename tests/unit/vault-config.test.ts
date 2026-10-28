import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { addSpace } from "structured-context/api";
import { DEFAULT_SCHEMA } from "../../src/config-source";
import { addSpaceTarget, addSpaceToConfig, vaultConfigPath } from "../../src/vault-config";

type AddSpaceOptions = Parameters<typeof addSpace>[0];
type AddSpaceResult = ReturnType<typeof addSpace>;

const BASE = join("/", "vault");
const GLOBAL = join("/", "home", "me", ".config", "structured-context", "config.json");
const recorder = () => {
	const calls: AddSpaceOptions[] = [];
	const write = (options: AddSpaceOptions): AddSpaceResult => {
		calls.push(options);
		return { configPath: options.configFile ?? "", created: true, space: { name: options.name, path: "." } };
	};
	return { calls, write };
};

describe("addSpaceTarget", () => {
	it("is the discovered config when there is one", () => {
		assert.equal(addSpaceTarget(BASE, GLOBAL), GLOBAL);
	});

	it("is a new .sctx.json at the vault root when none was found, or when asked for", () => {
		assert.equal(addSpaceTarget(BASE, undefined), join(BASE, ".sctx.json"));
		assert.equal(addSpaceTarget(BASE, GLOBAL, true), vaultConfigPath(BASE));
	});
});

describe("addSpaceToConfig", () => {
	it("writes to the given file with an absolute path and the default schema", () => {
		const { calls, write } = recorder();
		addSpaceToConfig(BASE, vaultConfigPath(BASE), { name: "notes", path: "notes" }, [], write);
		assert.deepEqual(calls, [
			{
				name: "notes",
				path: join(BASE, "notes"),
				schema: DEFAULT_SCHEMA,
				configFile: vaultConfigPath(BASE),
				startDir: BASE,
			},
		]);
	});

	it("writes a vault schema relative to the vault root config", () => {
		const { calls, write } = recorder();
		addSpaceToConfig(BASE, vaultConfigPath(BASE), { name: "n", path: "n", schema: "schemas/mine.json" }, [], write);
		assert.equal(calls[0]?.schema, "./schemas/mine.json");
	});

	it("writes a vault schema as an absolute path to a config anywhere else", () => {
		const { calls, write } = recorder();
		addSpaceToConfig(BASE, GLOBAL, { name: "n", path: "n", schema: "schemas/mine.json" }, [], write);
		assert.equal(calls[0]?.schema, join(BASE, "schemas/mine.json"));
		assert.equal(calls[0]?.configFile, GLOBAL);
	});

	it("writes a bundled or plugin schema by name, wherever the config is", () => {
		const { calls, write } = recorder();
		const named = ["knowledge_wiki.json", "demo/demo.json"];
		addSpaceToConfig(BASE, GLOBAL, { name: "a", path: "a", schema: "knowledge_wiki.json" }, named, write);
		addSpaceToConfig(BASE, vaultConfigPath(BASE), { name: "b", path: "b", schema: "demo/demo.json" }, named, write);
		assert.deepEqual(
			calls.map((c) => c.schema),
			["knowledge_wiki.json", "demo/demo.json"],
		);
	});
});

import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { addSpace } from "structured-context/api";
import { DEFAULT_SCHEMA } from "../../src/config-source";
import { addSpaceToVaultConfig, migrateSpacesToVaultConfig, vaultConfigPath } from "../../src/vault-config";

type AddSpaceOptions = Parameters<typeof addSpace>[0];
type AddSpaceResult = ReturnType<typeof addSpace>;

const BASE = join("/", "vault");
const recorder = () => {
	const calls: AddSpaceOptions[] = [];
	const write = (options: AddSpaceOptions): AddSpaceResult => {
		calls.push(options);
		return { configPath: options.configFile ?? "", created: true, space: { name: options.name, path: "." } };
	};
	return { calls, write };
};

describe("addSpaceToVaultConfig", () => {
	it("writes to the vault root with absolute paths and the default schema", () => {
		const { calls, write } = recorder();
		addSpaceToVaultConfig(BASE, { name: "notes", path: "notes" }, write);
		assert.deepEqual(calls, [
			{ name: "notes", path: join(BASE, "notes"), schema: DEFAULT_SCHEMA, configFile: vaultConfigPath(BASE), startDir: BASE },
		]);
		assert.equal(vaultConfigPath(BASE), join(BASE, ".sctx.json"));
	});

	it("writes a vault-relative schema relative to the config folder", () => {
		const { calls, write } = recorder();
		addSpaceToVaultConfig(BASE, { name: "n", path: "n", schema: "schemas/mine.json" }, write);
		assert.equal(calls[0]?.schema, "./schemas/mine.json");
	});
});

describe("migrateSpacesToVaultConfig", () => {
	it("moves every space", () => {
		const { calls, write } = recorder();
		const spaces = [{ name: "a", path: "a" }, { name: "b", path: "b" }];
		const result = migrateSpacesToVaultConfig(BASE, spaces, write);
		assert.deepEqual(result.moved, spaces);
		assert.equal(result.error, undefined);
		assert.equal(calls.length, 2);
	});

	it("stops at the first failure and reports what moved", () => {
		let n = 0;
		const write = (options: AddSpaceOptions): AddSpaceResult => {
			if (++n === 2) throw new Error("E_SPACE_EXISTS: already there");
			return { configPath: "", created: false, space: { name: options.name, path: "." } };
		};
		const spaces = [{ name: "a", path: "a" }, { name: "b", path: "b" }, { name: "c", path: "c" }];
		const result = migrateSpacesToVaultConfig(BASE, spaces, write);
		assert.deepEqual(result.moved, [spaces[0]]);
		assert.match(result.error ?? "", /E_SPACE_EXISTS/);
	});
});

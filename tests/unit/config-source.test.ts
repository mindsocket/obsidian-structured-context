import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Config } from "structured-context/api";
import { resolveConfig, type ConfigLoader } from "../../src/config-source";

const BASE = join("/", "vault");
const found = () => join(BASE, ".sctx.json");
const discoveredConfig: Config = { spaces: [{ name: "global", path: "/elsewhere" }] };
const failing: ConfigLoader = () => {
	throw new Error("bad json");
};

describe("resolveConfig", () => {
	it("discovers from the vault folder and reports the file found", () => {
		let startedAt: string | undefined;
		const loader: ConfigLoader = (startDir) => ((startedAt = startDir), discoveredConfig);
		const result = resolveConfig(BASE, loader, found);
		assert.equal(startedAt, BASE);
		assert.equal(result.config, discoveredConfig);
		assert.equal(result.file, found());
	});

	it("has no spaces and no error when no config exists yet", () => {
		const result = resolveConfig(BASE, failing, () => undefined);
		assert.deepEqual(result.config.spaces, []);
		assert.equal(result.error, undefined);
		assert.equal(result.file, undefined);
	});

	it("reports a config that fails to load, with the file", () => {
		const result = resolveConfig(BASE, failing, found);
		assert.equal(result.error, "bad json");
		assert.deepEqual(result.config.spaces, []);
		assert.equal(result.file, found());
	});

	it("discovers from the working directory when the vault has no filesystem path", () => {
		let startedAt: string | undefined = "unset";
		resolveConfig(null, (startDir) => ((startedAt = startDir), discoveredConfig), found);
		assert.equal(startedAt, undefined);
	});
});

import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Config } from "structured-context/api";
import { resolveConfig, type ConfigLoader, type ConfigSettings } from "../../src/config-source";

const BASE = join("/", "vault");
const settings = (over: Partial<ConfigSettings> = {}): ConfigSettings => ({
	configMode: "discovered",
	configPath: "",
	...over,
});
const found = () => join(BASE, ".sctx.json");
const discoveredConfig: Config = { spaces: [{ name: "global", path: "/elsewhere" }] };
const loaderOf = (config: Config): ConfigLoader => () => config;
const failing: ConfigLoader = () => {
	throw new Error("bad json");
};

describe("custom config file", () => {
	it("loads the given path", () => {
		let asked: string | undefined;
		const loader: ConfigLoader = (path) => ((asked = path), discoveredConfig);
		const result = resolveConfig(settings({ configMode: "custom", configPath: "/my/config.json" }), BASE, loader);
		assert.equal(asked, "/my/config.json");
		assert.equal(result.source, "custom");
		assert.equal(result.config, discoveredConfig);
		assert.equal(result.file, "/my/config.json");
	});

	it("reports a missing path instead of loading", () => {
		const result = resolveConfig(settings({ configMode: "custom", configPath: "  " }), BASE, loaderOf(discoveredConfig));
		assert.match(result.error ?? "", /No config file path/);
		assert.deepEqual(result.config.spaces, []);
	});

	it("reports a config that fails to load, with no spaces", () => {
		const result = resolveConfig(settings({ configMode: "custom", configPath: "/x.json" }), BASE, failing);
		assert.equal(result.error, "bad json");
		assert.deepEqual(result.config.spaces, []);
	});
});

describe("discovered config", () => {
	it("is discovered from the vault folder, not given a path, and reports the file found", () => {
		let asked: string | undefined = "unset";
		let startedAt: string | undefined;
		const loader: ConfigLoader = (path, startDir) => ((asked = path), (startedAt = startDir), discoveredConfig);
		const result = resolveConfig(settings(), BASE, loader, found);
		assert.equal(asked, undefined);
		assert.equal(startedAt, BASE);
		assert.equal(result.source, "discovered");
		assert.equal(result.config, discoveredConfig);
		assert.equal(result.file, found());
	});

	it("has no spaces and no error when no config exists yet", () => {
		const result = resolveConfig(settings(), BASE, failing, () => undefined);
		assert.deepEqual(result.config.spaces, []);
		assert.equal(result.error, undefined);
		assert.equal(result.file, undefined);
	});

	it("reports a config that fails to load", () => {
		assert.equal(resolveConfig(settings(), BASE, failing, found).error, "bad json");
	});
});

describe("vault config", () => {
	const vaultFile = join(BASE, ".sctx.json");

	it("loads only the .sctx.json at the vault root, ignoring any discovered config", () => {
		let asked: string | undefined;
		const loader: ConfigLoader = (path) => ((asked = path), discoveredConfig);
		const result = resolveConfig(settings({ configMode: "vault" }), BASE, loader, () => "/elsewhere/.sctx.json", () => true);
		assert.equal(asked, vaultFile);
		assert.equal(result.source, "vault");
		assert.equal(result.file, vaultFile);
	});

	it("has no spaces and no error until the file exists", () => {
		const result = resolveConfig(settings({ configMode: "vault" }), BASE, failing, found, () => false);
		assert.deepEqual(result.config.spaces, []);
		assert.equal(result.error, undefined);
		assert.equal(result.file, undefined);
	});

	it("reports a vault config that fails to load", () => {
		assert.equal(resolveConfig(settings({ configMode: "vault" }), BASE, failing, found, () => true).error, "bad json");
	});

	it("has no spaces when the vault has no filesystem path", () => {
		assert.deepEqual(resolveConfig(settings({ configMode: "vault" }), null, failing).config.spaces, []);
	});
});

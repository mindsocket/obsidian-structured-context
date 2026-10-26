import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Config } from "structured-context/api";
import { DEFAULT_SCHEMA, resolveConfig, type ConfigLoader, type ConfigSettings } from "../../src/config-source";

const BASE = join("/", "vault");
const settings = (over: Partial<ConfigSettings> = {}): ConfigSettings => ({
	configMode: "auto",
	configPath: "",
	spaces: [{ name: "notes", path: "notes" }],
	...over,
});
const systemConfig: Config = { spaces: [{ name: "global", path: "/elsewhere" }] };
const loaderOf = (config: Config): ConfigLoader => () => config;
const failing: ConfigLoader = () => {
	throw new Error("bad json");
};

describe("built-in spaces", () => {
	it("resolves vault-relative paths against the vault and defaults the schema", () => {
		const { config, source, error } = resolveConfig(settings({ configMode: "builtin" }), BASE, failing);
		assert.equal(source, "builtin");
		assert.equal(error, undefined);
		assert.deepEqual(config.spaces, [
			{ name: "notes", path: join(BASE, "notes"), sourceDir: BASE, schema: DEFAULT_SCHEMA },
		]);
	});

	it("resolves a space's own schema against the vault", () => {
		const { config } = resolveConfig(
			settings({ configMode: "builtin", spaces: [{ name: "n", path: "n", schema: "schemas/mine.json" }] }),
			BASE,
			failing,
		);
		assert.equal(config.spaces[0]?.schema, join(BASE, "schemas/mine.json"));
	});

	it("has no spaces when the vault has no filesystem path", () => {
		assert.deepEqual(resolveConfig(settings({ configMode: "builtin" }), null, failing).config.spaces, []);
	});
});

describe("custom config file", () => {
	it("loads the given path", () => {
		let asked: string | undefined;
		const loader: ConfigLoader = (path) => ((asked = path), systemConfig);
		const result = resolveConfig(settings({ configMode: "custom", configPath: "/my/config.json" }), BASE, loader);
		assert.equal(asked, "/my/config.json");
		assert.equal(result.source, "custom");
		assert.equal(result.config, systemConfig);
	});

	it("reports a missing path instead of loading", () => {
		const result = resolveConfig(settings({ configMode: "custom", configPath: "  " }), BASE, loaderOf(systemConfig));
		assert.match(result.error ?? "", /No config file path/);
		assert.deepEqual(result.config.spaces, []);
	});

	it("reports a config that fails to load, with no spaces", () => {
		const result = resolveConfig(settings({ configMode: "custom", configPath: "/x.json" }), BASE, failing);
		assert.equal(result.error, "bad json");
		assert.deepEqual(result.config.spaces, []);
	});
});

describe("system config", () => {
	it("is discovered, not given a path", () => {
		let asked: string | undefined = "unset";
		const loader: ConfigLoader = (path) => ((asked = path), systemConfig);
		const result = resolveConfig(settings({ configMode: "system" }), BASE, loader);
		assert.equal(asked, undefined);
		assert.equal(result.source, "system");
	});

	it("does not fall back to built-in spaces", () => {
		const result = resolveConfig(settings({ configMode: "system" }), BASE, loaderOf({ spaces: [] }));
		assert.equal(result.source, "system");
		assert.deepEqual(result.config.spaces, []);
	});

	it("reports a config that fails to load", () => {
		assert.equal(resolveConfig(settings({ configMode: "system" }), BASE, failing).error, "bad json");
	});
});

describe("automatic", () => {
	it("prefers a system config that defines spaces", () => {
		const result = resolveConfig(settings(), BASE, loaderOf(systemConfig));
		assert.equal(result.source, "system");
		assert.equal(result.config, systemConfig);
	});

	it("falls back to built-in spaces when the system config has none", () => {
		const result = resolveConfig(settings(), BASE, loaderOf({ spaces: [] }));
		assert.equal(result.source, "builtin");
		assert.equal(result.error, undefined);
		assert.equal(result.config.spaces[0]?.name, "notes");
	});

	it("falls back to built-in spaces but reports a system config that is broken", () => {
		const result = resolveConfig(settings(), BASE, failing);
		assert.equal(result.source, "builtin");
		assert.equal(result.error, "bad json");
		assert.equal(result.config.spaces[0]?.name, "notes");
	});
});

// Install the release assets into a throwaway vault and load the plugin outside Obsidian, so a bad
// bundle or a missing runtime file fails here rather than after a release. Run `npm run build` first.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const vault = mkdtempSync(join(tmpdir(), "sctx-obsidian-smoke-"));
try {
	// Only what a GitHub release carries: main.js, manifest.json, styles.css.
	const pluginDir = join(vault, ".obsidian/plugins/structured-context");
	mkdirSync(pluginDir, { recursive: true });
	for (const [from, to] of [["dist/main.js", "main.js"], ["dist/manifest.json", "manifest.json"], ["dist/styles.css", "styles.css"]]) {
		assert.ok(existsSync(join(root, from)), `${from} missing; run npm run build first`);
		cpSync(join(root, from), join(pluginDir, to));
	}
	cpSync(join(root, "tests/smoke/vault/notes"), join(vault, "notes"), { recursive: true });

	// `obsidian` and CodeMirror are external to the bundle and supplied by the app. Resolve obsidian to the
	// stub, and CodeMirror from this repo's devDependencies.
	const Module = createRequire(import.meta.url)("node:module");
	const resolveFilename = Module._resolveFilename;
	Module._resolveFilename = function (request, ...rest) {
		if (request === "obsidian") return join(root, "tests/smoke/stubs/obsidian/index.js");
		if (request.startsWith("@codemirror/")) return resolveFilename.call(this, request, { ...rest[0], paths: [join(root, "node_modules")] }, ...rest.slice(1));
		return resolveFilename.call(this, request, ...rest);
	};

	const { FileSystemAdapter } = createRequire(import.meta.url)("obsidian");
	const manifest = JSON.parse((await import("node:fs")).readFileSync(join(pluginDir, "manifest.json"), "utf8"));
	const PluginClass = createRequire(join(pluginDir, "main.js"))(join(pluginDir, "main.js"));
	const Plugin = PluginClass.default ?? PluginClass;

	const app = {
		vault: { adapter: new FileSystemAdapter(vault), on() {} },
		workspace: { on() {}, getActiveViewOfType: () => null, getLeaf: () => ({}) },
	};
	const load = async (savedData) => {
		const plugin = new Plugin(app, { ...manifest, dir: ".obsidian/plugins/structured-context" });
		plugin.savedData = savedData;
		await plugin.onload();
		return plugin;
	};
	const check = async (plugin, label) => {
		const results = {};
		for (const name of ["valid-goal", "invalid-type"]) {
			results[name] = await plugin.validator.validate(join(vault, "notes", `${name}.md`));
		}
		assert.ok(results["valid-goal"], `${label}: valid note was not found in the space`);
		assert.equal(results["valid-goal"].errorCount, 0, `${label}: valid note failed: ${JSON.stringify(results["valid-goal"])}`);
		assert.ok(results["invalid-type"]?.errorCount > 0, `${label}: invalid note passed validation`);
		plugin.onunload();
	};

	// Spaces kept in the plugin settings
	await check(await load({ configMode: "builtin", spaces: [{ name: "smoke", path: "notes" }] }), "built-in");

	// A .sctx.json at the vault root, found by discovery in automatic mode
	writeFileSync(join(vault, ".sctx.json"), JSON.stringify({ spaces: [{ name: "smoke", path: "notes", schema: "strategy_general.json" }] }));
	const discovered = await load({ configMode: "auto", spaces: [] });
	assert.equal(discovered.resolvedConfig.source, "system");
	assert.equal(discovered.resolvedConfig.file, join(vault, ".sctx.json"));
	await check(discovered, "vault .sctx.json");
	console.log("smoke ok");
} finally {
	rmSync(vault, { recursive: true, force: true });
}

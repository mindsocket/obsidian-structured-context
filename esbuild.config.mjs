import { appendFileSync, cpSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import esbuild from "esbuild";

const require = createRequire(import.meta.url);
const apiEntry = require.resolve("structured-context/api");
const sctxRoot = resolve(dirname(apiEntry), "..");

/** Every file under dir, as { path relative to dir: contents }. */
function readTree(dir, base = dir, out = {}) {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) readTree(full, base, out);
		else out[relative(base, full).split("\\").join("/")] = readFileSync(full, "utf8");
	}
	return out;
}

// A release carries only main.js, manifest.json and styles.css, so structured-context's bundled schemas
// travel inside main.js and are written next to it when the plugin loads.
const embeddedSchemas = {
	name: "embedded-schemas",
	setup(build) {
		build.onResolve({ filter: /^virtual:bundled-schemas$/ }, (args) => ({
			path: args.path,
			namespace: "sctx-schemas",
		}));
		build.onLoad({ filter: /.*/, namespace: "sctx-schemas" }, () => ({
			contents: `export default ${JSON.stringify(readTree(resolve(sctxRoot, "schemas")))};`,
			loader: "js",
			watchDirs: [resolve(sctxRoot, "schemas")],
		}));
	},
};

const copyAssets = {
	name: "copy-assets",
	setup(build) {
		build.onEnd(() => {
			cpSync("manifest.json", "dist/manifest.json");
			// Plugin styles plus the map-views library's prebuilt stylesheet.
			const mapViewsCss = readFileSync(require.resolve("structured-context-map-views/styles.css"), "utf8");
			writeFileSync("dist/styles.css", `${readFileSync("styles.css", "utf8")}\n${mapViewsCss}`);
		});
	},
};

/** The package folder under node_modules that a bundled input belongs to, or undefined for our own source. */
function packageDirOf(input) {
	const parts = input.split("/");
	const i = parts.lastIndexOf("node_modules");
	if (i < 0) return undefined;
	const nameLength = parts[i + 1]?.startsWith("@") ? 2 : 1;
	return parts.slice(0, i + 1 + nameLength).join("/");
}

const isCopyrightLine = (line) => /^\s*(copyright\b|\(c\)|©)/i.test(line);

// A release is only main.js, manifest.json and styles.css, so the licences of the packages bundled into main.js
// travel at its end. Each distinct licence text appears once, after the packages and copyright lines it covers.
const licenceNotices = {
	name: "licence-notices",
	setup(build) {
		build.onEnd((result) => {
			if (!result.metafile) return;
			const dirs = [...new Set(Object.keys(result.metafile.inputs).map(packageDirOf).filter(Boolean))];
			const groups = new Map(); // licence text without copyright lines -> lines naming the packages it covers
			for (const dir of dirs) {
				const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
				const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
				const lines = file ? readFileSync(join(dir, file), "utf8").split("\n") : [];
				const copyright = lines
					.filter(isCopyrightLine)
					.map((l) => l.trim())
					.join("; ");
				const text = file
					? lines
							.filter((l) => !isCopyrightLine(l))
							.join("\n")
							.trim()
					: `License: ${pkg.license ?? "unknown"} (the package has no licence file)`;
				if (!groups.has(text)) groups.set(text, []);
				groups.get(text).push(`  ${pkg.name}@${pkg.version}${copyright ? `  ${copyright}` : ""}`);
			}
			if (groups.size === 0) return;
			const body = [...groups]
				.map(([text, packages]) => `${packages.sort().join("\n")}\n\n${text}`)
				.join("\n\n---\n\n")
				.replaceAll("*/", "* /");
			appendFileSync(
				build.initialOptions.outfile,
				`\n/*\nThird-party software bundled in this file:\n\n${body}\n*/\n`,
			);
		});
	},
};

// The Miro sync is a command-line feature that this plugin does not expose. Bundling it would add a network client
// and a read of MIRO_TOKEN to main.js, so structured-context's built-in Miro plugin is replaced by one that still
// accepts its config (a config shared with the command line stays valid) but has no render formats.
const withoutMiro = {
	name: "without-miro",
	setup(build) {
		build.onResolve({ filter: /^\.\/miro$/ }, (args) =>
			args.importer.includes(`${sep}structured-context${sep}dist${sep}plugins${sep}`)
				? { path: "miro-stub", namespace: "sctx-miro-stub" }
				: undefined,
		);
		build.onLoad({ filter: /.*/, namespace: "sctx-miro-stub" }, () => ({
			contents: `
				import { PLUGIN_PREFIX } from "structured-context/api";
				export const miroPlugin = {
					name: PLUGIN_PREFIX + "miro",
					configSchema: {
						type: "object",
						properties: { boardId: { type: "string" }, frameId: { type: "string" } },
						additionalProperties: false,
					},
				};`,
			resolveDir: sctxRoot,
			loader: "js",
		}));
	},
};

// react-dom can inject <script> elements for <script> tags it renders. The map view renders none, so that code is
// unreachable here; replace it with a throw so main.js cannot create script elements at runtime.
const SCRIPT_ELEMENT = /\b[\w$]+\.createElement\(\s*"script"\s*\)/g;
const withoutScriptInjection = {
	name: "without-script-injection",
	setup(build) {
		build.onLoad({ filter: /react-dom[\\/]cjs[\\/]react-dom-client\.(production|development)\.js$/ }, (args) => {
			const source = readFileSync(args.path, "utf8");
			const patched = source.replace(
				SCRIPT_ELEMENT,
				'(() => { throw new Error("Script elements are disabled"); })()',
			);
			if (patched === source)
				throw new Error(`without-script-injection found nothing to replace in ${args.path}`);
			return { contents: patched, loader: "js" };
		});
	},
};

const banner = `/*
THIS IS A GENERATED/BUNDLED FILE BY ESBUILD
if you want to view the source, please visit the github repository of this plugin
*/
`;

const prod = process.argv[2] === "production";

const context = await esbuild.context({
	plugins: [embeddedSchemas, withoutMiro, withoutScriptInjection, copyAssets, licenceNotices],
	metafile: prod,
	// licenceNotices covers every bundled package; esbuild's own block covers only those with legal comments
	legalComments: "none",
	banner: {
		js: banner,
	},
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",

		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtinModules,
	],
	define: {
		"process.env.NODE_ENV": JSON.stringify(prod ? "production" : "development"),
	},
	platform: "node",
	format: "cjs",
	target: "es2020",
	logLevel: "info",
	logOverride: { "empty-import-meta": "silent" },
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "dist/main.js",
	minify: prod,
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}

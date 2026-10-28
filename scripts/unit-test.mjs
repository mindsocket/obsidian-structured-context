// Bundle each tests/unit/*.test.ts with esbuild, then run them with node's test runner.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import esbuild from "esbuild";

const root = resolve(import.meta.dirname, "..");
const unitDir = join(root, "tests/unit");
const out = mkdtempSync(join(tmpdir(), "sctx-unit-"));
try {
	const entries = readdirSync(unitDir)
		.filter((f) => f.endsWith(".test.ts"))
		.map((f) => join(unitDir, f));
	await esbuild.build({
		entryPoints: entries,
		outdir: out,
		bundle: true,
		platform: "node",
		format: "cjs",
		logLevel: "warning",
		logOverride: { "empty-import-meta": "silent" },
	});
	const files = readdirSync(out)
		.filter((f) => f.endsWith(".js"))
		.map((f) => join(out, f));
	const { status } = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
	process.exitCode = status ?? 1;
} finally {
	rmSync(out, { recursive: true, force: true });
}

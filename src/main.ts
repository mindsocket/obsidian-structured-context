import { FileSystemAdapter, Notice, Plugin, MarkdownView, TFile } from "obsidian";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import bundledSchemas from "virtual:bundled-schemas";
import { loadConfig, setBundledSchemasDir, setConfigPath, type Config } from "structured-context/api";
import { EditorView } from "@codemirror/view";
import { DEFAULT_SETTINGS, PluginSettings, StructuredContextSettingTab } from "./settings";
import { Validator } from "./validator";
import { setValidationResult, validationField } from "./editor-extension";

/** Bundled schema used for built-in spaces that don't set one; structured-context requires an explicit schema. */
const DEFAULT_SCHEMA = "strategy_general.json";

/** Write the schemas embedded at build time into dir, touching only files that are missing or changed. */
function writeBundledSchemas(dir: string) {
	for (const [relPath, contents] of Object.entries(bundledSchemas)) {
		const file = join(dir, relPath);
		if (existsSync(file) && readFileSync(file, "utf8") === contents) continue;
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, contents);
	}
}

export default class StructuredContextPlugin extends Plugin {
	settings: PluginSettings;
	private validator: Validator;
	private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new StructuredContextSettingTab(this.app, this));

		// structured-context reads its bundled schemas from disk, so write them next to the plugin
		if (this.app.vault.adapter instanceof FileSystemAdapter && this.manifest.dir) {
			const pluginDir = join(this.app.vault.adapter.getBasePath(), this.manifest.dir);
			const schemasDir = join(pluginDir, "schemas");
			writeBundledSchemas(schemasDir);
			setBundledSchemasDir(schemasDir);
		}

		this.validator = new Validator(this.buildConfig());

		this.registerEditorExtension([validationField]);

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (view?.file) {
					void this.validateFile(view.file, view);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;

				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (view?.file?.path !== file.path) return;

				const existing = this.debounceTimers.get(file.path);
				if (existing) clearTimeout(existing);

				const timer = setTimeout(() => {
					this.debounceTimers.delete(file.path);
					void this.validateFile(file, view);
				}, this.settings.debounceMs);

				this.debounceTimers.set(file.path, timer);
			})
		);

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView?.file) {
			void this.validateFile(activeView.file, activeView);
		}
	}

	onunload() {
		for (const timer of this.debounceTimers.values()) {
			clearTimeout(timer);
		}
		this.debounceTimers.clear();
	}

	private async validateFile(file: TFile, view: MarkdownView) {
		const adapter = this.app.vault.adapter;
		const basePath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
		const absolutePath = basePath ? join(basePath, file.path) : file.path;

		let result = null;
		try {
			result = await this.validator.validate(absolutePath);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			new Notice(`Structured Context validation failed: ${msg}`);
			console.error("[structured-context] Validation error:", e);
			return;
		}

		const cmView = (view.editor as unknown as { cm?: EditorView }).cm;
		if (!cmView) return;

		cmView.dispatch({
			effects: setValidationResult.of(result),
		});
	}

	private buildConfig(): Config {
		const { configMode, configPath, spaces } = this.settings;
		const adapter = this.app.vault.adapter;
		const basePath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;

		switch (configMode) {
			case "builtin": {
				if (!basePath) return { spaces: [] };
				return {
					spaces: spaces.map(s => ({
						name: s.name,
						path: join(basePath, s.path),
						// Anchors relative schema and plugin paths; required for configs not loaded from a file.
						sourceDir: basePath,
						schema: s.schema ? join(basePath, s.schema) : DEFAULT_SCHEMA,
					})),
				};
			}
			case "custom":
				setConfigPath(configPath || undefined);
				return loadConfig();
			case "system":
				setConfigPath(undefined);
				return loadConfig();
		}
	}

	async loadSettings() {
		const saved = (await this.loadData()) as Record<string, unknown> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
		// Migrate: preserve existing behaviour for users with no configMode
		if (saved && !saved.configMode) {
			this.settings.configMode =
				typeof saved.configPath === "string" && saved.configPath !== ""
					? "custom"
					: "system";
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.validator = new Validator(this.buildConfig());
	}
}

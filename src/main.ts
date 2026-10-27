import { FileSystemAdapter, Notice, Plugin, MarkdownView, TFile } from "obsidian";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import bundledSchemas from "virtual:bundled-schemas";
import { listSchemas, setBundledSchemasDir } from "structured-context/api";
import { EditorView } from "@codemirror/view";
import { resolveConfig, type ResolvedConfig } from "./config-source";
import { DEFAULT_SETTINGS, PluginSettings, StructuredContextSettingTab } from "./settings";
import { Validator } from "./validator";
import { setValidationResult, validationField } from "./editor-extension";

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
	/** The config in use and where it came from; the settings tab reports it. */
	resolvedConfig: ResolvedConfig;
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

		this.applyConfig();

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

	/** The schemas available to the current config, for the add-space dialog. Empty if they cannot be listed. */
	async availableSchemas(): Promise<Awaited<ReturnType<typeof listSchemas>>> {
		try {
			return await listSchemas({ config: this.resolvedConfig.config, startDir: this.vaultBasePath() ?? undefined });
		} catch (e) {
			console.error("[structured-context] Could not list schemas:", e);
			return [];
		}
	}

	/** The vault's folder on disk, or null when the vault is not on a local filesystem. */
	vaultBasePath(): string | null {
		const adapter = this.app.vault.adapter;
		return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
	}

	/** Discover the config and use it for validation. */
	private applyConfig() {
		const adapter = this.app.vault.adapter;
		const basePath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
		this.resolvedConfig = resolveConfig(basePath);
		this.validator = new Validator(this.resolvedConfig.config);
		if (this.resolvedConfig.error) {
			new Notice(`Structured Context config problem: ${this.resolvedConfig.error}`);
			console.error("[structured-context] Config error:", this.resolvedConfig.error);
		}
	}

	async loadSettings() {
		const saved = (await this.loadData()) as Partial<PluginSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.applyConfig();
		// The open note may now be in a different space, or none
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view?.file) {
			void this.validateFile(view.file, view);
		}
	}
}

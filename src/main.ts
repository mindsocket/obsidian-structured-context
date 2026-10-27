import { FileSystemAdapter, Notice, Plugin, MarkdownView, TAbstractFile, TFile } from "obsidian";
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

function isMarkdown(path: string): boolean {
	return path.endsWith(".md");
}

export default class StructuredContextPlugin extends Plugin {
	settings: PluginSettings;
	private validator: Validator;
	/** The config in use and where it came from; the settings tab reports it. */
	resolvedConfig: ResolvedConfig;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	/** Counts validations started; a run that finishes after a newer one started discards its result. */
	private validationRun = 0;
	/** The last problem shown in a notice, so a repeated failure is not shown again on every validation. */
	private lastNotice: string | null = null;

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
				this.cancelScheduledValidation();
				void this.validateActive();
			})
		);

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file.path === this.app.workspace.getActiveFile()?.path) this.scheduleValidation();
			})
		);

		// Adding, removing or renaming any note can change the open note's links, hierarchy and duplicate checks.
		// Obsidian reports every existing file as created while the vault loads, so listen only once it has.
		this.app.workspace.onLayoutReady(() => {
			const onNoteChange = (file: TAbstractFile, oldPath?: string) => {
				if (isMarkdown(file.path) || (oldPath !== undefined && isMarkdown(oldPath))) this.scheduleValidation();
			};
			this.registerEvent(this.app.vault.on("create", onNoteChange));
			this.registerEvent(this.app.vault.on("delete", onNoteChange));
			this.registerEvent(this.app.vault.on("rename", onNoteChange));
		});

		void this.validateActive();
	}

	onunload() {
		this.cancelScheduledValidation();
	}

	/** Validate the open note once changes have paused for the debounce interval. */
	private scheduleValidation() {
		this.cancelScheduledValidation();
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			void this.validateActive();
		}, this.settings.debounceMs);
	}

	private cancelScheduledValidation() {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.debounceTimer = null;
	}

	/** Validate whichever note is open when this runs, not when it was scheduled. */
	private async validateActive() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view?.file) await this.validateFile(view.file, view);
	}

	private async validateFile(file: TFile, view: MarkdownView) {
		// The config file can be edited outside Obsidian at any time, and Obsidian does not report changes to
		// dotfiles, so discover it afresh on every validation. It is a few small JSON reads.
		this.applyConfig();
		const run = ++this.validationRun;

		const adapter = this.app.vault.adapter;
		const basePath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
		const absolutePath = basePath ? join(basePath, file.path) : file.path;

		let result = null;
		try {
			result = await this.validator.validate(absolutePath);
			if (!this.resolvedConfig.error) this.lastNotice = null;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.notifyOnce(`Structured Context validation failed: ${msg}`);
			console.error("[structured-context] Validation error:", e);
			// Fall through with no result, so the last good decorations do not stay beside the error
		}

		// A newer validation has started, or the view now shows another note: this result is stale
		if (run !== this.validationRun || view.file?.path !== file.path) return;

		const cmView = (view.editor as unknown as { cm?: EditorView }).cm;
		if (!cmView) return;

		cmView.dispatch({
			effects: setValidationResult.of(result),
		});
	}

	/** Show a notice unless it repeats the last one; a broken schema would otherwise raise one per edit. */
	private notifyOnce(message: string) {
		if (message === this.lastNotice) return;
		this.lastNotice = message;
		new Notice(message);
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
			this.notifyOnce(`Structured Context config problem: ${this.resolvedConfig.error}`);
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
		void this.validateActive();
	}
}

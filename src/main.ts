import { join } from "node:path";
import bundledSchemas from "virtual:bundled-schemas";
import type { EditorView } from "@codemirror/view";
import { type FileSystemAdapter, MarkdownView, Notice, Plugin, type TAbstractFile, type TFile } from "obsidian";
import { listSchemas, setBundledSchemasDir } from "structured-context/api";
import { type ResolvedConfig, resolveConfig } from "./config-source";
import { type FieldMap, setValidationResult, validationField } from "./editor-extension";
import { MAP_VIEW_TYPE, MapViewPane } from "./map-view";
import { writeSchemaFiles } from "./schema-files";
import { DEFAULT_SETTINGS, type PluginSettings, StructuredContextSettingTab } from "./settings";
import { affectsOpenNote } from "./space-scope";
import { Validator } from "./validator";

function isMarkdown(path: string): boolean {
	return path.endsWith(".md");
}

export default class StructuredContextPlugin extends Plugin {
	settings: PluginSettings;
	private validator: Validator;
	/** The config in use and where it came from; the settings tab reports it. */
	resolvedConfig: ResolvedConfig;
	private debounceTimer: number | null = null;
	/** Counts validations started; a run that finishes after a newer one started discards its result. */
	private validationRun = 0;
	/**
	 * The view and note the latest validation is for. Opening a note fires both active-leaf-change and file-open,
	 * so a request for the same view and note is skipped until a change clears this.
	 */
	private validated: { view: MarkdownView; path: string } | null = null;
	/** The last problem shown in a notice, so a repeated failure is not shown again on every validation. */
	private lastNotice: string | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new StructuredContextSettingTab(this.app, this));

		// structured-context reads its bundled schemas from disk, so write them next to the plugin
		const pluginDir = join(
			this.vaultBasePath(),
			this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`,
		);
		try {
			setBundledSchemasDir(writeSchemaFiles(pluginDir, bundledSchemas));
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.notifyOnce(
				`Structured Context could not write its schemas to ${pluginDir}: ${msg}. Validation will fail until it can.`,
			);
			console.error("[structured-context] Could not write bundled schemas:", e);
		}

		this.refreshConfig();

		this.registerEditorExtension([validationField]);

		this.registerView(MAP_VIEW_TYPE, (leaf) => new MapViewPane(leaf, () => this.resolvedConfig));
		this.addCommand({
			id: "open-map-view",
			name: "Open map view",
			callback: () => this.app.workspace.getLeaf("tab").setViewState({ type: MAP_VIEW_TYPE, active: true }),
		});

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.cancelScheduledValidation();
				void this.validateActive();
			}),
		);

		// A note opened from elsewhere (the map view) may not have its editor ready at active-leaf-change.
		this.registerEvent(this.app.workspace.on("file-open", () => this.scheduleValidation()));

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file.path === this.app.workspace.getActiveFile()?.path) this.revalidate();
			}),
		);

		// Adding, removing or renaming a note in the open note's space can change its links, hierarchy and duplicate
		// checks. Obsidian reports every existing file as created while the vault loads, so listen only once it has.
		this.app.workspace.onLayoutReady(() => {
			const onNoteChange = (file: TAbstractFile, oldPath?: string) => {
				const open = this.app.workspace.getActiveFile();
				const changed = [file.path, ...(oldPath === undefined ? [] : [oldPath])].filter(isMarkdown);
				if (!open || changed.length === 0) return;
				const base = this.vaultBasePath();
				const inSpace = affectsOpenNote(
					this.resolvedConfig.config,
					join(base, open.path),
					changed.map((path) => join(base, path)),
				);
				if (inSpace) this.revalidate();
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

	/** Something the open note's result depends on changed: validate it again once changes pause. */
	private revalidate() {
		this.validated = null;
		this.scheduleValidation();
	}

	/** Validate the open note once changes have paused for the debounce interval. */
	private scheduleValidation() {
		this.cancelScheduledValidation();
		this.debounceTimer = window.setTimeout(() => {
			this.debounceTimer = null;
			void this.validateActive();
		}, this.settings.debounceMs);
	}

	private cancelScheduledValidation() {
		if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
		this.debounceTimer = null;
	}

	/** Validate whichever note is open when this runs, not when it was scheduled. */
	private async validateActive() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view?.file) return;
		if (this.validated?.view === view && this.validated.path === view.file.path) return;
		await this.validateFile(view.file, view);
	}

	private async validateFile(file: TFile, view: MarkdownView) {
		// The config file can be edited outside Obsidian at any time, and Obsidian does not report changes to
		// dotfiles, so discover it afresh on every validation. It is a few small JSON reads.
		this.refreshConfig();
		const run = ++this.validationRun;
		this.validated = { view, path: file.path };

		const absolutePath = join(this.vaultBasePath(), file.path);

		let result = null;
		try {
			result = await this.validator.validate(absolutePath);
			if (!this.resolvedConfig.error) this.lastNotice = null;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.notifyOnce(`Structured Context validation failed: ${msg}`);
			this.validated = null;
			console.error("[structured-context] Validation error:", e);
			// Fall through with no result, so the last good decorations do not stay beside the error
		}

		// A newer validation has started, or the view now shows another note: this result is stale
		if (run !== this.validationRun || view.file?.path !== file.path) return;

		const cmView = (view.editor as unknown as { cm?: EditorView }).cm;
		if (!cmView) {
			this.validated = null;
			return;
		}

		cmView.dispatch({
			effects: setValidationResult.of(
				result && {
					result,
					fieldMap: this.fieldMapOf(result.space),
					propertiesWidget: view.contentEl.querySelector(".metadata-container") !== null,
				},
			),
		});
	}

	/** The markdown plugin's fieldMap for a space. structured-context stores plugin names with their prefix. */
	private fieldMapOf(spaceName: string): FieldMap | undefined {
		const plugins = this.resolvedConfig.config.spaces.find((s) => s.name === spaceName)?.plugins;
		return plugins?.["sctx-markdown"]?.fieldMap as FieldMap | undefined;
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
			return await listSchemas({ config: this.resolvedConfig.config, startDir: this.vaultBasePath() });
		} catch (e) {
			console.error("[structured-context] Could not list schemas:", e);
			return [];
		}
	}

	/** The vault's folder on disk. The plugin is desktop-only, so the vault is always on the local filesystem. */
	vaultBasePath(): string {
		return (this.app.vault.adapter as FileSystemAdapter).getBasePath();
	}

	/** Discover the config and use it for validation. */
	refreshConfig() {
		this.resolvedConfig = resolveConfig(this.vaultBasePath());
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
		this.refreshConfig();
		// The open note may now be in a different space, or none
		this.validated = null;
		void this.validateActive();
	}
}

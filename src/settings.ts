import { App, AbstractInputSuggest, Modal, Notice, PluginSettingTab, Setting, TextComponent, TFolder } from "obsidian";
import type StructuredContextPlugin from "./main";
import { isAbsolute, relative } from "node:path";
import type { SpaceSetting } from "./config-source";
import { addSpaceTarget, addSpaceToConfig, vaultConfigPath } from "./vault-config";

export interface PluginSettings {
	debounceMs: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	debounceMs: 1500,
};

class VaultFolderSuggest extends AbstractInputSuggest<TFolder> {
	getSuggestions(query: string): TFolder[] {
		const lq = query.toLowerCase();
		return this.app.vault.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder && f.path.toLowerCase().includes(lq))
			.slice(0, 50);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	selectSuggestion(folder: TFolder, _evt: MouseEvent | KeyboardEvent): void {
		this.setValue(folder.path);
		this.close();
	}
}

/** A schema choice: a bundled or plugin schema by name, or a .json file in the vault by vault-relative path. */
interface SchemaOption {
	value: string;
	detail: string;
}

class SchemaSuggest extends AbstractInputSuggest<SchemaOption> {
	constructor(app: App, inputEl: HTMLInputElement, private readonly named: SchemaOption[]) {
		super(app, inputEl);
	}

	getSuggestions(query: string): SchemaOption[] {
		const lq = query.toLowerCase();
		const files = this.app.vault.getFiles()
			.filter(f => f.extension === "json")
			.map(f => ({ value: f.path, detail: "vault" }));
		return [...this.named, ...files]
			.filter(o => o.value.toLowerCase().includes(lq) || o.detail.toLowerCase().includes(lq))
			.slice(0, 50);
	}

	renderSuggestion(option: SchemaOption, el: HTMLElement): void {
		el.setText(option.value);
		el.createEl("small", { text: ` ${option.detail}`, cls: "setting-item-description" });
	}

	selectSuggestion(option: SchemaOption, _evt: MouseEvent | KeyboardEvent): void {
		this.setValue(option.value);
		this.close();
	}
}

class AddSpaceModal extends Modal {
	private readonly onSubmit: (space: SpaceSetting, useVaultConfig: boolean) => void;
	private nameInput!: TextComponent;
	private pathInput!: TextComponent;
	private schemaInput!: TextComponent;

	/**
	 * `target` is the config file the space is saved to. When that is an existing config elsewhere,
	 * `canUseVaultConfig` offers a new .sctx.json at the vault root instead.
	 */
	constructor(
		app: App,
		private readonly schemas: SchemaOption[],
		private readonly target: string,
		private readonly canUseVaultConfig: boolean,
		onSubmit: (space: SpaceSetting, useVaultConfig: boolean) => void,
	) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Add space" });

		new Setting(contentEl)
			.setName("Name")
			.setDesc("Unique identifier: lowercase letters, numbers, hyphens, underscores")
			.addText(text => { this.nameInput = text; });

		new Setting(contentEl)
			.setName("Path")
			.setDesc("Vault-relative path to the space directory")
			.addText(text => {
				this.pathInput = text;
				new VaultFolderSuggest(this.app, text.inputEl);
			});

		new Setting(contentEl)
			.setName("Schema")
			.setDesc("Choose a bundled or plugin schema, or a JSON schema file in your vault. Leave empty for the default, strategy_general.json.")
			.addText(text => {
				this.schemaInput = text;
				new SchemaSuggest(this.app, text.inputEl, this.schemas);
			});

		contentEl.createEl("p", { text: `Saves to ${this.target}`, cls: "setting-item-description" });

		const buttons = new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText("Save")
				.setCta()
				.onClick(() => this.submit(false))
			);
		if (this.canUseVaultConfig) {
			buttons.addButton(btn => btn
				.setButtonText("Save to new vault-level config")
				.onClick(() => this.submit(true))
			);
		}
		buttons.addButton(btn => btn
			.setButtonText("Cancel")
			.onClick(() => this.close())
		);
	}

	private submit(useVaultConfig: boolean): void {
		// Read the inputs directly: choosing a suggestion sets the value without firing change events.
		const name = this.nameInput.getValue().trim();
		const path = this.pathInput.getValue().trim();
		const schema = this.schemaInput.getValue().trim();
		if (!/^[a-z0-9_-]+$/.test(name)) {
			new Notice("Space name must only contain lowercase letters, numbers, hyphens, and underscores.");
			return;
		}
		if (!path) {
			new Notice("Path is required.");
			return;
		}
		this.onSubmit({ name, path, ...(schema ? { schema } : {}) }, useVaultConfig);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

const SYSTEM_CONFIG_HELP = "Spaces come from the nearest .sctx.json from the vault folder upward, otherwise from ~/.config/structured-context/config.json.";

export class StructuredContextSettingTab extends PluginSettingTab {
	plugin: StructuredContextPlugin;

	constructor(app: App, plugin: StructuredContextPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("p", {
			text: "Validates your structured Markdown content against its schema and shows inline hints as you write.",
			cls: "setting-item-description",
		});

		this.renderStatus(containerEl);
		this.renderSpaces(containerEl);

		new Setting(containerEl)
			.setName("Validation debounce (ms)")
			.setDesc("How long to wait after saving before re-validating. Increase if validation feels slow on large content sets.")
			.addText(text => text
				.setValue(String(this.plugin.settings.debounceMs))
				.onChange(async value => {
					const n = Number(value);
					if (Number.isInteger(n) && n >= 0) {
						this.plugin.settings.debounceMs = n;
						// Read live by the modify handler, so the config needs no rebuild
						await this.plugin.saveData(this.plugin.settings);
					}
				})
			);
	}

	private renderSpaces(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Spaces").setHeading();
		containerEl.createEl("p", { text: SYSTEM_CONFIG_HELP, cls: "setting-item-description" });

		const base = this.plugin.vaultBasePath();
		for (const space of this.plugin.resolvedConfig.config.spaces) {
			const outside = base !== null && this.isOutsideVault(base, space.path);
			const setting = new Setting(containerEl)
				.setName(space.name)
				.setDesc(outside ? `${space.path} · outside this vault` : space.path);
			if (outside) setting.settingEl.addClass("sctx-outside-vault");
		}

		if (!this.plugin.resolvedConfig.file) {
			containerEl.createEl("p", { text: "No config found. Adding a space creates a .sctx.json in your vault.", cls: "setting-item-description" });
		}
		if (base) {
			new Setting(containerEl)
				.addButton(btn => btn
					.setButtonText("Add space")
					.onClick(() => void this.openSpaceModal(base))
				);
		}
		containerEl.createEl("p", { text: "To rename, change or remove a space, edit the config file.", cls: "setting-item-description" });
	}

	private isOutsideVault(base: string, path: string): boolean {
		const rel = relative(base, path);
		return rel.startsWith("..") || isAbsolute(rel);
	}

	private renderStatus(containerEl: HTMLElement): void {
		const { config, error, file } = this.plugin.resolvedConfig;
		const count = config.spaces.length;
		const summary = count === 0
			? `${file ? `Using ${file}` : "No config found"}: no spaces defined, so nothing is validated.`
			: `Using ${file}: ${count} ${count === 1 ? "space" : "spaces"} (${config.spaces.map(s => s.name).join(", ")}).`;
		containerEl.createEl("p", { text: summary, cls: "setting-item-description" });
		if (error) {
			containerEl.createEl("p", { text: `Config problem: ${error}`, cls: "setting-item-description mod-warning" });
		}
	}

	private async openSpaceModal(base: string): Promise<void> {
		const schemas = (await this.plugin.availableSchemas())
			.filter(l => !l.partial && l.source !== "configured")
			.map(l => ({ value: l.schema, detail: l.source === "core" ? "bundled" : l.source }));
		const { file } = this.plugin.resolvedConfig;
		const canUseVaultConfig = file !== undefined && file !== vaultConfigPath(base);
		new AddSpaceModal(this.app, schemas, addSpaceTarget(base, file), canUseVaultConfig, (space, useVaultConfig) => {
			try {
				addSpaceToConfig(base, addSpaceTarget(base, file, useVaultConfig), space, schemas.map(s => s.value));
			} catch (e) {
				new Notice(e instanceof Error ? e.message : String(e));
				return;
			}
			void this.plugin.saveSettings().then(() => this.display());
		}).open();
	}
}

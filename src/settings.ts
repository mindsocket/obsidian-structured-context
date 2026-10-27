import { App, AbstractInputSuggest, Modal, Notice, PluginSettingTab, Setting, TextComponent, TFolder } from "obsidian";
import type StructuredContextPlugin from "./main";
import { relative, resolve, isAbsolute } from "node:path";
import type { ConfigMode, ConfigSettings, SpaceSetting } from "./config-source";
import { addSpaceToVaultConfig, vaultConfigPath } from "./vault-config";

export interface PluginSettings extends ConfigSettings {
	debounceMs: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	configMode: "discovered",
	configPath: "",
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
	private readonly onSubmit: (space: SpaceSetting) => void;
	private nameInput!: TextComponent;
	private pathInput!: TextComponent;
	private schemaInput!: TextComponent;

	constructor(app: App, private readonly schemas: SchemaOption[], onSubmit: (space: SpaceSetting) => void) {
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

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText("Save")
				.setCta()
				.onClick(() => this.submit())
			)
			.addButton(btn => btn
				.setButtonText("Cancel")
				.onClick(() => this.close())
			);
	}

	private submit(): void {
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
		this.onSubmit({ name, path, ...(schema ? { schema } : {}) });
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

const SYSTEM_CONFIG_HELP = "The discovered config is the file named by the SCTX_CONFIG environment variable, otherwise the nearest .sctx.json from the vault folder upward, otherwise ~/.config/structured-context/config.json.";

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

		new Setting(containerEl)
			.setName("Config source")
			.setDesc("Where the spaces to validate come from.")
			.addDropdown(drop => drop
				.addOption("vault", "Vault config (.sctx.json at the vault root)")
				.addOption("discovered", "Discovered config (as the command line finds it)")
				.addOption("custom", "Custom config file")
				.setValue(this.plugin.settings.configMode)
				.onChange(async (value: string) => {
					this.plugin.settings.configMode = value as ConfigMode;
					await this.plugin.saveSettings();
					this.display();
				})
			);

		this.renderStatus(containerEl);

		const { configMode } = this.plugin.settings;

		if (configMode === "vault") {
			this.renderSpaces(containerEl, true);
		} else if (configMode === "discovered") {
			this.renderSpaces(containerEl, false);
		} else {
			this.renderCustomSection(containerEl);
		}

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

	/** The config's spaces, then what can be done to them. `vaultOnly` is the vault's own .sctx.json. */
	private renderSpaces(containerEl: HTMLElement, vaultOnly: boolean): void {
		new Setting(containerEl).setName("Spaces").setHeading();
		if (!vaultOnly) containerEl.createEl("p", { text: SYSTEM_CONFIG_HELP, cls: "setting-item-description" });

		const base = this.plugin.vaultBasePath();
		const { config, file } = this.plugin.resolvedConfig;
		for (const space of config.spaces) {
			const outside = base !== null && this.isOutsideVault(base, space.path);
			const setting = new Setting(containerEl)
				.setName(space.name)
				.setDesc(outside ? `${space.path} · outside this vault` : space.path);
			if (outside) setting.settingEl.addClass("sctx-outside-vault");
		}

		const isVaultConfig = base !== null && (!file || resolve(file) === resolve(vaultConfigPath(base)));
		if (!file) {
			containerEl.createEl("p", { text: "No config found. Add a space to create a .sctx.json in your vault.", cls: "setting-item-description" });
		}
		if (isVaultConfig) {
			new Setting(containerEl)
				.addButton(btn => btn
					.setButtonText("Add space")
					.onClick(() => void this.openSpaceModal())
				);
			if (file) {
				containerEl.createEl("p", { text: "To rename, change or remove a space, edit .sctx.json in your vault.", cls: "setting-item-description" });
			}
		} else if (file) {
			containerEl.createEl("p", {
				text: `To change these spaces, edit that file. To keep this vault's spaces in its own .sctx.json, change the config source to the vault config.`,
				cls: "setting-item-description",
			});
		}
	}

	private isOutsideVault(base: string, path: string): boolean {
		const rel = relative(base, path);
		return rel.startsWith("..") || isAbsolute(rel);
	}

	private renderStatus(containerEl: HTMLElement): void {
		const { source, config, error, file } = this.plugin.resolvedConfig;
		const names = { vault: "vault config", custom: "custom config file", discovered: "discovered config" };
		const count = config.spaces.length;
		const summary = count === 0
			? `Using ${names[source]}${file ? ` (${file})` : ""}: no spaces defined, so nothing is validated.`
			: `Using ${names[source]}${file ? ` (${file})` : ""}: ${count} ${count === 1 ? "space" : "spaces"} (${config.spaces.map(s => s.name).join(", ")}).`;
		containerEl.createEl("p", { text: summary, cls: "setting-item-description" });
		if (error) {
			containerEl.createEl("p", { text: `Config problem: ${error}`, cls: "setting-item-description mod-warning" });
		}
	}

	private renderCustomSection(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Config file path")
			.setDesc("Path to a structured-context config.json. Applied when you leave the field.")
			.addText(text => {
				text
					.setPlaceholder("/path/to/config.json")
					.setValue(this.plugin.settings.configPath)
					.onChange(value => { this.plugin.settings.configPath = value; });
				text.inputEl.addEventListener("blur", () => {
					void this.plugin.saveSettings().then(() => this.display());
				});
			});
	}

	private async openSpaceModal(): Promise<void> {
		const schemas = (await this.plugin.availableSchemas())
			.filter(l => !l.partial && l.source !== "configured")
			.map(l => ({ value: l.schema, detail: l.source === "core" ? "bundled" : l.source }));
		new AddSpaceModal(this.app, schemas, space => {
			const base = this.plugin.vaultBasePath();
			if (!base) return;
			try {
				addSpaceToVaultConfig(base, space, schemas.map(s => s.value));
			} catch (e) {
				new Notice(e instanceof Error ? e.message : String(e));
				return;
			}
			void this.plugin.saveSettings().then(() => this.display());
		}).open();
	}
}

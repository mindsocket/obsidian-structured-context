import { App, AbstractInputSuggest, Modal, Notice, PluginSettingTab, Setting, TFile, TFolder } from "obsidian";
import type StructuredContextPlugin from "./main";
import type { ConfigMode, ConfigSettings, SpaceSetting } from "./config-source";

export interface PluginSettings extends ConfigSettings {
	debounceMs: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	configMode: "auto",
	spaces: [],
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

class VaultFileSuggest extends AbstractInputSuggest<TFile> {
	getSuggestions(query: string): TFile[] {
		const lq = query.toLowerCase();
		return this.app.vault.getAllLoadedFiles()
			.filter((f): f is TFile => f instanceof TFile && f.path.toLowerCase().includes(lq))
			.slice(0, 50);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}

	selectSuggestion(file: TFile, _evt: MouseEvent | KeyboardEvent): void {
		this.setValue(file.path);
		this.close();
	}
}

class SpaceEditModal extends Modal {
	private space: SpaceSetting;
	private readonly isNew: boolean;
	private readonly onSubmit: (space: SpaceSetting) => void;

	constructor(app: App, space: SpaceSetting | null, onSubmit: (space: SpaceSetting) => void) {
		super(app);
		this.isNew = space === null;
		this.space = space ? { ...space } : { name: "", path: "" };
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: this.isNew ? "Add space" : "Edit space" });

		new Setting(contentEl)
			.setName("Name")
			.setDesc("Unique identifier: lowercase letters, numbers, hyphens, underscores")
			.addText(text => text
				.setValue(this.space.name)
				.onChange(value => { this.space.name = value; })
			);

		new Setting(contentEl)
			.setName("Path")
			.setDesc("Vault-relative path to the space directory")
			.addText(text => {
				text.setValue(this.space.path).onChange(value => { this.space.path = value; });
				new VaultFolderSuggest(this.app, text.inputEl);
			});

		new Setting(contentEl)
			.setName("Schema")
			.setDesc("Vault-relative path to schema file (optional, defaults to the bundled strategy_general.json)")
			.addText(text => {
				text.setValue(this.space.schema ?? "").onChange(value => {
					this.space.schema = value.trim() || undefined;
				});
				new VaultFileSuggest(this.app, text.inputEl);
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
		if (!/^[a-z0-9_-]+$/.test(this.space.name)) {
			new Notice("Space name must only contain lowercase letters, numbers, hyphens, and underscores.");
			return;
		}
		if (!this.space.path.trim()) {
			new Notice("Path is required.");
			return;
		}
		this.onSubmit({ ...this.space });
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

const SYSTEM_CONFIG_HELP = "The system config is the file named by the SCTX_CONFIG environment variable, or ~/.config/structured-context/config.json.";

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
				.addOption("auto", "Automatic (recommended)")
				.addOption("builtin", "Built-in spaces only")
				.addOption("custom", "Custom config file")
				.addOption("system", "System config only")
				.setValue(this.plugin.settings.configMode)
				.onChange(async (value: string) => {
					this.plugin.settings.configMode = value as ConfigMode;
					await this.plugin.saveSettings();
					this.display();
				})
			);

		this.renderStatus(containerEl);

		const { configMode } = this.plugin.settings;

		if (configMode === "auto") {
			containerEl.createEl("p", {
				text: `Automatic uses your system config when it defines spaces. ${SYSTEM_CONFIG_HELP} Otherwise it uses the spaces below.`,
				cls: "setting-item-description",
			});
		}
		if (configMode === "auto" || configMode === "builtin") {
			this.renderBuiltinSection(containerEl);
		} else if (configMode === "custom") {
			this.renderCustomSection(containerEl);
		} else {
			containerEl.createEl("p", { text: SYSTEM_CONFIG_HELP, cls: "setting-item-description" });
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

	private renderBuiltinSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Spaces").setHeading();

		const { spaces } = this.plugin.settings;

		if (spaces.length === 0) {
			containerEl.createEl("p", {
				text: "No spaces configured. Add a space to start validating.",
				cls: "setting-item-description",
			});
		} else {
			for (let i = 0; i < spaces.length; i++) {
				const space = spaces[i];
				if (!space) continue;
				const desc = space.schema ? `${space.path} · schema: ${space.schema}` : space.path;
				new Setting(containerEl)
					.setName(space.name)
					.setDesc(desc)
					.addExtraButton(btn => btn
						.setIcon("pencil")
						.setTooltip("Edit")
						.onClick(() => this.openSpaceModal(i))
					)
					.addExtraButton(btn => btn
						.setIcon("trash")
						.setTooltip("Remove")
						.onClick(async () => {
							this.plugin.settings.spaces.splice(i, 1);
							await this.plugin.saveSettings();
							this.display();
						})
					);
			}
		}

		new Setting(containerEl)
			.addButton(btn => btn
				.setButtonText("Add space")
				.onClick(() => this.openSpaceModal(null))
			);
	}

	private renderStatus(containerEl: HTMLElement): void {
		const { source, config, error } = this.plugin.resolvedConfig;
		const names = { builtin: "built-in spaces", custom: "custom config file", system: "system config" };
		const count = config.spaces.length;
		const summary = count === 0
			? `Using ${names[source]}: no spaces defined, so nothing is validated.`
			: `Using ${names[source]}: ${count} ${count === 1 ? "space" : "spaces"} (${config.spaces.map(s => s.name).join(", ")}).`;
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

	private openSpaceModal(index: number | null): void {
		const existing = index !== null ? (this.plugin.settings.spaces[index] ?? null) : null;
		new SpaceEditModal(this.app, existing, space => {
			if (index !== null) {
				this.plugin.settings.spaces[index] = space;
			} else {
				this.plugin.settings.spaces.push(space);
			}
			void this.plugin.saveSettings().then(() => this.display());
		}).open();
	}
}

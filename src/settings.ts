import { App, PluginSettingTab, Setting } from "obsidian";
import type StructuredContextPlugin from "./main";

export interface PluginSettings {
	configPath: string;
	debounceMs: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	configPath: "",
	debounceMs: 1500,
};

export class StructuredContextSettingTab extends PluginSettingTab {
	plugin: StructuredContextPlugin;

	constructor(app: App, plugin: StructuredContextPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Structured Context" });
		containerEl.createEl("p", {
			text: "Validates your structured markdown content against its schema and shows inline hints as you write.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Config file path")
			.setDesc(
				"Path to your sctx config.json. Leave blank to use default discovery (SCTX_CONFIG env var or config.json in standard locations)."
			)
			.addText((text) =>
				text
					.setPlaceholder("/path/to/config.json")
					.setValue(this.plugin.settings.configPath)
					.onChange(async (value) => {
						this.plugin.settings.configPath = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Validation debounce (ms)")
			.setDesc(
				"How long to wait after saving before re-validating. Increase if validation feels slow on large content sets."
			)
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.debounceMs))
					.onChange(async (value) => {
						const n = Number(value);
						if (Number.isInteger(n) && n >= 0) {
							this.plugin.settings.debounceMs = n;
							await this.plugin.saveSettings();
						}
					})
			);
	}
}

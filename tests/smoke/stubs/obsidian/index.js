// Just enough of the obsidian API for the plugin to load and validate under node.
class FileSystemAdapter {
	constructor(basePath) { this.basePath = basePath; }
	getBasePath() { return this.basePath; }
}
class Plugin {
	constructor(app, manifest) { this.app = app; this.manifest = manifest; }
	async loadData() { return this.savedData ?? null; }
	async saveData() {}
	addSettingTab() {}
	addCommand() {}
	registerEditorExtension() {}
	registerView() {}
	registerEvent() {}
}
class Noop {}
module.exports = {
	FileSystemAdapter, Plugin,
	Notice: class { constructor(msg) { console.error("Notice:", msg); } },
	MarkdownView: Noop, TFile: Noop, TFolder: Noop, App: Noop, Modal: Noop,
	PluginSettingTab: Noop, AbstractInputSuggest: Noop, Setting: Noop,
};

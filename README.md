# Structured Context for Obsidian

Keep your content clean and your thinking clear.

This plugin brings inline validation to your structured markdown content — knowledge wikis, product/strategy frameworks (like Opportunity Solution Trees), and any schema-governed knowledge graph you maintain in Obsidian.

When you open or edit a file, the plugin checks it against your schema and highlights problems directly in the editor: missing required fields, invalid values, broken relationships, and rule violations — without leaving your notes.

**Note:** This plugin is desktop-only (requires Electron/Node APIs).

## Installation

Not yet in the Obsidian community plugins browser. To try it, download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/mindsocket/obsidian-structured-context/releases/latest) into your vault's `.obsidian/plugins/structured-context/` folder, or install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat).

## Setup

1. Enable the plugin in Obsidian settings.
2. Open the plugin's settings. Under **Spaces**, add a space: a name, the vault folder that holds your content, and optionally a schema file in your vault. Without a schema, the bundled `strategy_general.json` is used.
3. Open a markdown file in that folder.

Files outside every space are ignored.

If you already use [structured-context](https://github.com/mindsocket/structured-context) on the command line, set **Config source** to **Custom config file** (and give its path), or **System config** to use the same config the `sctx` command finds.

## What you'll see

- **Highlighted frontmatter lines** for property-level errors (wrong value, missing required field, etc.), with an inline message showing what's wrong
- **A block panel below the frontmatter** for document-level issues: broken links, hierarchy violations, rule violations, and duplicate titles

Validation runs when you open a file and after you edit it.

## Settings

| Setting | Description |
|---|---|
| Config source | **Built-in** manages spaces in the plugin's settings. **Custom config file** loads a structured-context `config.json` from a path you give. **System config** finds one the way the `sctx` command does: the `SCTX_CONFIG` environment variable, then `~/.config/structured-context/config.json`. |
| Spaces | Built-in mode only. Each space has a name, a vault folder and an optional schema file. |
| Config file path | Custom mode only. Path to a structured-context `config.json`. |
| Validation debounce (ms) | How long to wait after you stop editing before re-validating (default 1500). Increase it if validation feels slow on large content sets. |

## Development

```bash
npm install              # install dependencies
npm run build            # build to dist/
npm run dev              # watch mode, rebuilds on change
npm run install-to-vault # copy dist/ to configured vault (requires install.json)
npm run test:smoke       # after a build: install into a throwaway vault and validate fixture notes
```

To test your changes locally:
1. Copy `install.json.example` to `install.json` and set your vault path
2. Run `npm run build && npm run install-to-vault`
3. Reload the Obsidian plugin

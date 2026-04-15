# Structured Context for Obsidian

Keep your content clean and your thinking clear.

This plugin brings inline validation to your structured markdown content — knowledge wikis, product/strategy frameworks (like Opportunity Solution Trees), and any schema-governed knowledge graph you maintain in Obsidian.

When you open or edit a file, the plugin checks it against your schema and highlights problems directly in the editor: missing required fields, invalid values, broken relationships, and rule violations — without leaving your notes.

**Note:** This plugin is desktop-only (requires Electron/Node APIs).

## Installation

Install from the Obsidian community plugins browser (coming soon) or manually by copying the files to your vault's `.obsidian/plugins/structured-context/` directory.

## Setup

1. Create a [`structured-context`](https://github.com/mindsocket/structured-context) configuration in your vault
2. Define at least one "space" pointing to your content directories
3. Enable the plugin in Obsidian settings
4. (Optional) Configure plugin settings if your config file is in a non-standard location

Once configured, validation runs automatically when you open or edit markdown files in your spaces.

## What you'll see

- **Highlighted frontmatter lines** for property-level errors (wrong value, missing required field, etc.), with an inline message showing what's wrong
- **A block panel below the frontmatter** for document-level issues: broken links, hierarchy violations, rule failures, and duplicate titles
- Files outside any configured space are silently ignored

## Settings

| Setting | Description |
|---|---|
| Config file path | Path to your `sctx config.json`. Leave blank to use default discovery (SCTX_CONFIG env var or standard locations). |
| Validation debounce | How long to wait after a file is saved before re-validating (default: 1500ms). Increase if validation feels slow on large content sets. |

## Development

```bash
npm install              # install dependencies
npm run build            # build to dist/
npm run dev              # watch mode, rebuilds on change
npm run install-to-vault # copy dist/ to configured vault (requires install.json)
```

To test your changes locally:
1. Copy `install.json.example` to `install.json` and set your vault path
2. Run `npm run build && npm run install-to-vault`
3. Reload the Obsidian plugin

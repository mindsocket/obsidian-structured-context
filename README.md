# Structured Context for Obsidian

Keep your content clean and your thinking clear.

This plugin brings inline validation to your structured markdown content — knowledge wikis, product/strategy frameworks (like Opportunity Solution Trees), and any schema-governed knowledge graph you maintain in Obsidian.

When you open or edit a file, the plugin checks it against your schema and highlights problems directly in the editor: missing required fields, invalid values, broken relationships, and rule violations — without leaving your notes.

**Note:** This plugin is desktop-only (requires Electron/Node APIs).

## Installation

Not yet in the Obsidian community plugins browser. To try it, download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/mindsocket/obsidian-structured-context/releases/latest) into your vault's `.obsidian/plugins/structured-context/` folder, or install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat).

## Setup

1. Enable the plugin in Obsidian settings.
2. If your vault already has a `.sctx.json` at its root, or you use [structured-context](https://github.com/mindsocket/structured-context) on the command line or in Claude Code, you're done: the plugin finds the same config.
3. Otherwise open the plugin's settings and, under **Spaces**, add a space: a name, the vault folder that holds your content, and optionally a schema file in your vault. Without a schema, the bundled `strategy_general.json` is used. This creates a `.sctx.json` at the vault root, which the command line and Claude Code read too.
4. Open a markdown file in that folder.

Files outside every space are ignored. The settings page shows which config is in use and the spaces it defines.

## What you'll see

- **Highlighted frontmatter lines** for property-level issues (wrong value, missing required field, etc.), with an inline message showing what's wrong
- **A block panel below the frontmatter** for document-level issues: broken links, hierarchy violations, rule violations, and duplicate titles

Issues are shown by severity, each with its own colour and symbol:

| Severity | Symbol | Meaning |
|---|---|---|
| Error | ✖ red | The file fails validation |
| Warning | ⚠ orange | Worth fixing; the file still passes |
| Info | ⓘ blue | A suggestion |

Validation runs when you open a file and after you edit it. Semantic (AI-judged) rules never run in the editor.

## Settings

| Setting | Description |
|---|---|
| Config source | **Discovered config** (the default) or a **Custom config file**. |
| Spaces | The discovered config's spaces are listed. **Add space** (a name, a vault folder and an optional schema file) writes to the vault's `.sctx.json`, creating it if there is no config yet; to rename, change or remove a space, edit that file. |
| Config file path | Custom config only. Path to a structured-context `config.json`. |
| Validation debounce (ms) | How long to wait after you stop editing before re-validating (default 1500). Increase it if validation feels slow on large content sets. |

The discovered config is the file named by the `SCTX_CONFIG` environment variable, otherwise the nearest `.sctx.json` from the vault folder upward, otherwise `~/.config/structured-context/config.json`. Paths in a `.sctx.json` are relative to the folder that holds it, so `"path": "."` is the whole vault.

## Development

```bash
npm install              # install dependencies
npm run build            # build to dist/
npm run dev              # watch mode, rebuilds on change
npm run install-to-vault # copy dist/ to configured vault (requires install.json)
npm test                 # unit tests
npm run test:smoke       # after a build: install into a throwaway vault and validate fixture notes
```

To test your changes locally:
1. Copy `install.json.example` to `install.json` and set your vault path
2. Run `npm run build && npm run install-to-vault`
3. Reload the Obsidian plugin

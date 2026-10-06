# Obsidian Structured Context Plugin

Desktop-only Obsidian plugin that provides inline validation for [structured-context](https://github.com/mindsocket/structured-context) spaces.

## What it does

Validates markdown files against their schemas and shows errors directly in the editor:
- **Property-level errors** highlighted on frontmatter lines with inline messages
- **Document-level errors** shown in a block panel below frontmatter
- Automatic validation on file open and edit (debounced)

Files outside any configured space are silently ignored.

## Relationship to structured-context

This plugin bundles `structured-context` as a library via esbuild and calls `validateFile()` directly — no CLI or subprocess dependency.

**Architecture:**
- Uses `structured-context/api` exports (not the CLI)
- Config cached in Validator constructor (not reloaded on each validation)
- Schemas bundled alongside plugin in `dist/schemas/`
- CM6 editor extensions for inline decorations

## Development

```bash
npm install              # install dependencies
npm run build            # build to dist/
npm run dev              # watch mode
npm run install-to-vault # copy dist/ to vault (requires install.json)
```

> **Note**: Pre-commit hooks run eslint with --fix on staged files. Pre-push hooks verify the build passes.

### Configuring install location

Copy `install.json.example` to `install.json` and set your vault path:

```json
{
  "vaultPath": "~/Documents/MyVault"
}
```

Then `npm run install-to-vault` will copy the built plugin to your vault.

## Key files

- `src/main.ts` — Plugin entry point, event handlers, debouncing
- `src/validator.ts` — Wraps `validateFile()` from structured-context, caches config
- `src/editor-extension.ts` — CM6 StateField for validation decorations
- `src/settings.ts` — Plugin settings UI (config path, debounce)
- `esbuild.config.mjs` — Build config, copies schemas/manifest.json to `dist/`

## How validation works

1. **Plugin load** (`onload`):
   - Calls `setBundledSchemasDir()` to point to bundled schemas
   - Creates Validator with cached config
   - Registers CM6 extension
   - Sets up event handlers for file open/modify

2. **File validation** (`validateFile`):
   - Resolves vault-relative path to absolute
   - Calls `validator.validate(filePath)`
   - Dispatches result to CM6 editor view

3. **Editor display** (`editor-extension.ts`):
   - Parses frontmatter to find property line numbers
   - Categorizes errors as property-linked vs document-level
   - Builds CM6 Decorations (inline widgets + block panel)

## Build output

The `dist/` directory contains everything needed to run:
- `main.js` — Bundled plugin (includes structured-context)
- `manifest.json` — Copied from repo root
- `schemas/` — Copied from structured-context package

This entire directory is copied to the vault on install.

## Bundling approach and implications

**Why CJS format**: Obsidian plugins require CommonJS (`format: "cjs"` in esbuild).

**The challenge**: `structured-context` is an ESM library that uses `import.meta` for runtime path resolution. When bundled into CJS, `import.meta` becomes unavailable.

**How we handle it**:
1. esbuild bundles the ESM library into CJS (with suppressed warnings via `logOverride`)
2. At plugin load time, `main.ts` calls `setBundledSchemasDir()` to explicitly override the schema path
3. The library's fallback (`import.meta.url ? ... : ''`) handles the bundled case gracefully

**Future**: When Obsidian supports ESM plugins, we can switch to `format: "esm"` and remove the runtime override.

## Testing changes

1. Edit source files
2. Run `npm run build`
3. Run `npm run install-to-vault`
4. Reload the plugin: `obsidian plugin:reload id=structured-context` (or Settings → Community plugins)
5. Open a markdown file in a configured space

### Verifying in the running app (agents)

The `obsidian` CLI drives the running app, so changes can be checked without asking the user to click around:

- `obsidian eval code='...'` runs JavaScript in the app and prints the result. Use it to query the DOM, `app.workspace`, computed styles and hit tests (`document.elementFromPoint`). Return a `JSON.stringify(...)` string. Async code (`(async () => ...)()`) returns nothing, so split a sequence into separate calls and `sleep` between them.
- React-controlled `<select>`s need the native setter plus a bubbling `change` event: `Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, v); sel.dispatchEvent(new Event("change", { bubbles: true }))`.
- `obsidian dev:errors` / `dev:console` show captured errors and logs, and `dev:css selector=... prop=...` shows which rules set a property, with their sources. That's how host CSS overriding plugin styles is diagnosed.
- `obsidian dev:screenshot path=...` is only trustworthy while the Obsidian window is visible. In the background (`document.visibilityState === "hidden"`) the app paints no frames, so screenshots are stale, and `ResizeObserver` and `requestAnimationFrame` callbacks don't run. Rely on DOM measurements, or ask the user to bring Obsidian forward.
- Clicks that open notes change the user's workspace. Close any tab you opened (`app.workspace.activeLeaf.detach()`) and restore focus to the view under test.
- `install-to-vault` replaces the installed plugin folder. Check it for a `data.json` (saved settings) first.

## Further reading

- [Plugin development guide](docs/plugin-development.md) — General Obsidian plugin conventions and patterns
- [README](README.md) — User-facing documentation

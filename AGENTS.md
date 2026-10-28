# Obsidian Structured Context Plugin

Desktop-only Obsidian plugin that provides inline validation for [structured-context](https://github.com/mindsocket/structured-context) spaces.

## What it does

Validates markdown files against their schemas and shows issues directly in the editor, by severity (error, warning, info):
- **Property-level issues** highlighted on frontmatter lines with inline messages
- **Document-level issues** shown in a block panel below frontmatter
- Automatic validation on file open and edit (debounced)

Files outside any configured space are silently ignored.

## Relationship to structured-context

This plugin bundles `structured-context` as a library via esbuild and calls `validateFile()` directly — no CLI or subprocess dependency.

**Architecture:**
- Uses `structured-context/api` exports (not the CLI)
- Config cached in Validator constructor (not reloaded on each validation)
- Schemas embedded in `main.js` and written to `<plugin dir>/schemas/` on load
- CM6 editor extensions for inline decorations

## Development

```bash
npm install              # install dependencies
npm run build            # build to dist/
npm run dev              # watch mode
npm run install-to-vault # copy dist/ to vault (requires install.json)
```

Checks:

```bash
npm run lint       # biome (format and lint), then eslint with eslint-plugin-obsidianmd
npm run lint:fix
npm run typecheck
npm test           # unit tests
npm run test:smoke # installs the build into a throwaway vault and loads the plugin outside Obsidian
```

Pre-commit runs biome and eslint (with --fix, re-staged) on staged files, then the typecheck. Pre-push runs lint, tests, the build and the smoke test against the pushed commits in a detached worktree (`scripts/git-hooks/check-pushed-tree.sh`), so uncommitted work can neither mask a problem nor block a push. Biome handles formatting and general lint rules (tabs and double quotes, as in `.editorconfig`); eslint stays for the Obsidian-specific rules the plugin review uses. A git-ignored `lefthook-local.yml` can add personal hooks such as a secret scan.

## Releases

Releases go through the `/release <major|minor|patch>` skill. A release is a GitHub release carrying `main.js`, `manifest.json` and `styles.css`, created by `.github/workflows/release.yml` when `npm version` pushes the version tag (no `v` prefix). The plugin isn't published to npm.

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
- `src/editor-extension.ts` — CM6 StateField for validation decorations. `planDecorations` decides what to draw (error, warning and info); it is pure and unit-tested
- `src/config-source.ts` — Finds the config structured-context discovers from the vault folder. No Obsidian imports, so it is unit-tested
- `src/settings.ts` — Plugin settings UI (spaces listed from the config and added to it, debounce)
- `esbuild.config.mjs` — Build config; embeds structured-context's schemas (`virtual:bundled-schemas`) and copies manifest.json and styles.css to `dist/`
- `scripts/smoke-test.mjs` — Installs the release files into a throwaway vault and validates fixture notes (`tests/smoke/`) with `obsidian` stubbed

## How validation works

1. **Plugin load** (`onload`):
   - Calls `setBundledSchemasDir()` to point to bundled schemas
   - Discovers the config (`resolveConfig`) and creates the Validator with it; adding a space rebuilds both and revalidates the open note
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

`dist/` holds exactly the files a release carries, which is all Obsidian installs:
- `main.js` — Bundled plugin (includes structured-context and its schemas)
- `manifest.json` — Copied from repo root
- `styles.css` — Copied from repo root

`npm run install-to-vault` copies this directory to the vault. The plugin writes the embedded schemas into a `schemas-<hash>/` folder inside its own folder on load, because structured-context reads them from disk, and removes folders left by other builds.

## Testing and releasing

- `npm test` — unit tests in `tests/unit/`, bundled with esbuild and run with `node --test`. Pure logic belongs in modules that don't import `obsidian`, so it can be tested here.
- `npm run test:smoke` — run after `npm run build`. Mirrors a release install, so a file the plugin needs at runtime but a release lacks fails here.
- CI (`.github/workflows/test.yml`) runs build, lint, unit tests and the smoke test.
- Release: `npm version <patch|minor|major>` bumps `manifest.json` and `versions.json`, commits and tags (no `v` prefix, as Obsidian requires). Pushing the tag runs `.github/workflows/release.yml`, which attaches the three files to a GitHub release.
- First release: the files already say 0.1.0, so tag it directly (`git tag 0.1.0 && git push origin 0.1.0`) rather than running `npm version`, which would make it 0.2.0.
- `minAppVersion` is the oldest Obsidian whose API the plugin uses (1.4.11, for `AbstractInputSuggest`), not the version of the `obsidian` dev dependency. When using a newer API, check its `@since` in `node_modules/obsidian/obsidian.d.ts` and raise it.

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

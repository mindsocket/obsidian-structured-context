# Obsidian Structured Context Plugin

Desktop-only Obsidian plugin that shows inline [structured-context](https://github.com/mindsocket/structured-context) validation (error, warning, info) in the editor. Files outside any configured space are ignored. User docs are in `README.md`; Obsidian plugin conventions are in `docs/plugin-development.md`.

## Architecture

- The plugin bundles `structured-context` as a library (`structured-context/api`), not the CLI. `src/validator.ts` keeps one `SpaceContext` and `ReadSpaceResult` per space, refreshes changed files via `refreshReadResult()`, and validates with `validateSpace({ readResult })`.
- Known caching limits (require reloading the plugin to pick up):
  - Editing an imported local schema partial (`$ref` or `$metadata.imports`) without touching the root schema file (`Validator` checks only the root schema's mtime; tracked in #24).
  - Editing markdown files that belong to a space but live outside the vault (Obsidian only emits vault events for files inside the vault).
  - Editing a local plugin under `.sctx/plugins/`.
- `src/main.ts` is the entry point: load, event handlers, debouncing, and which notes need re-validating. A note is validated again only when its space has changed since its view last showed results.
- `src/editor-extension.ts` builds the CM6 decorations. Parsing and planning logic lives in modules that don't import `obsidian`, such as `config-source.ts` (config discovery, which space a note is in), so unit tests can load them.
- Schemas are embedded in `main.js` and written to `<plugin dir>/schemas-<hash>/` on load, because structured-context reads them from disk. Folders from other builds are removed.

## Bundling

Obsidian needs CommonJS, but `structured-context` is ESM and uses `import.meta` for path resolution, which doesn't exist once bundled. `main.ts` therefore calls `setBundledSchemasDir()` to set the schema path explicitly.

## Checks

```bash
npm run lint       # biome (format and lint), then eslint with eslint-plugin-obsidianmd
npm run typecheck
npm test           # unit tests in tests/unit
npm run test:smoke # after `npm run build`: installs the build into a throwaway vault and loads it outside Obsidian
```

- Pre-push runs lint, tests, build and smoke test against the pushed commits in a detached worktree, so uncommitted work can't mask a failure or block a push.
- `dist/` holds exactly the files a release carries (`main.js`, `manifest.json`, `styles.css`). Anything the plugin needs at runtime must be in it; the smoke test catches omissions.
- `minAppVersion` is the oldest Obsidian whose API the plugin uses, not the `obsidian` dev dependency's version. When using a newer API, check its `@since` in `node_modules/obsidian/obsidian.d.ts` and raise it.

## Releases

Use the `/release <major|minor|patch>` skill. Tags have no `v` prefix (Obsidian requires this); pushing the tag runs `.github/workflows/release.yml`.

## Trying changes in a vault

`npm run build && npm run install-to-vault` (vault path from `install.json`, copied from `install.json.example`), then `obsidian plugin:reload id=structured-context`. `install-to-vault` replaces the plugin folder, so check it for a `data.json` (saved settings) first.

The `obsidian` CLI drives the running app, so agents can verify changes without asking the user to click around:

- `obsidian eval code='...'` runs JavaScript in the app. Return a `JSON.stringify(...)` string. Async code returns nothing, so split a sequence into separate calls with a sleep between.
- `obsidian dev:errors`, `dev:console` and `dev:css selector=... prop=...` show errors, logs and which CSS rules set a property.
- `obsidian dev:screenshot` is only trustworthy while the window is visible. When `document.visibilityState === "hidden"` the app paints no frames, screenshots are stale, and `ResizeObserver` and `requestAnimationFrame` callbacks don't run; rely on DOM measurements.
- Opening notes changes the user's workspace. Close tabs you opened and restore focus.

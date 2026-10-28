---
name: release
description: Cut a release of the Obsidian plugin. Use when the user asks to cut a release, publish a new version, or run /release <major|minor|patch>.
---

## Task

Cut a **$ARGUMENTS** release (major, minor, or patch). The plugin is released as a GitHub release carrying `main.js`, `manifest.json` and `styles.css`, which Obsidian installs; it is not published to npm.

1. Verify the branch is `main`, the working tree is clean and `package.json` has no `file:` dependencies (a release must build from the registry). If not, stop and tell the user. If `minAppVersion` in `manifest.json` should change for this release, do that first and commit it: the version script copies it into `versions.json`.

2. Bump the version:
   ```
   npm version $ARGUMENTS
   ```
   This runs lint, the unit tests, the build and the smoke test (`preversion`), bumps `package.json`, `manifest.json` and `versions.json`, commits, tags (no `v` prefix, see `.npmrc`) and pushes the commit and tag (`postversion`). If any check fails, stop and report the errors.

3. The tag push starts `.github/workflows/release.yml`, which checks the tag is on `main` and matches `manifest.json` and `versions.json`, rebuilds, tests and creates the GitHub release. Wait for it:
   ```
   v=$(jq -r .version manifest.json)
   gh run watch "$(gh run list --workflow Release --branch "$v" --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
   gh release view "$v" --json assets --jq '.assets[].name'
   ```
   The assets must be `main.js`, `manifest.json` and `styles.css`. If the run fails, stop and report it; fix forward with a patch release rather than moving the tag.

4. Tell the user the release is up, and that `npm run install-to-vault` installs a local build for testing.

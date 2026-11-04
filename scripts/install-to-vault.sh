#!/bin/bash
# Build the plugin and install it to a local Obsidian vault for testing.
# Configure vault path in install.json (see install.json.example).
# The vault folder must exist; the .obsidian/plugins tree is created if missing.
# data.json (plugin settings) is preserved across reinstalls.

set -euo pipefail

die() { echo "install-to-vault: $*" >&2; exit 1; }

command -v jq >/dev/null || die "jq not found"

cd "$(dirname "$0")/.."

[ -f install.json ] || die "install.json not found"

VAULT=$(jq -r 'env.HOME as $h | .vaultPath // "" | gsub("^~"; $h)' install.json)
[ -n "$VAULT" ] || die "vaultPath missing in install.json"
[ -d "$VAULT" ] || die "vault folder does not exist: $VAULT"

npm run build

for f in manifest.json main.js styles.css; do
	[ -f "dist/$f" ] || die "build did not produce dist/$f"
done

ID=$(jq -r '.id // ""' dist/manifest.json)
[ -n "$ID" ] || die "id missing in dist/manifest.json"

DEST="$VAULT/.obsidian/plugins/$ID"
mkdir -p "$DEST"
find "$DEST" -mindepth 1 -maxdepth 1 ! -name data.json -exec rm -rf {} +
cp -R dist/. "$DEST/"

echo "Installed to $DEST"

# Reinstalling deletes the schemas folder the running plugin points at, so reload it if Obsidian is running
# with this vault open. Best effort: without the obsidian CLI, or with the vault closed, reload it by hand.
TIMEOUT=(); command -v timeout >/dev/null && TIMEOUT=(timeout 20)
if command -v obsidian >/dev/null; then
	if ${TIMEOUT[@]+"${TIMEOUT[@]}"} obsidian vault="$(basename "$VAULT")" plugin:reload id="$ID" >/dev/null 2>&1; then
		echo "Reloaded $ID in Obsidian"
	else
		echo "Could not reload $ID: reload the plugin in Obsidian (the vault must be open)"
	fi
else
	echo "obsidian CLI not found: reload $ID in Obsidian"
fi

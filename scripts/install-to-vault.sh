#!/bin/bash
# Install the built plugin to a local Obsidian vault for testing.
# Configure vault path in install.json (see install.json.example).

set -euo pipefail

VAULT=$(jq -r 'env.HOME as $h | .vaultPath | gsub("^~"; $h)' install.json)
ID=$(jq -r '.id' dist/manifest.json)

: ${VAULT:?vaultPath missing in install.json}
: ${ID:?id missing in dist/manifest.json}

DEST="$VAULT/.obsidian/plugins/$ID"
rm -rf "$DEST"
cp -r dist/. "$DEST"

echo "Installed to $DEST"

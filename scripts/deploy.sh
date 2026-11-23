#!/usr/bin/env bash
# Builds the editor, hosts Pyodide itself and uploads dist to the web server.
#   DEPLOY_TARGET=user@host:/path/to/editor DEPLOY_SSH_PORT=22 scripts/deploy.sh
# <path>/html receives the site (docker-compose.yml and nginx.conf from deploy/ belong next to it, see docs/deploy.md).
# Nothing server-specific is stored in the repository: target and port come from the environment.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DEPLOY_TARGET:?set DEPLOY_TARGET=user@host:/path/to/editor}"
PORT="${DEPLOY_SSH_PORT:-22}"
config_file="${DEPLOY_CONFIG:-deploy/config.local.json}"
if [[ -z "${DEPLOY_CONFIG:-}" && ! -f "$config_file" ]]; then
  config_file=deploy/config.production.json
fi
test -f "$config_file"

npm test
npm run build
npm run size

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
cp -r dist/. "$stage"
cp "$config_file" "$stage/config.json"
node scripts/selfhost.mjs "$stage"   # adds pyodide/ and points config.json at it (keeps the other settings)
rm -f "$stage/config.example.json"
chmod -R u=rwX,go=rX "$stage"   # mktemp makes the folder private (700); the web server in the container must be able to read it

# --delay-updates: files are renamed into place at the end, index.html and sw.js never point at assets that are not there yet
rsync -az --delete --delay-updates -e "ssh -p $PORT" "$stage/" "$DEPLOY_TARGET/html/"
echo "uploaded to $DEPLOY_TARGET/html/"

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
# A static-only deployment needs no backend, no checkout and no network check.
backend_url="$(node -e 'const fs=require("fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).backendUrl || "")' "$config_file")"
if [[ -n "$backend_url" ]]; then
  python3 scripts/check_compatibility.py --frontend public/compatibility.json --backend "${BACKEND_MANIFEST:-$backend_url/api/compatibility}"
fi

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


# Existing Docker/nginx deployments can publish the matching CSP in the same rollout.
if [[ -n "${DEPLOY_NGINX_CONTAINER:-}" ]]; then
  host="${DEPLOY_TARGET%%:*}"
  remote_dir="${DEPLOY_TARGET#*:}"
  printf -v remote_quoted '%q' "$remote_dir"
  printf -v container_quoted '%q' "$DEPLOY_NGINX_CONTAINER"
  scp -P "$PORT" deploy/nginx.conf "$host:$remote_dir/nginx.next.conf"
  ssh -p "$PORT" "$host" "bash -s -- $remote_quoted $container_quoted" < scripts/reload-nginx.sh
fi

#!/usr/bin/env bash
# Runs on the existing frontend host, preserving the bind-mounted inode.
set -euo pipefail
cd "$1"
container="$2"
cp nginx.conf nginx.previous.conf
restore() { cat nginx.previous.conf > nginx.conf; docker exec "$container" nginx -s reload; }
trap restore ERR
cat nginx.next.conf > nginx.conf
docker exec "$container" nginx -t
docker exec "$container" nginx -s reload
trap - ERR

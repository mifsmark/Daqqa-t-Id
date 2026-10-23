#!/usr/bin/env bash
set -euo pipefail

target="${1:-}"
if [[ "$target" != "staging" && "$target" != "production" ]]; then
  echo "Usage: scripts/deploy-cloudflare.sh staging|production" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export WRANGLER_LOG_PATH="${WRANGLER_LOG_PATH:-${TMPDIR:-/tmp}/daqqa-t-id-wrangler-$$.log}"
if [[ -n "${CLOUDFLARE_API_TOKEN:-}" && -z "${XDG_CONFIG_HOME:-}" ]]; then
  export XDG_CONFIG_HOME="${TMPDIR:-/tmp}/daqqa-t-id-wrangler-config-$$"
fi
if [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
  mkdir -p "$XDG_CONFIG_HOME"
fi
node "$repo_root/scripts/check-cloudflare-config.mjs" "$target"
npm ci --prefix "$repo_root/src/frontend"
cd "$repo_root/src/cloudflare"
npm ci
npm run check
npm test
npm run "deploy:$target"

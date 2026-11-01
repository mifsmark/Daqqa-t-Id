#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export WRANGLER_LOG_PATH="${WRANGLER_LOG_PATH:-${TMPDIR:-/tmp}/daqqa-t-id-wrangler-$$.log}"
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-${TMPDIR:-/tmp}/daqqa-t-id-xdg-$$}"
mkdir -p "$XDG_CONFIG_HOME"
npm ci --prefix "$repo_root/src/frontend"
cd "$repo_root/src/cloudflare"
npm ci
npm run dev

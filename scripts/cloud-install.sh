#!/usr/bin/env bash
set -euo pipefail
# Existing checkouts are isolated. Do not create a worktree or reset user changes.
cd /workspace/Daqqa-t-Id
export DOTNET_ROOT=/workspace/.dotnet
export PATH="$DOTNET_ROOT:$PATH"
export DOTNET_CLI_HOME=/workspace/.dotnet-home
export NUGET_PACKAGES=/workspace/.nuget/packages
export npm_config_cache=/tmp/daqqa-npm-cache
export DOTNET_CLI_TELEMETRY_OPTOUT=1
mkdir -p "$DOTNET_ROOT" /home/agent/.dotnet
if [ ! -x "$DOTNET_ROOT/dotnet" ]; then
  archive="$(mktemp /tmp/daqqa-sdk.XXXXXX.tar.gz)"
  trap 'rm -f "$archive"' EXIT
  curl -fsSL https://builds.dotnet.microsoft.com/dotnet/Sdk/10.0.402/dotnet-sdk-10.0.402-linux-x64.tar.gz -o "$archive"
  printf '%s  %s\n' '1904a98dda2db34ba78ba3c4fb1b224455329af91c341d83547843c1839e112b04ae699ee92fa2449a8f62249196a938723078c0c60b9f65c88539d5687729c2' "$archive" | sha512sum --check --status
  tar -xzf "$archive" -C "$DOTNET_ROOT"
fi
dotnet restore DaqqaTid.slnx
npm ci --prefix src/frontend
npm ci --prefix src/cloudflare
npm ci --prefix tests/e2e
npm run build --prefix src/frontend
mkdir -p src/backend/DaqqaTid.Api/wwwroot
cp -a src/frontend/dist/. src/backend/DaqqaTid.Api/wwwroot/
dotnet build DaqqaTid.slnx --configuration Release --no-restore

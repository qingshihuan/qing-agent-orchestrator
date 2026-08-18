#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
skill_root="$(CDPATH= cd -- "$script_dir/.." && pwd -P)"
bundled_relay="$skill_root/runtime"
project_relay="$(CDPATH= cd -- "$script_dir/../../../.." && pwd -P)"
relay_home="${QING_RELAY_HOME:-}"

if [[ -z "$relay_home" ]]; then
  if [[ -f "$bundled_relay/dist/src/cli.js" ]]; then
    relay_home="$bundled_relay"
  elif [[ -f "$project_relay/dist/src/cli.js" ]]; then
    relay_home="$project_relay"
  else
    echo "Qing Relay runtime was not found. Reinstall the full edition or set QING_RELAY_HOME to its absolute installation directory." >&2
    exit 1
  fi
elif [[ "$relay_home" != /* ]]; then
  echo "QING_RELAY_HOME must be an absolute directory path." >&2
  exit 1
elif [[ ! -d "$relay_home" ]]; then
  echo "QING_RELAY_HOME does not exist or is not a directory: $relay_home" >&2
  exit 1
else
  relay_home="$(CDPATH= cd -- "$relay_home" && pwd -P)"
fi

entrypoint="$relay_home/dist/src/cli.js"
config="$relay_home/config/relay.user.json"

if [[ ! -f "$entrypoint" ]]; then
  echo "Qing Relay entrypoint is missing: $entrypoint" >&2
  exit 1
fi
if [[ ! -f "$config" ]]; then
  echo "Qing Relay user configuration is missing: $config" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found in PATH. Install Node.js 18 or newer before using Qing Relay." >&2
  exit 1
fi

exec node "$entrypoint" "$@" --config "$config"

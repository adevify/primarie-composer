#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

remove_runtime_dir() {
  local target="$1"

  if [[ ! -d "$target" ]]; then
    return
  fi

  if rm -rf "$target" 2>/dev/null; then
    return
  fi

  echo "Normal remove failed; retrying after relaxing permissions." >&2
  chmod -R u+rwX "$target" 2>/dev/null || true
  if rm -rf "$target" 2>/dev/null; then
    return
  fi

  if [[ -d "$target" ]]; then
    if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
      echo "Removing container-owned files with sudo." >&2
      sudo rm -rf "$target"
      return
    fi

    echo "Environment directory still exists and contains files this worker cannot delete: $target" >&2
    echo "Run this once on the host, then retry: sudo rm -rf '$target'" >&2
    exit 13
  fi
}

ENV_NAME="${1:-}"
validate_env "$ENV_NAME"

ENV_DIR="$(env_dir "$ENV_NAME")"
PROJECT_NAME="$(project_name "$ENV_NAME")"

if [[ -d "$ENV_DIR" ]]; then
  cd "$ENV_DIR"
  compose_cmd -p "$PROJECT_NAME" --env-file "$ENV_DIR/.env" down --remove-orphans || true
fi

remove_runtime_dir "$ENV_DIR"

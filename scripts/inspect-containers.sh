#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

PAYLOAD_FILE="${1:?Payload file is required}"
ENV_NAME="$(jq -r '.environment' "$PAYLOAD_FILE")"
validate_env "$ENV_NAME"

ENV_DIR="$(env_dir "$ENV_NAME")"
PROJECT_NAME="$(project_name "$ENV_NAME")"

if [[ ! -d "$ENV_DIR" ]]; then
  echo "[]"
  exit 0
fi

cd "$ENV_DIR"
if compose_cmd -p "$PROJECT_NAME" --env-file "$ENV_DIR/.env" ps --format json >/tmp/composer-containers-"$ENV_NAME".json 2>/tmp/composer-containers-"$ENV_NAME".err; then
  cat /tmp/composer-containers-"$ENV_NAME".json
else
  cat /tmp/composer-containers-"$ENV_NAME".err >&2
  exit 1
fi

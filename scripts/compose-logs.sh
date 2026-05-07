#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

PAYLOAD_FILE="${1:?Payload file is required}"
ENV_NAME="$(jq -r '.environment' "$PAYLOAD_FILE")"
TAIL_LINES="$(jq -r '.tailLines // 200' "$PAYLOAD_FILE")"
validate_env "$ENV_NAME"

if [[ ! "$TAIL_LINES" =~ ^[0-9]+$ ]]; then
  echo "Invalid tailLines: $TAIL_LINES" >&2
  exit 2
fi

ENV_DIR="$(env_dir "$ENV_NAME")"
PROJECT_NAME="$(project_name "$ENV_NAME")"

if [[ ! -d "$ENV_DIR" ]]; then
  exit 0
fi

cd "$ENV_DIR"
compose_cmd -p "$PROJECT_NAME" --env-file "$ENV_DIR/.env" logs --tail "$TAIL_LINES" --timestamps

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

PAYLOAD_FILE="${1:?Payload file is required}"
ENV_NAME="$(jq -r '.environment' "$PAYLOAD_FILE")"
CONTAINER="$(jq -r '.container' "$PAYLOAD_FILE")"
TAIL_LINES="$(jq -r '.tailLines // 200' "$PAYLOAD_FILE")"
validate_env "$ENV_NAME"

if [[ ! "$CONTAINER" =~ ^[a-zA-Z0-9_.-]+$ ]]; then
  echo "Invalid container: $CONTAINER" >&2
  exit 2
fi
if [[ ! "$TAIL_LINES" =~ ^[0-9]+$ ]]; then
  echo "Invalid tailLines: $TAIL_LINES" >&2
  exit 2
fi

ENV_DIR="$(env_dir "$ENV_NAME")"
PROJECT_NAME="$(project_name "$ENV_NAME")"
assert_project_container "$PROJECT_NAME" "$CONTAINER"

docker logs --tail "$TAIL_LINES" --timestamps "$CONTAINER"

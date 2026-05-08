#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

PAYLOAD_FILE="${1:?Payload file is required}"
ENV_NAME="$(jq -r '.environment' "$PAYLOAD_FILE")"
CONTAINER="$(jq -r '.container' "$PAYLOAD_FILE")"
COMMAND="$(jq -r '.command' "$PAYLOAD_FILE")"
validate_env "$ENV_NAME"

if [[ ! "$CONTAINER" =~ ^[a-zA-Z0-9_.-]+$ ]]; then
  echo "Invalid container: $CONTAINER" >&2
  exit 2
fi

PROJECT_NAME="$(project_name "$ENV_NAME")"
assert_project_container "$PROJECT_NAME" "$CONTAINER"

stdout_file="$(mktemp)"
stderr_file="$(mktemp)"
set +e
docker exec "$CONTAINER" sh -lc "$COMMAND" >"$stdout_file" 2>"$stderr_file"
code="$?"
set -e

jq -n \
  --arg command "$COMMAND" \
  --argjson exitCode "$code" \
  --rawfile stdout "$stdout_file" \
  --rawfile stderr "$stderr_file" \
  '{ command: $command, exitCode: $exitCode, stdout: $stdout, stderr: $stderr }'

rm -f "$stdout_file" "$stderr_file"

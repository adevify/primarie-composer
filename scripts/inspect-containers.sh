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
output_file="$(mktemp)"
error_file="$(mktemp)"
fallback_file="$(mktemp)"
cleanup() {
  rm -f "$output_file" "$error_file" "$fallback_file"
}
trap cleanup EXIT

if compose_cmd -p "$PROJECT_NAME" --env-file "$ENV_DIR/.env" ps --format json >"$output_file" 2>"$error_file"; then
  if [[ -s "$output_file" ]] && ! jq -e 'type == "array" and length == 0' "$output_file" >/dev/null 2>&1; then
    cat "$output_file"
    exit 0
  fi
else
  cat "$error_file" >&2
fi

docker ps -a \
  --filter "label=com.docker.compose.project=$PROJECT_NAME" \
  --format '{{json .}}' > "$fallback_file"

if [[ -s "$fallback_file" ]]; then
  jq -c '
    def label_value($key):
      (.Labels // "")
      | split(",")
      | map(split("="))
      | map(select(.[0] == $key))
      | .[0][1] // null;

    {
      ID,
      Name: (.Names // .Name),
      Names: (.Names // .Name),
      Service: label_value("com.docker.compose.service"),
      Image,
      State,
      Status,
      Ports
    }
  ' "$fallback_file"
  exit 0
fi

if [[ -s "$error_file" ]]; then
  exit 1
fi

echo "[]"

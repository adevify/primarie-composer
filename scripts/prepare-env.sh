#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

PAYLOAD_FILE="${1:?Payload file is required}"
ENV_NAME="$(jq -r '.environment' "$PAYLOAD_FILE")"
validate_env "$ENV_NAME"

RUNTIME_PATH="$(jq -r '.runtimePath' "$PAYLOAD_FILE")"
SOURCE_REPO_URL="$(jq -r '.sourceRepoUrl' "$PAYLOAD_FILE")"
BRANCH="$(jq -r '.source.branch' "$PAYLOAD_FILE")"
COMMIT="$(jq -r '.source.commit' "$PAYLOAD_FILE")"

rm -rf "$RUNTIME_PATH"
git clone "$SOURCE_REPO_URL" "$RUNTIME_PATH"
cd "$RUNTIME_PATH"
git fetch --all --prune
git checkout -f "origin/$BRANCH"
git reset --hard "$COMMIT"
patch_repo_proxy_dockerfile "$RUNTIME_PATH"

write_env_file() {
  local output_file="$1"
  : > "$output_file"
  while IFS= read -r entry; do
    local key value escaped
    key="$(echo "$entry" | base64 --decode | jq -r '.key')"
    value="$(echo "$entry" | base64 --decode | jq -r '.value')"
    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      echo "Invalid environment variable name: $key" >&2
      exit 2
    fi
    if [[ "$value" =~ ^[A-Za-z0-9_./:@-]*$ ]]; then
      printf "%s=%s\n" "$key" "$value" >> "$output_file"
    else
      escaped="${value//\\/\\\\}"
      escaped="${escaped//\"/\\\"}"
      escaped="${escaped//\$/\\\$}"
      printf "%s=\"%s\"\n" "$key" "$escaped" >> "$output_file"
    fi
  done < <(jq -r '.environmentVariables | to_entries[] | @base64' "$PAYLOAD_FILE")
}

write_env_file "$RUNTIME_PATH/.env"
echo "Prepared $ENV_NAME at $RUNTIME_PATH"

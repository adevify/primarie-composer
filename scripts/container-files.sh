#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

PAYLOAD_FILE="${1:?Payload file is required}"
ENV_NAME="$(jq -r '.environment' "$PAYLOAD_FILE")"
CONTAINER="$(jq -r '.container' "$PAYLOAD_FILE")"
TARGET_PATH="$(jq -r '.path // "/"' "$PAYLOAD_FILE")"
validate_env "$ENV_NAME"

if [[ ! "$CONTAINER" =~ ^[a-zA-Z0-9_.-]+$ ]]; then
  echo "Invalid container: $CONTAINER" >&2
  exit 2
fi

PROJECT_NAME="$(project_name "$ENV_NAME")"
assert_project_container "$PROJECT_NAME" "$CONTAINER"

raw="$(
  docker exec "$CONTAINER" sh -c '
    target="$1"
    if [ ! -d "$target" ]; then
      exit 0
    fi
    find "$target" -mindepth 1 -maxdepth 1 2>/dev/null | sort | while IFS= read -r entry; do
      name="$(basename "$entry")"
      type="other"
      [ -d "$entry" ] && type="directory"
      [ -f "$entry" ] && type="file"
      size="$(stat -c "%s" "$entry" 2>/dev/null || echo 0)"
      modified="$(stat -c "%Y" "$entry" 2>/dev/null || echo 0)"
      printf "%s\t%s\t%s\t%s\t%s\n" "$entry" "$name" "$type" "$size" "$modified"
    done
  ' sh "$TARGET_PATH"
)"

printf "%s\n" "$raw" | jq -R -s '
  split("\n")
  | map(select(length > 0) | split("\t"))
  | map({
      path: .[0],
      name: .[1],
      type: .[2],
      size: (.[3] | tonumber),
      modifiedAt: ((.[4] | tonumber) | todate)
    })
'

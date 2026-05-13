#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

PAYLOAD_FILE="${1:?Payload file is required}"
ENV_NAME="$(jq -r '.environment' "$PAYLOAD_FILE")"
validate_env "$ENV_NAME"

RUNTIME_PATH="$(jq -r '.runtimePath' "$PAYLOAD_FILE")"
BRANCH="$(jq -r '.source.branch' "$PAYLOAD_FILE")"
COMMIT="$(jq -r '.source.commit' "$PAYLOAD_FILE")"

cd "$RUNTIME_PATH"
git fetch --all --prune
git reset --hard
git clean -fd
git checkout -f "origin/$BRANCH"
git reset --hard "$COMMIT"

count="$(jq '.files | length' "$PAYLOAD_FILE")"
for ((index = 0; index < count; index += 1)); do
  file_path="$(jq -r ".files[$index].path" "$PAYLOAD_FILE")"
  status="$(jq -r ".files[$index].status" "$PAYLOAD_FILE")"
  delete_confirmed="$(jq -r ".files[$index].deleteConfirmed // false" "$PAYLOAD_FILE")"
  assert_safe_relative_path "$file_path"
  target="$RUNTIME_PATH/$file_path"

  if [[ "$status" == "deleted" ]]; then
    if [[ "$delete_confirmed" != "true" ]]; then
      echo "Skipped unconfirmed delete for $file_path"
      continue
    fi
    rm -f "$target"
    continue
  fi

  content_base64="$(jq -r ".files[$index].contentBase64 // empty" "$PAYLOAD_FILE")"
  if [[ -z "$content_base64" ]]; then
    continue
  fi

  mkdir -p "$(dirname "$target")"
  printf "%s" "$content_base64" | base64 --decode > "$target"
done

echo "Synced $count files into $ENV_NAME"

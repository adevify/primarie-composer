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
RESET_BEFORE_APPLY="$(jq -r '.resetBeforeApply // true' "$PAYLOAD_FILE")"
PATCH_MODE="$(jq -r '.patch.mode // empty' "$PAYLOAD_FILE")"

cd "$RUNTIME_PATH"

reset_to_source() {
  git fetch --all --prune
  git reset --hard
  git clean -fd
  git checkout -f "origin/$BRANCH"
  git reset --hard "$COMMIT"
  patch_repo_for_composer "$RUNTIME_PATH"
}

hash_file() {
  sha256sum "$1" | awk '{ print $1 }'
}

sync_state_dir() {
  echo "$RUNTIME_PATH/.git/primarie-composer"
}

last_patch_file() {
  echo "$(sync_state_dir)/last-sync.patch"
}

ensure_patch_state() {
  mkdir -p "$(sync_state_dir)"
  if [[ ! -f "$(last_patch_file)" ]]; then
    : > "$(last_patch_file)"
  fi
}

decode_patch_data() {
  local output_file="$1"
  jq -r '.patch.data | @base64' "$PAYLOAD_FILE" | base64 --decode > "$output_file"
}

restore_previous_patch() {
  local previous_patch="$1"
  if [[ -s "$previous_patch" ]] && git apply --binary --check "$previous_patch" >/dev/null 2>&1; then
    git apply --binary "$previous_patch" || true
  fi
}

apply_current_patch() {
  local current_patch="$1"
  local previous_patch
  previous_patch="$(last_patch_file)"

  if [[ "$RESET_BEFORE_APPLY" == "true" ]]; then
    reset_to_source
    if [[ -s "$current_patch" ]]; then
      git apply --binary --check "$current_patch"
      git apply --binary "$current_patch"
    fi
    cp "$current_patch" "$previous_patch"
    return
  fi

  if [[ -s "$previous_patch" ]]; then
    git apply --binary --reverse --check "$previous_patch"
    git apply --binary --reverse "$previous_patch"
  fi

  if [[ -s "$current_patch" ]]; then
    if ! git apply --binary --check "$current_patch"; then
      restore_previous_patch "$previous_patch"
      echo "Patch does not apply cleanly. Use Force sync to reset and apply the full patch." >&2
      exit 1
    fi
    if ! git apply --binary "$current_patch"; then
      restore_previous_patch "$previous_patch"
      echo "Patch failed while applying. Use Force sync to reset and apply the full patch." >&2
      exit 1
    fi
  fi

  cp "$current_patch" "$previous_patch"
}

prepare_delta_patch() {
  local current_patch="$1"
  local delta_patch="$2"
  local previous_patch
  local expected_previous_hash
  local actual_previous_hash
  previous_patch="$(last_patch_file)"
  expected_previous_hash="$(jq -r '.patch.previousSha256' "$PAYLOAD_FILE")"
  actual_previous_hash="$(hash_file "$previous_patch")"

  if [[ "$expected_previous_hash" != "$actual_previous_hash" ]]; then
    echo "Patch baseline mismatch: Electron expected $expected_previous_hash but server has $actual_previous_hash. Use Force sync." >&2
    exit 1
  fi

  cp "$previous_patch" "$current_patch"
  decode_patch_data "$delta_patch"
  if [[ ! -s "$delta_patch" ]]; then
    return
  fi

  patch --batch --silent --dry-run "$current_patch" "$delta_patch"
  patch --batch --silent "$current_patch" "$delta_patch"
}

sync_patch_payload() {
  local tmp_dir
  local current_patch
  local delta_patch
  local expected_current_hash
  local actual_current_hash
  local previous_patch

  ensure_patch_state
  tmp_dir="$(mktemp -d)"
  current_patch="$tmp_dir/current.patch"
  delta_patch="$tmp_dir/delta.patch"
  previous_patch="$(last_patch_file)"
  expected_current_hash="$(jq -r '.patch.currentSha256' "$PAYLOAD_FILE")"

  if [[ "$PATCH_MODE" == "full" ]]; then
    if [[ "$RESET_BEFORE_APPLY" != "true" ]]; then
      local expected_previous_hash
      local actual_previous_hash
      expected_previous_hash="$(jq -r '.patch.previousSha256' "$PAYLOAD_FILE")"
      actual_previous_hash="$(hash_file "$previous_patch")"
      if [[ "$expected_previous_hash" != "$actual_previous_hash" ]]; then
        echo "Patch baseline mismatch: Electron expected $expected_previous_hash but server has $actual_previous_hash. Use Force sync." >&2
        exit 1
      fi
    fi
    decode_patch_data "$current_patch"
  elif [[ "$PATCH_MODE" == "delta" ]]; then
    prepare_delta_patch "$current_patch" "$delta_patch"
  else
    echo "Unsupported patch mode: $PATCH_MODE" >&2
    exit 2
  fi

  actual_current_hash="$(hash_file "$current_patch")"
  if [[ "$actual_current_hash" != "$expected_current_hash" ]]; then
    echo "Patch hash mismatch: expected $expected_current_hash but reconstructed $actual_current_hash" >&2
    exit 1
  fi

  apply_current_patch "$current_patch"
  rm -rf "$tmp_dir"
  echo "Synced $PATCH_MODE patch into $ENV_NAME"
}

if [[ -z "$PATCH_MODE" ]]; then
  echo "Patch payload is required for sync." >&2
  exit 2
fi

sync_patch_payload

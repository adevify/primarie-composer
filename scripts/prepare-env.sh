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
SEED_NAME="$(jq -r '.seedName // "default"' "$PAYLOAD_FILE")"
HOST_SEEDS_DIR="$(jq -r '.hostSeedsDir // empty' "$PAYLOAD_FILE")"
HOST_SEEDS_DIR="${HOST_SEEDS_DIR:-$(composer_root)/seeds}"

export GIT_TERMINAL_PROMPT="${GIT_TERMINAL_PROMPT:-0}"
export GIT_ASKPASS="${GIT_ASKPASS:-/bin/false}"
export SSH_ASKPASS="${SSH_ASKPASS:-/bin/false}"
export GCM_INTERACTIVE="${GCM_INTERACTIVE:-Never}"
GIT_SSH_CONNECT_TIMEOUT_SECONDS="${GIT_SSH_CONNECT_TIMEOUT_SECONDS:-30}"
GIT_HTTP_LOW_SPEED_LIMIT="${GIT_HTTP_LOW_SPEED_LIMIT:-1000}"
GIT_HTTP_LOW_SPEED_TIME="${GIT_HTTP_LOW_SPEED_TIME:-30}"
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=$GIT_SSH_CONNECT_TIMEOUT_SECONDS}"
git_network_args=(-c "http.lowSpeedLimit=$GIT_HTTP_LOW_SPEED_LIMIT" -c "http.lowSpeedTime=$GIT_HTTP_LOW_SPEED_TIME")

copy_seed_data() {
  local seed_name="$1"
  local seeds_dir="$2"
  local seed_dir="$seeds_dir/$seed_name"
  local source_mongo="$seed_dir/mongodb"
  local source_media="$seed_dir/media"
  local target_data="$RUNTIME_PATH/data"
  local target_mongo="$target_data/mongodb"
  local target_media="$target_data/media"

  if [[ ! "$seed_name" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "Invalid seed: $seed_name" >&2
    exit 2
  fi

  if [[ ! -d "$seed_dir" ]]; then
    echo "Seed folder not found: $seed_dir" >&2
    exit 2
  fi

  if [[ ! -d "$source_mongo" ]]; then
    echo "Prepared MongoDB seed folder not found: $source_mongo" >&2
    echo "Run scripts/prepare-seeds.sh before preparing environments." >&2
    exit 2
  fi

  rm -rf "$target_mongo" "$target_media"
  mkdir -p "$target_mongo" "$target_media"
  cp -a "$source_mongo/." "$target_mongo/"
  if [[ -d "$source_media" ]]; then
    cp -a "$source_media/." "$target_media/"
  fi
}

echo "[composer-progress] cloning"
rm -rf "$RUNTIME_PATH"
git "${git_network_args[@]}" clone "$SOURCE_REPO_URL" "$RUNTIME_PATH"
cd "$RUNTIME_PATH"
git "${git_network_args[@]}" fetch --all --prune
echo "[composer-progress] checking_out"
git checkout -f "origin/$BRANCH"
git reset --hard "$COMMIT"
patch_repo_for_composer "$RUNTIME_PATH"
copy_seed_data "$SEED_NAME" "$HOST_SEEDS_DIR"

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

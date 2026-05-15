#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

log_prepare() {
  printf "[prepare-env] %s %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

on_prepare_error() {
  local code="$?"
  local line="${BASH_LINENO[0]:-unknown}"
  log_prepare "error: exitCode=$code line=$line command=$BASH_COMMAND"
  log_prepare "error_context: pwd=$(pwd) runtimePath=${RUNTIME_PATH:-unset} env=${ENV_NAME:-unset} branch=${BRANCH:-unset} commit=${COMMIT:-unset} seed=${SEED_NAME:-unset}"
  log_prepare "error_context_runtime: $(ls -la "${RUNTIME_PATH:-/dev/null}" 2>&1 | tail -n 40 | tr '\n' ';')"
  log_prepare "error_context_parent: $(ls -la "$(dirname "${RUNTIME_PATH:-/tmp}")" 2>&1 | tail -n 40 | tr '\n' ';')"
  log_prepare "error_context_disk: $(df -h "${RUNTIME_PATH:-/tmp}" 2>&1 | tr '\n' ';')"
  exit "$code"
}

trap on_prepare_error ERR

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

log_prepare "start: env=$ENV_NAME payload=$PAYLOAD_FILE runtimePath=$RUNTIME_PATH runtimeParent=$(dirname "$RUNTIME_PATH")"
log_prepare "source: branch=$BRANCH commit=$COMMIT repo=$SOURCE_REPO_URL seed=$SEED_NAME hostSeedsDir=$HOST_SEEDS_DIR"
log_prepare "git_config: terminalPrompt=$GIT_TERMINAL_PROMPT askpass=$GIT_ASKPASS sshAskpass=$SSH_ASKPASS gcmInteractive=$GCM_INTERACTIVE sshConnectTimeout=$GIT_SSH_CONNECT_TIMEOUT_SECONDS httpLowSpeedLimit=$GIT_HTTP_LOW_SPEED_LIMIT httpLowSpeedTime=$GIT_HTTP_LOW_SPEED_TIME"
log_prepare "tools: git=$(command -v git || true) jq=$(command -v jq || true) user=$(id -un 2>/dev/null || true) uid=$(id -u 2>/dev/null || true) pwd=$(pwd)"
log_prepare "versions: bash=$BASH_VERSION gitVersion=$(git --version 2>&1 || true) jqVersion=$(jq --version 2>&1 || true)"
log_prepare "directories: composerRoot=$(composer_root) runtimeRoot=$(runtime_root) runtimeParent=$(dirname "$RUNTIME_PATH") seedsDir=$HOST_SEEDS_DIR"
log_prepare "preflight_runtime_parent: $(ls -ld "$(dirname "$RUNTIME_PATH")" 2>&1 || true)"
log_prepare "preflight_seed: $(find "$HOST_SEEDS_DIR/$SEED_NAME" -maxdepth 2 -mindepth 1 -type d -print 2>&1 | sed -n '1,40p' | tr '\n' ';')"
log_prepare "preflight_disk: $(df -h "$(dirname "$RUNTIME_PATH")" "$HOST_SEEDS_DIR" 2>&1 | tr '\n' ';')"
log_prepare "payload_summary: $(jq -c '{environment, environmentPort, runtimeRoot, runtimePath, seedName, hostSeedsDir, source, sourceRepoUrl, environmentVariableKeys: ((.environmentVariables // {}) | keys)}' "$PAYLOAD_FILE")"

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
    log_prepare "copy_seed_missing_seed_dir: seedDir=$seed_dir"
    echo "Seed folder not found: $seed_dir" >&2
    exit 2
  fi

  if [[ ! -d "$source_mongo" ]]; then
    log_prepare "copy_seed_missing_mongo_dir: sourceMongo=$source_mongo seedDirListing=$(ls -la "$seed_dir" 2>&1 | tr '\n' ';')"
    echo "Prepared MongoDB seed folder not found: $source_mongo" >&2
    echo "Run scripts/prepare-seeds.sh before preparing environments." >&2
    exit 2
  fi

  log_prepare "copy_seed_paths: seedDir=$seed_dir sourceMongo=$source_mongo sourceMedia=$source_media targetMongo=$target_mongo targetMedia=$target_media"
  rm -rf "$target_mongo" "$target_media"
  mkdir -p "$target_mongo" "$target_media"
  cp -a "$source_mongo/." "$target_mongo/"
  if [[ -d "$source_media" ]]; then
    cp -a "$source_media/." "$target_media/"
  fi
  log_prepare "copy_seed_counts: mongoFiles=$(find "$target_mongo" -type f 2>/dev/null | wc -l | tr -d " ") mediaFiles=$(find "$target_media" -type f 2>/dev/null | wc -l | tr -d " ")"
}

echo "[composer-progress] cloning"
log_prepare "runtime_cleanup_start: runtimePath=$RUNTIME_PATH existsBefore=$([[ -e "$RUNTIME_PATH" ]] && echo yes || echo no)"
rm -rf "$RUNTIME_PATH"
log_prepare "runtime_cleanup_done: runtimePath=$RUNTIME_PATH existsAfter=$([[ -e "$RUNTIME_PATH" ]] && echo yes || echo no)"
mkdir -p "$RUNTIME_PATH"
log_prepare "runtime_dir_created: runtimePath=$RUNTIME_PATH parentListing=$(ls -ld "$(dirname "$RUNTIME_PATH")" "$RUNTIME_PATH" 2>&1 | tr '\n' ';')"
log_prepare "git_clone_start: repo=$SOURCE_REPO_URL target=$RUNTIME_PATH"
git "${git_network_args[@]}" clone "$SOURCE_REPO_URL" "$RUNTIME_PATH"
log_prepare "git_clone_done: target=$RUNTIME_PATH gitDirExists=$([[ -d "$RUNTIME_PATH/.git" ]] && echo yes || echo no)"
cd "$RUNTIME_PATH"
log_prepare "git_remote: $(git remote -v 2>&1 | tr '\n' ';')"
log_prepare "git_fetch_start: cwd=$(pwd)"
git "${git_network_args[@]}" fetch --all --prune
log_prepare "git_fetch_done"
echo "[composer-progress] checking_out"
log_prepare "git_checkout_start: branch=origin/$BRANCH"
log_prepare "git_branch_candidates: $(git branch -r 2>&1 | sed -n '1,80p' | tr '\n' ';')"
git checkout -f "origin/$BRANCH"
log_prepare "git_checkout_done: head=$(git rev-parse --short HEAD 2>/dev/null || true)"
log_prepare "git_reset_start: commit=$COMMIT"
git reset --hard "$COMMIT"
log_prepare "git_reset_done: head=$(git rev-parse HEAD 2>/dev/null || true)"
log_prepare "patch_repo_start"
patch_repo_for_composer "$RUNTIME_PATH"
log_prepare "patch_repo_done: dockerComposeExists=$([[ -f "$RUNTIME_PATH/docker-compose.yml" || -f "$RUNTIME_PATH/compose.yml" ]] && echo yes || echo no) envExampleExists=$([[ -f "$RUNTIME_PATH/.env.example" ]] && echo yes || echo no)"
log_prepare "copy_seed_start: seed=$SEED_NAME hostSeedsDir=$HOST_SEEDS_DIR"
copy_seed_data "$SEED_NAME" "$HOST_SEEDS_DIR"
log_prepare "copy_seed_done: dataDir=$RUNTIME_PATH/data"

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
log_prepare "env_file_written: path=$RUNTIME_PATH/.env keys=$(jq -r '.environmentVariables | keys | join(",")' "$PAYLOAD_FILE") size=$(wc -c < "$RUNTIME_PATH/.env" | tr -d " ")"
echo "Prepared $ENV_NAME at $RUNTIME_PATH"
log_prepare "done: env=$ENV_NAME runtimePath=$RUNTIME_PATH topLevel=$(find "$RUNTIME_PATH" -maxdepth 1 -mindepth 1 -printf '%f ' 2>/dev/null || ls "$RUNTIME_PATH" 2>/dev/null | tr '\n' ' ')"

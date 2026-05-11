#!/usr/bin/env bash
set -euo pipefail
umask 000

BUS_ROOT="${BUS_ROOT:-/opt/composer-bus}"
PIPE="${PIPE:-$BUS_ROOT/actions.pipe}"
RESULTS_DIR="${RESULTS_DIR:-$BUS_ROOT/results}"
LOGS_DIR="${LOGS_DIR:-$BUS_ROOT/logs}"
LOCKS_DIR="${LOCKS_DIR:-$BUS_ROOT/locks}"
READY_FILE="${READY_FILE:-$BUS_ROOT/worker.ready}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAX_RESULT_OUTPUT_BYTES="${MAX_RESULT_OUTPUT_BYTES:-65536}"
ACTION_HEARTBEAT_SECONDS="${ACTION_HEARTBEAT_SECONDS:-30}"
MAX_PARALLEL_ACTIONS="${MAX_PARALLEL_ACTIONS:-4}"

mkdir -p "$RESULTS_DIR" "$LOGS_DIR" "$LOCKS_DIR"
chmod 777 "$RESULTS_DIR" "$LOGS_DIR" "$LOCKS_DIR" 2>/dev/null || true
if [[ ! -p "$PIPE" ]]; then
  rm -f "$PIPE"
  mkfifo "$PIPE"
  chmod 666 "$PIPE" 2>/dev/null || true
fi

date -u +%Y-%m-%dT%H:%M:%SZ > "$READY_FILE"
chmod 666 "$READY_FILE" 2>/dev/null || true

write_result() {
  local id="$1"
  local status="$2"
  local message="$3"
  local output="${4:-}"

  local tmp="$RESULTS_DIR/$id.json.tmp"
  local output_file
  output_file="$(mktemp)"
  truncate_output "$output" > "$output_file"

  jq -n \
    --arg id "$id" \
    --arg status "$status" \
    --arg message "$message" \
    --rawfile output "$output_file" \
    '{
      id: $id,
      status: $status,
      message: $message,
      output: $output,
      finishedAt: now | todate
    }' > "$tmp"
  rm -f "$output_file"
  mv "$tmp" "$RESULTS_DIR/$id.json"
}

truncate_output() {
  local output="$1"
  local byte_count
  byte_count="$(printf "%s" "$output" | wc -c | tr -d " ")"
  if [[ "$byte_count" -le "$MAX_RESULT_OUTPUT_BYTES" ]]; then
    printf "%s" "$output"
    return
  fi

  printf "[output truncated to last %s bytes from %s bytes]\n" "$MAX_RESULT_OUTPUT_BYTES" "$byte_count"
  printf "%s" "$output" | tail -c "$MAX_RESULT_OUTPUT_BYTES"
}

run_payload_script() {
  local id="$1"
  local script="$2"
  local line="$3"
  local payload_file
  payload_file="$(mktemp)"
  echo "$line" | jq '.payload' > "$payload_file"
  if output="$(run_and_capture "$LOGS_DIR/$id.log" "$script" "$payload_file")"; then
    rm -f "$payload_file"
    write_result "$id" "success" "Action completed" "$output"
    echo "[composer-worker] success $id - Action completed at $(date -u +%Y-%m-%dT%H:%M:%SZ) Output: $output"
  else
    local code=$?
    rm -f "$payload_file"
    write_result "$id" "error" "Action failed with exit code $code" "$output"
    echo "[composer-worker] error $id - Action failed with exit code $code at $(date -u +%Y-%m-%dT%H:%M:%SZ) Output: $output"
  fi
}

wait_for_parallel_slot() {
  while [[ "$(jobs -rp | wc -l | tr -d " ")" -ge "$MAX_PARALLEL_ACTIONS" ]]; do
    wait -n || true
  done
}

requires_environment_lock() {
  local type="$1"

  [[ "$type" == "environment.start" \
    || "$type" == "environment.stop" \
    || "$type" == "environment.restart" \
    || "$type" == "environment.mongo.inspect" ]]
}

environment_lock_path() {
  local environment="$1"
  local safe_environment

  safe_environment="$(printf "%s" "$environment" | tr -c 'A-Za-z0-9_.-' '_')"
  printf "%s/env-%s" "$LOCKS_DIR" "$safe_environment"
}

acquire_environment_lock() {
  local lock_dir="$1"
  local id="$2"
  local type="$3"
  local environment="$4"
  local lock_pid

  if mkdir "$lock_dir" >/dev/null 2>&1; then
    {
      printf "pid=%s\n" "$BASHPID"
      printf "id=%s\n" "$id"
      printf "type=%s\n" "$type"
      printf "environment=%s\n" "$environment"
      printf "startedAt=%s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } > "$lock_dir/info"
    return 0
  fi

  lock_pid="$(sed -n 's/^pid=//p' "$lock_dir/info" 2>/dev/null | head -n 1 || true)"
  if [[ -n "$lock_pid" ]] && ! kill -0 "$lock_pid" >/dev/null 2>&1; then
    rm -rf "$lock_dir"
    if mkdir "$lock_dir" >/dev/null 2>&1; then
      {
        printf "pid=%s\n" "$BASHPID"
        printf "id=%s\n" "$id"
        printf "type=%s\n" "$type"
        printf "environment=%s\n" "$environment"
        printf "startedAt=%s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      } > "$lock_dir/info"
      return 0
    fi
  fi

  return 1
}

release_environment_lock() {
  local lock_dir="$1"

  if [[ -n "$lock_dir" ]]; then
    rm -rf "$lock_dir"
  fi
}

write_lock_conflict_result() {
  local id="$1"
  local type="$2"
  local environment="$3"
  local message="Environment action already running for $environment"

  case "$type" in
    "environment.containers.inspect")
      write_result "$id" "success" "$message" "[]"
      ;;
    "environment.mongo.inspect")
      write_result "$id" "success" "$message" "{\"available\":false,\"reason\":\"$message\"}"
      ;;
    *)
      write_result "$id" "success" "$message" ""
      ;;
  esac
}

run_and_capture() {
  local log_file="$1"
  shift
  local output_file
  local heartbeat_pid

  if ! ensure_action_log_file "$log_file"; then
    printf "Unable to write action log file: %s\n" "$log_file"
    return 13
  fi

  output_file="$(mktemp)"
  : >> "$log_file"

  printf "[composer-worker] running command at %s: %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$log_file"
  (
    while true; do
      sleep "${ACTION_HEARTBEAT_SECONDS:-30}"
      printf "[composer-worker] action still running at %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$log_file"
    done
  ) &
  heartbeat_pid="$!"

  set +e
  "$@" 2>&1 | tee -a "$output_file" "$log_file" >/dev/null
  local code="${PIPESTATUS[0]}"
  set -e

  kill "$heartbeat_pid" >/dev/null 2>&1 || true
  printf "[composer-worker] action finished with exit code %s at %s\n" "$code" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$log_file"

  cat "$output_file"
  rm -f "$output_file"
  return "$code"
}

ensure_action_log_file() {
  local log_file="$1"
  local log_dir
  log_dir="$(dirname "$log_file")"

  mkdir -p "$log_dir" 2>/dev/null || true
  chmod 777 "$log_dir" 2>/dev/null || true

  if [[ -e "$log_file" && ! -w "$log_file" ]]; then
    chmod 666 "$log_file" 2>/dev/null || true
  fi

  if [[ -e "$log_file" && ! -w "$log_file" && -w "$log_dir" ]]; then
    rm -f "$log_file" 2>/dev/null || true
  fi

  if ! : >> "$log_file" 2>/dev/null; then
    if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
      sudo mkdir -p "$log_dir"
      sudo touch "$log_file"
      sudo chmod 777 "$log_dir"
      sudo chmod 666 "$log_file"
    fi
  fi

  [[ -w "$log_file" ]]
}

process_action() {
  local line="$1"

  if ! echo "$line" | jq -e . >/dev/null 2>&1; then
    return 0
  fi

  local id
  local type
  local environment
  local environment_port
  local proxy_upstream_host
  local output
  local action_lock_dir

  id="$(echo "$line" | jq -r '.id // empty')"
  type="$(echo "$line" | jq -r '.type // empty')"
  environment="$(echo "$line" | jq -r '.payload.environment // empty')"
  environment_port="$(echo "$line" | jq -r '.payload.environmentPort // empty')"
  proxy_upstream_host="$(echo "$line" | jq -r '.payload.proxyUpstreamHost // empty')"

  if [[ -z "$id" ]]; then
    return 0
  fi

  local action_log_file="$LOGS_DIR/$id.log"
  if ! ensure_action_log_file "$action_log_file"; then
    write_result "$id" "error" "Action log file is not writable: $action_log_file"
    echo "[composer-worker] error $id - Action log file is not writable: $action_log_file"
    return 0
  fi

  printf "[composer-worker] accepted action at %s: %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$type" >> "$action_log_file"

  if requires_environment_lock "$type"; then
    if [[ -z "$environment" ]]; then
      write_result "$id" "error" "Environment is required for locked action: $type"
      return 0
    fi

    action_lock_dir="$(environment_lock_path "$environment")"
    if ! acquire_environment_lock "$action_lock_dir" "$id" "$type" "$environment"; then
      printf "[composer-worker] lock conflict at %s: %s for %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$type" "$environment" >> "$action_log_file"
      write_lock_conflict_result "$id" "$type" "$environment"
      echo "[composer-worker] locked $id - $type for $environment already has an active action; returning no-op result"
      return 0
    fi
    trap 'release_environment_lock "$action_lock_dir"' RETURN
  fi

  case "$type" in
    "environment.prepare")
      run_payload_script "$id" "$SCRIPT_DIR/prepare-env.sh" "$line"
      ;;
    "environment.files.sync")
      run_payload_script "$id" "$SCRIPT_DIR/sync-files.sh" "$line"
      ;;
    "environment.containers.inspect")
      run_payload_script "$id" "$SCRIPT_DIR/inspect-containers.sh" "$line"
      ;;
    "environment.compose.logs")
      run_payload_script "$id" "$SCRIPT_DIR/compose-logs.sh" "$line"
      ;;
    "environment.container.logs")
      run_payload_script "$id" "$SCRIPT_DIR/container-logs.sh" "$line"
      ;;
    "environment.container.files")
      run_payload_script "$id" "$SCRIPT_DIR/container-files.sh" "$line"
      ;;
    "environment.container.exec")
      run_payload_script "$id" "$SCRIPT_DIR/container-exec.sh" "$line"
      ;;
    "environment.mongo.inspect")
      run_payload_script "$id" "$SCRIPT_DIR/mongo-inspect.sh" "$line"
      ;;
    "environment.start")
      if output="$(run_and_capture "$LOGS_DIR/$id.log" "$SCRIPT_DIR/start-env.sh" "$environment" "$environment_port" "$proxy_upstream_host")"; then
        write_result "$id" "success" "Environment started" "$output"
      else
        write_result "$id" "error" "Environment start failed" "$output"
      fi
      ;;
    "environment.stop")
      if output="$(run_and_capture "$LOGS_DIR/$id.log" "$SCRIPT_DIR/stop-env.sh" "$environment")"; then
        write_result "$id" "success" "Environment stopped" "$output"
      else
        write_result "$id" "error" "Environment stop failed" "$output"
      fi
      ;;
    "environment.restart")
      if output="$(run_and_capture "$LOGS_DIR/$id.log" "$SCRIPT_DIR/restart-env.sh" "$environment" "$environment_port" "$proxy_upstream_host")"; then
        write_result "$id" "success" "Environment restarted" "$output"
      else
        write_result "$id" "error" "Environment restart failed" "$output"
      fi
      ;;
    "environment.remove")
      if output="$(run_and_capture "$LOGS_DIR/$id.log" "$SCRIPT_DIR/remove-env.sh" "$environment")"; then
        write_result "$id" "success" "Environment removed" "$output"
      else
        write_result "$id" "error" "Environment remove failed" "$output"
      fi
      ;;
    *)
      write_result "$id" "error" "Unknown action type: $type"
      ;;
  esac
}

while true; do
  while IFS= read -r line; do
    wait_for_parallel_slot

    (
      process_action "$line"
    ) &
  done < "$PIPE"
done

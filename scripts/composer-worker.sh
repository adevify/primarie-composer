#!/usr/bin/env bash
set -euo pipefail

BUS_ROOT="${BUS_ROOT:-/opt/composer-bus}"
PIPE="${PIPE:-$BUS_ROOT/actions.pipe}"
RESULTS_DIR="${RESULTS_DIR:-$BUS_ROOT/results}"
LOGS_DIR="${LOGS_DIR:-$BUS_ROOT/logs}"
READY_FILE="${READY_FILE:-$BUS_ROOT/worker.ready}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAX_RESULT_OUTPUT_BYTES="${MAX_RESULT_OUTPUT_BYTES:-65536}"
ACTION_HEARTBEAT_SECONDS="${ACTION_HEARTBEAT_SECONDS:-30}"

mkdir -p "$RESULTS_DIR" "$LOGS_DIR"
if [[ ! -p "$PIPE" ]]; then
  rm -f "$PIPE"
  mkfifo "$PIPE"
fi

date -u +%Y-%m-%dT%H:%M:%SZ > "$READY_FILE"

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

run_and_capture() {
  local log_file="$1"
  shift
  local output_file
  local heartbeat_pid
  output_file="$(mktemp)"
  : > "$log_file"

  (
    while true; do
      read -r -t "${ACTION_HEARTBEAT_SECONDS:-30}" _ || true
      printf "[composer-worker] action still running at %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$log_file"
    done
  ) &
  heartbeat_pid="$!"

  set +e
  "$@" 2>&1 | tee "$output_file" "$log_file" >/dev/null
  local code="${PIPESTATUS[0]}"
  set -e

  kill "$heartbeat_pid" >/dev/null 2>&1 || true
  printf "[composer-worker] action finished with exit code %s at %s\n" "$code" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$log_file"

  cat "$output_file"
  rm -f "$output_file"
  return "$code"
}

while true; do
  while IFS= read -r line; do
    if ! echo "$line" | jq -e . >/dev/null 2>&1; then
      continue
    fi

    id="$(echo "$line" | jq -r '.id // empty')"
    type="$(echo "$line" | jq -r '.type // empty')"
    environment="$(echo "$line" | jq -r '.payload.environment // empty')"
    environment_port="$(echo "$line" | jq -r '.payload.environmentPort // empty')"
    proxy_upstream_host="$(echo "$line" | jq -r '.payload.proxyUpstreamHost // empty')"

    if [[ -z "$id" ]]; then
      continue
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
  done < "$PIPE"
done

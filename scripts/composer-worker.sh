#!/usr/bin/env bash
set -euo pipefail
umask 000

BUS_ROOT="${BUS_ROOT:-/opt/composer-bus}"
PIPE="${PIPE:-$BUS_ROOT/actions.pipe}"
ACKS_DIR="${ACKS_DIR:-$BUS_ROOT/acks}"
RESULTS_DIR="${RESULTS_DIR:-$BUS_ROOT/results}"
LOGS_DIR="${LOGS_DIR:-$BUS_ROOT/logs}"
LOCKS_DIR="${LOCKS_DIR:-$BUS_ROOT/locks}"
WORKER_LOCK_DIR="${WORKER_LOCK_DIR:-$BUS_ROOT/worker.lock}"
READY_FILE="${READY_FILE:-$BUS_ROOT/worker.ready}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAX_RESULT_OUTPUT_BYTES="${MAX_RESULT_OUTPUT_BYTES:-5242880}"
ACTION_HEARTBEAT_SECONDS="${ACTION_HEARTBEAT_SECONDS:-30}"
MAX_PARALLEL_ACTIONS="${MAX_PARALLEL_ACTIONS:-4}"
WORKER_MAIN_BASHPID="${BASHPID:-$$}"

current_bash_pid() {
  printf "%s" "${BASHPID:-$$}"
}

timestamp() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

worker_log() {
  printf "[composer-worker] %s %s\n" "$(timestamp)" "$*"
}

on_worker_error() {
  local code="$?"
  local line="${BASH_LINENO[0]:-unknown}"
  worker_log "worker_error: exitCode=$code line=$line command=$BASH_COMMAND pid=$$ bashpid=$(current_bash_pid) pipe=$PIPE busRoot=$BUS_ROOT"
  worker_log "worker_error_context: pwd=$(pwd) readyExists=$([[ -f "$READY_FILE" ]] && echo yes || echo no) pipeIsFifo=$([[ -p "$PIPE" ]] && echo yes || echo no) runningJobs=$(jobs -rp | wc -l | tr -d " ")"
  exit "$code"
}

trap on_worker_error ERR

mkdir -p "$BUS_ROOT"

acquire_worker_lock() {
  local lock_pid

  if mkdir "$WORKER_LOCK_DIR" >/dev/null 2>&1; then
    {
      printf "pid=%s\n" "$$"
      printf "bashpid=%s\n" "$(current_bash_pid)"
      printf "script=%s\n" "$0"
      printf "startedAt=%s\n" "$(timestamp)"
    } > "$WORKER_LOCK_DIR/info"
    return 0
  fi

  lock_pid="$(sed -n 's/^pid=//p' "$WORKER_LOCK_DIR/info" 2>/dev/null | head -n 1 || true)"
  if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" >/dev/null 2>&1; then
    worker_log "another worker is already running: pid=$lock_pid lock=$WORKER_LOCK_DIR"
    exit 1
  fi

  worker_log "removing stale worker lock: lock=$WORKER_LOCK_DIR pid=${lock_pid:-unknown}"
  rm -rf "$WORKER_LOCK_DIR"
  if mkdir "$WORKER_LOCK_DIR" >/dev/null 2>&1; then
    {
      printf "pid=%s\n" "$$"
      printf "bashpid=%s\n" "$(current_bash_pid)"
      printf "script=%s\n" "$0"
      printf "startedAt=%s\n" "$(timestamp)"
    } > "$WORKER_LOCK_DIR/info"
    return 0
  fi

  worker_log "unable to acquire worker lock: lock=$WORKER_LOCK_DIR"
  exit 1
}

release_worker_lock() {
  if [[ "$(current_bash_pid)" == "$WORKER_MAIN_BASHPID" ]]; then
    rm -rf "$WORKER_LOCK_DIR"
  fi
}

acquire_worker_lock

mkdir -p "$ACKS_DIR" "$RESULTS_DIR" "$LOGS_DIR" "$LOCKS_DIR"
chmod 777 "$ACKS_DIR" "$RESULTS_DIR" "$LOGS_DIR" "$LOCKS_DIR" 2>/dev/null || true
if [[ ! -p "$PIPE" ]]; then
  worker_log "fifo_missing_or_not_pipe: pipe=$PIPE removing_and_recreating=1"
  rm -f "$PIPE"
  mkfifo "$PIPE"
  chmod 666 "$PIPE" 2>/dev/null || true
else
  worker_log "fifo_exists: pipe=$PIPE mode=$(stat -c '%a' "$PIPE" 2>/dev/null || stat -f '%Lp' "$PIPE" 2>/dev/null || printf unknown)"
fi

date -u +%Y-%m-%dT%H:%M:%SZ > "$READY_FILE"
chmod 666 "$READY_FILE" 2>/dev/null || true
worker_log "ready: pid=$$ bashpid=$(current_bash_pid) pipe=$PIPE acks=$ACKS_DIR results=$RESULTS_DIR logs=$LOGS_DIR locks=$LOCKS_DIR workerLock=$WORKER_LOCK_DIR ready=$READY_FILE maxParallel=$MAX_PARALLEL_ACTIONS heartbeatSeconds=$ACTION_HEARTBEAT_SECONDS busRoot=$BUS_ROOT scriptDir=$SCRIPT_DIR"

cleanup_worker() {
  if [[ "$(current_bash_pid)" == "$WORKER_MAIN_BASHPID" ]]; then
    worker_log "exiting: removing ready file $READY_FILE and worker lock $WORKER_LOCK_DIR"
    rm -f "$READY_FILE"
    release_worker_lock
  fi
}

trap cleanup_worker EXIT
trap 'cleanup_worker; exit 0' TERM INT

write_result() {
  local id="$1"
  local status="$2"
  local message="$3"
  local output="${4:-}"

  local tmp="$RESULTS_DIR/$id.json.tmp"
  local output_file
  output_file="$(mktemp)"
  truncate_output "$output" > "$output_file"
  worker_log "write_result_start: id=$id status=$status message=$message tmp=$tmp outputBytes=$(wc -c < "$output_file" | tr -d " ")"

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
  worker_log "write_result_done: id=$id status=$status result=$RESULTS_DIR/$id.json"
}

write_ack() {
  local id="$1"
  local type="$2"
  local environment="$3"
  local log_file="$4"
  local tmp="$ACKS_DIR/$id.json.tmp"

  jq -n \
    --arg id "$id" \
    --arg type "$type" \
    --arg environment "$environment" \
    --arg acceptedAt "$(timestamp)" \
    --argjson pid "$(current_bash_pid)" \
    --arg logFile "$log_file" \
    '{
      id: $id,
      type: $type,
      environment: $environment,
      acceptedAt: $acceptedAt,
      pid: $pid,
      logFile: $logFile
    }' > "$tmp"
  mv "$tmp" "$ACKS_DIR/$id.json"
  worker_log "ack_written: id=$id type=$type environment=$environment ack=$ACKS_DIR/$id.json"
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
  {
    printf "[composer-worker] payload_file at %s: %s\n" "$(timestamp)" "$payload_file"
    printf "[composer-worker] payload_summary at %s: " "$(timestamp)"
    jq -c '{
      environment,
      environmentPort,
      runtimeRoot,
      runtimePath,
      seedName,
      hostSeedsDir,
      proxyUpstreamHost,
      source,
      sourceRepoUrl,
      environmentVariableKeys: ((.environmentVariables // {}) | keys)
    }' "$payload_file"
  } >> "$LOGS_DIR/$id.log"
  worker_log "run_payload_script: id=$id script=$script payloadFile=$payload_file summary=$(jq -c '{environment, environmentPort, runtimeRoot, runtimePath, seedName, source, sourceRepoUrl}' "$payload_file")"
  worker_log "run_payload_script_start: id=$id script=$script log=$LOGS_DIR/$id.log payloadBytes=$(wc -c < "$payload_file" | tr -d " ")"
  if output="$(run_and_capture "$LOGS_DIR/$id.log" "$script" "$payload_file")"; then
    rm -f "$payload_file"
    write_result "$id" "success" "Action completed" "$output"
    worker_log "success: id=$id message=Action completed outputBytes=$(printf "%s" "$output" | wc -c | tr -d " ")"
  else
    local code=$?
    rm -f "$payload_file"
    write_result "$id" "error" "Action failed with exit code $code" "$output"
    worker_log "error: id=$id exitCode=$code outputBytes=$(printf "%s" "$output" | wc -c | tr -d " ")"
  fi
}

wait_for_parallel_slot() {
  while [[ "$(jobs -rp | wc -l | tr -d " ")" -ge "$MAX_PARALLEL_ACTIONS" ]]; do
    worker_log "parallel_slots_full: runningJobs=$(jobs -rp | wc -l | tr -d " ") max=$MAX_PARALLEL_ACTIONS"
    wait -n || true
  done
}

requires_environment_lock() {
  local type="$1"

  [[ "$type" == "environment.start" \
    || "$type" == "environment.stop" \
    || "$type" == "environment.restart" \
    || "$type" == "environment.remove" \
    || "$type" == "environment.prepare" \
    || "$type" == "environment.mongo.inspect" \
    || "$type" == "environment.mongo.command" \
    || "$type" == "environment.mongo.importProdTennant" ]]
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
    worker_log "lock_acquired: id=$id type=$type environment=$environment lock=$lock_dir pid=$(current_bash_pid)"
    {
      printf "pid=%s\n" "$(current_bash_pid)"
      printf "id=%s\n" "$id"
      printf "type=%s\n" "$type"
      printf "environment=%s\n" "$environment"
      printf "startedAt=%s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } > "$lock_dir/info"
    return 0
  fi

  lock_pid="$(sed -n 's/^pid=//p' "$lock_dir/info" 2>/dev/null | head -n 1 || true)"
  if [[ -n "$lock_pid" ]] && ! kill -0 "$lock_pid" >/dev/null 2>&1; then
    worker_log "lock_stale: existingPid=$lock_pid lock=$lock_dir removing=1"
    rm -rf "$lock_dir"
    if mkdir "$lock_dir" >/dev/null 2>&1; then
      worker_log "lock_acquired_after_stale: id=$id type=$type environment=$environment lock=$lock_dir pid=$(current_bash_pid)"
      {
        printf "pid=%s\n" "$(current_bash_pid)"
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
    worker_log "lock_released: lock=$lock_dir"
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
    "environment.mongo.command" | "environment.mongo.importProdTennant")
      write_result "$id" "error" "$message" "{\"error\":\"$message\"}"
      ;;
    *)
      write_result "$id" "success" "$message" ""
      ;;
  esac
}

run_heartbeat() {
  local log_file="$1"
  local interval="${2:-30}"
  local sleep_pid=""

  stop_heartbeat_sleep() {
    if [[ -n "$sleep_pid" ]]; then
      kill "$sleep_pid" >/dev/null 2>&1 || true
      wait "$sleep_pid" >/dev/null 2>&1 || true
      sleep_pid=""
    fi
  }

  trap 'stop_heartbeat_sleep; exit 0' TERM INT EXIT

  while true; do
    sleep "$interval" &
    sleep_pid="$!"
    if ! wait "$sleep_pid" >/dev/null 2>&1; then
      sleep_pid=""
      exit 0
    fi
    sleep_pid=""
    printf "[composer-worker] action still running at %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$log_file"
  done
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
  run_heartbeat "$log_file" "${ACTION_HEARTBEAT_SECONDS:-30}" >/dev/null 2>&1 &
  heartbeat_pid="$!"

  set +e
  "$@" </dev/null 2>&1 | tee -a "$output_file" "$log_file" >/dev/null
  local code="${PIPESTATUS[0]}"
  set -e

  kill "$heartbeat_pid" >/dev/null 2>&1 || true
  wait "$heartbeat_pid" >/dev/null 2>&1 || true
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
    worker_log "ignored_invalid_json: bytes=${#line}"
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
  worker_log "process_action_parsed: id=${id:-missing} type=${type:-missing} environment=${environment:-missing} port=${environment_port:-missing} proxy=${proxy_upstream_host:-missing} payloadKeys=$(echo "$line" | jq -r '(.payload // {}) | keys | join(",")' 2>/dev/null || true)"

  if [[ -z "$id" ]]; then
    worker_log "ignored_missing_id: type=$type environment=$environment bytes=${#line}"
    return 0
  fi

  local action_log_file="$LOGS_DIR/$id.log"
  if ! ensure_action_log_file "$action_log_file"; then
    write_result "$id" "error" "Action log file is not writable: $action_log_file"
    worker_log "error: id=$id actionLogNotWritable=$action_log_file"
    return 0
  fi

  printf "[composer-worker] accepted action at %s: type=%s environment=%s port=%s proxy=%s pid=%s\n" "$(timestamp)" "$type" "$environment" "$environment_port" "$proxy_upstream_host" "$(current_bash_pid)" >> "$action_log_file"
  worker_log "accepted: id=$id type=$type environment=$environment port=$environment_port proxy=$proxy_upstream_host actionLog=$action_log_file pid=$(current_bash_pid)"
  write_ack "$id" "$type" "$environment" "$action_log_file"

  if requires_environment_lock "$type"; then
    if [[ -z "$environment" ]]; then
      write_result "$id" "error" "Environment is required for locked action: $type"
      worker_log "error: id=$id type=$type missingEnvironment=1"
      return 0
    fi

    action_lock_dir="$(environment_lock_path "$environment")"
    worker_log "lock_attempt: id=$id type=$type environment=$environment lock=$action_lock_dir"
    if ! acquire_environment_lock "$action_lock_dir" "$id" "$type" "$environment"; then
      printf "[composer-worker] lock conflict at %s: %s for %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$type" "$environment" >> "$action_log_file"
      write_lock_conflict_result "$id" "$type" "$environment"
      worker_log "locked: id=$id type=$type environment=$environment alreadyActive=1"
      return 0
    fi
    trap 'release_environment_lock "$action_lock_dir"' RETURN
  fi

  printf "[composer-worker] dispatch at %s: type=%s scriptDir=%s\n" "$(timestamp)" "$type" "$SCRIPT_DIR" >> "$action_log_file"
  worker_log "dispatch: id=$id type=$type environment=$environment"

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
    "environment.mongo.command")
      run_payload_script "$id" "$SCRIPT_DIR/mongo-inspect.sh" "$line"
      ;;
    "environment.mongo.importProdTennant")
      run_payload_script "$id" "$SCRIPT_DIR/import-prod-tennant.sh" "$line"
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
      worker_log "unknown_action: id=$id type=$type"
      ;;
  esac
  worker_log "processed: id=$id type=$type environment=$environment"
}

worker_log "fifo_open_start: pipe=$PIPE mode=read_write_persistent_fd fd=3"
exec 3<>"$PIPE"
worker_log "fifo_open_done: pipe=$PIPE mode=read_write_persistent_fd fd=3 pid=$$ bashpid=$(current_bash_pid)"

while true; do
  worker_log "fifo_read_wait: pipe=$PIPE fd=3 runningJobs=$(jobs -rp | wc -l | tr -d " ")"
  if IFS= read -r line <&3; then
    worker_log "received_line: bytes=${#line}"
    wait_for_parallel_slot

    (
      process_action "$line"
    ) &
    child_pid="$!"
    worker_log "spawned_action_worker: childPid=$child_pid bytes=${#line} runningJobs=$(jobs -rp | wc -l | tr -d " ")"
  else
    worker_log "fifo_read_eof_or_error: pipe=$PIPE fd=3 status=$? reopening=1"
    exec 3<&-
    sleep 1
    worker_log "fifo_reopen_start: pipe=$PIPE fd=3"
    exec 3<>"$PIPE"
    worker_log "fifo_reopen_done: pipe=$PIPE fd=3"
  fi
done

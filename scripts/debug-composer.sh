#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUS_ROOT="${BUS_ROOT:-/opt/composer-bus}"
BUS_PID=""

bus_pids() {
  pgrep -f "composer-worker.sh" 2>/dev/null || true
}

stop_bus_workers() {
  local pids
  local pid

  pids="$(bus_pids)"
  if [[ -z "$pids" ]]; then
    return
  fi

  printf "[composer-debug] stopping existing Bash FIFO bus PID(s): %s\n" "$(printf "%s" "$pids" | tr '\n' ' ')"
  while IFS= read -r pid; do
    if [[ -n "$pid" ]]; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done <<< "$pids"

  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if [[ -z "$(bus_pids)" ]]; then
      return
    fi
    sleep 1
  done

  pids="$(bus_pids)"
  if [[ -n "$pids" ]]; then
    printf "[composer-debug] Bash FIFO bus PID(s) did not stop: %s\n" "$(printf "%s" "$pids" | tr '\n' ' ')" >&2
    exit 1
  fi
}

reset_bus_files() {
  rm -f "$BUS_ROOT/actions.pipe" "$BUS_ROOT/worker.ready"
  rm -rf "$BUS_ROOT/worker.lock"
  mkdir -p "$BUS_ROOT/acks" "$BUS_ROOT/results" "$BUS_ROOT/logs" "$BUS_ROOT/locks"
  chmod -R 777 "$BUS_ROOT" 2>/dev/null || true
}

cleanup() {
  local exit_code=$?
  printf "\n[composer-debug] stopping Bash FIFO bus workers\n"
  stop_bus_workers
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

printf "[composer-debug] running prerequisite checks...\n"
CHECK_ONLY=1 "$ROOT_DIR/scripts/start-composer.sh"

printf "[composer-debug] preparing seed MongoDB data folders...\n"
SEEDS_DIR="${HOST_SEEDS_DIR:-$ROOT_DIR/seeds}" "$ROOT_DIR/scripts/prepare-seeds.sh"

printf "[composer-debug] stopping stale Bash FIFO bus workers...\n"
stop_bus_workers
reset_bus_files

printf "[composer-debug] starting Bash FIFO bus in live log mode...\n"
BUS_ROOT="$BUS_ROOT" \
COMPOSER_ROOT="$ROOT_DIR" \
RUNTIME_ROOT="$ROOT_DIR/runtime/environments" \
"$ROOT_DIR/scripts/composer-worker.sh" &
BUS_PID="$!"

sleep 1
if ! kill -0 "$BUS_PID" >/dev/null 2>&1; then
  printf "[composer-debug] Bash FIFO bus failed to start.\n" >&2
  exit 1
fi

printf "[composer-debug] bus PID: %s\n" "$BUS_PID"
printf "[composer-debug] starting docker compose attached. Press Ctrl+C to stop logs and bus.\n"

export HOST_RUNTIME_DIR="${HOST_RUNTIME_DIR:-$ROOT_DIR/runtime/environments}"
export HOST_SEEDS_DIR="${HOST_SEEDS_DIR:-$ROOT_DIR/seeds}"
export SSH_AUTH_SOCK="${SSH_AUTH_SOCK:-/tmp/empty-ssh-agent.sock}"

docker compose up --build

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUS_ROOT="${BUS_ROOT:-/opt/composer-bus}"
BUS_PID=""

cleanup() {
  local exit_code=$?
  if [[ -n "$BUS_PID" ]] && kill -0 "$BUS_PID" >/dev/null 2>&1; then
    printf "\n[composer-debug] stopping Bash FIFO bus PID %s\n" "$BUS_PID"
    kill "$BUS_PID" >/dev/null 2>&1 || true
    wait "$BUS_PID" >/dev/null 2>&1 || true
  fi
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

printf "[composer-debug] running prerequisite checks...\n"
CHECK_ONLY=1 "$ROOT_DIR/scripts/start-composer.sh"

printf "[composer-debug] preparing seed MongoDB data folders...\n"
SEEDS_DIR="${HOST_SEEDS_DIR:-$ROOT_DIR/seeds}" "$ROOT_DIR/scripts/prepare-seeds.sh"

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

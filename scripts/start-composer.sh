#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUS_ROOT="${BUS_ROOT:-/opt/composer-bus}"
COMPOSE_MODE="${COMPOSE_MODE:-detached}"
RUN_DIR="$ROOT_DIR/runtime/composer"
BUS_PID_FILE="$RUN_DIR/bus.pid"
BUS_LOG_FILE="$RUN_DIR/bus.log"

mkdir -p "$RUN_DIR"

log() {
  printf "[composer-start] %s\n" "$*"
}

prompt_yes_no() {
  local question="$1"
  local answer
  read -r -p "$question [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "Y" || "$answer" == "yes" || "$answer" == "YES" ]]
}

have() {
  command -v "$1" >/dev/null 2>&1
}

install_with_manager() {
  local package_name="$1"
  if have brew; then
    brew install "$package_name"
    return
  fi
  if have apt-get; then
    sudo apt-get update
    sudo apt-get install -y "$package_name"
    return
  fi
  if have dnf; then
    sudo dnf install -y "$package_name"
    return
  fi
  if have yum; then
    sudo yum install -y "$package_name"
    return
  fi

  log "No supported package manager found for installing $package_name."
  return 1
}

ensure_command() {
  local command_name="$1"
  local package_name="${2:-$command_name}"
  if have "$command_name"; then
    return
  fi

  if prompt_yes_no "$command_name is not installed. Install $package_name now?"; then
    install_with_manager "$package_name"
  fi

  if ! have "$command_name"; then
    log "$command_name is required. Install it and rerun this script."
    exit 1
  fi
}

ensure_docker() {
  if have docker; then
    return
  fi

  if [[ "$(uname -s)" == "Darwin" ]]; then
    if ! have brew; then
      log "Docker is required. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and rerun this script."
      exit 1
    fi

    if prompt_yes_no "Docker is not installed. Install Docker Desktop with Homebrew now?"; then
      brew install --cask docker
      log "Docker Desktop was installed. Start Docker Desktop, wait until it is running, then rerun this script."
    fi
    exit 1
  fi

  if prompt_yes_no "Docker is not installed. Install Docker packages now?"; then
    if have apt-get; then
      sudo apt-get update
      sudo apt-get install -y docker.io docker-compose-plugin
      sudo systemctl enable --now docker || true
    else
      install_with_manager docker
    fi
  fi

  if ! have docker; then
    log "Docker is required. Install Docker and rerun this script."
    exit 1
  fi
}

ensure_docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    return
  fi

  if have docker-compose; then
    return
  fi

  if prompt_yes_no "Docker Compose is not available. Install the compose plugin now?"; then
    if have brew; then
      brew install docker-compose
    elif have apt-get; then
      sudo apt-get update
      sudo apt-get install -y docker-compose-plugin
    else
      install_with_manager docker-compose
    fi
  fi

  if ! docker compose version >/dev/null 2>&1 && ! have docker-compose; then
    log "Docker Compose is required. Install it and rerun this script."
    exit 1
  fi
}

ensure_docker_running() {
  if docker info >/dev/null 2>&1; then
    return
  fi

  if [[ "$(uname -s)" == "Darwin" ]]; then
    log "Docker is installed but not running. Start Docker Desktop, wait until it is ready, then rerun this script."
  else
    log "Docker is installed but not running. Try: sudo systemctl start docker"
  fi
  exit 1
}

ensure_bus_root() {
  if [[ -d "$BUS_ROOT" && -w "$BUS_ROOT" ]]; then
    mkdir -p "$BUS_ROOT/acks" "$BUS_ROOT/results" "$BUS_ROOT/logs" "$BUS_ROOT/locks"
    chmod -R 777 "$BUS_ROOT" 2>/dev/null || true
    return
  fi

  if prompt_yes_no "$BUS_ROOT needs to be created or made writable. Run sudo setup now?"; then
    sudo mkdir -p "$BUS_ROOT/acks" "$BUS_ROOT/results" "$BUS_ROOT/logs" "$BUS_ROOT/locks"
    sudo chmod -R 777 "$BUS_ROOT"
  fi

  if [[ ! -d "$BUS_ROOT" || ! -w "$BUS_ROOT" ]]; then
    log "$BUS_ROOT must exist and be writable by this user."
    exit 1
  fi
}

ensure_env_file() {
  if [[ -f "$ROOT_DIR/.env" ]]; then
    return
  fi

  if [[ -f "$ROOT_DIR/.env.example" ]] && prompt_yes_no ".env is missing. Copy .env.example to .env now?"; then
    cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  fi

  if [[ ! -f "$ROOT_DIR/.env" ]]; then
    log ".env is required for docker compose. Create it and rerun this script."
    exit 1
  fi
}

start_bus() {
  if [[ -f "$BUS_PID_FILE" ]]; then
    local old_pid
    old_pid="$(cat "$BUS_PID_FILE")"
    if [[ -n "$old_pid" ]] && kill -0 "$old_pid" >/dev/null 2>&1; then
      if bus_restart_required; then
        log "Bash bus is running with old scripts; restarting PID $old_pid."
        kill "$old_pid" >/dev/null 2>&1 || true
        for _ in 1 2 3 4 5; do
          if ! kill -0 "$old_pid" >/dev/null 2>&1; then
            break
          fi
          sleep 1
        done
        if kill -0 "$old_pid" >/dev/null 2>&1; then
          log "Bash bus PID $old_pid did not stop. Stop it manually or rerun with RESTART_BUS=1 after it exits."
          exit 1
        fi
      else
        log "Bash bus is already running with PID $old_pid."
        return
      fi
    else
      rm -f "$BUS_PID_FILE"
    fi
  fi

  log "Starting Bash FIFO bus..."
  BUS_ROOT="$BUS_ROOT" \
  COMPOSER_ROOT="$ROOT_DIR" \
  RUNTIME_ROOT="$ROOT_DIR/runtime/environments" \
  nohup "$ROOT_DIR/scripts/composer-worker.sh" > "$BUS_LOG_FILE" 2>&1 &
  echo "$!" > "$BUS_PID_FILE"
  sleep 1

  if ! kill -0 "$(cat "$BUS_PID_FILE")" >/dev/null 2>&1; then
    log "Bash bus failed to start. See $BUS_LOG_FILE."
    exit 1
  fi

  log "Bash bus started with PID $(cat "$BUS_PID_FILE"). Log: $BUS_LOG_FILE"
}

bus_restart_required() {
  local script

  if [[ "${RESTART_BUS:-0}" == "1" ]]; then
    return 0
  fi

  for script in \
    "$ROOT_DIR/scripts/composer-worker.sh" \
    "$ROOT_DIR/scripts/prepare-env.sh" \
    "$ROOT_DIR/scripts/common.sh"; do
    if [[ "$script" -nt "$BUS_PID_FILE" ]]; then
      return 0
    fi
  done

  return 1
}

start_compose() {
  log "Starting Composer docker compose stack..."
  cd "$ROOT_DIR"

  export HOST_RUNTIME_DIR="${HOST_RUNTIME_DIR:-$ROOT_DIR/runtime/environments}"
  export HOST_SEEDS_DIR="${HOST_SEEDS_DIR:-$ROOT_DIR/seeds}"
  export SSH_AUTH_SOCK="${SSH_AUTH_SOCK:-/tmp/empty-ssh-agent.sock}"

  if [[ "$COMPOSE_MODE" == "attached" ]]; then
    docker compose up --build
  else
    docker compose up --build -d
  fi
  log "Composer stack started."
}

prepare_seeds() {
  log "Preparing seed MongoDB data folders..."
  SEEDS_DIR="${HOST_SEEDS_DIR:-$ROOT_DIR/seeds}" "$ROOT_DIR/scripts/prepare-seeds.sh"
}

run_checks() {
  ensure_command jq jq
  ensure_command git git
  ensure_docker
  ensure_docker_compose
  ensure_docker_running
  ensure_bus_root
  ensure_env_file
}

run_checks
if [[ "${CHECK_ONLY:-0}" == "1" ]]; then
  log "Checks passed."
  exit 0
fi

prepare_seeds
start_bus
start_compose

log "Ready. API health should be available through the configured proxy/API port."

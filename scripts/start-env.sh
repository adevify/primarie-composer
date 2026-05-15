#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

log_start() {
  printf "[start-env] %s %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

on_start_error() {
  local code="$?"
  local line="${BASH_LINENO[0]:-unknown}"
  log_start "error: exitCode=$code line=$line command=$BASH_COMMAND"
  log_start "error_context: env=${ENV_NAME:-unset} envDir=${ENV_DIR:-unset} project=${PROJECT_NAME:-unset} proxyHost=${PROXY_UPSTREAM_HOST:-unset} proxyPort=${PROXY_PORT:-unset} pwd=$(pwd)"
  if [[ -n "${PROJECT_NAME:-}" ]]; then
    log_start "error_context_compose_ps: $(compose_cmd -p "$PROJECT_NAME" --env-file "${ENV_DIR:-/dev/null}/.env" ps 2>&1 | tail -n 80 | tr '\n' ';')"
    log_start "error_context_docker_ps: $(docker ps -a --filter "label=com.docker.compose.project=$PROJECT_NAME" --format '{{.Names}} {{.Status}} {{.Ports}}' 2>&1 | tr '\n' ';')"
  fi
  exit "$code"
}

trap on_start_error ERR

ENV_NAME="${1:-}"
validate_env "$ENV_NAME"
ENV_PORT="${2:-}"
PROXY_UPSTREAM_HOST="${3:-host.docker.internal}"

ENV_DIR="$(env_dir "$ENV_NAME")"
PROJECT_NAME="$(project_name "$ENV_NAME")"

log_start "start: env=$ENV_NAME envDir=$ENV_DIR project=$PROJECT_NAME envPort=$ENV_PORT proxyUpstreamHost=$PROXY_UPSTREAM_HOST scriptDir=$SCRIPT_DIR"
log_start "tools: docker=$(command -v docker || true) dockerVersion=$(docker --version 2>&1 || true) composeVersion=$(compose_cmd version 2>&1 || true)"
log_start "env_dir_state: $(ls -la "$ENV_DIR" 2>&1 | tail -n 80 | tr '\n' ';')"
log_start "env_file_state: exists=$([[ -f "$ENV_DIR/.env" ]] && echo yes || echo no) size=$([[ -f "$ENV_DIR/.env" ]] && wc -c < "$ENV_DIR/.env" | tr -d " " || echo 0)"
ensure_env_proxy_hosts "$ENV_DIR/.env" "$ENV_NAME" "$ENV_PORT"
log_start "proxy_hosts_ensured: env=$ENV_NAME envPort=$ENV_PORT envFile=$ENV_DIR/.env"
patch_repo_for_composer "$ENV_DIR"
log_start "repo_patched: envDir=$ENV_DIR"
PROXY_PORT="$(read_env_var "$ENV_DIR/.env" "PROXY_EXTERNAL_PORT")"
log_start "proxy_port_read: proxyPort=$PROXY_PORT"

cd "$ENV_DIR"
log_start "compose_config_start: cwd=$(pwd)"
compose_cmd -p "$PROJECT_NAME" --env-file "$ENV_DIR/.env" config --services 2>&1 | sed 's/^/[start-env] compose_service /' || true
echo "Building compose project $PROJECT_NAME in $ENV_DIR"
log_start "compose_build_start: project=$PROJECT_NAME envDir=$ENV_DIR"
COMPOSE_PROGRESS=plain compose_cmd -p "$PROJECT_NAME" --env-file "$ENV_DIR/.env" build
log_start "compose_build_done: project=$PROJECT_NAME"

echo "Starting compose project $PROJECT_NAME"
log_start "compose_up_start: project=$PROJECT_NAME"
compose_cmd -p "$PROJECT_NAME" --env-file "$ENV_DIR/.env" up -d --remove-orphans
log_start "compose_up_done: project=$PROJECT_NAME"

echo "Compose services after start:"
compose_cmd -p "$PROJECT_NAME" --env-file "$ENV_DIR/.env" ps
log_start "compose_ps_done: project=$PROJECT_NAME"

require_compose_service_running "$PROJECT_NAME" "proxy"
log_start "proxy_service_running: project=$PROJECT_NAME"
if ! wait_for_proxy_upstream_port "$PROXY_UPSTREAM_HOST" "$PROXY_PORT" "${ENV_START_READY_TIMEOUT_SECONDS:-30}"; then
  echo "Warning: compose services are running, but Composer proxy readiness check did not pass yet." >&2
  log_start "proxy_readiness_warning: proxyUpstreamHost=$PROXY_UPSTREAM_HOST proxyPort=$PROXY_PORT timeout=${ENV_START_READY_TIMEOUT_SECONDS:-30}"
fi
log_start "done: env=$ENV_NAME project=$PROJECT_NAME proxyPort=$PROXY_PORT"

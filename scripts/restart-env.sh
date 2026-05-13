#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

ENV_NAME="${1:-}"
validate_env "$ENV_NAME"
ENV_PORT="${2:-}"
PROXY_UPSTREAM_HOST="${3:-host.docker.internal}"

ENV_DIR="$(env_dir "$ENV_NAME")"
PROJECT_NAME="$(project_name "$ENV_NAME")"

ensure_env_proxy_hosts "$ENV_DIR/.env" "$ENV_NAME" "$ENV_PORT"
patch_repo_for_composer "$ENV_DIR"
PROXY_PORT="$(read_env_var "$ENV_DIR/.env" "PROXY_EXTERNAL_PORT")"

cd "$ENV_DIR"
echo "Building proxy for compose project $PROJECT_NAME"
COMPOSE_PROGRESS=plain compose_cmd -p "$PROJECT_NAME" --env-file "$ENV_DIR/.env" build proxy

compose_cmd -p "$PROJECT_NAME" --env-file "$ENV_DIR/.env" up -d --remove-orphans
require_compose_service_running "$PROJECT_NAME" "proxy"
wait_for_proxy_upstream_port "$PROXY_UPSTREAM_HOST" "$PROXY_PORT" "${ENV_START_READY_TIMEOUT_SECONDS:-120}"

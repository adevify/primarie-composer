#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

ENV_NAME="${1:-}"
validate_env "$ENV_NAME"

ENV_DIR="$(env_dir "$ENV_NAME")"
PROJECT_NAME="$(project_name "$ENV_NAME")"

cd "$ENV_DIR"
compose_cmd -p "$PROJECT_NAME" --env-file "$ENV_DIR/.env" stop

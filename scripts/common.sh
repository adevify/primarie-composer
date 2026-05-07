#!/usr/bin/env bash

validate_env() {
  local env_name="$1"
  if [[ ! "$env_name" =~ ^[a-z0-9][a-z0-9-]*[a-z0-9]$ ]]; then
    echo "Invalid environment: $env_name" >&2
    exit 2
  fi
}

composer_root() {
  echo "${COMPOSER_ROOT:-/opt/primarie-composer}"
}

runtime_root() {
  echo "${RUNTIME_ROOT:-$(composer_root)/runtime/environments}"
}

env_dir() {
  local env_name="$1"
  echo "$(runtime_root)/$env_name"
}

project_name() {
  local env_name="$1"
  echo "env_${env_name//-/_}"
}

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

assert_safe_relative_path() {
  local relative_path="$1"
  if [[ -z "$relative_path" || "$relative_path" == /* || "$relative_path" == *"/../"* || "$relative_path" == "../"* || "$relative_path" == *"/.." || "$relative_path" == "." || "$relative_path" == ".." ]]; then
    echo "Invalid relative path: $relative_path" >&2
    exit 2
  fi
}

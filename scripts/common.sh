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

set_env_var() {
  local env_file="$1"
  local key="$2"
  local value="$3"
  local tmp_file

  tmp_file="$(mktemp)"
  if [[ -f "$env_file" ]] && grep -q "^${key}=" "$env_file"; then
    awk -v key="$key" -v value="$value" 'BEGIN { line = key "=" value } $0 ~ "^" key "=" { print line; next } { print }' "$env_file" > "$tmp_file"
  else
    if [[ -f "$env_file" ]]; then
      cat "$env_file" > "$tmp_file"
    fi
    printf "%s=%s\n" "$key" "$value" >> "$tmp_file"
  fi

  mv "$tmp_file" "$env_file"
}

ensure_env_proxy_hosts() {
  local env_file="$1"
  local root_domain="${ROOT_DOMAIN:-prmr.md}"
  local env_name="${2:-}"
  local env_port="${3:-}"

  if [[ ! -f "$env_file" ]]; then
    echo "Environment .env file is missing: $env_file" >&2
    exit 2
  fi

  set_env_var "$env_file" "HOST_1" "$root_domain"
  set_env_var "$env_file" "HOST_2" "$root_domain"
  set_env_var "$env_file" "ROOT_DOMAIN" "$root_domain"
  if [[ -n "$env_name" ]]; then
    set_env_var "$env_file" "ENV_KEY" "$env_name"
  fi
  if [[ -n "$env_port" ]]; then
    set_env_var "$env_file" "ENV_PORT" "$env_port"
    set_env_var "$env_file" "PROXY_EXTERNAL_PORT" "$env_port"
  fi
}

read_env_var() {
  local env_file="$1"
  local key="$2"
  local value

  value="$(grep -E "^${key}=" "$env_file" | tail -n 1 | cut -d= -f2- || true)"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf "%s" "$value"
}

wait_for_tcp_port() {
  local host="$1"
  local port="$2"
  local timeout_seconds="${3:-120}"
  local started_at
  local now

  if [[ -z "$port" || ! "$port" =~ ^[0-9]+$ ]]; then
    echo "Invalid port: $port" >&2
    exit 2
  fi

  echo "Waiting for $host:$port to accept connections..."
  started_at="$(date +%s)"
  while true; do
    if (: >"/dev/tcp/$host/$port") >/dev/null 2>&1; then
      echo "$host:$port is accepting connections."
      return 0
    fi

    now="$(date +%s)"
    if (( now - started_at >= timeout_seconds )); then
      echo "Timed out waiting for $host:$port after ${timeout_seconds}s." >&2
      return 1
    fi

    sleep 2
  done
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

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

composer_project_name() {
  basename "$(composer_root)"
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

compose_service_container_id() {
  local project_name="$1"
  local service_name="$2"
  local include_stopped="${3:-0}"
  local args=(-q --filter "label=com.docker.compose.project=$project_name" --filter "label=com.docker.compose.service=$service_name")

  if [[ "$include_stopped" == "1" ]]; then
    docker ps -a "${args[@]}" | head -n 1
    return
  fi

  docker ps "${args[@]}" | head -n 1
}

require_compose_service_running() {
  local project_name="$1"
  local service_name="$2"
  local container_id
  local stopped_container_id

  container_id="$(compose_service_container_id "$project_name" "$service_name" 0 || true)"
  if [[ -n "$container_id" ]]; then
    echo "Compose service $service_name is running: $container_id"
    return
  fi

  echo "Compose service $service_name is not running for project $project_name." >&2
  echo "Known containers for project $project_name:" >&2
  docker ps -a \
    --filter "label=com.docker.compose.project=$project_name" \
    --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" >&2 || true

  stopped_container_id="$(compose_service_container_id "$project_name" "$service_name" 1 || true)"
  if [[ -n "$stopped_container_id" ]]; then
    echo "Last logs for $service_name container $stopped_container_id:" >&2
    docker logs --tail 160 "$stopped_container_id" >&2 || true
  fi

  return 1
}

assert_project_container() {
  local project_name="$1"
  local container="$2"
  local actual_project

  actual_project="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$container" 2>/dev/null || true)"
  if [[ "$actual_project" != "$project_name" ]]; then
    echo "Container $container does not belong to compose project $project_name" >&2
    exit 2
  fi
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

patch_repo_proxy_dockerfile() {
  local repo_dir="$1"
  local dockerfile="$repo_dir/proxy/Dockerfile"
  local service

  if [[ ! -f "$dockerfile" ]]; then
    return
  fi

  if ! grep -q "resolver 127.0.0.11" "$dockerfile"; then
    perl -0pi -e 's/http \{ \\/http { \\\n        resolver 127.0.0.11 ipv6=off valid=10s;\\/g' "$dockerfile"
  fi

  for service in landing-adevify landing-primarie api media admin ingest storybook client; do
    if ! grep -q "${service//-/_}_upstream" "$dockerfile"; then
      perl -0pi -e "s/proxy_pass http:\\/\\/$service;/set \\\$${service//-/_}_upstream $service;\\\\\n                proxy_pass http:\\/\\/\\\$${service//-/_}_upstream;/g" "$dockerfile"
    fi
  done

  perl -0pi -e 's/(set )\$/\1\\\$/g; s/(proxy_pass http:\/\/)\$/\1\\\$/g' "$dockerfile"
}

patch_repo_storybook_compose_volume() {
  local repo_dir="$1"
  local compose_file="$repo_dir/docker-compose.yml"

  if [[ ! -f "$compose_file" ]] || grep -q "/code/apps/storybook/node_modules" "$compose_file"; then
    return
  fi

  perl -0pi -e 's|(storybook:\n(?:.*\n)*?\s+volumes:\n\s+- ./apps/storybook:/code/apps/storybook\n)|$1      - /code/apps/storybook/node_modules\n|s' "$compose_file"
}

patch_repo_for_composer() {
  local repo_dir="$1"

  patch_repo_proxy_dockerfile "$repo_dir"
  patch_repo_storybook_compose_volume "$repo_dir"
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

composer_proxy_container_id() {
  local project_name="${COMPOSE_PROJECT_NAME:-$(composer_project_name)}"
  docker ps -q \
    --filter "label=com.docker.compose.project=$project_name" \
    --filter "label=com.docker.compose.service=proxy" \
    | head -n 1
}

wait_for_proxy_upstream_port() {
  local host="$1"
  local port="$2"
  local timeout_seconds="${3:-120}"
  local proxy_container
  local started_at
  local now

  proxy_container="$(composer_proxy_container_id || true)"
  if [[ -z "$proxy_container" ]]; then
    wait_for_tcp_port "$host" "$port" "$timeout_seconds"
    return
  fi

  echo "Waiting for Composer proxy to reach $host:$port..."
  started_at="$(date +%s)"
  while true; do
    if docker exec "$proxy_container" sh -c 'nc -z -w 2 "$0" "$1"' "$host" "$port" >/dev/null 2>&1; then
      echo "Composer proxy can reach $host:$port."
      return 0
    fi

    now="$(date +%s)"
    if (( now - started_at >= timeout_seconds )); then
      echo "Timed out waiting for Composer proxy to reach $host:$port after ${timeout_seconds}s." >&2
      echo "Composer proxy container: $proxy_container" >&2
      echo "Docker containers publishing :$port:" >&2
      docker ps --filter "publish=$port" --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}" >&2 || true
      echo "Connectivity probe from Composer proxy:" >&2
      docker exec "$proxy_container" sh -c 'nc -vz -w 2 "$0" "$1"' "$host" "$port" >&2 || true
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

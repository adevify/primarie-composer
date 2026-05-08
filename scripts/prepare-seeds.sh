#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEEDS_DIR="${SEEDS_DIR:-$ROOT_DIR/seeds}"
MONGO_IMAGE="${SEED_MONGO_IMAGE:-mongo:7.0.12}"
MONGO_DATABASE="${SEED_MONGO_DATABASE:-primarie}"
CURRENT_CONTAINER=""

log() {
  printf "[prepare-seeds] %s\n" "$*"
}

cleanup() {
  if [[ -n "$CURRENT_CONTAINER" ]]; then
    docker rm -f "$CURRENT_CONTAINER" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

if ! command -v jq >/dev/null 2>&1; then
  log "jq is required."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  log "docker is required."
  exit 1
fi

wait_for_mongo() {
  local container="$1"
  local started_at
  local now

  started_at="$(date +%s)"
  while true; do
    if docker exec "$container" mongosh --quiet --eval "db.adminCommand({ ping: 1 }).ok" >/dev/null 2>&1; then
      return
    fi

    now="$(date +%s)"
    if (( now - started_at >= 60 )); then
      log "Mongo did not become ready in $container."
      docker logs "$container" >&2 || true
      exit 1
    fi

    sleep 1
  done
}

reset_mongo_dir() {
  local mongo_dir="$1"

  mkdir -p "$mongo_dir"
  docker run --rm \
    -v "$mongo_dir:/data/db" \
    --entrypoint bash \
    "$MONGO_IMAGE" \
    -lc 'shopt -s dotglob nullglob; rm -rf /data/db/*'
}

import_json_file() {
  local container="$1"
  local file_path="$2"
  local collection="$3"

  jq -c 'if type == "array" then .[] else . end' "$file_path" \
    | docker exec -i "$container" mongoimport --quiet --db "$MONGO_DATABASE" --collection "$collection" --drop
}

prepare_seed() {
  local seed_dir="$1"
  local seed_name
  local mongo_dir
  local file_path
  local file_name
  local collection

  seed_name="$(basename "$seed_dir")"
  if [[ ! "$seed_name" =~ ^[A-Za-z0-9_-]+$ ]]; then
    log "Skipping seed with unsupported name: $seed_name"
    return
  fi

  mongo_dir="$seed_dir/mongodb"
  mkdir -p "$seed_dir/media"
  reset_mongo_dir "$mongo_dir"

  CURRENT_CONTAINER="primarie-seed-$(printf "%s" "${seed_name//_/-}" | tr '[:upper:]' '[:lower:]')-$$"
  log "Preparing $seed_name with $MONGO_IMAGE..."
  docker run -d \
    --name "$CURRENT_CONTAINER" \
    -v "$mongo_dir:/data/db" \
    -v "$seed_dir:/seed:ro" \
    "$MONGO_IMAGE" \
    mongod --quiet --bind_ip_all >/dev/null

  wait_for_mongo "$CURRENT_CONTAINER"
  docker exec "$CURRENT_CONTAINER" mongosh --quiet "$MONGO_DATABASE" --eval "db.getCollection('__primarie_seed_ready').insertOne({ ready: true }); db.getCollection('__primarie_seed_ready').drop();" >/dev/null

  shopt -s nullglob
  for file_path in "$seed_dir"/*.json; do
    file_name="$(basename "$file_path")"
    collection="${file_name%.json}"
    log "Importing $seed_name/$file_name into $MONGO_DATABASE.$collection"
    import_json_file "$CURRENT_CONTAINER" "$file_path" "$collection" >/dev/null
  done
  shopt -u nullglob

  docker stop "$CURRENT_CONTAINER" >/dev/null
  docker rm "$CURRENT_CONTAINER" >/dev/null
  CURRENT_CONTAINER=""
}

if [[ ! -d "$SEEDS_DIR" ]]; then
  log "Seeds directory does not exist: $SEEDS_DIR"
  exit 0
fi

shopt -s nullglob
for seed_dir in "$SEEDS_DIR"/*; do
  if [[ -d "$seed_dir" ]]; then
    prepare_seed "$seed_dir"
  fi
done
shopt -u nullglob

log "Seed data folders are ready."

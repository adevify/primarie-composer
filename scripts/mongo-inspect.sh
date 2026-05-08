#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

PAYLOAD_FILE="${1:?Payload file is required}"
ENV_NAME="$(jq -r '.environment' "$PAYLOAD_FILE")"
LIMIT="$(jq -r '.limit // 20' "$PAYLOAD_FILE")"
validate_env "$ENV_NAME"

if [[ ! "$LIMIT" =~ ^[0-9]+$ ]]; then
  echo "Invalid limit: $LIMIT" >&2
  exit 2
fi

ENV_DIR="$(env_dir "$ENV_NAME")"
PROJECT_NAME="$(project_name "$ENV_NAME")"

if [[ ! -d "$ENV_DIR" ]]; then
  jq -n --arg reason "Environment directory is missing" '{ available: false, reason: $reason }'
  exit 0
fi

cd "$ENV_DIR"
container_id="$(compose_cmd -p "$PROJECT_NAME" --env-file "$ENV_DIR/.env" ps -q mongodb || true)"
if [[ -z "$container_id" ]]; then
  container_id="$(compose_cmd -p "$PROJECT_NAME" --env-file "$ENV_DIR/.env" ps -q mongo || true)"
fi
if [[ -z "$container_id" ]]; then
  jq -n --arg reason "MongoDB container is not running" '{ available: false, reason: $reason }'
  exit 0
fi

database="primarie"

docker exec "$container_id" mongosh "$database" --quiet --eval "
const limit = Number($LIMIT);
const collections = db.getCollectionNames().sort().map((name) => {
  const collection = db.getCollection(name);
  return {
    name,
    count: collection.countDocuments(),
    sample: collection.find({}).limit(limit).toArray()
  };
});
print(JSON.stringify({ available: true, container: '$container_id', database: db.getName(), collections }));
"

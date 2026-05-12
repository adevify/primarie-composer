#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

PAYLOAD_FILE="${1:?Payload file is required}"
ENV_NAME="$(jq -r '.environment' "$PAYLOAD_FILE")"
LIMIT="$(jq -r '.limit // 20' "$PAYLOAD_FILE")"
MAX_BYTES="$(jq -r '.maxBytes // 50000' "$PAYLOAD_FILE")"
MAX_DOC_BYTES="$(jq -r '.maxDocBytes // 2000' "$PAYLOAD_FILE")"
validate_env "$ENV_NAME"

if [[ ! "$LIMIT" =~ ^[0-9]+$ ]]; then
  echo "Invalid limit: $LIMIT" >&2
  exit 2
fi
if [[ ! "$MAX_BYTES" =~ ^[0-9]+$ ]]; then
  echo "Invalid maxBytes: $MAX_BYTES" >&2
  exit 2
fi
if [[ ! "$MAX_DOC_BYTES" =~ ^[0-9]+$ ]]; then
  echo "Invalid maxDocBytes: $MAX_DOC_BYTES" >&2
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
const maxBytes = Number($MAX_BYTES);
const maxDocBytes = Number($MAX_DOC_BYTES);
const result = { available: true, container: '$container_id', database: db.getName(), collections: [], truncated: false };
const jsonSize = (value) => JSON.stringify(value).length;
const fitDocument = (document) => {
  const serialized = JSON.stringify(document);
  if (serialized.length <= maxDocBytes) {
    return document;
  }
  return {
    __truncated: true,
    __originalBytes: serialized.length,
    __preview: serialized.slice(0, maxDocBytes)
  };
};

for (const name of db.getCollectionNames().sort()) {
  const collection = db.getCollection(name);
  const entry = {
    name,
    count: collection.countDocuments(),
    sample: []
  };

  const documents = collection.find({}).limit(limit).toArray();
  for (const document of documents) {
    const preview = fitDocument(document);
    const nextEntry = { ...entry, sample: [...entry.sample, preview] };
    const nextResult = { ...result, collections: [...result.collections, nextEntry] };
    if (jsonSize(nextResult) > maxBytes) {
      entry.truncated = true;
      result.truncated = true;
      break;
    }
    entry.sample.push(preview);
  }

  const nextResult = { ...result, collections: [...result.collections, entry] };
  if (jsonSize(nextResult) > maxBytes) {
    result.truncated = true;
    const minimalEntry = { name, count: entry.count, sample: [], truncated: true };
    const minimalResult = { ...result, collections: [...result.collections, minimalEntry] };
    if (jsonSize(minimalResult) <= maxBytes) {
      result.collections.push(minimalEntry);
    }
    break;
  }

  result.collections.push(entry);
}

print(JSON.stringify(result));
"

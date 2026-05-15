#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

log_import() {
  printf "[import-prod-tennant] %s %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

on_import_error() {
  local code="$?"
  local line="${BASH_LINENO[0]:-unknown}"
  log_import "error: exitCode=$code line=$line command=$BASH_COMMAND env=${ENV_NAME:-unset} tennant=${TENNANT:-unset}"
  exit "$code"
}

trap on_import_error ERR

PAYLOAD_FILE="${1:?Payload file is required}"
ENV_NAME="$(jq -r '.environment' "$PAYLOAD_FILE")"
TENNANT="$(jq -r '.tennant' "$PAYLOAD_FILE")"
EXPORT_URL="https://api.primarie.md/tennants.export"
SIGNATURE="$(jq -r '.signature' "$PAYLOAD_FILE")"
validate_env "$ENV_NAME"

if [[ ! "$TENNANT" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  echo "Invalid tennant: $TENNANT" >&2
  exit 2
fi

if [[ -z "$EXPORT_URL" || "$EXPORT_URL" == "null" || -z "$SIGNATURE" || "$SIGNATURE" == "null" ]]; then
  echo "Import requires exportUrl and signature." >&2
  exit 2
fi

ENV_DIR="$(env_dir "$ENV_NAME")"
PROJECT_NAME="$(project_name "$ENV_NAME")"
database="primarie"

if [[ ! -d "$ENV_DIR" ]]; then
  echo "Environment directory is missing: $ENV_DIR" >&2
  exit 2
fi

cd "$ENV_DIR"
container_id="$(compose_cmd -p "$PROJECT_NAME" --env-file "$ENV_DIR/.env" ps -q mongodb || true)"
if [[ -z "$container_id" ]]; then
  container_id="$(compose_cmd -p "$PROJECT_NAME" --env-file "$ENV_DIR/.env" ps -q mongo || true)"
fi
if [[ -z "$container_id" ]]; then
  echo "MongoDB container is not running for $ENV_NAME" >&2
  exit 2
fi

work_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

request_body="$work_dir/request.json"
wrapped_request_body="$work_dir/request-wrapped.json"
response_body="$work_dir/response.json"
export_body="$work_dir/export.json"
import_summary="$work_dir/summary.jsonl"

jq -n --arg tennant "$TENNANT" --arg signature "$SIGNATURE" '{tennant: $tennant, signature: $signature}' > "$request_body"
jq -n --slurpfile json "$request_body" '{json: $json[0]}' > "$wrapped_request_body"

log_import "fetch_start: env=$ENV_NAME tennant=$TENNANT url=$EXPORT_URL container=$container_id"
if ! curl -fsS -X POST "$EXPORT_URL" -H "content-type: application/json" --data-binary @"$request_body" -o "$response_body"; then
  log_import "fetch_post_plain_failed_try_wrapped_post: url=$EXPORT_URL"
  if ! curl -fsS -X POST "$EXPORT_URL" -H "content-type: application/json" --data-binary @"$wrapped_request_body" -o "$response_body"; then
    encoded_input="$(jq -c . "$wrapped_request_body" | jq -sRr @uri)"
    log_import "fetch_wrapped_post_failed_try_get: url=$EXPORT_URL"
    curl -fsS "$EXPORT_URL?input=$encoded_input" -o "$response_body"
  fi
fi
log_import "fetch_done: bytes=$(wc -c < "$response_body" | tr -d " ")"

jq '
  if type == "object" and has("result") and (.result | has("data")) then
    if (.result.data | type) == "object" and (.result.data | has("json")) then .result.data.json else .result.data end
  elif type == "object" and has("data") then
    if (.data | type) == "object" and (.data | has("json")) then .data.json else .data end
  else
    .
  end
' "$response_body" > "$export_body"

log_import "extract_done: exportBytes=$(wc -c < "$export_body" | tr -d " ") keys=$(jq -r 'keys | join(",")' "$export_body")"

write_collection_file() {
  local export_key="$1"
  local collection="$2"
  local mode="${3:-array}"
  local file="$work_dir/$collection-$export_key.json"

  if [[ "$mode" == "object" ]]; then
    jq -c --arg key "$export_key" 'if .[$key] == null then [] else [.[$key]] end' "$export_body" > "$file"
  else
    jq -c --arg key "$export_key" 'if (.[$key] // null) == null then [] elif (.[$key] | type) == "array" then .[$key] else [.[$key]] end' "$export_body" > "$file"
  fi

  local count
  count="$(jq 'length' "$file")"
  if [[ "$count" == "0" ]]; then
    log_import "collection_skip_empty: key=$export_key collection=$collection"
    return
  fi

  log_import "collection_import_start: key=$export_key collection=$collection count=$count"
  docker exec -i "$container_id" mongoimport \
    --quiet \
    --db "$database" \
    --collection "$collection" \
    --mode upsert \
    --upsertFields _id \
    --jsonArray < "$file"
  jq -n --arg key "$export_key" --arg collection "$collection" --argjson count "$count" '{key: $key, collection: $collection, count: $count}' >> "$import_summary"
  log_import "collection_import_done: key=$export_key collection=$collection count=$count"
}

write_collection_file "media" "media"
write_collection_file "mediaFolders" "mediaFolder"
write_collection_file "tennant" "tennants" "object"
write_collection_file "events" "events"
write_collection_file "news" "news"
write_collection_file "alerts" "alerts"
write_collection_file "edificies" "edifices"
write_collection_file "galleries" "galleries"
write_collection_file "employees" "employees"
write_collection_file "documents" "documents"
write_collection_file "users" "users"
write_collection_file "categories" "categories"
write_collection_file "tennantsStats" "tennantsStats"
write_collection_file "pages" "pages"
write_collection_file "localDocs" "localDocs"
write_collection_file "publicAcqs" "publicAcqs"
write_collection_file "mailTemplates" "emailTemplates"
write_collection_file "geodata" "geodata"
write_collection_file "contracts" "contracts"
write_collection_file "draftContracts" "draftContracts"
write_collection_file "assignedUser" "users" "object"

if [[ ! -f "$import_summary" ]]; then
  echo "No importable collections were returned by production export." >&2
  exit 2
fi

jq -s --arg tennant "$TENNANT" --arg database "$database" '{tennant: $tennant, database: $database, collections: ., importedCollections: length, importedDocuments: (map(.count) | add // 0)}' "$import_summary"
log_import "done: env=$ENV_NAME tennant=$TENNANT summary=$(jq -s -c '{collections: length, documents: (map(.count) | add // 0)}' "$import_summary")"

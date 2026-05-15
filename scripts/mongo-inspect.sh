#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

PAYLOAD_FILE="${1:?Payload file is required}"
ENV_NAME="$(jq -r '.environment' "$PAYLOAD_FILE")"
OPERATION="$(jq -r '.operation // "preview"' "$PAYLOAD_FILE")"
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
payload_json="$(jq -c . "$PAYLOAD_FILE")"
payload_literal="$(printf "%s" "$payload_json" | jq -Rs .)"
mongo_script="$(mktemp)"
trap 'rm -f "$mongo_script"' EXIT

cat > "$mongo_script" <<MONGO_JS
const payload = EJSON.parse($payload_literal);
const operation = payload.operation || "preview";
const defaultLimit = Number($LIMIT);
const maxBytes = Number($MAX_BYTES);
const maxDocBytes = Number($MAX_DOC_BYTES);
const resultBase = { available: true, container: "$container_id", database: db.getName() };

const jsonSize = (value) => EJSON.stringify(value, { relaxed: false }).length;
const fail = (message) => {
  throw new Error(message);
};
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof ObjectId) && !(value instanceof Date);
const validateCollectionName = (name) => {
  if (typeof name !== "string" || !/^[A-Za-z0-9_.-]+$/.test(name) || name.includes("..") || name.startsWith("system.")) {
    fail("Invalid collection name.");
  }
  return name;
};
const toObjectIdIfPossible = (value) => {
  if (typeof value === "string" && /^[a-fA-F0-9]{24}$/.test(value)) {
    return ObjectId(value);
  }
  return value;
};
const normalizeMongoValue = (value, key) => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeMongoValue(item, key));
  }
  if (isPlainObject(value)) {
    const next = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      next[childKey] = normalizeMongoValue(childValue, key === "_id" ? "_id" : childKey);
    }
    return next;
  }
  return key === "_id" ? toObjectIdIfPossible(value) : value;
};
const normalizeFilter = (filter, allowEmpty = true) => {
  const normalized = normalizeMongoValue(filter || {}, "");
  if (!isPlainObject(normalized)) {
    fail("Filter must be a JSON object.");
  }
  if (!allowEmpty && Object.keys(normalized).length === 0) {
    fail("Empty filters are not allowed for this operation.");
  }
  return normalized;
};
const normalizeSort = (sort) => {
  const normalized = normalizeMongoValue(sort || { _id: -1 }, "");
  if (!isPlainObject(normalized)) {
    fail("Sort must be a JSON object.");
  }
  return normalized;
};
const normalizeUpdate = (update) => {
  const normalized = normalizeMongoValue(update || {}, "");
  if (!isPlainObject(normalized) || Object.keys(normalized).length === 0) {
    fail("Update must be a non-empty JSON object.");
  }
  if (!Object.keys(normalized).every((key) => key.startsWith("$"))) {
    fail("Update must use MongoDB update operators such as \$set, \$unset, or \$inc.");
  }
  return normalized;
};
const collection = () => db.getCollection(validateCollectionName(payload.collection));
const pageValue = () => Math.max(1, Math.floor(Number(payload.page || 1)));
const limitValue = () => Math.max(1, Math.min(100, Math.floor(Number(payload.limit || defaultLimit || 20))));
const printResult = (value) => print(EJSON.stringify(value, { relaxed: false }));
const fitDocument = (document) => {
  const serialized = EJSON.stringify(document, { relaxed: false });
  if (serialized.length <= maxDocBytes) {
    return document;
  }
  return {
    __truncated: true,
    __originalBytes: serialized.length,
    __preview: serialized.slice(0, maxDocBytes)
  };
};
const collectionStats = (name) => {
  try {
    const stats = db.runCommand({ collStats: name });
    return {
      sizeBytes: typeof stats.size === "number" ? stats.size : undefined,
      storageSizeBytes: typeof stats.storageSize === "number" ? stats.storageSize : undefined
    };
  } catch {
    return {};
  }
};
const listCollections = (includeSample) => {
  const collections = [];
  for (const name of db.getCollectionNames().sort()) {
    const coll = db.getCollection(name);
    const entry = {
      name,
      count: coll.countDocuments(),
      ...collectionStats(name)
    };
    if (includeSample) {
      entry.sample = [];
      const documents = coll.find({}).limit(defaultLimit).toArray();
      for (const document of documents) {
        const preview = fitDocument(document);
        const nextResult = { ...resultBase, collections: [...collections, { ...entry, sample: [...entry.sample, preview] }], truncated: false };
        if (jsonSize(nextResult) > maxBytes) {
          entry.truncated = true;
          break;
        }
        entry.sample.push(preview);
      }
    }
    collections.push(entry);
    if (includeSample && jsonSize({ ...resultBase, collections, truncated: false }) > maxBytes) {
      collections.pop();
      collections.push({ name, count: entry.count, sample: [], truncated: true, ...collectionStats(name) });
      return { ...resultBase, collections, truncated: true };
    }
  }
  return { ...resultBase, collections, truncated: false };
};

if (operation === "preview") {
  printResult(listCollections(true));
} else if (operation === "collections") {
  printResult({ database: db.getName(), collections: listCollections(false).collections });
} else if (operation === "search") {
  const coll = collection();
  const page = pageValue();
  const limit = limitValue();
  const filter = normalizeFilter(payload.filter, true);
  const sort = normalizeSort(payload.sort);
  const total = coll.countDocuments(filter);
  const documents = coll.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).toArray();
  printResult({ collection: payload.collection, page, limit, total, documents });
} else if (operation === "insert") {
  const coll = collection();
  if (!Array.isArray(payload.documents) || payload.documents.length === 0) {
    fail("Documents must be a non-empty JSON array.");
  }
  const documents = payload.documents.map((document) => normalizeMongoValue(document, ""));
  if (!documents.every(isPlainObject)) {
    fail("Each document must be a JSON object.");
  }
  const writeResult = documents.length === 1 ? coll.insertOne(documents[0]) : coll.insertMany(documents);
  const insertedIds = writeResult.insertedIds ? Object.values(writeResult.insertedIds) : [writeResult.insertedId].filter(Boolean);
  printResult({ insertedCount: writeResult.insertedCount ?? insertedIds.length, insertedIds });
} else if (operation === "delete") {
  if (payload.confirm !== true) {
    fail("Delete requires confirmation.");
  }
  const coll = collection();
  const filter = normalizeFilter(payload.filter, payload.allowEmptyFilter === true);
  const many = payload.many === true;
  const matchedCount = many ? coll.countDocuments(filter) : Math.min(1, coll.countDocuments(filter));
  const writeResult = many ? coll.deleteMany(filter) : coll.deleteOne(filter);
  printResult({ matchedCount, deletedCount: writeResult.deletedCount ?? 0 });
} else if (operation === "update") {
  if (payload.confirm !== true) {
    fail("Update requires confirmation.");
  }
  const coll = collection();
  const filter = normalizeFilter(payload.filter, payload.allowEmptyFilter === true);
  const update = normalizeUpdate(payload.update);
  const many = payload.many === true;
  const writeResult = many ? coll.updateMany(filter, update) : coll.updateOne(filter, update);
  printResult({ matchedCount: writeResult.matchedCount ?? 0, modifiedCount: writeResult.modifiedCount ?? 0 });
} else {
  fail("Unsupported Mongo operation: " + operation);
}
MONGO_JS

docker exec -i "$container_id" sh -c '
set -eu
database="$1"
script_file="$(mktemp)"
cat > "$script_file"
set +e
mongosh --quiet "$database" "$script_file"
status="$?"
set -e
rm -f "$script_file"
exit "$status"
' sh "$database" < "$mongo_script"

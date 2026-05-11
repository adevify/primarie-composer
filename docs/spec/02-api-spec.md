# 02 API Spec

## Chapter 2.1 Runtime

The API is an Express application in `apps/api/src/main.ts`.

Runtime behavior:

- Enables `trust proxy` with value `1`.
- Uses Helmet.
- Parses JSON bodies with a `25mb` limit.
- Enables CORS for `http://localhost:5173`, `http://127.0.0.1:5173`, and `https://prmr.md`.
- Connects to MongoDB at process startup.
- Ensures lifecycle action indexes at startup.
- Listens on port `80` inside the container/process.
- Handles `SIGTERM` and `SIGINT` by closing MongoDB and the HTTP server.

## Chapter 2.2 Health Route

`GET /health`

Returns:

```json
{
  "ok": true,
  "service": "primarie-composer-api",
  "actionBus": {
    "ready": true,
    "pipePath": "/bus/actions.pipe",
    "resultsDir": "/bus/results",
    "workerReadyPath": "/bus/worker.ready"
  }
}
```

The action bus is considered ready only if the FIFO pipe, results directory, and worker ready file exist.

## Chapter 2.3 Auth Routes

Mounted under `/auth`.

### Chapter 2.3.1 POST /auth/login

Body:

```json
{
  "email": "operator@example.com",
  "password": "secret"
}
```

Validation:

- `email` must be an email address.
- `password` must be non-empty.
- User must exist in MongoDB collection `users`.
- Password is checked with bcrypt.

Success response:

```json
{
  "accessToken": "...",
  "tokenType": "Bearer",
  "expiresIn": "12h",
  "user": {
    "email": "operator@example.com",
    "name": "Operator"
  }
}
```

Rate limit:

- 10 requests per 60 seconds.
- Standard rate limit headers enabled.

### Chapter 2.3.2 GET /auth/users

Requires JWT.

Returns public central users without password hashes, plus inferred role/status/provisioned-at fields.

### Chapter 2.3.3 GET /auth/me

Requires JWT.

Returns:

```json
{
  "user": {
    "email": "operator@example.com",
    "name": "Operator"
  }
}
```

### Chapter 2.3.4 POST /auth/refresh

Requires JWT. Returns a new access token for the current JWT user payload.

### Chapter 2.3.5 POST /auth/logout

Requires JWT. Returns HTTP 204. No server-side token invalidation is implemented.

### Chapter 2.3.6 GET /auth/verify

Reads the bearer token and verifies it. Returns `{ "ok": true, "user": payload }` or HTTP 401 with `{ "ok": false }`.

## Chapter 2.4 JWT Middleware

All `/environments/*` routes require `Authorization: Bearer {token}`.

JWT payload is converted to:

```ts
{
  email: string;
  name: string;
}
```

Fallbacks:

- Missing email becomes `"[EMAIL_ADDRESS]"`.
- Missing name becomes `"Electron operator"`.

## Chapter 2.5 Proxy Authorization Route

Mounted under `/proxy`.

### Chapter 2.5.1 GET /proxy/authorize

Used by Nginx `auth_request`.

Input headers:

- `X-Original-Host`: preferred host to authorize.
- `Host`: fallback host.
- `X-Request-Id`: optional request id for logs.

Host format:

```text
{subdomain}-{environmentKey}.{ROOT_DOMAIN}
```

Example:

```text
admin-magic-rocket.prmr.md
```

Authorization rules:

- Host must be under `ROOT_DOMAIN`.
- Host must contain exactly one pre-root DNS label.
- The first hyphen separates service subdomain from environment key.
- Environment key must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- Environment record must exist.
- Environment status must be `running`.

Success response:

- HTTP 204.
- Headers:
  - `x-environment-key`
  - `x-environment-port`
  - `x-environment-subdomain`
  - `x-upstream-host`
  - `x-service-host`

Failure responses:

- 403 for missing/malformed/out-of-domain hosts.
- 404 for unknown environments.
- 503 for existing but non-running environments.

## Chapter 2.6 Environment DTOs

Create body:

```ts
{
  seed?: string;
  source: {
    branch: string;
    commit: string;
    repoPath?: string;
  };
  env?: Record<string, string>;
}
```

Create validation:

- `seed` defaults to `default`.
- `seed` must match `^[a-zA-Z0-9_-]+$`.
- `source.branch` is required.
- `source.commit` must be at least 7 characters.
- `env` defaults to `{}`.

Changed file payload:

```ts
{
  path: string;
  status: "modified" | "added" | "deleted";
  contentBase64?: string;
}
```

Sync body:

```ts
{
  branch: string;
  commit: string;
  files: ChangedFilePayload[];
}
```

Pull request reference:

```ts
{
  title?: string;
  url: string;
}
```

## Chapter 2.7 Environment Routes

All routes in this chapter are mounted under `/environments` and require JWT.

### Chapter 2.7.1 POST /environments

Creates an environment record and starts background preparation.

Success:

- HTTP 201.
- Returns the new `EnvironmentRecord` with status initially `creating`.

Current creation does not accept a client-provided key and does not start Docker Compose.

### Chapter 2.7.2 GET /environments

Returns all environment records as an array.

### Chapter 2.7.3 GET /environments/logs/all

Query params:

- `page`, default `0`.
- `perPage`, default `100`.

Returns paginated system log records from the shared `logs` collection.

This is a cross-environment activity feed. It must be backed by the shared `logs` collection.

### Chapter 2.7.4 GET /environments/system/metrics

Returns CPU, memory, and storage metrics for the API host/container context.

CPU is sampled from `os.cpus()`. Storage is read from `df -k {RUNTIME_DIR}`.

### Chapter 2.7.5 GET /environments/actions/:id

Returns one lifecycle action record by id.

### Chapter 2.7.6 GET /environments/actions/:id/logs

Returns lines from the lifecycle action's attached log file.

Query params:

- `cursor`, optional opaque cursor returned by the previous response.
- `limit`, default `200`.

Behavior:

- The first request reads the latest tail segment from the log file.
- Follow-up requests use `cursor` to move upward to older log segments until `hasMore` is false.
- The endpoint must not query MongoDB log rows.
- Lines should be returned in chronological order inside each page for terminal display, even though paging starts from the newest segment.

Response shape:

```ts
{
  actionId: string;
  cursor?: string;
  nextCursor?: string;
  hasMore: boolean;
  items: Array<{
    line: string;
    level?: "info" | "error";
    byteStart?: number;
    byteEnd?: number;
    createdAt?: string;
  }>;
}
```

### Chapter 2.7.7 GET /environments/actions/:id/logs/stream

Streams appended lines from the lifecycle action's attached log file as newline-delimited JSON.

Query params:

- `from`, optional byte offset. When absent, the stream starts at the current file end unless `replayTail` is provided.
- `replayTail`, optional number of lines to emit before following.

Event shapes:

```json
{ "type": "line", "line": "...", "level": "info", "byteStart": 120, "byteEnd": 180 }
{ "type": "action", "action": {} }
{ "type": "complete" }
{ "type": "error", "message": "..." }
```

The endpoint follows the log file in `tail -f` style until the action reaches `complete` or `error`, the client disconnects, or the server closes the stream.

### Chapter 2.7.8 GET /environments/:key

Returns one environment record or HTTP 404.

### Chapter 2.7.9 GET /environments/:key/logs

Returns paginated system log records filtered by `environmentKey`.

Query params:

- `page`, default `0`.
- `perPage`, default `50`.

### Chapter 2.7.10 GET /environments/:key/containers

Publishes `environment.containers.inspect` and returns parsed container JSON.

### Chapter 2.7.11 GET /environments/:key/files

Lists files in the host runtime environment directory.

Query params:

- `path`, default `/`.

The API resolves the path inside `RUNTIME_DIR/{key}` and rejects traversal outside that root.

### Chapter 2.7.12 GET /environments/:key/mongo

Publishes `environment.mongo.inspect` and returns Mongo preview JSON.

### Chapter 2.7.13 GET /environments/:key/compose/logs

Publishes `environment.compose.logs` and returns paginated log tail lines as `{ log, level }`.

### Chapter 2.7.14 GET /environments/:key/compose/logs/stream

Streams Compose log lines as NDJSON events.

Current implementation fetches a tail through the bus and emits it, then completes. It is not a true long-running `docker logs --follow` stream in the active bus path.

### Chapter 2.7.15 GET /environments/:key/actions

Returns paginated lifecycle actions for one environment.

Query params:

- `page`, default `0`.
- `perPage`, default `20`.

### Chapter 2.7.16 GET /environments/:key/actions/:action/stream

Valid `action` values:

- `start`
- `stop`
- `restart`
- `resume`

Runs the lifecycle action directly and streams live NDJSON events. The UI currently uses the queued action route instead.

If this direct streaming route remains, it should still write to an action log file or be treated as a non-persistent convenience endpoint. It should not create MongoDB action log rows.

### Chapter 2.7.17 POST /environments/:key/actions/:action

Queues a lifecycle action record and starts a background job.

Success:

- HTTP 202.
- Returns the action record.

The background job writes its execution transcript to the action's attached log file and updates action status to `complete` or `error`.

### Chapter 2.7.18 GET /environments/:key/containers/:container/files

Lists files in a running container.

Container name validation: `^[a-zA-Z0-9_.-]+$`.

Query params:

- `path`, default `/`.

### Chapter 2.7.19 GET /environments/:key/containers/:container/logs/stream

Streams a container log tail as NDJSON events.

Current active script returns a finite `docker logs --tail` output, so the API emits those lines and completes.

### Chapter 2.7.20 POST /environments/:key/containers/:container/exec

Body:

```json
{
  "command": "pwd && ls -la"
}
```

Publishes `environment.container.exec` and returns:

```ts
{
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}
```

### Chapter 2.7.21 POST /environments/:key/stop

Synchronously publishes `environment.stop` and marks status `stopped`.

### Chapter 2.7.22 POST /environments/:key/resume

Only the owner can resume a manually created environment. Publishes `environment.start` if not already running and marks status `running`.

### Chapter 2.7.23 POST /environments/:key/start

Synchronously publishes `environment.start` and marks status `running`.

### Chapter 2.7.24 POST /environments/:key/restart

Synchronously publishes `environment.restart` and marks status `running`.

### Chapter 2.7.25 POST /environments/:key/sync-files

Publishes `environment.files.sync` with branch, commit, and changed files.

### Chapter 2.7.26 POST /environments/:key/sync

Alias for `/sync-files`.

### Chapter 2.7.27 DELETE /environments/:key

Publishes `environment.remove`, marks status `removed`, deletes the environment record, and returns HTTP 204.

### Chapter 2.7.28 POST /environments/github/webhook

Handles GitHub `pull_request` events.

Current behavior:

- Ignores non-`pull_request` events with HTTP 204.
- For `opened`, `reopened`, and `synchronize`, deletes the previous PR environment if found and creates a new one with seed `default`.
- For `closed`, deletes matching PR environments.
- Pull request identity is `{ title, url }`.
- Source is `{ branch: pr.head.ref, commit: pr.head.sha }`.

Because this route is mounted under `/environments`, it currently requires JWT like the rest of the environment API.

## Chapter 2.8 Error Handling

The global error handler reads `error.status` when present and returns:

```json
{
  "error": "message"
}
```

Status defaults to 500 if missing or invalid.

Zod validation errors return HTTP 400 with flattened error details.

## Chapter 2.9 Logging

The API logs structured JSON to stdout/stderr for scopes:

- `api`
- `proxy.authorize`
- `environments`
- `host-action-bus`

System-level activity logs are persisted in MongoDB collection `logs`.

Lifecycle action execution transcripts are attached as files on their action records. They are not stored in MongoDB as log rows.

System log events should be written for environment lifecycle and automation changes, including create, prepare, start, resume, stop, restart, remove, file sync update, PR update, PR merge/close cleanup, and failure.

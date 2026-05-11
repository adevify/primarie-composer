# 03 Data Models

## Chapter 3.1 MongoDB Connection

The API connects to MongoDB using:

```ts
mongodb://db
```

All central API collections are stored in database:

```text
primarie
```

The helper `collection(name)` currently calls `connect()` before returning a collection, even though startup also calls `connect()`.

## Chapter 3.2 EnvironmentRecord

Collection:

```text
environments
```

Type:

```ts
{
  key: string;
  port: number;
  status: EnvironmentStatus;
  seed: string;
  createdBy: EnvironmentOwner | PullRequestRef;
  source: EnvironmentSource;
  createdAt: Date;
  updatedAt: Date;
}
```

Environment status:

```ts
"creating"
| "cloning"
| "checking_out"
| "applying_changes"
| "starting"
| "running"
| "stopped"
| "failed"
| "removing"
| "removed"
```

Environment source:

```ts
{
  branch: string;
  commit: string;
  repoPath?: string;
}
```

Manual owner:

```ts
{
  email: string;
  name: string;
}
```

Pull request owner/reference:

```ts
{
  title?: string;
  url: string;
}
```

## Chapter 3.3 Environment Collection Operations

Operations:

- `get(key)`: returns one record or throws HTTP 404.
- `getSilent(key)`: returns one record or `null`.
- `list()`: returns all records.
- `create(record)`: inserts record with fresh `createdAt` and `updatedAt`.
- `update(key, mutator)`: reads current record, merges the mutator patch, updates `updatedAt`, and returns the updated record.
- `delete(key)`: deletes one record.

No explicit indexes are created for `environments` in source.

## Chapter 3.4 SystemLogRecord

Collection:

```text
logs
```

Type:

```ts
{
  id: string;
  createdAt: Date;
  level: "info" | "error" | "warn";
  event: string;
  message: string;
  source: "api" | "worker" | "electron" | "github" | "system";
  actor?: {
    type: "user" | "system" | "github";
    email?: string;
    name?: string;
    url?: string;
  };
  target?: {
    type: "environment" | "pull_request" | "system";
    environmentKey?: string;
    pullRequestUrl?: string;
  };
  environmentKey?: string;
  actionId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}
```

This replaces any environment-specific log model. System activity should be written only to the shared `logs` collection.

Expected event names include:

- `environment.created`
- `environment.prepare_started`
- `environment.prepared`
- `environment.started`
- `environment.resumed`
- `environment.stopped`
- `environment.restarted`
- `environment.removed`
- `environment.failed`
- `environment.files_synced`
- `environment.pr_updated`
- `environment.pr_removed`

Defaults and write rules:

- `level`: `info`
- `createdAt`: current date
- `source`: one of the known system sources
- `environmentKey`: copied from `target.environmentKey` when the target is an environment, so dashboard and detail queries can filter efficiently

List operations:

- `add(record)`: creates one system log record.
- `list(filters, page, perPage)`: newest first across all system logs.
- `listByEnvironment(environmentKey, page, perPage)`: newest first for one environment key, backed by the same `logs` collection.

Recommended indexes:

- `{ createdAt: -1 }`
- `{ environmentKey: 1, createdAt: -1 }`
- `{ event: 1, createdAt: -1 }`
- `{ "actor.email": 1, createdAt: -1 }`
- `{ "target.pullRequestUrl": 1, createdAt: -1 }`
- `{ correlationId: 1, createdAt: -1 }`

## Chapter 3.5 EnvironmentActionRecord

Collection:

```text
environment-actions
```

Type:

```ts
{
  id: string;
  environmentKey: string;
  action: "start" | "stop" | "restart" | "resume";
  status: "queued" | "running" | "complete" | "error";
  requestedBy?: {
    email: string;
    name: string;
  };
  logFile: {
    path: string;
    driver: "file";
    createdAt: Date;
    updatedAt?: Date;
    sizeBytes?: number;
  };
  environment?: unknown;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}
```

Indexes ensured at startup:

- `{ id: 1 }`, unique.
- `{ environmentKey: 1, createdAt: -1 }`.

Creation rule:

- The API must create or reserve the `logFile` attachment before the action moves from `queued` to `running`.
- Worker output for the action must append to this file.
- Action status and summary fields stay in MongoDB; verbose execution output stays in the file.

## Chapter 3.6 Action Log File Attachment

There should not be an `EnvironmentActionLog` model and there should not be an `environment-action-logs` collection.

Each `EnvironmentActionRecord` owns a file-backed execution transcript through its `logFile` property.

Recommended file location:

```text
{BUS_LOGS_DIR}/{actionId}.log
```

The stored `logFile.path` should be treated as internal server/worker state. The Electron app should not read the host path directly; it should ask the API to tail or follow the log file.

Line format:

```ts
{
  actionId: string;
  line: string;
  level: "info" | "error";
  byteStart?: number;
  byteEnd?: number;
  createdAt?: Date;
}
```

The line shape above is an API projection of file contents, not a MongoDB document.

Lazy loading behavior:

- The first API read starts from the end of the file and returns the newest tail segment.
- The client can request older segments by passing the returned cursor.
- Pagination moves upward through the file until no older content remains.
- Lines should be delivered in chronological order within each returned segment so the terminal view can render naturally.

Streaming behavior:

- The streaming endpoint follows the file in `tail -f` style.
- The stream emits appended lines as they are written.
- The stream ends when the action reaches `complete` or `error`, or when the client disconnects.

Retention:

- Action log files should be removed when their environment/action retention policy removes the owning action.
- Delete environment should remove the runtime action logs associated with that environment unless a configured audit retention policy says otherwise.

## Chapter 3.7 UserRecord

Collection:

```text
users
```

Type:

```ts
{
  email: string;
  name: string;
  password: string;
}
```

`password` is a bcrypt hash.

Public user projection removes `password` and adds inferred display fields:

```ts
{
  email: string;
  name: string;
  provisionedAt?: Date;
  role?: string;
  status?: "online" | "idle" | "locked";
}
```

Role inference:

- First user, or email containing `admin`/`root`: `ROOT_SYSTEM`.
- Email containing `guest`/`external`: `READ_ONLY`.
- Otherwise: `DEV_ENGINEER`.

Status inference cycles through:

```text
online, idle, locked, online
```

Fallback `provisionedAt` starts at `2024-01-01T00:00:00.000Z` and subtracts 17 days per user index.

## Chapter 3.8 Host Action Result

The API bus service expects result files shaped as:

```ts
{
  id: string;
  status: "success" | "error";
  message: string;
  output?: string;
  finishedAt?: string;
}
```

Result files are stored by the worker at:

```text
{BUS_RESULTS_DIR}/{actionId}.json
```

Result files may be deleted after the API consumes them.

Lifecycle action log attachments are different: they must persist after action completion so Electron can lazy-load older tail segments and inspect completed action transcripts.

## Chapter 3.9 Environment Seed Data

Seed JSON files under `seeds/{seed}` are not central API records. They are imported into prepared MongoDB data folders for generated environments.

The default seed contains:

- `users.json`
- `settings.json`
- `tenants.json`

These seed users are not the same as central API auth users.

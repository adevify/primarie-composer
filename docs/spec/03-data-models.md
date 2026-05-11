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

## Chapter 3.4 EnvironmentLog

Collection:

```text
environments-logs
```

Type:

```ts
{
  environmentKey: string;
  createdAt: Date;
  log: string;
  level: "info" | "error" | "warn";
  system: boolean;
}
```

Defaults on insert:

- `level`: `info`
- `system`: `false`
- `createdAt`: current date

List operations:

- `list(key, page, perPage)`: newest first for one environment.
- `listAll(page, perPage)`: newest first across all environments.

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

## Chapter 3.6 EnvironmentActionLog

Collection:

```text
environment-action-logs
```

Type:

```ts
{
  actionId: string;
  environmentKey: string;
  createdAt: Date;
  sequence: number;
  log: string;
  level: "info" | "error";
}
```

Sequence behavior:

- `sequence` is assigned by counting existing logs for the action.
- Logs are streamed and listed in ascending sequence order.

Index ensured at startup:

- `{ actionId: 1, sequence: 1 }`, unique.

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

The API deletes result and log files after reading them.

## Chapter 3.9 Environment Seed Data

Seed JSON files under `seeds/{seed}` are not central API records. They are imported into prepared MongoDB data folders for generated environments.

The default seed contains:

- `users.json`
- `settings.json`
- `tenants.json`

These seed users are not the same as central API auth users.


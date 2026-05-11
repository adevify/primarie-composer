# 09 Observed Gaps And Review Notes

## Chapter 9.1 Existing README Drift

The root README describes several older behaviors:

- API as file-backed through `runtime/environments.json`; current code uses MongoDB.
- Login body with `accessKey` and `operatorName`; current code uses email/password.
- Create payload with `key`, `tenants`, `dirty`, and `changedFiles`; current create DTO only accepts `seed`, `source`, and `env`.
- Create flow that starts Docker Compose immediately; current create prepares and ends as `stopped`.
- Environment hostnames with underscores; current proxy parser and UI use hyphens.
- Routes such as `/reuse`, `/pr/update`, and `/pr/merged`; current code uses `/resume` and `/github/webhook`.
- API listening on `localhost:3000`; current source listens on port `80`.
- API mounting Docker socket; current central Compose uses host FIFO bus instead.

## Chapter 9.2 Electron README Drift

`apps/electron/README.md` says the login default API base URL is `http://localhost`, but `LoginView.tsx` defaults to:

```text
https://prmr.md
```

It also describes creation as starting and running the environment, while current API creation prepares a stopped environment.

## Chapter 9.3 Dockerfile Port Mismatch

`apps/api/Dockerfile` declares:

```text
EXPOSE 3000
```

Current API source listens on:

```ts
app.listen(80)
```

Root `.env.example` includes `API_PORT=3000`, but the current API source does not read `API_PORT`.

## Chapter 9.4 Template Artifact Removal

Remove all environment template artifacts from the desired system.

Removal scope:

- `templates/environment`
- template mock files
- central Compose `./templates` mount
- API env vars `TEMPLATE_DIR` and `HOST_TEMPLATE_DIR`
- API config fields for templates
- README/spec references that describe templates as supported runtime artifacts

Environment preparation should use the configured source repository and generated runtime data only.

## Chapter 9.5 Seed Runtime Path

Current `prepare-seeds.sh` creates prepared MongoDB data folders at:

```text
seeds/{seed}/mongodb
```

Current `prepare-env.sh` copies this into:

```text
runtime/environments/{key}/data/mongodb
```

Because templates are removed, seed handling should align only with the cloned source repository's expected runtime paths.

## Chapter 9.6 Remove Unused TypeScript Services

Remove these unused service classes from the desired API source:

- `DockerComposeService`
- `GitRepositoryService`
- `SeedService`
- `MongoSeedDumpService`

Also remove unused helper methods from `EnvironmentsService`, including `writeEnvironmentFile`, `composeConfig`, and `composeLogger`, unless a reviewed implementation path explicitly reuses them.

## Chapter 9.7 Login Missing User Status

`UserCollection.get(email)` throws HTTP 404 when a user is not found. `POST /auth/login` expects a missing user to produce a generic HTTP 401, but the thrown 404 bypasses that branch.

Current likely result for unknown email:

```json
{
  "error": "User not found: {email}"
}
```

This differs from the intended generic invalid-credentials response.

## Chapter 9.8 Central Auth Users Not Seeded

No script currently provisions central API users with bcrypt password hashes. The default seed users are for generated environment data, not central Composer authentication.

Review question: should there be a central bootstrap/admin user flow?

## Chapter 9.9 Environment Sync Record Update

`syncFiles` updates top-level `branch` and `commit` fields on the record:

```ts
return {
  ...record,
  branch: input.branch,
  commit: input.commit,
};
```

`EnvironmentRecord` does not define top-level `branch` or `commit`; it defines `source.branch` and `source.commit`. The Electron UI reads `environment.source.branch` and `environment.source.commit`, so sync may not update visible source metadata.

## Chapter 9.10 GitHub Webhook Authentication

`POST /environments/github/webhook` is mounted behind `authenticateJwt` because all environment routes use JWT middleware. Standard GitHub webhooks will not include this bearer token unless custom proxying is added.

Review question: should webhook authentication use GitHub signatures instead of API JWT?

## Chapter 9.11 GitHub Closed Event Error Path

`deletePullRequestEnvironments` calls `identifyPrEnvironment`, which throws 404 when no matching PR environment exists. For a GitHub `closed` webhook without a current environment, the route can return an error instead of idempotent 204.

## Chapter 9.12 Generated Environment Key Behavior

Environment keys are chosen randomly from a fixed name list. There is no client-provided key in the current create DTO.

The generator attempts as many times as the list length, but each attempt is random. It can theoretically fail even if unused names still exist.

## Chapter 9.13 Lifecycle Lock Coverage

The worker locks start, stop, restart, container inspection, and Mongo inspection. Prepare, sync, remove, container logs, container files, and container exec are not locked.

Review question: should remove/sync/prepare also lock per environment?

## Chapter 9.14 Streaming Is Mostly Finite Tail

API route names include `/stream`, but active worker scripts for Compose and container logs return finite tails. The API emits those tail lines as NDJSON and completes.

Review question: should these become true follow streams, or should the UI/API names say tail?

## Chapter 9.15 Environments Page Filters

The current Environments page uses tabs/filters, and the `mine` filter tab currently behaves the same as `all`.

Desired behavior: group manual environments by owner, with the authenticated current user's environments first under `Me`, other users after that, and PR-backed environments grouped separately by pull request.

## Chapter 9.16 UI Placeholder Data

Several UI values are hard-coded, inferred, or cosmetic:

- Sidebar brand text `ELECTRO_TERMINAL` and `v1.0.4-stable`.
- Dashboard node label `DOCKER-PRODUCTION-CLUSTER-01`.
- Environment container counts such as `8/8`, `1/4`, and `0/4`.
- Environment details fallback uptime `42h 12m`.
- Users page last auth labels.
- Users page create/edit/disable/delete buttons.
- Users page global activity feed.
- Environments page uptime `142h 12m`.

Review question: should these be removed, wired to real API data, or kept as visual placeholders?

## Chapter 9.17 Security Review Targets

High-impact surfaces to review:

- `POST /environments/:key/containers/:container/exec` runs arbitrary shell inside containers.
- Runtime and container file browsing expose filesystem content.
- Mongo inspection exposes sample documents.
- JWTs are stored in renderer localStorage.
- DevTools open automatically.
- Host bus FIFO accepts JSON actions from writers with filesystem access.
- Worker can remove runtime directories and can use passwordless sudo if available.

## Chapter 9.18 Type And Response Shape Drift

Potential type/shape mismatches:

- `/auth/verify` returns raw JWT payload as `user`; Electron only checks request success and does not use the returned shape.
- README examples include `domains` and `config` in environment create responses; current `EnvironmentRecord` does not include those fields.

## Chapter 9.19 Action Log Storage Migration

The desired data model attaches a file log to each lifecycle action. Electron should read the latest tail segment first, lazy-load older file segments while scrolling upward, and stream live output with `tail -f` behavior.

Current code still stores action log rows in MongoDB through `EnvironmentActionCollection.addLog` and `environment-action-logs`. That should be replaced with file-backed reads and streams.

## Chapter 9.20 Build Artifacts In Local Workspace

The local workspace contains ignored generated artifacts:

- `apps/api/dist`
- `apps/electron/out`
- `runtime/db`
- `runtime/environments/*`
- `proxy/ssl/*`

These should usually not be reviewed as source unless the task is specifically about local runtime state.

## Chapter 9.21 Logs Collection Migration

The desired data model uses one shared `logs` collection for system-level activity events.

Current code still contains `EnvironmentLogCollection` backed by `environments-logs`. That should be replaced by a system log collection capable of storing events such as environment created, resumed, stopped, removed, started, file-sync updated, PR updated, and PR cleanup.

## Chapter 9.22 Worker Sleep Delay

The worker runner should not let a fixed `sleep` delay action completion after output/result data has arrived.

Expected behavior: wait for the default close timeout only during quiet periods when nothing is fired, but close as soon as possible once logs, result data, or process completion is available.

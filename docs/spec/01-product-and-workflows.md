# 01 Product And Workflows

## Chapter 1.1 Product Intent

Primarie Composer provides a local/operator control surface for isolated Primarie environments. An operator selects a Git repository and asks the central API to prepare an environment from a branch and commit. The API records metadata in MongoDB and delegates filesystem, Git, Docker Compose, and inspection work to a host-side Bash worker.

## Chapter 1.2 Actors

- Operator: authenticated human using the Electron app.
- Electron main process: trusted local process for filesystem dialogs, Git commands, and file watching.
- Electron renderer: React UI and API client.
- Central API: authenticated HTTP API for auth, environment metadata, lifecycle actions, system logs, metrics, and proxy authorization.
- MongoDB: central persistence for users, environment records, system logs, and lifecycle actions.
- Host action worker: Bash FIFO worker that performs privileged host operations.
- Central Nginx proxy: routes public hostnames to running environment ports after asking the API.
- Environment Compose project: cloned target repo plus `.env`, seed data, and containers.
- GitHub webhook source: optional PR automation caller, currently mounted behind JWT middleware.

## Chapter 1.3 Login Workflow

1. The renderer shows `LoginView`.
2. The operator enters API base URL, email, and password.
3. `ComposerApiClient.login` posts to `/auth/login`.
4. The API validates email/password against the central MongoDB `users` collection.
5. The API returns a JWT access token, token type, expiry string, and public user payload.
6. The renderer stores the session JSON in `localStorage` under `primarie-composer.auth`.
7. On later startup, the renderer calls `/auth/verify`; if valid, it restores the session.

## Chapter 1.4 Repository Selection Workflow

1. The operator clicks the repository picker.
2. Electron main opens a native directory dialog.
3. The selected path must contain `.git`.
4. The path is stored in `localStorage` under `primarie-composer.repoPath`.
5. Git status is read with `git rev-parse --abbrev-ref HEAD`, `git rev-parse HEAD`, and `git status --porcelain`.
6. The renderer displays branch, commit, dirty state, and changed file names.

## Chapter 1.5 Environment Creation Workflow

Current implementation flow:

1. The operator opens the create dialog from the Environments page.
2. Electron reads `.env` from the selected repo, falling back to `.env.example`.
3. The create dialog displays editable env variable values.
4. The renderer refreshes Git state.
5. The renderer posts `seed`, `source.branch`, `source.commit`, and `env` to `POST /environments`.
6. The API generates a random key from an internal name list.
7. The API validates that `seeds/{seed}/mongodb` exists.
8. The API picks the next available local port from `BASE_ENV_PORT`.
9. The API creates an environment record with status `creating`.
10. The API writes a system log event such as `environment.created`.
11. The API returns the new record immediately with HTTP 201.
12. In the background, the API publishes `environment.prepare` to the host action bus.
13. The host worker runs `scripts/prepare-env.sh`.
14. The worker clones `SOURCE_REPO_URL` into the runtime path, checks out `origin/{branch}`, resets to `{commit}`, patches the repo for Composer compatibility, copies seed data, and writes `.env`.
15. The API records bus output and marks the environment `stopped` on success.
16. The renderer polls the environment and system logs filtered by environment key until preparation exits `creating`, `cloning`, or `checking_out`.
17. The renderer closes the create dialog, opens environment details, and sets the environment as the active sync target.

Important: current creation prepares the environment but does not start it. Start is a separate lifecycle action.

## Chapter 1.6 Lifecycle Workflow

Lifecycle actions are exposed in two forms:

- Direct routes: `/environments/:key/start`, `/stop`, `/restart`, `/resume`.
- Queued action routes: `/environments/:key/actions/:action`, with a file-backed log attachment and NDJSON tail streaming.

The Electron UI primarily uses queued actions for `start`, `stop`, `restart`, `resume`, and `delete`, then reads or streams the action's attached log file through `/environments/actions/:id/logs` and `/environments/actions/:id/logs/stream`.

Start/resume:

1. API verifies the environment exists.
2. `resume` additionally requires the authenticated user to own the environment.
3. API marks status `starting`.
4. API publishes `environment.start`.
5. Worker runs `scripts/start-env.sh`.
6. Worker builds and starts Docker Compose, checks the proxy service, and waits for proxy reachability.
7. API marks status `running`.

Stop:

1. API publishes `environment.stop`.
2. Worker runs `scripts/stop-env.sh`.
3. API marks status `stopped`.

Restart:

1. API marks status `starting`.
2. API publishes `environment.restart`.

Delete:

1. API marks status `removing`.
2. API publishes `environment.remove`.
3. Worker runs `scripts/remove-env.sh`.
4. API marks status `removed` and deletes the environment record after the action record has captured the removed environment snapshot.
3. Worker runs `scripts/restart-env.sh`.
4. API marks status `running`.

Delete:

1. API marks status `removing`.
2. API publishes `environment.remove`.
3. Worker runs `scripts/remove-env.sh`.
4. API marks status `removed`.
5. API deletes the environment record from MongoDB.

## Chapter 1.7 Continuous Sync Workflow

1. The operator selects an active environment.
2. The operator starts sync from the sidebar.
3. Electron main starts a chokidar watcher and a 1-second Git-state poller.
4. On file changes or Git-state changes, Electron reads Git status and builds a binary Git patch.
5. Ignored folders/files are excluded from the temporary patch index.
6. Normal sync posts a delta from the last acknowledged patch; force sync posts the full patch.
7. The renderer posts the patch to `/environments/:key/sync-files`.
8. The API publishes `environment.files.sync`.
9. The worker reconstructs the full patch, checks for baseline mismatches, runs `git apply --check`, and applies the patch only if it is clean.
11. The API writes a system log event such as `environment.files_synced`.

## Chapter 1.8 Inspection Workflow

Environment details include:

- Compose/container logs, fetched as tails and streamed as NDJSON events.
- Container list from `docker compose ps --format json`.
- Container filesystem browsing through `docker exec` and `find`.
- Runtime directory filesystem browsing through API filesystem reads.
- Container shell command execution through `docker exec`.
- MongoDB inspection through `mongosh`.
- Lifecycle action history and per-action attached log files.

## Chapter 1.9 System Log Workflow

System-level audit/activity events are stored in one `logs` collection rather than an environment-specific log collection.

The log stream should include events such as:

- Environment created.
- Environment prepared.
- Environment started.
- Environment resumed.
- Environment stopped.
- Environment restarted.
- Environment removed.
- Environment failed.
- Environment updated by file sync.
- Environment updated by pull request event.
- Environment removed by pull request merge/close event.

Each event can be filtered by environment key, actor, source, event name, lifecycle action id, or pull request metadata.

## Chapter 1.10 Proxy Routing Workflow

1. A public request enters the central Nginx proxy.
2. Nginx sends an internal auth request to `/proxy/authorize`.
3. The API parses a host like `admin-envkey.prmr.md`.
4. The API checks the environment record and requires status `running`.
5. The API returns routing headers including environment key, port, upstream host, and service host.
6. Nginx proxies the original request to `http://{upstream_host}:{environment_port}` with `Host` rewritten to `{subdomain}.{ROOT_DOMAIN}`.

## Chapter 1.11 Status Model

Environment statuses:

- `creating`
- `cloning`
- `checking_out`
- `applying_changes`
- `starting`
- `running`
- `stopped`
- `failed`
- `removing`
- `removed`

Current status usage:

- Create starts at `creating`, then moves to `cloning`, then `stopped` or `failed`.
- Sync sets `checking_out`.
- Start/restart/resume set `starting`, then `running`.
- Stop sets `stopped`.
- Delete sets `removing`, then `removed`, then removes the record.

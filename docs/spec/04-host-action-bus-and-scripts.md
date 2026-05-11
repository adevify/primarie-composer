# 04 Host Action Bus And Scripts

## Chapter 4.1 Bus Purpose

The current API delegates host-level work to a Bash FIFO bus instead of running Docker and Git commands directly in Node. This keeps privileged operations in host scripts while the API publishes typed JSON actions and waits for result files.

## Chapter 4.2 Bus Paths

API defaults:

- `BUS_PIPE_PATH`: `/bus/actions.pipe`
- `BUS_RESULTS_DIR`: `/bus/results`
- `BUS_LOGS_DIR`: `/bus/logs`
- `BUS_WORKER_READY_PATH`: `/bus/worker.ready`
- `BUS_ACTION_TIMEOUT_MS`: `120000`
- `BUS_POLL_INTERVAL_MS`: `200`

Central Compose mounts host `/opt/composer-bus` to API container `/bus`.

Worker defaults:

- `BUS_ROOT`: `/opt/composer-bus`
- `PIPE`: `$BUS_ROOT/actions.pipe`
- `RESULTS_DIR`: `$BUS_ROOT/results`
- `LOGS_DIR`: `$BUS_ROOT/logs`
- `LOCKS_DIR`: `$BUS_ROOT/locks`
- `READY_FILE`: `$BUS_ROOT/worker.ready`
- `MAX_RESULT_OUTPUT_BYTES`: `65536`
- `ACTION_HEARTBEAT_SECONDS`: `30`
- `MAX_PARALLEL_ACTIONS`: `4`

## Chapter 4.3 Published Action Shape

The API appends one JSON line per action:

```json
{
  "id": "uuid",
  "type": "environment.start",
  "payload": {
    "environment": "magic-rocket"
  },
  "createdAt": "2026-05-11T00:00:00.000Z"
}
```

Every published environment action also includes:

- `environment`
- `environmentPort`
- `proxyUpstreamHost`
- `runtimeRoot`
- `runtimePath`

Additional payload fields depend on action type.

## Chapter 4.4 Worker Result Shape

The worker writes:

```json
{
  "id": "uuid",
  "status": "success",
  "message": "Action completed",
  "output": "...",
  "finishedAt": "2026-05-11T00:00:00Z"
}
```

Output is truncated to the last `MAX_RESULT_OUTPUT_BYTES` when needed.

For lifecycle actions, the worker also writes the full execution transcript to the action's attached log file, normally:

```text
{LOGS_DIR}/{actionId}.log
```

That file must remain available after the worker writes the result so the API can support lazy tail reads and `tail -f` style streaming for Electron.

## Chapter 4.5 Worker Action Routing

Action type mapping:

- `environment.prepare`: `scripts/prepare-env.sh`
- `environment.files.sync`: `scripts/sync-files.sh`
- `environment.containers.inspect`: `scripts/inspect-containers.sh`
- `environment.compose.logs`: `scripts/compose-logs.sh`
- `environment.container.logs`: `scripts/container-logs.sh`
- `environment.container.files`: `scripts/container-files.sh`
- `environment.container.exec`: `scripts/container-exec.sh`
- `environment.mongo.inspect`: `scripts/mongo-inspect.sh`
- `environment.start`: `scripts/start-env.sh`
- `environment.stop`: `scripts/stop-env.sh`
- `environment.restart`: `scripts/restart-env.sh`
- `environment.remove`: `scripts/remove-env.sh`

Unknown action types return an error result.

## Chapter 4.6 Worker Locking

The worker locks these action types by environment:

- `environment.start`
- `environment.stop`
- `environment.restart`
- `environment.containers.inspect`
- `environment.mongo.inspect`

Lock conflicts return no-op success for most actions. Container inspection returns `[]`; Mongo inspection returns unavailable JSON.

Current unlocked action types include prepare, sync, remove, container logs, container files, and container exec.

## Chapter 4.7 Shared Script Helpers

`scripts/common.sh` defines:

- Environment name validation: `^[a-z0-9][a-z0-9-]*[a-z0-9]$`.
- `composer_root`, default `/opt/primarie-composer`.
- `runtime_root`, default `{composer_root}/runtime/environments`.
- Environment directory resolver.
- Compose project name resolver: `env_{environment-with-hyphens-as-underscores}`.
- Docker Compose command fallback between `docker compose` and `docker-compose`.
- Compose container lookup and service-running assertions.
- Container project ownership assertion.
- `.env` mutation helpers.
- proxy host env injection.
- repo patch helpers.
- TCP readiness probes from host or central proxy container.
- safe relative path validation for sync payloads.

Runner close timing:

- A running script should wait for the configured default close timeout only when no completion data, result data, or log/output data has been fired.
- If output data is being fired, or the child process/result file has completed, the runner should close the action as soon as possible.
- Fixed `sleep` intervals must not delay action completion after data arrives.
- Any wait loop should be interruptible or short-polling enough that fresh output/result data is handled immediately.
- The close timeout is a quiet-period fallback, not a minimum action duration.

## Chapter 4.8 Prepare Environment Script

`scripts/prepare-env.sh` receives a payload JSON file.

Inputs read from payload:

- `environment`
- `runtimePath`
- `sourceRepoUrl`
- `source.branch`
- `source.commit`
- `seedName`
- `hostSeedsDir`
- `environmentVariables`

Flow:

1. Validates environment name.
2. Removes the existing runtime path.
3. Clones `sourceRepoUrl` directly into `runtimePath`.
4. Fetches all branches.
5. Checks out `origin/{branch}`.
6. Resets hard to `{commit}`.
7. Applies Composer compatibility patches to the cloned repo.
8. Copies prepared seed data from `{hostSeedsDir}/{seedName}` into `{runtimePath}/data`.
9. Writes `{runtimePath}/.env` from `environmentVariables`.
10. Prints `Prepared {environment} at {runtimePath}`.

The script must not depend on any template directory. The runtime environment is the cloned source repository plus generated runtime data and `.env`.

## Chapter 4.9 Repo Patch Helpers

`patch_repo_for_composer` applies two targeted modifications when matching files exist:

- `proxy/Dockerfile`: injects Docker DNS resolver and rewrites certain `proxy_pass` lines to use variables for services such as `landing-adevify`, `api`, `media`, `admin`, `client`, and others.
- `docker-compose.yml`: adds a `/code/apps/storybook/node_modules` volume under the storybook service if missing.

These patches are applied during prepare, start, and restart.

## Chapter 4.10 Sync Files Script

`scripts/sync-files.sh` receives a payload JSON file.

Flow:

1. Validates environment name.
2. Reads runtime path, branch, commit, and file array.
3. Runs `git fetch --all --prune`.
4. Runs `git reset --hard`.
5. Runs `git clean -fd`.
6. Checks out `origin/{branch}`.
7. Resets hard to `{commit}`.
8. Applies each changed file:
   - deleted files are removed with `rm -f`.
   - added/modified files with `contentBase64` are decoded into place.
   - paths must be safe relative paths.
9. Prints `Synced {count} files into {environment}`.

## Chapter 4.11 Start Environment Script

`scripts/start-env.sh` arguments:

```text
start-env.sh {environment} {environmentPort} {proxyUpstreamHost}
```

Flow:

1. Validates environment name.
2. Resolves env directory and Compose project.
3. Ensures `.env` contains `HOST_1`, `HOST_2`, `ROOT_DOMAIN`, `ENV_KEY`, `ENV_PORT`, and `PROXY_EXTERNAL_PORT`.
4. Applies repo patches.
5. Reads `PROXY_EXTERNAL_PORT`.
6. Runs `docker compose build` with `COMPOSE_PROGRESS=plain`.
7. Runs `docker compose up -d --remove-orphans`.
8. Prints Compose services.
9. Requires Compose service `proxy` to be running.
10. Waits for the central proxy to reach `{proxyUpstreamHost}:{PROXY_EXTERNAL_PORT}`.

## Chapter 4.12 Stop Restart Remove Scripts

`scripts/stop-env.sh`:

- Runs `docker compose stop` in the runtime folder.

`scripts/restart-env.sh`:

- Ensures proxy host env values.
- Applies repo patches.
- Runs `docker compose up -d --remove-orphans`.
- Requires the `proxy` service.
- Waits for proxy reachability.

`scripts/remove-env.sh`:

- Runs `docker compose down --remove-orphans` if the runtime directory exists.
- Deletes the runtime directory.
- Retries with relaxed permissions.
- Uses passwordless `sudo rm -rf` only if normal deletion still fails and `sudo -n true` succeeds.

## Chapter 4.13 Inspection Scripts

`scripts/inspect-containers.sh`:

- Runs `docker compose ps --format json`.
- Returns `[]` when the runtime directory is absent.

`scripts/compose-logs.sh`:

- Runs `docker compose logs --tail {tailLines} --timestamps`.

`scripts/container-logs.sh`:

- Validates container name and environment ownership.
- Runs `docker logs --tail {tailLines} --timestamps`.

`scripts/container-files.sh`:

- Validates container name and environment ownership.
- Runs `docker exec` with `find` and `stat`.
- Returns JSON entries with `path`, `name`, `type`, `size`, and `modifiedAt`.

`scripts/container-exec.sh`:

- Validates container name and environment ownership.
- Runs arbitrary shell command with `docker exec {container} sh -lc`.
- Returns command, exit code, stdout, and stderr as JSON.

`scripts/mongo-inspect.sh`:

- Finds service `mongodb`, falling back to `mongo`.
- Uses database `primarie`.
- Returns `{ available: false, reason }` when runtime or container is missing.
- Otherwise returns collections with counts and sample documents up to payload `limit`.

## Chapter 4.14 Seed Preparation Script

`scripts/prepare-seeds.sh`:

- Requires `jq` and Docker.
- Iterates `seeds/*` directories.
- Skips unsupported seed names.
- Rebuilds `{seed}/mongodb`.
- Ensures `{seed}/media` exists.
- Runs a temporary MongoDB container.
- Imports each top-level `*.json` file into database `primarie`, collection name equal to file basename.
- Normalizes permissions on the generated MongoDB data folder.

## Chapter 4.15 Composer Startup Scripts

`scripts/start-composer.sh`:

1. Checks/install-prompts for `jq`, Git, Docker, Docker Compose.
2. Ensures Docker is running.
3. Ensures `/opt/composer-bus` is writable or offers sudo setup.
4. Ensures root `.env` exists, optionally copying `.env.example`.
5. Runs seed preparation.
6. Starts the Bash FIFO worker in the background.
7. Starts the central Docker Compose stack, detached by default.

`scripts/debug-composer.sh`:

1. Runs prerequisite checks only.
2. Runs seed preparation.
3. Starts the worker in live log mode.
4. Starts central Docker Compose attached.
5. Stops the worker on exit.

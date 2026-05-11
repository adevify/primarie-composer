# 08 Configuration Security And Operations

## Chapter 8.1 Root Environment Variables

`.env.example` defines:

- `API_PORT=3000`
- `NODE_ENV=production`
- `JWT_SECRET=replace-with-a-long-random-jwt-secret`
- `JWT_EXPIRES_IN=12h`
- `SOURCE_REPO_URL=git@github.com:org/repo.git`
- `BASE_ENV_PORT=8001`
- `ROOT_DOMAIN=prmr.md`
- `PROXY_UPSTREAM_HOST=auto`

Current API source requires `JWT_SECRET` to be at least 16 characters and `SOURCE_REPO_URL` to be non-empty.

`API_PORT` is present in `.env.example` but not used by current API source.

## Chapter 8.2 API Environment Schema

`apps/api/src/config/env.ts` parses:

- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `SOURCE_REPO_URL`
- `BASE_ENV_PORT`
- `ROOT_DOMAIN`
- `PROXY_UPSTREAM_HOST`
- `RUNTIME_DIR`
- `SEEDS_DIR`
- `HOST_RUNTIME_DIR`
- `HOST_SEEDS_DIR`
- `BUS_PIPE_PATH`
- `BUS_RESULTS_DIR`
- `BUS_LOGS_DIR`
- `BUS_WORKER_READY_PATH`
- `BUS_ACTION_TIMEOUT_MS`
- `BUS_POLL_INTERVAL_MS`

Defaults are local repo paths when running outside Docker, except bus paths default to `/bus/...`.

## Chapter 8.3 Central Compose Environment

The central API container sets:

- `NODE_ENV`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `SOURCE_REPO_URL`
- `BASE_ENV_PORT`
- `ROOT_DOMAIN`
- `PROXY_UPSTREAM_HOST`
- `RUNTIME_DIR=/app/runtime/environments`
- `HOST_RUNTIME_DIR`
- `ENVIRONMENTS_FILE=/app/runtime/environments.json`
- `SEEDS_DIR=/app/seeds`
- `HOST_SEEDS_DIR`
- bus paths under `/bus`
- `SSH_AUTH_SOCK=/ssh-agent`

`ENVIRONMENTS_FILE` is set in Compose but not parsed by current `env.ts`; the current implementation stores environment metadata in MongoDB.

Template configuration such as `TEMPLATE_DIR` and `HOST_TEMPLATE_DIR` has been removed from the environment schema and central Compose configuration.

## Chapter 8.4 Environment Runtime Variables

Environment `.env` values are assembled from:

- User-provided Electron create dialog values.
- API-injected values.
- Worker start script enforced values.

API prepare payload injects:

- `PROXY_EXTERNAL_PORT`
- `HOST_1`
- `HOST_2`
- `NETWORK_NAME`
- `ENV_KEY`
- `ENV_PORT`
- `ROOT_DOMAIN`
- `MONGO_DATABASE=primarie`

Start/restart scripts ensure:

- `HOST_1`
- `HOST_2`
- `ROOT_DOMAIN`
- `ENV_KEY`
- `ENV_PORT`
- `PROXY_EXTERNAL_PORT`

## Chapter 8.5 Local Operation Commands

Start central Composer stack:

```sh
npm run start:composer
```

Start debug mode:

```sh
npm run debug:composer
```

Run Electron dev mode:

```sh
npm run composer
```

Run API locally:

```sh
cd apps/api
npm install
npm run dev
```

Run Electron locally:

```sh
cd apps/electron
npm install
npm run dev
```

## Chapter 8.6 Required Host Tools

Host scripts expect:

- Bash.
- `jq`.
- Git.
- Docker.
- Docker Compose plugin or `docker-compose`.
- A writable bus root, default `/opt/composer-bus`.
- Access to the configured source repository, usually through SSH agent forwarding and known hosts.

`start-composer.sh` can prompt to install missing tools using Homebrew, apt, dnf, or yum where available.

## Chapter 8.7 Authentication Security

Implemented:

- JWT signed with `JWT_SECRET`.
- JWT expiry configured by `JWT_EXPIRES_IN`.
- Login rate limited.
- Passwords checked with bcrypt.
- Authenticated routes require bearer token.

Current limitations:

- Logout is stateless and does not invalidate tokens.
- Tokens are stored in Electron renderer `localStorage`.
- No refresh token rotation is implemented.
- User roles are inferred for display and not enforced as authorization policy.

## Chapter 8.8 API HTTP Security

Implemented:

- Helmet.
- CORS allowlist.
- JSON body size limit.
- Trust proxy configured.

Important exposed capabilities:

- Container exec route runs arbitrary shell commands inside selected environment containers.
- Runtime file browsing can reveal files in generated environment directories.
- Container file browsing can reveal files inside running containers.
- Mongo inspection returns sample documents.

These routes require JWT but no role-based access checks.

## Chapter 8.9 Electron Security

Implemented:

- Context isolation.
- Renderer sandbox.
- Node integration disabled.
- Narrow preload bridge.
- Repo path validation.
- File path resolution inside selected repo.
- `.env` excluded from file sync.

Current limitations:

- JWT stored in localStorage.
- DevTools open automatically in all current window creation code.

## Chapter 8.10 Host Worker Security

The worker has broad host authority because it runs Git, Docker, file deletion, chmod, and optional passwordless sudo deletion logic.

Safety checks:

- Environment name validation.
- Container name validation.
- Container ownership assertion for container toolbox scripts.
- Relative path validation for sync file payloads.
- Runtime directory traversal prevention in API file listing.

Risk areas:

- Arbitrary command execution inside containers.
- Removal script deletes runtime environment directories.
- Repo patch scripts mutate cloned source files.
- Some action types are not environment-locked.
- Host bus accepts any JSON line written to the FIFO.

## Chapter 8.11 Network And TLS

Central proxy listens on HTTP and HTTPS ports configured by:

- `PROXY_HTTP_PORT`, default `80`.
- `PROXY_HTTPS_PORT`, default `443`.

HTTPS expects certificate files mounted from `proxy/ssl`.

Environment routing requires DNS or hosts configuration that points wildcard hostnames under `ROOT_DOMAIN` to the central proxy.

## Chapter 8.12 Logging And Observability

Sources of operational logs:

- API structured stdout/stderr JSON logs.
- MongoDB `logs` collection for system-level activity. This is the only database-backed log store.
- File-backed lifecycle action logs attached to action records.
- Worker bus logs under `BUS_LOGS_DIR`.
- Central Compose logs.
- Environment Compose logs.
- Container logs.

The Electron UI displays system activity logs, file-backed lifecycle action logs, Compose logs, and container logs.

# 00 Repository Map

## Chapter 0.1 Root Package

The root `package.json` defines a private ESM package named `primarie-composer`.

Root scripts:

- `npm run composer`: runs Electron dev mode through `npm --prefix apps/electron run dev`.
- `npm run start:composer`: runs `./scripts/start-composer.sh`.
- `npm run debug:composer`: runs `./scripts/debug-composer.sh`.

The root package does not define npm workspaces. Each app has its own `package.json` and `package-lock.json`.

## Chapter 0.2 Top-Level Directories

- `apps/api`: central Express API, MongoDB data access, environment services, and Docker image definition.
- `apps/electron`: Electron desktop app with React renderer, secure preload bridge, and Git/file watcher logic.
- `scripts`: host-side Bash worker and operational scripts for environment lifecycle, sync, logs, container inspection, and seed preparation.
- `proxy`: central Nginx reverse proxy config plus ignored SSL material.
- `seeds/default`: seed JSON files for environment MongoDB data.
- `runtime`: ignored local runtime data for generated environments and central MongoDB storage.
- `docs/spec`: this generated spec pack.

## Chapter 0.3 API Source Files

Primary API files:

- `apps/api/src/main.ts`: Express bootstrap, middleware, route mounting, MongoDB connection, health check, and shutdown.
- `apps/api/src/config/env.ts`: environment variable schema and defaults.
- `apps/api/src/modules/auth/*`: login, token refresh, token verification, user listing, and JWT middleware.
- `apps/api/src/modules/environments/*`: route definitions, Zod DTOs, and environment orchestration service.
- `apps/api/src/modules/proxy/proxy.routes.ts`: Nginx authorization endpoint for environment hostnames.
- `apps/api/src/db/*`: MongoDB collection adapters.
- `apps/api/src/services/bus/HostActionBusService.ts`: FIFO bus publisher and result polling.

Removed from the active source tree:

- `apps/api/src/services/docker/*`
- `apps/api/src/services/git/*`
- `apps/api/src/services/seeds/*`

Lifecycle work is performed through the host action bus and scripts.

## Chapter 0.4 Electron Source Files

Primary Electron files:

- `apps/electron/src/main/main.ts`: Electron window, IPC handlers, repo selection, Git state, changed files, and watcher lifecycle.
- `apps/electron/src/main/preload.ts`: context-isolated bridge exposed as `window.primarieElectron`.
- `apps/electron/src/main/git.ts`: Git status reading, `.env` parsing, changed file payload generation, binary/large file skips, and repository path safety.
- `apps/electron/src/main/file-sync.ts`: chokidar watcher and Git-state polling.
- `apps/electron/src/renderer/App.tsx`: top-level renderer state machine and workflow orchestration.
- `apps/electron/src/renderer/api.ts`: typed API client and NDJSON stream client.
- `apps/electron/src/renderer/components/*`: dashboard, environments, details, users, auth, repo, sync, and log UI components.
- `apps/electron/src/renderer/theme.ts`: MUI dark theme and component overrides.

## Chapter 0.5 Script Files

Primary script files:

- `scripts/composer-worker.sh`: FIFO bus worker and action router.
- `scripts/common.sh`: shared validation, Compose helpers, repo patch helpers, and connectivity probes.
- `scripts/start-composer.sh`: prerequisite checks, seed preparation, bus startup, and central Compose startup.
- `scripts/debug-composer.sh`: attached debug mode with live worker logs.
- `scripts/prepare-seeds.sh`: rebuilds prepared MongoDB seed data folders.
- `scripts/prepare-env.sh`: clones the target source repo, checks out branch/commit, applies repo patches, copies seed data, and writes `.env`.
- `scripts/sync-files.sh`: fetches/reset/checks out branch/commit and applies changed-file payloads.
- `scripts/start-env.sh`, `stop-env.sh`, `restart-env.sh`, `remove-env.sh`: runtime Compose lifecycle.
- `scripts/inspect-containers.sh`, `compose-logs.sh`, `container-logs.sh`, `container-files.sh`, `container-exec.sh`, `mongo-inspect.sh`: inspection and toolbox actions.

## Chapter 0.6 Generated And Ignored Artifacts

The `.gitignore` excludes:

- `.env`
- `node_modules`
- `dist`
- `apps/electron/out`
- `runtime/environments/*`
- `runtime/db/*`
- `runtime/environments.json`
- `proxy/ssl/*`
- selected debug/log/source folders

The local workspace currently contains ignored runtime/build data such as `apps/api/dist`, `apps/electron/out`, `runtime/db`, and a generated runtime environment under `runtime/environments`. These are operational artifacts, not canonical source.

## Chapter 0.7 Configuration Files

- Root `.env.example` includes `JWT_SECRET`, `JWT_EXPIRES_IN`, `SOURCE_REPO_URL`, `BASE_ENV_PORT`, `ROOT_DOMAIN`, and `PROXY_UPSTREAM_HOST`.
- `apps/api/tsconfig.json` compiles TypeScript as `NodeNext` into `dist`.
- `apps/electron/tsconfig.json` uses strict TypeScript, React JSX, and `moduleResolution: Bundler`.
- `apps/electron/electron.vite.config.ts` defines main, preload, and renderer build inputs.
- `apps/electron/vite.config.ts` supports standalone renderer Vite usage.
- `docker-compose.yml` runs central proxy, MongoDB, and API containers.

## Chapter 0.8 Dependency Summary

API dependencies include Express, CORS, Helmet, rate limiting, Zod, JSON Web Tokens, bcrypt, dotenv, and MongoDB.

Electron dependencies include Electron, electron-vite, React 19, MUI 6, MUI icons, Vite, chokidar, and TypeScript.

Host scripts require shell tools including Bash, `jq`, Git, Docker, Docker Compose or `docker-compose`, and MongoDB images pulled through Docker.

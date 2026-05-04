# primarie-composer

Initial environment orchestration service for `primarie.md`.

The central API accepts authenticated requests from the local Electron app, creates isolated Docker Compose environments from templates and seed JSON files, and stores environment metadata in `runtime/environments.json`.

## Structure

```text
apps/api                 TypeScript Express API
templates/environment   Per-environment Docker Compose template
seeds/default           Seed JSON copied into generated environments
runtime/environments    Generated environment folders, gitignored in normal use
runtime/environments.json File-backed environment registry
proxy                   Nginx proxy that asks the API before routing subdomains
```

## Run the central API

Create a local env file:

```sh
cp .env.example .env
```

Edit `JWT_SECRET` and `SOURCE_REPO_URL`, then start:

```sh
docker compose up --build
```

The API listens on `http://localhost:3000` by default. The proxy listens on port `80` by default, configurable with `PROXY_HTTP_PORT`.

The API container mounts `/var/run/docker.sock` so it can run `docker compose` for generated environments. This is powerful and should only be used on trusted local/dev hosts.

The API does not require a database. Existing environments are stored in `runtime/environments.json`.

## Electron authentication

The Electron app calls `POST /auth/login`.

```sh
curl -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"accessKey":"replace-with-local-electron-access-key","operatorName":"Arsenii"}'
```

The response contains a JWT bearer token. Send it on environment routes:

```sh
Authorization: Bearer <accessToken>
```

## Create an environment

```sh
curl -X POST http://localhost:3000/environments \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{
    "seed":"default",
    "tenants":["bardar"],
    "source":{
      "branch":"feature/some-branch",
      "commit":"abc1234567890",
      "dirty":true,
      "changedFiles":[
        {
          "path":"apps/web/src/App.tsx",
          "status":"modified",
          "contentBase64":"..."
        }
      ]
    }
  }'
```

If `key` is omitted, the API generates a short lowercase key. Keys must be 4-12 lowercase letters or numbers.

The API will:

1. assign the next available local port from `BASE_ENV_PORT` (`8001` by default),
2. create `runtime/environments/{key}`,
3. copy `templates/environment`,
4. clone `SOURCE_REPO_URL` into `runtime/environments/{key}/repo`,
5. checkout `source.branch`,
6. checkout exact `source.commit`,
7. apply `source.changedFiles` over the cloned repo,
8. copy `seeds/{seed}` into `runtime/environments/{key}/seeds`,
9. create `runtime/environments/{key}/mongo-dump` from seed JSON files,
10. write `.env` and `source.json`,
11. run `docker compose up -d`,
12. store metadata in `runtime/environments.json`.

The create response includes the generated key and runtime config:

```json
{
  "key": "zg22i",
  "port": 8001,
  "status": "running",
  "seed": "default",
  "tenants": ["bardar"],
  "branch": "feature/some-branch",
  "commit": "abc1234567890",
  "dirty": true,
  "domains": [
    "admin.zg22i.prmr.md",
    "api.zg22i.prmr.md",
    "bardar.zg22i.prmr.md"
  ],
  "config": {
    "key": "zg22i",
    "port": 8001,
    "rootDomain": "prmr.md",
    "seed": "default",
    "tenants": ["bardar"],
    "domains": [
      "admin.zg22i.prmr.md",
      "api.zg22i.prmr.md",
      "bardar.zg22i.prmr.md"
    ],
    "runtimePath": "/app/runtime/environments/zg22i",
    "repoPath": "/app/runtime/environments/zg22i/repo",
    "mongoDumpPath": "/app/runtime/environments/zg22i/mongo-dump",
    "source": {
      "branch": "feature/some-branch",
      "commit": "abc1234567890",
      "dirty": true,
      "changedFiles": []
    }
  }
}
```

The API stores who created the environment from the login `operatorName`:

```json
{
  "createdBy": {
    "id": "electron-operator",
    "name": "Electron operator"
  }
}
```

If an environment is created for a GitHub PR, include `pullRequest`:

```json
{
  "pullRequest": {
    "provider": "github",
    "repository": "org/repo",
    "number": 42,
    "title": "Add feature",
    "url": "https://github.com/org/repo/pull/42",
    "headSha": "abc1234567890"
  }
}
```

The Electron app lists all environments after login and groups them by GitHub PR when PR metadata exists, otherwise by creating user.

Example generated `.env`:

```env
ENV_KEY=zg22i
ENV_PORT=8001
ROOT_DOMAIN=prmr.md
MONGO_DATABASE=primarie_env_zg22i
TENANTS=bardar
SOURCE_BRANCH=feature/some-branch
SOURCE_COMMIT=abc1234567890
SOURCE_DIRTY=true
```

The generated `mongo-dump` folder is mounted into the environment MongoDB container at `/docker-entrypoint-initdb.d`. Its import script loads each seed JSON file as a Mongo collection when the environment Mongo container starts with an empty data volume.

## Environment routes

All environment routes require the JWT bearer token.

```text
POST   /environments
GET    /environments
GET    /environments/:key
POST   /environments/:key/stop
POST   /environments/:key/start
POST   /environments/:key/restart
POST   /environments/:key/reuse
POST   /environments/:key/sync-files
GET    /environments/:key/containers
GET    /environments/:key/containers/:container/files?path=/
POST   /environments/:key/containers/:container/exec
DELETE /environments/:key
POST   /environments/pr/update
POST   /environments/pr/merged
```

`POST /environments/:key/reuse` can be used by the owner to start and reuse their own stopped environment.

`POST /environments/:key/sync-files` receives the Electron app's latest branch, commit, and Git-status changed files for the active environment.

Container toolbox routes allow operators to inspect environment containers, browse files inside a selected container, and execute shell commands through the API. The current implementation executes commands and returns stdout/stderr; a fully interactive TTY can be layered on top later with a streaming terminal transport.

`POST /environments/pr/update` is for GitHub PR automation. It deletes the previous environment for the same PR, then creates a new environment with a fresh generated key and the latest branch, commit, changed files, seed, and tenants.

`POST /environments/pr/merged` removes environments for a PR after it is merged or closed.

## Domain model

Each environment key maps to one local port:

```text
zg22i -> 127.0.0.1:8001
next  -> 127.0.0.1:8002
```

Generated environments publish their assigned HTTP port on the Docker host. The top-level proxy container reaches that port through `host.docker.internal` after the API authorizes the requested host.

Public domains are handled by the `proxy` service:

```text
admin.zg22i.prmr.md  -> 127.0.0.1:8001
api.zg22i.prmr.md    -> 127.0.0.1:8001
bardar.zg22i.prmr.md -> 127.0.0.1:8001
```

The proxy receives requests for `*.{ENV_KEY}.{ROOT_DOMAIN}` and asks the API whether the host is allowed:

```text
GET /proxy/authorize
X-Original-Host: admin.zg22i.prmr.md
```

If the environment exists and is running, the API returns `204` with routing headers:

```text
X-Environment-Key: zg22i
X-Environment-Port: 8001
X-Upstream-Host: admin.prmr.md
```

For example, `admin.zg22i.prmr.md` is authorized as environment `zg22i`, forwarded to the assigned local environment port, and sent upstream with:

```text
Host: admin.prmr.md
X-Original-Host: admin.zg22i.prmr.md
```

The environment-local Nginx proxy uses the rewritten `Host` header to route:

```text
admin.prmr.md -> admin service
api.prmr.md   -> api service
*.prmr.md     -> web service
```

Requests for unknown, stopped, or malformed environment hosts are rejected by the proxy because the API authorization check fails.

The server proxy also exposes central API routes directly, without environment authorization:

```text
/health
/auth/*
/environments*
```

Use these through the proxy for login and environment lifecycle operations such as create, list, stop, reuse, and delete. All `/environments*` routes still require the API JWT bearer token.

## Local API development

```sh
cd apps/api
npm install
npm run dev
```

For local development outside Docker, set `JWT_SECRET`. The API still expects Docker to be available on the host when creating environments.

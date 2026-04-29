# primarie-composer

Initial environment orchestration service for `primarie.md`.

The central API accepts authenticated requests from the local Electron app, creates isolated Docker Compose environments from templates and seed JSON files, and stores environment metadata in MongoDB.

## Structure

```text
apps/api                 TypeScript Express API
templates/environment   Per-environment Docker Compose template
seeds/default           Seed JSON copied into generated environments
runtime/environments    Generated environment folders, gitignored in normal use
```

## Run the central API

Create a local env file:

```sh
cp .env.example .env
```

Edit `JWT_SECRET` and `ELECTRON_ACCESS_KEY`, then start:

```sh
docker compose up --build
```

The API listens on `http://localhost:3000` by default. MongoDB is only exposed to the Docker network, not to the host.

The API container mounts `/var/run/docker.sock` so it can run `docker compose` for generated environments. This is powerful and should only be used on trusted local/dev hosts.

## Electron authentication

The Electron app calls `POST /auth/login` with the local access key from `ELECTRON_ACCESS_KEY`.

```sh
curl -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"accessKey":"replace-with-local-electron-access-key"}'
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
  -d '{"key":"zg22i","seed":"default","tenants":["bardar"]}'
```

If `key` is omitted, the API generates a short lowercase key. Keys must be 4-12 lowercase letters or numbers.

The API will:

1. assign the next available local port from `BASE_ENV_PORT` (`8001` by default),
2. create `runtime/environments/{key}`,
3. copy `templates/environment`,
4. copy `seeds/{seed}` into `runtime/environments/{key}/seeds`,
5. write `.env`,
6. run `docker compose up -d`,
7. store metadata in MongoDB.

Example generated `.env`:

```env
ENV_KEY=zg22i
ENV_PORT=8001
ROOT_DOMAIN=prmr.md
MONGO_DATABASE=primarie_env_zg22i
TENANTS=bardar
```

## Environment routes

All environment routes require the JWT bearer token.

```text
POST   /environments
GET    /environments
GET    /environments/:key
POST   /environments/:key/stop
POST   /environments/:key/start
POST   /environments/:key/restart
DELETE /environments/:key
```

## Domain model

Each environment key maps to one local port:

```text
zg22i -> 127.0.0.1:8001
next  -> 127.0.0.1:8002
```

Public domains can then be forwarded by the future main server proxy:

```text
admin.zg22i.prmr.md  -> 127.0.0.1:8001
api.zg22i.prmr.md    -> 127.0.0.1:8001
bardar.zg22i.prmr.md -> 127.0.0.1:8001
```

The main proxy will terminate HTTPS on port 443 and forward plain HTTP to the assigned local environment port. It must preserve the original `Host` header because the environment-local Nginx proxy uses that header to route:

```text
admin.{ENV_KEY}.prmr.md -> admin service
api.{ENV_KEY}.prmr.md   -> api service
*.{ENV_KEY}.prmr.md     -> web service
```

This repository does not implement the public `*.prmr.md` proxy yet.

## Local API development

```sh
cd apps/api
npm install
npm run dev
```

For local development outside Docker, set `MONGO_URI`, `JWT_SECRET`, and `ELECTRON_ACCESS_KEY`. The API still expects Docker to be available on the host when creating environments.

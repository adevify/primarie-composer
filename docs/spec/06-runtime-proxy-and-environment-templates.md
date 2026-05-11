# 06 Runtime Proxy And Environment Templates

## Chapter 6.1 Central Docker Compose Stack

Root `docker-compose.yml` defines:

- `proxy`: Nginx 1.27 Alpine.
- `db`: MongoDB 7.0.12.
- `api`: built from `apps/api/Dockerfile`.

## Chapter 6.2 Central Proxy Service

The `proxy` service:

- Depends on API health.
- Publishes `${PROXY_HTTP_PORT:-80}:80`.
- Publishes `${PROXY_HTTPS_PORT:-443}:443`.
- Mounts `./proxy/nginx.conf` read-only.
- Mounts `./proxy/ssl` read-only.
- Adds `host.docker.internal:host-gateway`.

## Chapter 6.3 Central Database Service

The `db` service:

- Uses `mongo:7.0.12`.
- Runs `mongod --quiet`.
- Mounts `./runtime/db:/data/db`.
- Disables logging with Docker `logging.driver: none`.

## Chapter 6.4 Central API Service

The `api` service:

- Builds from `./apps/api`.
- Depends on `db`.
- Adds `host.docker.internal:host-gateway`.
- Mounts runtime, templates, seeds, host bus, SSH agent, and known hosts.
- Exposes API health to Docker health check.

Important mounted paths:

- `./runtime:/app/runtime`
- `./templates:/app/templates`
- `./seeds:/app/seeds`
- `/opt/composer-bus:/bus`
- `${SSH_AUTH_SOCK}:/ssh-agent`
- `${HOME}/.ssh/known_hosts:/root/.ssh/known_hosts:ro`

The current central Compose file does not mount `/var/run/docker.sock` into the API container. Host Docker work is delegated to the bus worker.

## Chapter 6.5 API Container Image

`apps/api/Dockerfile` has three stages:

- `deps`: installs Node dependencies.
- `build`: compiles TypeScript.
- `runtime`: installs certificates, Git, procps, and OpenSSH client; copies compiled app and dependencies.

Runtime command:

```text
node dist/main.js
```

The Dockerfile declares `EXPOSE 3000`, while the API code listens on port `80`.

## Chapter 6.6 Central Nginx HTTP Routing

`proxy/nginx.conf` defines HTTP and HTTPS servers.

Direct central routes bypass environment authorization:

- `/health`
- `/auth/`
- `/environments`

All other paths use `auth_request /__composer_authorize`.

For environment traffic, Nginx sets:

- `Host` to `$service_host`.
- `X-Original-Host` to original host.
- `X-Environment-Key` to authorized environment key.
- `X-Forwarded-*` headers.
- WebSocket upgrade headers.

Proxy target:

```text
http://$upstream_host:$environment_port
```

## Chapter 6.7 Central Nginx HTTPS Routing

The HTTPS server mirrors the HTTP server and uses:

- `/etc/nginx/ssl/ssl.crt`
- `/etc/nginx/ssl/ssl.key`
- `/etc/nginx/ssl/ssl.bundle`

SSL files are ignored by Git except `.gitkeep`.

## Chapter 6.8 Hostname Contract

Current API parser accepts:

```text
{subdomain}-{environmentKey}.{ROOT_DOMAIN}
```

Examples:

```text
admin-magic-rocket.prmr.md
api-magic-rocket.prmr.md
web-magic-rocket.prmr.md
```

The API returns service host:

```text
{subdomain}.{ROOT_DOMAIN}
```

Example:

```text
admin.prmr.md
```

The API resolves upstream host from `PROXY_UPSTREAM_HOST`:

- `auto` or `host.docker.internal`: reads Docker default gateway from `/proc/net/route`.
- IP address: uses as-is.
- DNS name: resolves IPv4 through `dns.lookup`.

## Chapter 6.9 Environment Template Compose Artifact

`templates/environment/docker-compose.yml` defines a standalone mock environment:

- `env-nginx`
- `admin`
- `api`
- `web`
- `mongo`

`env-nginx` publishes `${ENV_PORT}:80`.

Mock services use Nginx and mount:

- `mock/admin.html`
- `mock/api.json`
- `mock/web.html`
- `./repo:/workspace/repo:ro`

Mongo uses:

- `mongo:7`
- named volume `mongo-data`
- `./mongo-dump:/docker-entrypoint-initdb.d:ro`
- `MONGO_INITDB_DATABASE`

## Chapter 6.10 Environment Template Nginx Artifact

`templates/environment/nginx.conf` routes:

- Host matching `admin-[^.]+.*` to service `admin`.
- Host matching `api-[^.]+.*` to service `api`.
- All other hosts to service `web`.

It assumes public HTTPS termination is handled by the central server proxy and only listens on plain HTTP inside the environment.

## Chapter 6.11 Template Mock Artifacts

Mock files:

- `templates/environment/mock/admin.html`: static admin mock.
- `templates/environment/mock/web.html`: static tenant web mock.
- `templates/environment/mock/api.json`: `{ "service": "api-mock", "ok": true }`.

## Chapter 6.12 Active Runtime Path Contract

Active host scripts use runtime folders under:

```text
{HOST_RUNTIME_DIR}/{environmentKey}
```

or on the host by default:

```text
{COMPOSER_ROOT}/runtime/environments/{environmentKey}
```

The active prepare script clones the configured source repo directly into this folder and writes `.env` there. Start/restart then run Docker Compose from that folder.

This means the cloned target repo must provide a usable Docker Compose setup compatible with the injected `.env` values and Composer patches.

## Chapter 6.13 Runtime Files

Prepared environment runtime folders currently contain:

- cloned source repository contents
- `.env`
- `data/mongodb`
- `data/media`

Other files depend on the target source repository.


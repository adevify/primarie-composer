# Primarie Composer Repository Spec

## Chapter 0.1 Purpose

This spec documents the current repository as implemented, not only as described by existing README files. It is intended to be reviewed chapter by chapter so requested changes can point to stable headings.

## Chapter 0.2 Spec File Set

- [00 Repository Map](00-repository-map.md): repo layout, packages, generated artifacts, and source ownership.
- [01 Product And Workflows](01-product-and-workflows.md): product intent, actors, lifecycle flows, and state transitions.
- [02 API Spec](02-api-spec.md): Express API runtime, routes, payloads, auth, streaming, and errors.
- [03 Data Models](03-data-models.md): MongoDB collections and TypeScript record shapes.
- [04 Host Action Bus And Scripts](04-host-action-bus-and-scripts.md): FIFO bus, host worker, and shell script contracts.
- [05 Electron App](05-electron-app.md): Electron main/preload, renderer flows, sync, and UI modules.
- [06 Runtime Proxy And Environments](06-runtime-proxy-and-environments.md): central Compose stack, Nginx proxy, domain routing, and runtime environment layout.
- [07 Seeds And Data](07-seeds-and-data.md): seed folders, seed preparation, MongoDB import behavior, and auth user data.
- [08 Configuration Security And Operations](08-configuration-security-and-operations.md): env vars, local operations, security boundaries, and runtime risks.
- [09 Observed Gaps And Review Notes](09-observed-gaps-and-review-notes.md): implementation mismatches, stale docs, and likely fix targets.

## Chapter 0.3 Review Conventions

Each file uses explicit chapter headings. Suggested review comments can reference chapters like:

```text
02 API Spec, Chapter 2.4: change create environment to start immediately.
05 Electron App, Chapter 5.7: remove the static production-style labels.
09 Observed Gaps, Chapter 9.2: confirm the intended route shape.
```

## Chapter 0.4 Source Of Truth

The source code under `apps/api/src`, `apps/electron/src`, `scripts`, `proxy`, and `seeds` is treated as source of truth. Existing README files are used as background, but several README details are stale compared with current code.

## Chapter 0.5 System Summary

Primarie Composer is an internal local/development orchestration tool. Operators use an Electron desktop app to authenticate with a central API, select a local Git repository, create isolated environment records, start or stop Docker Compose environments through a host-side action bus, inspect containers, inspect MongoDB data, stream logs, and sync local Git-status changes into an active environment.

The central API is an Express TypeScript service backed by MongoDB. It does not directly execute Docker commands in the current active path. Instead, it publishes JSON actions to a FIFO bus under `/opt/composer-bus`; a Bash worker consumes those actions and runs host-level Git, Docker, and filesystem operations.

## Chapter 0.6 Important Current Behavior

- Creating an environment currently prepares the runtime folder and ends in `stopped`; starting is a separate lifecycle action.
- Authentication currently uses email/password against a MongoDB `users` collection with bcrypt password hashes.
- Environment domains use hyphen labels such as `admin-envkey.prmr.md`, not underscore labels.
- The active host worker clones `SOURCE_REPO_URL` directly into the runtime environment folder; template artifacts should be removed from the desired system.
- Several UI panels contain placeholder or inferred operational data, especially container counts, uptime, user roles, and user activity.

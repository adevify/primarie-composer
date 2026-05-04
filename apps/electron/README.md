# Primarie Composer Electron App

Internal operator desktop app for the Primarie Composer environment API.

The app uses Electron, React, TypeScript, Vite, MUI, and MUI icons. It does not use Tailwind.

## Run Electron Dev Mode

From the repository root:

```sh
npm run composer
```

The API should be running separately, usually at:

```text
http://localhost
```

## API Base URL

The login screen has an API Base URL field. The default is `http://localhost`.

The value is stored after login as `apiBaseUrl`.

## Login

The app calls:

```http
POST /auth/login
```

Body:

```json
{
  "email": "operator@example.com",
  "password": "..."
}
```

Expected response:

```json
{
  "accessToken": "...",
  "expiresAt": "..."
}
```

The current backend may return `expiresIn`; the app tolerates that during the first version.

Stored locally:

- `apiBaseUrl`
- `accessToken`
- `expiresAt` or `expiresIn`

The password is not stored. The first version uses `localStorage` with TODOs to move JWT storage to OS keychain or encrypted storage.
The API groups environments by the authenticated user.

## Token Verification

At startup, if `apiBaseUrl` and `accessToken` exist, the app calls:

```http
GET /auth/verify
Authorization: Bearer {token}
```

Expected response:

```json
{
  "ok": true,
  "user": {
    "type": "electron-operator"
  }
}
```

TODO: This endpoint is currently assumed. If the backend returns `404`, the app falls back to local expiry checks so development remains usable.

## Repository Selection

After login, choose a local repository with the `Choose local repository` button. The picker uses Electron's main process dialog through a safe preload API.

The selected folder must contain `.git`. The selected path is saved locally and can be changed later.

## Branch and Commit Detection

Git state is read in the Electron main process using:

```sh
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git status --porcelain
```

The renderer receives only typed data:

```ts
{
  branch: string;
  commit: string;
  isDirty: boolean;
  changedFiles: string[];
}
```

## Environment Variables Before Compose

Before an environment is created, Electron reads `.env` from the selected local repository through the safe preload API. If `.env` is missing, it falls back to `.env.example`. The renderer shows a dialog for every variable in that file, allowing each environment to use different values.

Those values are sent with the create request as `env`. The API writes them to `{runtime environment}/.env`, adds server defaults such as `ENV_KEY`, `ENV_PORT`, `ROOT_DOMAIN`, and `MONGO_DATABASE` when missing, and only then runs Docker Compose.

## Environment Creation

When creating an environment with `Use current repo state` enabled, the app refreshes Git state and sends the branch and commit:

```json
{
  "seed": "default",
  "source": {
    "branch": "feature/some-branch",
    "commit": "abc1234567890"
  },
  "env": {
    "SOME_APP_SETTING": "local value"
  }
}
```

Expected backend behavior:

- clone the configured remote repository into the generated environment folder
- checkout server repo to `source.branch`
- checkout exact `source.commit`
- write `.env` from the Electron-provided values and server defaults
- start Docker Compose for that environment folder
- create and run the environment

The create response immediately includes the generated unique environment key and `creating` status. The app then polls environment logs to show repository preparation, env writing, Compose startup, and final running/error state.

After login, the app loads all environments and groups them by GitHub PR when `pullRequest` metadata exists, otherwise by creator. Operators can stop environments and reuse environments they own.

Docker, seed setup, server-side Git checkout, changed-file application, and environment lifecycle are API responsibilities only.

## Continuous Sync

After an environment is created, it becomes the active sync target and the app starts watching the selected local repo. Operators can also select an active environment manually and use Start sync / Stop sync.

The watcher runs in the Electron main process with `chokidar` and a lightweight Git-state poller. On startup, file changes, branch changes, commit changes, or `git status` changes, it refreshes:

- current branch
- current commit
- `git status --porcelain`
- changed file payloads for files Git reports as changed

It then sends only those Git-status changed files:

```http
POST /environments/:key/sync-files
```

Body:

```json
{
  "branch": "feature/some-branch",
  "commit": "abc123...",
  "files": [
    {
      "path": "apps/web/src/App.tsx",
      "status": "modified",
      "contentBase64": "..."
    }
  ]
}
```

The first API implementation records the latest branch, commit, and changed-file payload metadata for the environment. Server-side file application can be expanded behind the same endpoint.

## Ignored Folders and Files

The app never watches or syncs:

- `.git`
- `node_modules`
- `dist`
- `build`
- `.next`
- `coverage`
- `.env`

Large files over 1MB and binary files are skipped and surfaced as warnings.

## Security Notes

- `contextIsolation: true`
- `nodeIntegration: false`
- no remote module
- renderer never receives raw Node APIs
- IPC validates repository inputs
- files are only read inside the selected repository path
- access key is not stored after login
- TODO: replace localStorage token persistence with OS keychain or encrypted storage

The Electron app does not run Docker and does not directly create environments on the server filesystem.

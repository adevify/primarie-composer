# 05 Electron App

## Chapter 5.1 Package And Build

Electron app package:

```text
@primarie-composer/electron
```

Scripts:

- `npm run dev`: `electron-vite dev`
- `npm run build`: `tsc --noEmit && electron-vite build`
- `npm run preview`: `electron-vite preview`
- `npm run typecheck`: `tsc --noEmit`

Main build input:

```text
src/main/main.ts
```

Preload build input:

```text
src/main/preload.ts
```

Renderer root:

```text
src/renderer
```

## Chapter 5.2 Main Process Window

`main.ts` creates a `BrowserWindow` with:

- Width `1280`, height `860`.
- Minimum width `1080`, minimum height `720`.
- Title `Primarie Composer`.
- `contextIsolation: true`.
- `nodeIntegration: false`.
- `sandbox: true`.
- Preload path `../preload/preload.js`.

DevTools are opened automatically in detached mode.

If `ELECTRON_RENDERER_URL` exists, the window loads that URL. Otherwise it loads built `renderer/index.html`.

## Chapter 5.3 Main Process Debug Hooks

The main process logs:

- Renderer console messages.
- Renderer load failures.
- Render process crashes.
- Preload errors.

It stops repo watching on `window-all-closed` and `before-quit`.

## Chapter 5.4 IPC Surface

The preload exposes `window.primarieElectron` with:

- `selectDirectory()`
- `getGitState(repoPath)`
- `readChangedFiles(repoPath)`
- `readEnvExample(repoPath)`
- `startWatchingRepo(repoPath)`
- `stopWatchingRepo()`
- `onRepoFileChanged(callback)`
- `onRepoSyncSnapshot(callback)`
- `onRepoWatchError(callback)`

All repo path inputs are validated in main process and must point to a Git repository.

## Chapter 5.5 Git State And Changed Files

Git state fields:

```ts
{
  branch: string;
  commit: string;
  isDirty: boolean;
  changedFiles: string[];
}
```

Git commands:

- `git rev-parse --abbrev-ref HEAD`
- `git rev-parse HEAD`
- `git status --porcelain`

Changed file payload:

```ts
{
  path: string;
  status: "modified" | "added" | "deleted";
  contentBase64?: string;
  warning?: string;
}
```

Changed file handling:

- Deleted or missing files become `{ status: "deleted" }`.
- Non-files are ignored.
- Files larger than 1 MB are skipped with warning.
- Files containing a null byte in the first 8000 bytes are treated as binary and skipped with warning.
- Text files are read and encoded as base64.

Ignored segments:

- `.git`
- `node_modules`
- `dist`
- `build`
- `.next`
- `coverage`

Ignored files:

- `.env`

## Chapter 5.6 Environment Variable Reading

Electron reads `.env` from the selected repository. If it does not exist, it reads `.env.example`.

Parsing behavior:

- Blank lines and comments are ignored.
- Leading `export ` is stripped.
- Values are split on the first `=`.
- Single or double quotes around full values are removed.
- Keys must match `^[A-Za-z_][A-Za-z0-9_]*$`.

The renderer passes these editable values to the API as `env`.

## Chapter 5.7 File Watcher

`file-sync.ts` uses chokidar with:

- Ignored paths based on `git.ts` ignore rules.
- `ignoreInitial: true`.
- `awaitWriteFinish` with stability threshold `200ms` and poll interval `50ms`.

Additional behavior:

- A debounce of `500ms` is used for file events.
- Git state is polled every `1000ms`.
- The renderer receives complete sync snapshots containing Git state and changed file payloads.
- A signature made from branch, commit, and sorted changed file names prevents duplicate emissions.

## Chapter 5.8 Renderer State

Important localStorage keys:

- `primarie-composer.auth`
- `primarie-composer.repoPath`
- `primarie-composer.activeEnvironmentKey`
- `primarie-composer.lastEmail`

Top-level pages:

- `dashboard`
- `environments`
- `users`

Top-level state covers:

- Auth session and login errors.
- Repository path and Git status.
- Environment list, dashboard system logs, metrics, and users.
- Create dialog and env values.
- Creation monitor.
- Details environment.
- Live log sessions.
- Latest local changes.
- Sync state.

## Chapter 5.9 API Client

`ComposerApiClient` wraps fetch calls and sends:

- `content-type: application/json` for JSON requests.
- `authorization: Bearer {accessToken}` for authenticated requests.
- `credentials: include`.

The API client supports:

- Login and token verification.
- User listing.
- Environment list/get/create/delete.
- Direct lifecycle operations.
- Queued lifecycle actions and file-backed action log tails.
- Dashboard system logs and system metrics.
- Container list, file list, exec, and log streams.
- Runtime file browsing.
- Mongo inspection.
- Compose logs.
- File sync.

NDJSON streams are parsed line by line using `TextDecoderStream`.

## Chapter 5.10 Login View

`LoginView` includes:

- API Base URL field.
- Email field.
- Password field.
- Login button.

Current default API base URL in code:

```text
https://prmr.md
```

The last email is stored locally. Password is cleared after submit.

## Chapter 5.11 Dashboard Layout

The main authenticated layout includes:

- Fixed sidebar on desktop.
- Mobile inline sidebar content.
- Navigation buttons for Dashboard, Environments, Users, plus non-functional System Logs and Settings items.
- API endpoint display.
- Logout button.

The Dashboard navigation target should show the database-backed system log feed. These are the only logs stored in MongoDB and are read from the shared `logs` collection.

Sidebar cards:

- Repository picker.
- Active environment/sync target.
- Git status.
- Latest changes.

## Chapter 5.12 Dashboard Page

`EnvironmentList` acts as the dashboard page.

It shows:

- System overview title.
- Refresh/health button.
- Environment and system metric stat boxes.
- Static network map panel.
- Searchable global system log table backed only by the MongoDB `logs` collection.
- Infinite-ish log loading based on scroll near bottom.

The dashboard log table should show system activity events such as:

- Environment created.
- Environment started.
- Environment resumed.
- Environment stopped.
- Environment restarted.
- Environment removed.
- Environment failed.
- Environment updated by file sync.
- Environment updated or removed by pull request automation.

The dashboard must not show file-backed lifecycle action transcripts, Compose logs, or container logs in this table. Those belong in environment details or log tail views.

Stats include total, active, stopped, failed, created today, inferred containers, CPU, RAM, and storage.

Several displayed dashboard labels are static or inferred rather than API-backed.

## Chapter 5.13 Environments Page

`EnvironmentsPage` shows:

- Create environment button disabled until a repo is selected.
- Grouped environment sections.
- Environment rows/cards with owner, type, URLs, branch, status, created date, container count, and actions.
- Resource usage panel.

Grouping rules:

- Manual environments are grouped by user owner.
- The current authenticated user's environments are shown first under `Me`.
- Other user-owned environments are grouped after `Me`, one group per user.
- Pull request environments are grouped separately by pull request.
- The PR section shows a list of PR groups, and each PR group contains its environment or environments.
- PR grouping uses pull request metadata from `createdBy` when it is a pull request reference.

The page should support scanning across all groups without requiring the operator to switch tabs first. Tabs or segmented controls can still exist, but they should filter or focus these groups rather than replace the grouping model.

Actions:

- View details.
- Set active sync target.
- Start/stop.
- Restart.
- Delete.

Group labels:

- `Me`: environments where `createdBy.email` matches the current session user email.
- Other users: display the owner's name or email.
- PRs: display pull request title when present, otherwise pull request URL.

Domain display currently builds:

```text
admin-{key}.prmr.md
api-{key}.prmr.md
```

## Chapter 5.14 Create Environment Dialog

`EnvironmentCreateForm` includes:

- Seed selector.
- Environment variable editor.
- Static progress step list.
- Cancel and Create buttons.

Current seed options:

- `default`

Submit payload to parent:

```ts
{
  seed: string;
  useCurrentRepoState: true;
  env: Record<string, string>;
}
```

The parent then creates from current Git branch/commit.

## Chapter 5.15 Environment Details

The details view includes:

- Header with environment key, status, owner, branch, dates, domains, and lifecycle buttons.
- Left sidebar container list.
- Utility tabs:
  - Logs
  - Files
  - Exec
  - Mongo
  - Actions
- Bottom command input for selected container.

Container tools:

- Refresh containers.
- Select container.
- Stream container logs.
- Browse container filesystem.
- Execute shell commands.

Environment tools:

- Browse runtime filesystem if no container is selected.
- Inspect MongoDB collections and sample documents.
- View queued lifecycle actions and their attached log files.
- Start Compose log stream.

## Chapter 5.16 Live Log Sessions

Renderer live log sessions are capped:

- Maximum 20 sessions.
- Maximum 800 entries per session.

Sessions can be `running`, `complete`, `error`, or `stopped`.

Container and Compose log sessions use abort controllers. Lifecycle action sessions read the newest tail segment first, lazy-load older file segments as the operator scrolls upward, and use `tail -f` style streaming for live output until completion or error.

## Chapter 5.17 Sync State

Sync state:

```ts
{
  watching: boolean;
  activeEnvironmentKey: string;
  lastSyncedFile?: string;
  lastSyncTime?: string;
  errors: string[];
}
```

When sync starts:

- Electron watcher starts for selected repo.
- Snapshots are sent to `/sync-files`.
- Files with warnings are not synced and become sync errors.
- Errors retain only the last few entries.

## Chapter 5.18 Users Page

The Users page displays central API users.

Features:

- Search by name, email, role, or status.
- Table with identity, inferred role, provision date, static last-auth labels, inferred status, and operation icons.
- Static Create user button.
- Static/global activity feed using first loaded users when available.
- Role distribution chart.

Create, edit, disable, and delete user operations are UI-only in current code.

## Chapter 5.19 Electron Security

Implemented boundaries:

- Renderer has no Node integration.
- Context isolation is enabled.
- Preload exposes a narrow typed bridge.
- Main process validates selected repo path.
- File reads are resolved inside the selected repo.
- `.env` files are never synced as changed files.

Known TODO in code:

- Replace localStorage token persistence with OS keychain or encrypted storage.

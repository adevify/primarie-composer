import chokidar, { type FSWatcher } from "chokidar";
import { promises as fs } from "node:fs";
import path from "node:path";
import { BrowserWindow } from "electron";
import { assertRepoPath, getGitState, isIgnoredRelativePath, readGitPatch, type GitPatchPayload, type GitState } from "./git.js";

const DEBOUNCE_MS = 500;
const GIT_STATE_POLL_MS = 1000;

export type RepoSyncSnapshot = {
  gitState: GitState;
  patch: GitPatchPayload;
};

let watcher: FSWatcher | null = null;
let watchedRepoPath: string | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
let gitStatePollTimer: NodeJS.Timeout | null = null;
let lastGitSignature = "";
const pendingPaths = new Set<string>();

export function startWatchingRepo(repoPath: string): void {
  const resolvedRepo = assertRepoPath(repoPath);
  stopWatchingRepo();
  watchedRepoPath = resolvedRepo;

  watcher = chokidar.watch(resolvedRepo, {
    ignored: (filePath) => {
      const relativePath = path.relative(resolvedRepo, filePath);
      return relativePath ? isIgnoredRelativePath(relativePath) : false;
    },
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50
    }
  });

  watcher.on("add", queuePath);
  watcher.on("change", queuePath);
  watcher.on("unlink", queuePath);
  watcher.on("error", (error) => {
    emitToRenderers("repo-watch-error", error instanceof Error ? error.message : String(error));
  });

  startGitStatePolling();
  void emitRepoSyncSnapshot(true);
}

export function stopWatchingRepo(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (gitStatePollTimer) {
    clearInterval(gitStatePollTimer);
    gitStatePollTimer = null;
  }

  lastGitSignature = "";
  pendingPaths.clear();
  void watcher?.close();
  watcher = null;
  watchedRepoPath = null;
}

function queuePath(filePath: string): void {
  if (!watchedRepoPath) {
    return;
  }

  const relativePath = path.relative(watchedRepoPath, filePath).split(path.sep).join("/");
  if (!relativePath || isIgnoredRelativePath(relativePath)) {
    return;
  }

  pendingPaths.add(relativePath);

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    void flushPendingPaths();
  }, DEBOUNCE_MS);
}

async function flushPendingPaths(): Promise<void> {
  if (!watchedRepoPath || pendingPaths.size === 0) {
    return;
  }

  pendingPaths.clear();
  await emitRepoSyncSnapshot(true);
}

function startGitStatePolling(): void {
  gitStatePollTimer = setInterval(() => {
    void emitRepoSyncSnapshot(false);
  }, GIT_STATE_POLL_MS);
}

async function emitRepoSyncSnapshot(force: boolean): Promise<void> {
  if (!watchedRepoPath) {
    return;
  }

  try {
    const gitState = await getGitState(watchedRepoPath);
    const signature = await toGitSignature(watchedRepoPath, gitState);
    if (!force && signature === lastGitSignature) {
      return;
    }

    const patch = await readGitPatch(watchedRepoPath, "delta");
    const snapshot: RepoSyncSnapshot = { gitState, patch };
    emitToRenderers("repo-sync-snapshot", snapshot);
    lastGitSignature = signature;
  } catch (error) {
    emitToRenderers("repo-watch-error", error instanceof Error ? error.message : String(error));
  }
}

async function toGitSignature(repoPath: string, gitState: GitState): Promise<string> {
  const changedFiles = await Promise.all(
    [...gitState.changedFiles].sort().map(async (relativePath) => ({
      path: relativePath,
      stat: await readChangedFileStat(repoPath, relativePath)
    }))
  );

  return JSON.stringify({
    branch: gitState.branch,
    commit: gitState.commit,
    changedFiles
  });
}

async function readChangedFileStat(repoPath: string, relativePath: string): Promise<{ exists: boolean; size?: number; mtimeMs?: number; ctimeMs?: number }> {
  const resolvedPath = path.resolve(repoPath, relativePath);
  const relativeToRepo = path.relative(repoPath, resolvedPath);
  if (relativeToRepo.startsWith("..") || path.isAbsolute(relativeToRepo)) {
    return { exists: false };
  }

  try {
    const stat = await fs.stat(resolvedPath);
    return {
      exists: true,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { exists: false };
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function emitToRenderers(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

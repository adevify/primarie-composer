import chokidar, { type FSWatcher } from "chokidar";
import path from "node:path";
import { BrowserWindow } from "electron";
import { assertRepoPath, isIgnoredRelativePath, readChangedFiles } from "./git.js";

const DEBOUNCE_MS = 500;

let watcher: FSWatcher | null = null;
let watchedRepoPath: string | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
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
}

export function stopWatchingRepo(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

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

  const paths = [...pendingPaths];
  pendingPaths.clear();

  try {
    const files = await readChangedFiles(watchedRepoPath, paths);
    emitToRenderers("repo-file-changed", files);
  } catch (error) {
    emitToRenderers("repo-watch-error", error instanceof Error ? error.message : String(error));
  }
}

function emitToRenderers(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

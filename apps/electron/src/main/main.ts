import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import path from "node:path";
import { assertRepoPath, getGitState, readChangedFiles, readEnvExample } from "./git.js";
import { startWatchingRepo, stopWatchingRepo } from "./file-sync.js";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    title: "Primarie Composer",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  attachDebugHandlers(mainWindow);
  mainWindow.webContents.openDevTools({ mode: "detach" });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

function attachDebugHandlers(window: BrowserWindow): void {
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer:load-failed] ${errorCode} ${errorDescription} ${validatedURL}`);
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[renderer:process-gone]", details);
  });

  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`[preload:error] ${preloadPath}`, error);
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  stopWatchingRepo();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopWatchingRepo();
});

function registerIpcHandlers(): void {
  ipcMain.handle("repo:select-directory", async () => {
    const options: OpenDialogOptions = {
      title: "Choose local repository",
      properties: ["openDirectory"]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const selectedPath = result.filePaths[0];
    assertRepoPath(selectedPath);
    return selectedPath;
  });

  ipcMain.handle("repo:get-git-state", async (_event, repoPath: unknown) => {
    return getGitState(validateRepoPathInput(repoPath));
  });

  ipcMain.handle("repo:read-changed-files", async (_event, repoPath: unknown) => {
    return readChangedFiles(validateRepoPathInput(repoPath));
  });

  ipcMain.handle("repo:read-env-example", async (_event, repoPath: unknown) => {
    return readEnvExample(validateRepoPathInput(repoPath));
  });

  ipcMain.handle("repo:start-watching", (_event, repoPath: unknown) => {
    startWatchingRepo(validateRepoPathInput(repoPath));
  });

  ipcMain.handle("repo:stop-watching", () => {
    stopWatchingRepo();
  });
}

function validateRepoPathInput(repoPath: unknown): string {
  if (typeof repoPath !== "string") {
    throw new Error("Repository path must be a string.");
  }
  return assertRepoPath(repoPath);
}

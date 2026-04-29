import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import path from "node:path";
import { assertRepoPath, getGitState, readChangedFiles } from "./git.js";
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
      preload: path.join(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
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

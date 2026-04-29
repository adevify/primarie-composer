import { contextBridge, ipcRenderer } from "electron";
import type { ChangedFilePayload, GitState } from "./git.js";

const electronAPI = {
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke("repo:select-directory"),
  getGitState: (repoPath: string): Promise<GitState> => ipcRenderer.invoke("repo:get-git-state", repoPath),
  readChangedFiles: (repoPath: string): Promise<ChangedFilePayload[]> =>
    ipcRenderer.invoke("repo:read-changed-files", repoPath),
  startWatchingRepo: (repoPath: string): Promise<void> => ipcRenderer.invoke("repo:start-watching", repoPath),
  stopWatchingRepo: (): Promise<void> => ipcRenderer.invoke("repo:stop-watching"),
  onRepoFileChanged: (callback: (files: ChangedFilePayload[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, files: ChangedFilePayload[]) => callback(files);
    ipcRenderer.on("repo-file-changed", listener);
    return () => ipcRenderer.removeListener("repo-file-changed", listener);
  },
  onRepoWatchError: (callback: (message: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on("repo-watch-error", listener);
    return () => ipcRenderer.removeListener("repo-watch-error", listener);
  }
};

contextBridge.exposeInMainWorld("primarieElectron", electronAPI);

export type PrimarieElectronAPI = typeof electronAPI;

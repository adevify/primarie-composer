import { contextBridge, ipcRenderer } from "electron";
import type { EnvExampleEntry, GitPatchMode, GitPatchPayload, GitState } from "./git.js";
import type { RepoSyncSnapshot } from "./file-sync.js";

const openUrl = (url: string): Promise<void> => ipcRenderer.invoke("external:open-url", url);

const electronAPI = {
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke("repo:select-directory"),
  getGitState: (repoPath: string): Promise<GitState> => ipcRenderer.invoke("repo:get-git-state", repoPath),
  readGitPatch: (repoPath: string, mode?: GitPatchMode): Promise<GitPatchPayload> =>
    ipcRenderer.invoke("repo:read-git-patch", repoPath, mode),
  commitPatchBaseline: (repoPath: string, expectedSha256: string): Promise<void> =>
    ipcRenderer.invoke("repo:commit-patch-baseline", repoPath, expectedSha256),
  readEnvExample: (repoPath: string): Promise<EnvExampleEntry[]> => ipcRenderer.invoke("repo:read-env-example", repoPath),
  startWatchingRepo: (repoPath: string): Promise<void> => ipcRenderer.invoke("repo:start-watching", repoPath),
  stopWatchingRepo: (): Promise<void> => ipcRenderer.invoke("repo:stop-watching"),
  openExternalUrl: openUrl,
  onRepoSyncSnapshot: (callback: (snapshot: RepoSyncSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: RepoSyncSnapshot) => callback(snapshot);
    ipcRenderer.on("repo-sync-snapshot", listener);
    return () => ipcRenderer.removeListener("repo-sync-snapshot", listener);
  },
  onRepoWatchError: (callback: (message: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on("repo-watch-error", listener);
    return () => ipcRenderer.removeListener("repo-watch-error", listener);
  }
};

const externalLinkAPI = {
  openUrl
};

contextBridge.exposeInMainWorld("primarieElectron", electronAPI);
contextBridge.exposeInMainWorld("electron", externalLinkAPI);

export type PrimarieElectronAPI = typeof electronAPI;
export type ElectronOpenAPI = typeof externalLinkAPI;

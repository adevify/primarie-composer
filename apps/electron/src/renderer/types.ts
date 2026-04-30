import type { PrimarieElectronAPI } from "../main/preload";

export type ChangedFileStatus = "modified" | "added" | "deleted";

export type ChangedFilePayload = {
  path: string;
  contentBase64?: string;
  status: ChangedFileStatus;
  warning?: string;
};

export type GitState = {
  branch: string;
  commit: string;
  isDirty: boolean;
  changedFiles: string[];
};

export type RepoSyncSnapshot = {
  gitState: GitState;
  files: ChangedFilePayload[];
};

export type AuthSession = {
  apiBaseUrl: string;
  accessToken: string;
  expiresAt?: string;
  user?: EnvironmentOwner;
};

export type EnvironmentStatus = "creating" | "running" | "stopped" | "error";

export type EnvironmentSource = {
  branch: string;
  commit: string;
  dirty: boolean;
  changedFiles: ChangedFilePayload[];
};

export type EnvironmentOwner = {
  id: string;
  name: string;
};

export type PullRequestRef = {
  provider: "github";
  repository: string;
  number: number;
  title?: string;
  url: string;
  headSha?: string;
  state?: "open" | "merged" | "closed";
};

export type EnvironmentRecord = {
  key: string;
  port?: number;
  status: EnvironmentStatus;
  seed: string;
  createdBy?: EnvironmentOwner;
  pullRequest?: PullRequestRef;
  branch?: string;
  commit?: string;
  dirty?: boolean;
  source?: EnvironmentSource;
  createdAt?: string;
  updatedAt?: string;
  runtimePath?: string;
  domains?: string[];
  config?: {
    key: string;
    port: number;
    rootDomain: string;
    seed: string;
    domains: string[];
    runtimePath: string;
    repoPath: string;
    mongoDumpPath: string;
    createdBy: EnvironmentOwner;
    pullRequest?: PullRequestRef;
    source?: EnvironmentSource;
  };
};

export type EnvironmentLog = {
  createdAt: string;
  log: string;
  level: "info" | "warn" | "error" | "debug";

};

export type CreateEnvironmentInput = {
  key?: string;
  source?: EnvironmentSource;
};

export type SyncFilesInput = {
  branch: string;
  commit: string;
  files: ChangedFilePayload[];
};

export type SyncState = {
  watching: boolean;
  activeEnvironmentKey: string;
  lastSyncedFile?: string;
  lastSyncTime?: string;
  errors: string[];
};

declare global {
  interface Window {
    primarieElectron: PrimarieElectronAPI;
  }
}

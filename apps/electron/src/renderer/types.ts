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

export type AuthSession = {
  apiBaseUrl: string;
  accessToken: string;
  expiresAt?: string;
};

export type EnvironmentStatus = "creating" | "running" | "stopped" | "error";

export type EnvironmentRecord = {
  key: string;
  port?: number;
  status: EnvironmentStatus;
  seed: string;
  tenants: string[];
  branch?: string;
  commit?: string;
  dirty?: boolean;
  createdAt?: string;
  updatedAt?: string;
  runtimePath?: string;
  domains?: string[];
};

export type CreateEnvironmentInput = {
  key?: string;
  seed: string;
  tenants: string[];
  source?: {
    branch: string;
    commit: string;
    dirty: boolean;
    changedFiles: ChangedFilePayload[];
  };
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

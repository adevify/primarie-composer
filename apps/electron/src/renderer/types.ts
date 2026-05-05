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

export type EnvExampleEntry = {
  key: string;
  value: string;
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
};

export type EnvironmentOwner = {
  email: string;
  name: string;
};

export type UserDirectoryRecord = EnvironmentOwner & {
  provisionedAt?: string;
  role?: string;
  status?: "online" | "idle" | "locked";
};

export type PullRequestRef = {
  title?: string;
  url: string;
};

export type EnvironmentRecord = {
  key: string;
  port: number;
  status: EnvironmentStatus;
  seed: string;
  createdBy: EnvironmentOwner | PullRequestRef;
  source: EnvironmentSource;
  createdAt: string;
  updatedAt: string;
};

export type EnvironmentLog = {
  environmentKey: string;
  createdAt: string;
  log: string;
  level: "info" | "warn" | "error";
  system: boolean;
};

export type EnvironmentLogsPage = {
  total: number;
  page: number;
  perPage: number;
  pages: number;
  items: EnvironmentLog[];
};

export type SystemMetrics = {
  cpu: {
    percent: number;
    loadAverage: number[];
    cores: number;
  };
  memory: {
    usedBytes: number;
    totalBytes: number;
    percent: number;
  };
  storage: {
    usedBytes: number;
    availableBytes: number;
    totalBytes: number;
    percent: number;
  };
};

export type EnvironmentContainer = {
  ID?: string;
  Name?: string;
  Service?: string;
  Image?: string;
  State?: string;
  Status?: string;
  Names?: string;
};

export type ContainerFileEntry = {
  path: string;
  name: string;
  type: string;
  size?: number;
  modifiedAt?: string;
};

export type MongoPreview = {
  available: boolean;
  reason?: string;
  container?: string;
  database?: string;
  collections?: Array<{
    name: string;
    count: number;
    sample: unknown;
  }>;
};

export type ContainerExecResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type LifecycleAction = "start" | "stop" | "restart" | "resume";

export type StreamLogEvent =
  | { type: "line"; log: string; level: "info" | "error" }
  | { type: "environment"; environment: EnvironmentRecord }
  | { type: "complete" }
  | { type: "error"; log: string; level: "error" };

export type ComposeLogEntry = {
  log: string;
  level: "info" | "error";
};

export type LiveLogSession = {
  id: string;
  environmentKey: string;
  title: string;
  subtitle: string;
  status: "running" | "complete" | "error" | "stopped";
  entries: Array<{ at: string; log: string; level: "info" | "error" }>;
};

export type CreateEnvironmentInput = {
  seed: string;
  source: EnvironmentSource;
  env?: Record<string, string>;
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

import type { ElectronOpenAPI, PrimarieElectronAPI } from "../main/preload";

export type GitPatchMode = "delta" | "full";

export type GitPatchPayload = {
  mode: GitPatchMode;
  data: string;
  previousSha256: string;
  currentSha256: string;
  currentSizeBytes: number;
  changedFiles: string[];
  isEmpty: boolean;
};

export type GitState = {
  branch: string;
  commit: string;
  isDirty: boolean;
  changedFiles: string[];
};

export type RepoSyncSnapshot = {
  gitState: GitState;
  patch: GitPatchPayload;
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

export type EnvironmentStatus =
  | "creating"
  | "cloning"
  | "checking_out"
  | "applying_changes"
  | "starting"
  | "running"
  | "stopped"
  | "failed"
  | "removing"
  | "removed";

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

export type SystemLogActor = {
  type: "user" | "system" | "github";
  email?: string;
  name?: string;
  url?: string;
};

export type EnvironmentLog = {
  id: string;
  createdAt: string;
  level: "info" | "warn" | "error";
  event: string;
  message: string;
  source: "api" | "worker" | "electron" | "github" | "system";
  actor?: SystemLogActor;
  target?: {
    type: "environment" | "pull_request" | "system";
    environmentKey?: string;
    pullRequestUrl?: string;
  };
  environmentKey?: string;
  actionId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
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

export type MongoCollectionSummary = {
  name: string;
  count: number;
  sizeBytes?: number;
  storageSizeBytes?: number;
};

export type MongoCollectionsResponse = {
  available?: boolean;
  reason?: string;
  database?: string;
  collections: MongoCollectionSummary[];
};

export type MongoDocumentsPage = {
  collection: string;
  page: number;
  limit: number;
  total: number;
  documents: unknown[];
};

export type MongoInsertResult = {
  insertedCount: number;
  insertedIds: unknown[];
};

export type MongoDeleteResult = {
  matchedCount: number;
  deletedCount: number;
};

export type MongoUpdateResult = {
  matchedCount: number;
  modifiedCount: number;
};

export type MongoImportProdTennantResult = {
  tennant: string;
  database: string;
  importedCollections: number;
  importedDocuments: number;
  collections: Array<{
    key: string;
    collection: string;
    count: number;
  }>;
};

export type ContainerExecResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type LifecycleAction = "start" | "stop" | "restart" | "resume" | "delete";

export type EnvironmentActionStatus = "queued" | "running" | "complete" | "error";

export type EnvironmentActionRecord = {
  id: string;
  environmentKey: string;
  action: LifecycleAction;
  status: EnvironmentActionStatus;
  logFile?: {
    path: string;
    driver: "file";
    createdAt: string;
    updatedAt?: string;
    sizeBytes?: number;
  };
  environment?: EnvironmentRecord;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type EnvironmentActionLog = {
  actionId: string;
  line: string;
  log?: string;
  level: "info" | "error";
  byteStart?: number;
  byteEnd?: number;
  createdAt?: string;
};

export type EnvironmentActionLogsPage = {
  actionId: string;
  cursor?: string;
  nextCursor?: string;
  hasMore: boolean;
  items: EnvironmentActionLog[];
};

export type EnvironmentActionsPage = {
  total: number;
  page: number;
  perPage: number;
  pages: number;
  items: EnvironmentActionRecord[];
};

export type StreamLogEvent =
  | { type: "line"; line?: string; log?: string; level: "info" | "error"; byteStart?: number; byteEnd?: number; createdAt?: string }
  | { type: "environment"; environment: EnvironmentRecord }
  | { type: "action"; action: EnvironmentActionRecord }
  | { type: "complete" }
  | { type: "error"; message?: string; log?: string; level: "error" };

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
  patch: GitPatchPayload;
  resetBeforeApply?: boolean;
};

export type FileSyncEvent = {
  id: string;
  environmentKey: string;
  path: string;
  status: "metadata";
  result: "sent" | "skipped" | "failed";
  branch: string;
  commit: string;
  at: string;
  warning?: string;
  error?: string;
};

export type SyncState = {
  watching: boolean;
  syncing: boolean;
  activeEnvironmentKey: string;
  lastSyncedFile?: string;
  lastSyncTime?: string;
  errors: string[];
};

declare global {
  interface Window {
    electron: ElectronOpenAPI;
    primarieElectron: PrimarieElectronAPI;
  }
}

import type {
  AuthSession,
  ComposeLogEntry,
  ContainerExecResult,
  ContainerFileEntry,
  CreateEnvironmentInput,
  EnvironmentContainer,
  EnvironmentActionLogsPage,
  EnvironmentActionRecord,
  EnvironmentActionsPage,
  EnvironmentLogsPage,
  EnvironmentRecord,
  LifecycleAction,
  MongoCollectionsResponse,
  MongoDeleteResult,
  MongoDocumentsPage,
  MongoInsertResult,
  MongoImportProdTennantResult,
  MongoPreview,
  MongoUpdateResult,
  StreamLogEvent,
  SystemMetrics,
  SyncFilesInput,
  UserDirectoryRecord
} from "./types";

type RequestOptions = {
  method?: string;
  body?: unknown;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ComposerApiClient {
  constructor(private session: AuthSession) { }

  updateSession(session: AuthSession): void {
    this.session = session;
  }

  async login(baseUrl: string, email: string, password: string): Promise<AuthSession> {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await parseResponse<{ accessToken: string; expiresAt?: string; expiresIn?: string; user?: AuthSession["user"] }>(response);

    return {
      apiBaseUrl: normalizeBaseUrl(baseUrl),
      accessToken: data.accessToken,
      expiresAt: data.expiresAt ?? data.expiresIn,
      user: data.user
    };
  }

  async verifyToken(): Promise<boolean> {
    try {
      // TODO: Backend endpoint is assumed until /auth/verify or /auth/me is implemented.
      await this.request<{ ok: boolean }>("/auth/verify");
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return !isSessionExpired(this.session);
      }
      if (error instanceof ApiError && error.status === 401) {
        return false;
      }
      throw error;
    }
  }

  listUsers(): Promise<UserDirectoryRecord[]> {
    return this.request<UserDirectoryRecord[]>("/auth/users");
  }

  listEnvironments(): Promise<EnvironmentRecord[]> {
    return this.request<EnvironmentRecord[]>("/environments");
  }

  getEnvironment(key: string): Promise<EnvironmentRecord> {
    return this.request<EnvironmentRecord>(`/environments/${encodeURIComponent(key)}`);
  }

  createEnvironment(input: CreateEnvironmentInput): Promise<EnvironmentRecord> {
    return this.request<EnvironmentRecord>("/environments", { method: "POST", body: input });
  }

  startEnvironment(key: string): Promise<EnvironmentRecord> {
    return this.request<EnvironmentRecord>(`/environments/${encodeURIComponent(key)}/start`, { method: "POST" });
  }

  stopEnvironment(key: string): Promise<EnvironmentRecord> {
    return this.request<EnvironmentRecord>(`/environments/${encodeURIComponent(key)}/stop`, { method: "POST" });
  }

  restartEnvironment(key: string): Promise<EnvironmentRecord> {
    return this.request<EnvironmentRecord>(`/environments/${encodeURIComponent(key)}/restart`, { method: "POST" });
  }

  resumeEnvironment(key: string): Promise<EnvironmentRecord> {
    return this.request<EnvironmentRecord>(`/environments/${encodeURIComponent(key)}/resume`, { method: "POST" });
  }

  createLifecycleAction(key: string, action: LifecycleAction): Promise<EnvironmentActionRecord> {
    return this.request<EnvironmentActionRecord>(
      `/environments/${encodeURIComponent(key)}/actions/${encodeURIComponent(action)}`,
      { method: "POST" }
    );
  }

  lifecycleActions(key: string, page = 0, perPage = 20): Promise<EnvironmentActionsPage> {
    const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
    return this.request<EnvironmentActionsPage>(`/environments/${encodeURIComponent(key)}/actions?${params.toString()}`);
  }

  getLifecycleAction(id: string): Promise<EnvironmentActionRecord> {
    return this.request<EnvironmentActionRecord>(`/environments/actions/${encodeURIComponent(id)}`);
  }

  lifecycleActionLogs(id: string, cursor?: string, limit = 200): Promise<EnvironmentActionLogsPage> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) {
      params.set("cursor", cursor);
    }
    return this.request<EnvironmentActionLogsPage>(`/environments/actions/${encodeURIComponent(id)}/logs?${params.toString()}`);
  }

  streamLifecycleActionLogs(
    id: string,
    options: { from?: number; replayTail?: number },
    onEvent: (event: StreamLogEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const params = new URLSearchParams();
    if (options.from !== undefined) {
      params.set("from", String(options.from));
    }
    if (options.replayTail !== undefined) {
      params.set("replayTail", String(options.replayTail));
    }
    return this.streamNdjson(`/environments/actions/${encodeURIComponent(id)}/logs/stream?${params.toString()}`, onEvent, signal);
  }

  logs(key: string): Promise<EnvironmentLogsPage> {
    return this.request<EnvironmentLogsPage>(`/environments/${encodeURIComponent(key)}/logs`);
  }

  allLogs(page = 0, perPage = 50): Promise<EnvironmentLogsPage> {
    return this.request<EnvironmentLogsPage>(`/environments/logs/all?${new URLSearchParams({ page: String(page), perPage: String(perPage) }).toString()}`);
  }

  systemMetrics(): Promise<SystemMetrics> {
    return this.request<SystemMetrics>("/environments/system/metrics");
  }

  listContainers(key: string): Promise<EnvironmentContainer[]> {
    return this.request<EnvironmentContainer[]>(`/environments/${encodeURIComponent(key)}/containers`);
  }

  listContainerFiles(key: string, container: string, path: string): Promise<ContainerFileEntry[]> {
    const params = new URLSearchParams({ path });
    return this.request<ContainerFileEntry[]>(
      `/environments/${encodeURIComponent(key)}/containers/${encodeURIComponent(container)}/files?${params.toString()}`
    );
  }

  listEnvironmentFiles(key: string, path: string): Promise<ContainerFileEntry[]> {
    const params = new URLSearchParams({ path });
    return this.request<ContainerFileEntry[]>(`/environments/${encodeURIComponent(key)}/files?${params.toString()}`);
  }

  inspectMongo(key: string): Promise<MongoPreview> {
    return this.request<MongoPreview>(`/environments/${encodeURIComponent(key)}/mongo`);
  }

  listMongoCollections(key: string): Promise<MongoCollectionsResponse> {
    return this.request<MongoCollectionsResponse>(`/environments/${encodeURIComponent(key)}/mongo/collections`);
  }

  searchMongoDocuments(
    key: string,
    collection: string,
    input: { filter: Record<string, unknown>; page: number; limit: number; sort: Record<string, unknown> }
  ): Promise<MongoDocumentsPage> {
    return this.request<MongoDocumentsPage>(
      `/environments/${encodeURIComponent(key)}/mongo/collections/${encodeURIComponent(collection)}/documents/search`,
      { method: "POST", body: input }
    );
  }

  insertMongoDocuments(key: string, collection: string, documents: Record<string, unknown>[]): Promise<MongoInsertResult> {
    return this.request<MongoInsertResult>(
      `/environments/${encodeURIComponent(key)}/mongo/collections/${encodeURIComponent(collection)}/documents`,
      { method: "POST", body: { documents } }
    );
  }

  deleteMongoDocuments(
    key: string,
    collection: string,
    input: { filter: Record<string, unknown>; many: boolean; confirm: true; allowEmptyFilter?: boolean }
  ): Promise<MongoDeleteResult> {
    return this.request<MongoDeleteResult>(
      `/environments/${encodeURIComponent(key)}/mongo/collections/${encodeURIComponent(collection)}/documents`,
      { method: "DELETE", body: input }
    );
  }

  updateMongoDocuments(
    key: string,
    collection: string,
    input: { filter: Record<string, unknown>; update: Record<string, unknown>; many: boolean; confirm: true; allowEmptyFilter?: boolean }
  ): Promise<MongoUpdateResult> {
    return this.request<MongoUpdateResult>(
      `/environments/${encodeURIComponent(key)}/mongo/collections/${encodeURIComponent(collection)}/documents`,
      { method: "PATCH", body: input }
    );
  }

  importProdTennant(key: string, input: { tennant: string }): Promise<MongoImportProdTennantResult> {
    return this.request<MongoImportProdTennantResult>(
      `/environments/${encodeURIComponent(key)}/mongo/import-prod-tennant`,
      { method: "POST", body: input }
    );
  }

  composeLogs(key: string, page = 0, perPage = 50): Promise<ComposeLogEntry[]> {
    const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
    return this.request<ComposeLogEntry[]>(`/environments/${encodeURIComponent(key)}/compose/logs?${params.toString()}`);
  }

  containerLogs(key: string, container: string, page = 0, perPage = 50): Promise<ComposeLogEntry[]> {
    const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
    return this.request<ComposeLogEntry[]>(
      `/environments/${encodeURIComponent(key)}/containers/${encodeURIComponent(container)}/logs?${params.toString()}`
    );
  }

  execInContainer(key: string, container: string, command: string): Promise<ContainerExecResult> {
    return this.request<ContainerExecResult>(
      `/environments/${encodeURIComponent(key)}/containers/${encodeURIComponent(container)}/exec`,
      { method: "POST", body: { command } }
    );
  }

  streamLifecycleAction(
    key: string,
    action: LifecycleAction,
    onEvent: (event: StreamLogEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    return this.streamNdjson(`/environments/${encodeURIComponent(key)}/actions/${encodeURIComponent(action)}/stream`, onEvent, signal);
  }

  streamContainerLogs(
    key: string,
    container: string,
    onEvent: (event: StreamLogEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    return this.streamNdjson(
      `/environments/${encodeURIComponent(key)}/containers/${encodeURIComponent(container)}/logs/stream`,
      onEvent,
      signal
    );
  }

  streamComposeLogs(
    key: string,
    onEvent: (event: StreamLogEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    return this.streamNdjson(
      `/environments/${encodeURIComponent(key)}/compose/logs/stream`,
      onEvent,
      signal
    );
  }

  async deleteEnvironment(key: string): Promise<void> {
    await this.request<void>(`/environments/${encodeURIComponent(key)}`, { method: "DELETE" });
  }

  syncFiles(key: string, input: SyncFilesInput): Promise<EnvironmentRecord> {
    return this.request<EnvironmentRecord>(`/environments/${encodeURIComponent(key)}/sync-files`, {
      method: "POST",
      body: input
    });
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";
    const url = new URL(`${this.session.apiBaseUrl}${path}`);
    if (method === "GET") {
      url.searchParams.set("_", String(Date.now()));
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.session.accessToken}`,
        "cache-control": "no-cache"
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      credentials: "include"
    });

    return parseResponse<T>(response);
  }

  private async streamNdjson(path: string, onEvent: (event: StreamLogEvent) => void, signal?: AbortSignal): Promise<void> {
    const response = await fetch(`${this.session.apiBaseUrl}${path}`, {
      headers: {
        authorization: `Bearer ${this.session.accessToken}`,
        "cache-control": "no-cache"
      },
      cache: "no-store",
      signal
    });

    if (!response.ok || !response.body) {
      await parseResponse<never>(response);
      throw new ApiError(`Stream failed with status ${response.status}.`, response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          onEvent(JSON.parse(trimmed) as StreamLogEvent);
        }
      }
    }

    buffer += decoder.decode();
    const trimmed = buffer.trim();
    if (trimmed) {
      onEvent(JSON.parse(trimmed) as StreamLogEvent);
    }
  }
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function isSessionExpired(session: AuthSession): boolean {
  if (!session.expiresAt) {
    return false;
  }

  const expiresAtTime = Date.parse(session.expiresAt);
  if (Number.isNaN(expiresAtTime)) {
    return false;
  }

  return expiresAtTime <= Date.now();
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = parseJsonBody(text);

  if (!response.ok) {
    const message = responseErrorMessage(data, response.status);
    throw new ApiError(message, response.status, data);
  }

  return data as T;
}

function parseJsonBody(text: string): unknown {
  if (!text) {
    return undefined;
  }

  try {
    return normalizeExtendedJson(JSON.parse(text));
  } catch {
    return text;
  }
}

function normalizeExtendedJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeExtendedJson(entry));
  }
  if (!isRecord(value)) {
    return value;
  }

  if (typeof value.$numberInt === "string") {
    const parsed = Number(value.$numberInt);
    return Number.isFinite(parsed) ? parsed : value.$numberInt;
  }
  if (typeof value.$numberLong === "string") {
    const parsed = Number(value.$numberLong);
    return Number.isFinite(parsed) ? parsed : value.$numberLong;
  }
  if (typeof value.$numberDouble === "string") {
    const parsed = Number(value.$numberDouble);
    return Number.isFinite(parsed) ? parsed : value.$numberDouble;
  }
  if (typeof value.$date === "string") {
    return value.$date;
  }
  if (typeof value.$oid === "string") {
    return value.$oid;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, normalizeExtendedJson(nested)]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function responseErrorMessage(data: unknown, status: number): string {
  const base =
    isRecord(data) && typeof data.error === "string"
      ? data.error
      : status === 401
        ? "Unauthorized or expired session."
        : `Request failed with status ${status}.`;
  const detail = responseErrorDetail(data);

  if (!detail || base.includes(detail)) {
    return base;
  }
  return `${base}\n${detail}`;
}

function responseErrorDetail(data: unknown): string | undefined {
  if (!isRecord(data) || !isRecord(data.details)) {
    return undefined;
  }

  const outputTail = typeof data.details.outputTail === "string" ? data.details.outputTail.trim() : "";
  if (outputTail) {
    return outputTail;
  }
  return undefined;
}

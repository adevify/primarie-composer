import type {
  AuthSession,
  ContainerExecResult,
  ContainerFileEntry,
  CreateEnvironmentInput,
  EnvironmentContainer,
  EnvironmentLogsPage,
  EnvironmentRecord,
  LifecycleAction,
  StreamLogEvent,
  SystemMetrics,
  SyncFilesInput
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
    const response = await fetch(`${this.session.apiBaseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.session.accessToken}`
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    return parseResponse<T>(response);
  }

  private async streamNdjson(path: string, onEvent: (event: StreamLogEvent) => void, signal?: AbortSignal): Promise<void> {
    const response = await fetch(`${this.session.apiBaseUrl}${path}`, {
      headers: {
        authorization: `Bearer ${this.session.accessToken}`
      },
      signal
    });

    if (!response.ok || !response.body) {
      await parseResponse<never>(response);
      throw new ApiError(`Stream failed with status ${response.status}.`, response.status);
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += value;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          onEvent(JSON.parse(trimmed) as StreamLogEvent);
        }
      }
    }

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
    const message =
      isRecord(data) && typeof data.error === "string"
        ? data.error
        : response.status === 401
          ? "Unauthorized or expired session."
          : `Request failed with status ${response.status}.`;
    throw new ApiError(message, response.status, data);
  }

  return data as T;
}

function parseJsonBody(text: string): unknown {
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

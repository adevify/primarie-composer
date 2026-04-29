import type { AuthSession, CreateEnvironmentInput, EnvironmentRecord, SyncFilesInput } from "./types";

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
  constructor(private session: AuthSession) {}

  updateSession(session: AuthSession): void {
    this.session = session;
  }

  async login(baseUrl: string, accessKey: string): Promise<AuthSession> {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessKey })
    });
    const data = await parseResponse<{ accessToken: string; expiresAt?: string; expiresIn?: string }>(response);

    return {
      apiBaseUrl: normalizeBaseUrl(baseUrl),
      accessToken: data.accessToken,
      expiresAt: data.expiresAt ?? data.expiresIn
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

  async deleteEnvironment(key: string): Promise<void> {
    await this.request<void>(`/environments/${encodeURIComponent(key)}`, { method: "DELETE" });
  }

  syncFiles(key: string, input: SyncFilesInput): Promise<{ ok?: boolean }> {
    // TODO: Backend endpoint is assumed until server-side file sync is implemented.
    return this.request<{ ok?: boolean }>(`/environments/${encodeURIComponent(key)}/sync-files`, {
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

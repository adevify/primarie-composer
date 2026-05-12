import { Alert, Box, CircularProgress, Stack, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, ComposerApiClient, isSessionExpired, normalizeBaseUrl } from "./api";
import { ActiveEnvironmentCard } from "./components/ActiveEnvironmentCard";
import { DashboardLayout } from "./components/DashboardLayout";
import { EnvironmentCreateForm } from "./components/EnvironmentCreateForm";
import { EnvironmentDetails } from "./components/EnvironmentDetails";
import { EnvironmentsPage } from "./components/EnvironmentsPage";
import { EnvironmentList } from "./components/EnvironmentList";
import { GitStatusCard } from "./components/GitStatusCard";
import { LatestChangesCard, type LatestChangeEvent } from "./components/LatestChangesCard";
import { LoginView } from "./components/LoginView";
import { RepoPicker } from "./components/RepoPicker";
import { UsersPage } from "./components/UsersPage";
import type { AuthSession, ChangedFilePayload, EnvExampleEntry, EnvironmentActionLogsPage, EnvironmentActionRecord, EnvironmentActionsPage, EnvironmentLog, EnvironmentLogsPage, EnvironmentRecord, EnvironmentStatus, GitState, LifecycleAction, LiveLogSession, RepoSyncSnapshot, StreamLogEvent, SyncState, SystemMetrics, UserDirectoryRecord } from "./types";

const AUTH_STORAGE_KEY = "primarie-composer.auth";
const REPO_STORAGE_KEY = "primarie-composer.repoPath";
const ACTIVE_ENV_STORAGE_KEY = "primarie-composer.activeEnvironmentKey";
const MAX_SYNC_CHUNK_CONTENT_LENGTH = 750 * 1024;
const DASHBOARD_LOGS_PER_PAGE = 50;

export default function App() {
  const electronBridge = window.primarieElectron;
  const externalLinkBridge = window.electron;
  const [activePage, setActivePage] = useState<"dashboard" | "environments" | "users">("dashboard");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string>();
  const [repoPath, setRepoPath] = useState(() => localStorage.getItem(REPO_STORAGE_KEY) ?? "");
  const [repoError, setRepoError] = useState<string>();
  const [gitState, setGitState] = useState<GitState>();
  const [gitLoading, setGitLoading] = useState(false);
  const [gitError, setGitError] = useState<string>();
  const [environments, setEnvironments] = useState<EnvironmentRecord[]>([]);
  const [dashboardLogs, setDashboardLogs] = useState<EnvironmentLog[]>([]);
  const [dashboardLogsPage, setDashboardLogsPage] = useState<EnvironmentLogsPage>();
  const [dashboardLogsLoadingMore, setDashboardLogsLoadingMore] = useState(false);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics>();
  const [users, setUsers] = useState<UserDirectoryRecord[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [environmentsLoading, setEnvironmentsLoading] = useState(false);
  const [environmentsError, setEnvironmentsError] = useState<string>();
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string>();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [envExampleEntries, setEnvExampleEntries] = useState<EnvExampleEntry[]>([]);
  const [envExampleLoading, setEnvExampleLoading] = useState(false);
  const [monitoredEnvironmentKey, setMonitoredEnvironmentKey] = useState<string>();
  const [monitoredEnvironment, setMonitoredEnvironment] = useState<EnvironmentRecord>();
  const [creationLogs, setCreationLogs] = useState<EnvironmentLog[]>([]);
  const [creationMonitorLoading, setCreationMonitorLoading] = useState(false);
  const [creationMonitorError, setCreationMonitorError] = useState<string>();
  const [detailsEnvironment, setDetailsEnvironment] = useState<EnvironmentRecord>();
  const [detailsLogRefreshToken, setDetailsLogRefreshToken] = useState(0);
  const [focusedLifecycleAction, setFocusedLifecycleAction] = useState<{ environmentKey: string; action: EnvironmentActionRecord; token: number }>();
  const [liveLogSessions, setLiveLogSessions] = useState<LiveLogSession[]>([]);
  const [latestChanges, setLatestChanges] = useState<LatestChangeEvent[]>([]);
  const streamControllers = useRef(new Map<string, AbortController>());
  const syncInFlightRef = useRef(false);
  const pendingSyncSnapshotRef = useRef<RepoSyncSnapshot | null>(null);
  const [syncState, setSyncState] = useState<SyncState>({
    watching: false,
    activeEnvironmentKey: localStorage.getItem(ACTIVE_ENV_STORAGE_KEY) ?? "",
    errors: []
  });
  const activeEnvironmentKeyRef = useRef(syncState.activeEnvironmentKey);

  const api = useMemo(() => (session ? new ComposerApiClient(session) : null), [session]);

  useEffect(() => {
    activeEnvironmentKeyRef.current = syncState.activeEnvironmentKey;
  }, [syncState.activeEnvironmentKey]);

  useEffect(() => {
    return () => {
      for (const controller of streamControllers.current.values()) {
        controller.abort();
      }
      streamControllers.current.clear();
    };
  }, []);

  const logout = useCallback(() => {
    void electronBridge?.stopWatchingRepo();
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setSession(null);
    setSyncState((current) => ({ ...current, watching: false }));
  }, [electronBridge]);

  const refreshEnvironments = useCallback(async () => {
    if (!api) {
      return;
    }

    setEnvironmentsLoading(true);
    setEnvironmentsError(undefined);
    try {
      const [nextEnvironments, nextLogs, nextMetrics] = await Promise.all([
        api.listEnvironments(),
        api.allLogs(0, DASHBOARD_LOGS_PER_PAGE),
        api.systemMetrics()
      ]);
      setEnvironments(nextEnvironments);
      setDashboardLogs(nextLogs.items);
      setDashboardLogsPage(nextLogs);
      setSystemMetrics(nextMetrics);
    } catch (error) {
      setEnvironmentsError(toErrorMessage(error));
      if (isUnauthorized(error)) {
        logout();
      }
    } finally {
      setEnvironmentsLoading(false);
    }
  }, [api, logout]);

  const refreshUsers = useCallback(async () => {
    if (!api) {
      return;
    }

    setUsersLoading(true);
    setEnvironmentsError(undefined);
    try {
      setUsers(await api.listUsers());
    } catch (error) {
      setEnvironmentsError(toErrorMessage(error));
      if (isUnauthorized(error)) {
        logout();
      }
    } finally {
      setUsersLoading(false);
    }
  }, [api, logout]);

  async function loadMoreDashboardLogs(): Promise<void> {
    if (!api || dashboardLogsLoadingMore || !dashboardLogsPage || dashboardLogsPage.page + 1 >= dashboardLogsPage.pages) {
      return;
    }

    setDashboardLogsLoadingMore(true);
    try {
      const nextPage = await api.allLogs(dashboardLogsPage.page + 1, DASHBOARD_LOGS_PER_PAGE);
      setDashboardLogs((current) => mergeLogs(current, nextPage.items));
      setDashboardLogsPage(nextPage);
    } catch (error) {
      setEnvironmentsError(toErrorMessage(error));
      if (isUnauthorized(error)) {
        logout();
      }
    } finally {
      setDashboardLogsLoadingMore(false);
    }
  }

  useEffect(() => {
    if (!api || detailsEnvironment) {
      return undefined;
    }

    const interval = setInterval(() => {
      void Promise.all([
        api.allLogs(0, DASHBOARD_LOGS_PER_PAGE),
        api.systemMetrics()
      ]).then(([page, metrics]) => {
        setDashboardLogs((current) => mergeLogs(page.items, current).slice(0, Math.max(current.length, DASHBOARD_LOGS_PER_PAGE)));
        setDashboardLogsPage((current) => current ? { ...page, page: current.page, pages: page.pages, total: page.total } : page);
        setSystemMetrics(metrics);
      }).catch((error) => {
        if (isUnauthorized(error)) {
          logout();
        }
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [api, detailsEnvironment, logout]);

  useEffect(() => {
    if (activePage === "users") {
      void refreshUsers();
    }
  }, [activePage, refreshUsers]);

  const refreshGitState = useCallback(async (): Promise<GitState | undefined> => {
    if (!repoPath) {
      return undefined;
    }

    setGitLoading(true);
    setGitError(undefined);
    try {
      if (!electronBridge) {
        throw new Error("Electron preload bridge is unavailable.");
      }
      const nextGitState = await electronBridge.getGitState(repoPath);
      setGitState(nextGitState);
      return nextGitState;
    } catch (error) {
      setGitError(toErrorMessage(error));
      return undefined;
    } finally {
      setGitLoading(false);
    }
  }, [electronBridge, repoPath]);

  useEffect(() => {
    async function verifySavedSession(): Promise<void> {
      const saved = loadSavedSession();
      if (!saved || isSessionExpired(saved)) {
        clearSavedSession();
        setAuthLoading(false);
        return;
      }

      try {
        const client = new ComposerApiClient(saved);
        const valid = await client.verifyToken();
        if (valid) {
          setSession(saved);
        } else {
          clearSavedSession();
        }
      } catch {
        clearSavedSession();
      } finally {
        setAuthLoading(false);
      }
    }

    void verifySavedSession();
  }, []);

  useEffect(() => {
    if (api) {
      void refreshEnvironments();
    }
  }, [api, refreshEnvironments]);

  useEffect(() => {
    if (!api || !monitoredEnvironmentKey) {
      return undefined;
    }

    let cancelled = false;
    let interval: NodeJS.Timeout | undefined;

    async function pollCreation(): Promise<void> {
      if (!api || !monitoredEnvironmentKey || cancelled) {
        return;
      }

      setCreationMonitorLoading(true);
      setCreationMonitorError(undefined);
      try {
        const [environment, logsPage] = await Promise.all([
          api.getEnvironment(monitoredEnvironmentKey),
          api.logs(monitoredEnvironmentKey)
        ]);

        if (cancelled) {
          return;
        }

        setMonitoredEnvironment(environment);
        setCreationLogs(logsPage.items);
        setEnvironments((current) => [environment, ...current.filter((item) => item.key !== environment.key)]);
        if (detailsEnvironment?.key === environment.key) {
          setDetailsEnvironment(environment);
        }

        if (!isEnvironmentPreparing(environment.status) && interval) {
          clearInterval(interval);
          interval = undefined;
        }
      } catch (error) {
        if (!cancelled) {
          setCreationMonitorError(toErrorMessage(error));
          if (isUnauthorized(error)) {
            logout();
          }
        }
      } finally {
        if (!cancelled) {
          setCreationMonitorLoading(false);
        }
      }
    }

    void pollCreation();
    interval = setInterval(() => {
      void pollCreation();
    }, 1500);

    return () => {
      cancelled = true;
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [api, monitoredEnvironmentKey, detailsEnvironment?.key, logout]);

  useEffect(() => {
    if (session && repoPath) {
      void refreshGitState();
    }
  }, [session, repoPath, refreshGitState]);

  useEffect(() => {
    if (!electronBridge) {
      return undefined;
    }

    const unsubscribe = electronBridge.onRepoSyncSnapshot((snapshot) => {
      void handleRepoSyncSnapshot(snapshot);
    });
    const unsubscribeErrors = electronBridge.onRepoWatchError((message) => {
      pushSyncError(message);
    });

    return () => {
      unsubscribe();
      unsubscribeErrors();
    };
  }, [electronBridge, api, repoPath, syncState.activeEnvironmentKey]);

  async function handleLogin(baseUrl: string, email: string, password: string): Promise<void> {
    setLoginLoading(true);
    setLoginError(undefined);
    try {
      const client = new ComposerApiClient({
        apiBaseUrl: normalizeBaseUrl(baseUrl),
        accessToken: "",
        expiresAt: undefined
      });
      const nextSession = await client.login(baseUrl, email, password);
      // TODO: Replace localStorage with OS keychain or encrypted storage.
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
    } catch (error) {
      setLoginError(toErrorMessage(error));
    } finally {
      setLoginLoading(false);
    }
  }

  async function chooseRepo(): Promise<void> {
    setRepoError(undefined);
    try {
      if (!electronBridge) {
        throw new Error("Electron preload bridge is unavailable.");
      }
      await electronBridge.stopWatchingRepo();
      const selectedPath = await electronBridge.selectDirectory();
      if (!selectedPath) {
        return;
      }
      localStorage.setItem(REPO_STORAGE_KEY, selectedPath);
      setRepoPath(selectedPath);
      setSyncState((current) => ({ ...current, watching: false }));
    } catch (error) {
      setRepoError(toErrorMessage(error));
    }
  }

  async function openCreateDialog(): Promise<void> {
    setCreateDialogOpen(true);
    setCreateError(undefined);
    setEnvExampleEntries([]);
    setMonitoredEnvironment(undefined);
    setMonitoredEnvironmentKey(undefined);
    setCreationLogs([]);
    setCreationMonitorError(undefined);

    if (!repoPath) {
      return;
    }

    setEnvExampleLoading(true);
    try {
      setEnvExampleEntries(await readEnvExampleEntries(repoPath));
    } catch (error) {
      setCreateError(toErrorMessage(error));
      if (isUnauthorized(error)) {
        logout();
      }
    } finally {
      setEnvExampleLoading(false);
    }
  }

  async function createEnvironment(input: { seed: string; useCurrentRepoState: boolean; env: Record<string, string> }): Promise<void> {
    if (!api) {
      return;
    }

    setCreateLoading(true);
    setCreateError(undefined);
    try {
      let source;
      let changedFiles: ChangedFilePayload[] = [];
      if (input.useCurrentRepoState) {
        const latestGitState = await refreshGitState();
        if (!latestGitState || !repoPath) {
          throw new Error("Choose a valid repository before creating an environment from local state.");
        }
        if (!electronBridge) {
          throw new Error("Electron preload bridge is unavailable.");
        }
        source = {
          branch: latestGitState.branch,
          commit: latestGitState.commit,
          repoPath
        };

        const localChanges = await electronBridge.readChangedFiles(repoPath);
        recordLatestChanges(localChanges);
        localChanges.filter((file) => file.warning).forEach((file) => pushSyncError(`${file.path}: ${file.warning}`));
        changedFiles = localChanges
          .filter((file) => !file.warning)
          .map((file) => ({
            path: file.path,
            status: file.status,
            contentBase64: file.contentBase64
          }));
      }

      if (!source) {
        throw new Error("Current repo state is required to create an environment.");
      }

      if (!electronBridge) {
        throw new Error("Electron preload bridge is unavailable.");
      }

      const created = await api.createEnvironment({
        seed: input.seed,
        source,
        env: input.env,
        changedFiles
      });
      setEnvironments((current) => [created, ...current.filter((item) => item.key !== created.key)]);
      setMonitoredEnvironment(created);
      setMonitoredEnvironmentKey(created.key);
      setCreationLogs([]);
      setCreationMonitorError(undefined);

      const readyEnvironment = await waitForEnvironmentPrepared(created.key);
      setCreateDialogOpen(false);
      setEnvironments((current) => [readyEnvironment, ...current.filter((item) => item.key !== readyEnvironment.key)]);
      setDetailsEnvironment(readyEnvironment);
      setActivePage("environments");
      setActiveEnvironment(readyEnvironment.key);
      await refreshEnvironments();
    } catch (error) {
      setCreateError(toErrorMessage(error));
      if (isUnauthorized(error)) {
        logout();
      }
    } finally {
      setCreateLoading(false);
    }
  }

  async function waitForEnvironmentPrepared(key: string): Promise<EnvironmentRecord> {
    if (!api) {
      throw new Error("API client is unavailable.");
    }

    let latest = await api.getEnvironment(key);
    for (let attempt = 0; attempt < 180 && isEnvironmentPreparing(latest.status); attempt += 1) {
      await delay(1000);
      latest = await api.getEnvironment(key);
    }

    if (isEnvironmentPreparing(latest.status)) {
      throw new Error(`Environment ${key} is still preparing after 180 seconds.`);
    }

    if (latest.status === "failed" || latest.status === "removed") {
      throw new Error(`Environment ${key} finished in ${latest.status} state.`);
    }

    return latest;
  }

  async function runEnvironmentAction(key: string, action: "start" | "stop" | "restart" | "resume" | "delete"): Promise<void> {
    if (!api) {
      return;
    }

    setEnvironmentsError(undefined);
    try {
      let updatedEnvironment: EnvironmentRecord | undefined;
      const environment = environments.find((item) => item.key === key) ?? (detailsEnvironment?.key === key ? detailsEnvironment : undefined);
      if (environment) {
        setActivePage("environments");
        setDetailsEnvironment(environment);
      }

      updatedEnvironment = await runLifecycleAction(key, action);
      if (action === "start" || action === "restart" || action === "resume") {
        setActiveEnvironment(key);
      }
      if ((action === "stop" || action === "delete") && syncState.activeEnvironmentKey === key) {
        await stopSync();
      }
      if (updatedEnvironment) {
        setDetailsEnvironment(updatedEnvironment);
      }
      await refreshEnvironments();
    } catch (error) {
      setEnvironmentsError(toErrorMessage(error));
      if (isUnauthorized(error)) {
        logout();
      }
    }
  }

  async function runLifecycleAction(key: string, action: LifecycleAction): Promise<EnvironmentRecord | undefined> {
    if (!api) {
      return undefined;
    }

    const createdAction = await api.createLifecycleAction(key, action);
    const sessionId = createdAction.id;
    let latestEnvironment: EnvironmentRecord | undefined;
    let failedMessage: string | undefined;

    setFocusedLifecycleAction({ environmentKey: key, action: createdAction, token: Date.now() });
    setDetailsLogRefreshToken((current) => current + 1);

    try {
      await api.streamLifecycleActionLogs(sessionId, { replayTail: 200 }, (event) => {
        if (event.type === "line") {
          return;
        }

        if (event.type === "action") {
          setFocusedLifecycleAction((current) => current?.action.id === event.action.id
            ? { ...current, action: event.action }
            : current
          );
          if (event.action.environment) {
            latestEnvironment = event.action.environment;
            setDetailsEnvironment(event.action.environment);
            setEnvironments((current) => current.map((item) => item.key === event.action.environment?.key ? event.action.environment : item));
          }
          if (event.action.status === "error") {
            failedMessage = event.action.error ?? `${capitalize(action)} ${key} failed.`;
          }
          return;
        }

        if (event.type === "complete") {
          return;
        }

        if (event.type === "error") {
          failedMessage = event.message ?? event.log;
        }
      });

      if (failedMessage) {
        throw new Error(failedMessage);
      }

      setDetailsLogRefreshToken((current) => current + 1);
      return latestEnvironment;
    } catch (error) {
      throw error;
    }
  }

  function startContainerLogStream(key: string, container: string): void {
    if (!api || !container) {
      return;
    }

    const sessionId = `${Date.now()}-container-${container}`;
    const controller = new AbortController();
    streamControllers.current.set(sessionId, controller);
    addLiveLogSession({
      id: sessionId,
      environmentKey: key,
      title: container,
      subtitle: "Container logs",
      status: "running",
      entries: []
    });

    void api.streamContainerLogs(
      key,
      container,
      (event) => handleStreamEvent(sessionId, event),
      controller.signal
    ).then(() => {
      markLiveLogSession(sessionId, "complete");
    }).catch((error) => {
      if (controller.signal.aborted) {
        appendLiveLogEntry(sessionId, "Stream stopped by operator.", "error");
        markLiveLogSession(sessionId, "stopped");
        return;
      }
      appendLiveLogEntry(sessionId, toErrorMessage(error), "error");
      markLiveLogSession(sessionId, "error");
    }).finally(() => {
      streamControllers.current.delete(sessionId);
    });
  }

  function startComposeLogStream(key: string): void {
    if (!api) {
      return;
    }

    const existing = liveLogSessions.find((session) => session.environmentKey === key && session.subtitle === "Docker Compose logs" && session.status === "running");
    if (existing) {
      return;
    }

    const sessionId = `${Date.now()}-compose-${key}`;
    const controller = new AbortController();
    streamControllers.current.set(sessionId, controller);
    addLiveLogSession({
      id: sessionId,
      environmentKey: key,
      title: "docker compose",
      subtitle: "Docker Compose logs",
      status: "running",
      entries: []
    });

    void api.composeLogs(key, 0, 50).then((entries) => {
      entries.forEach((entry) => appendLiveLogEntry(sessionId, entry.log, entry.level));
    }).catch((error) => {
      appendLiveLogEntry(sessionId, `Unable to load Docker Compose log tail: ${toErrorMessage(error)}`, "error");
    });

    void api.streamComposeLogs(
      key,
      (event) => handleStreamEvent(sessionId, event),
      controller.signal
    ).then(() => {
      markLiveLogSession(sessionId, "complete");
    }).catch((error) => {
      if (controller.signal.aborted) {
        appendLiveLogEntry(sessionId, "Stream stopped by operator.", "error");
        markLiveLogSession(sessionId, "stopped");
        return;
      }
      appendLiveLogEntry(sessionId, toErrorMessage(error), "error");
      markLiveLogSession(sessionId, "error");
    }).finally(() => {
      streamControllers.current.delete(sessionId);
    });
  }

  function stopLiveLogSession(id: string): void {
    streamControllers.current.get(id)?.abort();
  }

  function handleStreamEvent(sessionId: string, event: StreamLogEvent): void {
    if (event.type === "line" || event.type === "error") {
      appendLiveLogEntry(sessionId, event.type === "line" ? event.line ?? event.log ?? "" : event.message ?? event.log ?? "Stream failed", event.level);
    }
    if (event.type === "error") {
      markLiveLogSession(sessionId, "error");
    }
    if (event.type === "complete") {
      markLiveLogSession(sessionId, "complete");
    }
  }

  function addLiveLogSession(session: LiveLogSession): void {
    setLiveLogSessions((current) => [session, ...current].slice(0, 20));
  }

  function appendLiveLogEntry(id: string, log: string, level: "info" | "error"): void {
    setLiveLogSessions((current) => current.map((session) => {
      if (session.id !== id) {
        return session;
      }
      return {
        ...session,
        entries: [...session.entries, { at: new Date().toISOString(), log, level }].slice(-800)
      };
    }));
  }

  function markLiveLogSession(id: string, status: LiveLogSession["status"]): void {
    setLiveLogSessions((current) => current.map((session) => session.id === id ? { ...session, status } : session));
  }

  async function listContainers(key: string) {
    if (!api) {
      throw new Error("API client is unavailable.");
    }
    return api.listContainers(key);
  }

  async function listContainerFiles(key: string, container: string, path: string) {
    if (!api) {
      throw new Error("API client is unavailable.");
    }
    return api.listContainerFiles(key, container, path);
  }

  async function listEnvironmentFiles(key: string, path: string) {
    if (!api) {
      throw new Error("API client is unavailable.");
    }
    return api.listEnvironmentFiles(key, path);
  }

  async function inspectMongo(key: string) {
    if (!api) {
      throw new Error("API client is unavailable.");
    }
    return api.inspectMongo(key);
  }

  async function listLifecycleActions(key: string, page = 0, perPage = 20): Promise<EnvironmentActionsPage> {
    if (!api) {
      throw new Error("API client is unavailable.");
    }
    return api.lifecycleActions(key, page, perPage);
  }

  async function listComposeLogs(key: string, page = 0, perPage = 50) {
    if (!api) {
      throw new Error("API client is unavailable.");
    }
    return api.composeLogs(key, page, perPage);
  }

  async function listContainerLogs(key: string, container: string, page = 0, perPage = 50) {
    if (!api) {
      throw new Error("API client is unavailable.");
    }
    return api.containerLogs(key, container, page, perPage);
  }

  async function getLifecycleActionLogs(id: string, cursor?: string, limit = 200): Promise<EnvironmentActionLogsPage> {
    if (!api) {
      throw new Error("API client is unavailable.");
    }
    return api.lifecycleActionLogs(id, cursor, limit);
  }

  async function streamLifecycleActionLogs(id: string, options: { from?: number; replayTail?: number }, onEvent: (event: StreamLogEvent) => void, signal?: AbortSignal): Promise<void> {
    if (!api) {
      throw new Error("API client is unavailable.");
    }
    return api.streamLifecycleActionLogs(id, options, onEvent, signal);
  }

  async function execInContainer(key: string, container: string, command: string) {
    if (!api) {
      throw new Error("API client is unavailable.");
    }
    return api.execInContainer(key, container, command);
  }

  async function getEnvironmentLogs(key: string): Promise<EnvironmentLog[]> {
    if (!api) {
      throw new Error("API client is unavailable.");
    }
    return (await api.logs(key)).items;
  }

  async function readEnvExampleEntries(path: string): Promise<EnvExampleEntry[]> {
    if (!electronBridge) {
      throw new Error("Electron preload bridge is unavailable.");
    }

    try {
      return await electronBridge.readEnvExample(path);
    } catch (error) {
      const message = toErrorMessage(error);
      if (message.includes("No handler registered for 'repo:read-env-example'")) {
        pushSyncError("Restart Electron to enable .env reading. Continuing without env defaults.");
        return [];
      }
      throw error;
    }
  }

  function setActiveEnvironment(key: string): void {
    void electronBridge?.stopWatchingRepo();
    activeEnvironmentKeyRef.current = key;
    if (key) {
      localStorage.setItem(ACTIVE_ENV_STORAGE_KEY, key);
    } else {
      localStorage.removeItem(ACTIVE_ENV_STORAGE_KEY);
    }
    setSyncState((current) => ({ ...current, activeEnvironmentKey: key, watching: false }));
  }

  async function startSync(overrideKey?: string): Promise<void> {
    const key = overrideKey ?? syncState.activeEnvironmentKey;
    if (!repoPath || !key) {
      return;
    }

    try {
      if (!electronBridge) {
        throw new Error("Electron preload bridge is unavailable.");
      }
      activeEnvironmentKeyRef.current = key;
      setSyncState((current) => ({ ...current, watching: true, activeEnvironmentKey: key }));
      await electronBridge.startWatchingRepo(repoPath);
    } catch (error) {
      setSyncState((current) => ({ ...current, watching: false }));
      pushSyncError(toErrorMessage(error));
    }
  }

  async function stopSync(): Promise<void> {
    await electronBridge?.stopWatchingRepo();
    setSyncState((current) => ({ ...current, watching: false }));
  }

  async function handleRepoSyncSnapshot(snapshot: RepoSyncSnapshot): Promise<void> {
    setGitState(snapshot.gitState);
    recordLatestChanges(snapshot.files);
    pendingSyncSnapshotRef.current = snapshot;

    if (syncInFlightRef.current) {
      return;
    }

    await flushRepoSyncQueue();
  }

  async function flushRepoSyncQueue(): Promise<void> {
    if (syncInFlightRef.current) {
      return;
    }

    syncInFlightRef.current = true;
    try {
      while (pendingSyncSnapshotRef.current) {
        const snapshot = pendingSyncSnapshotRef.current;
        pendingSyncSnapshotRef.current = null;
        await syncRepoSnapshot(snapshot);
      }
    } finally {
      syncInFlightRef.current = false;
    }
  }

  async function syncRepoSnapshot(snapshot: RepoSyncSnapshot): Promise<void> {
    const activeEnvironmentKey = activeEnvironmentKeyRef.current;
    if (!api || !repoPath || !activeEnvironmentKey) {
      return;
    }

    try {
      const syncableFiles = snapshot.files.filter((file) => !file.warning);
      snapshot.files.filter((file) => file.warning).forEach((file) => pushSyncError(`${file.path}: ${file.warning}`));
      const chunks = syncableFiles.length > 0 ? chunkChangedFiles(syncableFiles) : [[]];

      for (const files of chunks) {
        await api.syncFiles(activeEnvironmentKey, {
          branch: snapshot.gitState.branch,
          commit: snapshot.gitState.commit,
          files
        });
      }

      setSyncState((current) => ({
        ...current,
        lastSyncedFile: syncableFiles.at(-1)?.path ?? "Git state",
        lastSyncTime: new Date().toLocaleString(),
        errors: snapshot.files.filter((file) => file.warning).map((file) => `${file.path}: ${file.warning}`)
      }));
    } catch (error) {
      pushSyncError(toErrorMessage(error));
      if (isUnauthorized(error)) {
        logout();
      }
    }
  }

  function pushSyncError(message: string): void {
    setSyncState((current) => ({ ...current, errors: [...current.errors.slice(-4), message] }));
  }

  function recordLatestChanges(files: ChangedFilePayload[]): void {
    if (files.length === 0) {
      return;
    }

    const at = new Date().toISOString();
    const events = files.map((file, index) => ({
      id: `${at}-${index}-${file.path}`,
      path: file.path,
      status: file.warning ? "skipped" : file.status,
      at,
      warning: file.warning
    }));
    setLatestChanges((current) => [...events, ...current].slice(0, 12));
  }

  if (authLoading) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <Stack spacing={2} alignItems="center">
          <CircularProgress />
          <Typography color="text.secondary">Verifying saved session</Typography>
        </Stack>
      </Box>
    );
  }

  if (!electronBridge || !externalLinkBridge) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 3 }}>
        <Alert severity="error" sx={{ maxWidth: 720 }}>
          Electron preload bridge is unavailable. Restart the app with <strong>npm run composer</strong> and check the
          terminal for preload errors.
        </Alert>
      </Box>
    );
  }

  if (!session) {
    return <LoginView loading={loginLoading} error={loginError} onLogin={handleLogin} />;
  }

  return (
    <DashboardLayout
      apiBaseUrl={session.apiBaseUrl}
      activePage={activePage}
      onNavigate={(page) => {
        setDetailsEnvironment(undefined);
        setActivePage(page);
      }}
      onLogout={logout}
      sidebar={
        <Stack spacing={2}>
          <RepoPicker repoPath={repoPath} error={repoError} onChooseRepo={chooseRepo} />
          <ActiveEnvironmentCard
            environments={environments}
            activeEnvironmentKey={syncState.activeEnvironmentKey}
            repoPath={repoPath}
            syncState={syncState}
            onStartSync={() => startSync()}
            onStopSync={stopSync}
          />
          <GitStatusCard gitState={gitState} loading={gitLoading} error={gitError} />
          <LatestChangesCard events={latestChanges} />
        </Stack>
      }
    >
      <Stack spacing={3}>
        {activePage === "users" ? (
          <>
            {environmentsError ? <Alert severity="error">{environmentsError}</Alert> : null}
            <UsersPage users={users} loading={usersLoading} onRefresh={refreshUsers} />
          </>
        ) : activePage === "environments" && !detailsEnvironment ? (
          <>
            {!repoPath ? <Alert severity="info">Choose a local repository before creating environments.</Alert> : null}
            <EnvironmentsPage
              environments={environments}
              activeEnvironmentKey={syncState.activeEnvironmentKey}
              metrics={systemMetrics}
              currentUser={session.user}
              repoPath={repoPath}
              onCreate={() => void openCreateDialog()}
              onDetails={setDetailsEnvironment}
              onSelectActive={setActiveEnvironment}
              onAction={runEnvironmentAction}
              onOpenExternalUrl={(url) => void externalLinkBridge.openUrl(url)}
            />
          </>
        ) : detailsEnvironment ? (
          <EnvironmentDetails
            environment={detailsEnvironment}
            open={Boolean(detailsEnvironment)}
            onClose={() => setDetailsEnvironment(undefined)}
            onListContainers={listContainers}
            onListContainerFiles={listContainerFiles}
            onListEnvironmentFiles={listEnvironmentFiles}
            onInspectMongo={inspectMongo}
            onListLifecycleActions={listLifecycleActions}
            onListComposeLogs={listComposeLogs}
            onListContainerLogs={listContainerLogs}
            onGetLifecycleActionLogs={getLifecycleActionLogs}
            onStreamLifecycleActionLogs={streamLifecycleActionLogs}
            onAction={runEnvironmentAction}
            onExecInContainer={execInContainer}
            actionRefreshToken={detailsLogRefreshToken}
            focusAction={focusedLifecycleAction?.environmentKey === detailsEnvironment.key ? focusedLifecycleAction : undefined}
            liveLogSessions={liveLogSessions.filter((session) => session.environmentKey === detailsEnvironment.key)}
            onStartComposeLogStream={startComposeLogStream}
            onStartContainerLogStream={startContainerLogStream}
            onStopLiveLogSession={stopLiveLogSession}
            onOpenExternalUrl={(url) => void externalLinkBridge.openUrl(url)}
          />
        ) : (
          <>
            <EnvironmentList
              environments={environments}
              logs={dashboardLogs}
              logsTotal={dashboardLogsPage?.total ?? dashboardLogs.length}
              logsHasMore={Boolean(dashboardLogsPage && dashboardLogsPage.page + 1 < dashboardLogsPage.pages)}
              logsLoadingMore={dashboardLogsLoadingMore}
              metrics={systemMetrics}
              loading={environmentsLoading}
              error={environmentsError}
              activeEnvironmentKey={syncState.activeEnvironmentKey}
              onRefresh={refreshEnvironments}
              onSelectActive={setActiveEnvironment}
              onDetails={setDetailsEnvironment}
              onAction={runEnvironmentAction}
              onLoadMoreLogs={loadMoreDashboardLogs}
            />
          </>
        )}
      </Stack>
      <EnvironmentCreateForm
        open={createDialogOpen}
        disabled={!repoPath}
        loading={createLoading}
        envLoading={envExampleLoading}
        envEntries={envExampleEntries}
        environment={monitoredEnvironment}
        monitorLoading={creationMonitorLoading}
        error={createError ?? creationMonitorError}
        onCancel={() => setCreateDialogOpen(false)}
        onCreate={createEnvironment}
      />
    </DashboardLayout>
  );
}

function loadSavedSession(): AuthSession | null {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    clearSavedSession();
    return null;
  }
}

function clearSavedSession(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEnvironmentPreparing(status: EnvironmentStatus): boolean {
  return status === "creating"
    || status === "cloning"
    || status === "checking_out"
    || status === "applying_changes";
}

function mergeLogs(primary: EnvironmentLog[], secondary: EnvironmentLog[]): EnvironmentLog[] {
  const seen = new Set<string>();
  const merged: EnvironmentLog[] = [];

  for (const log of [...primary, ...secondary]) {
    const id = log.id ?? `${log.createdAt}:${log.environmentKey ?? log.target?.environmentKey ?? ""}:${log.level}:${log.event}:${log.message}`;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    merged.push(log);
  }

  return merged;
}

function chunkChangedFiles(files: ChangedFilePayload[]): ChangedFilePayload[][] {
  const chunks: ChangedFilePayload[][] = [];
  let currentChunk: ChangedFilePayload[] = [];
  let currentLength = 0;

  for (const file of files) {
    const contentLength = file.contentBase64?.length ?? 0;
    if (currentChunk.length > 0 && currentLength + contentLength > MAX_SYNC_CHUNK_CONTENT_LENGTH) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentLength = 0;
    }

    currentChunk.push(file);
    currentLength += contentLength;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

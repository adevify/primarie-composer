import { Alert, Box, CircularProgress, Grid, Stack, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, ComposerApiClient, isSessionExpired, normalizeBaseUrl } from "./api";
import { DashboardLayout } from "./components/DashboardLayout";
import { EnvironmentCreateForm } from "./components/EnvironmentCreateForm";
import { EnvironmentDetails } from "./components/EnvironmentDetails";
import { EnvironmentList } from "./components/EnvironmentList";
import { GitStatusCard } from "./components/GitStatusCard";
import { LoginView } from "./components/LoginView";
import { RepoPicker } from "./components/RepoPicker";
import { SyncStatusCard } from "./components/SyncStatusCard";
import type { AuthSession, ChangedFilePayload, EnvironmentRecord, GitState, RepoSyncSnapshot, SyncState } from "./types";

const AUTH_STORAGE_KEY = "primarie-composer.auth";
const REPO_STORAGE_KEY = "primarie-composer.repoPath";
const ACTIVE_ENV_STORAGE_KEY = "primarie-composer.activeEnvironmentKey";

export default function App() {
  const electronBridge = window.primarieElectron;
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
  const [environmentsLoading, setEnvironmentsLoading] = useState(false);
  const [environmentsError, setEnvironmentsError] = useState<string>();
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string>();
  const [detailsEnvironment, setDetailsEnvironment] = useState<EnvironmentRecord>();
  const [syncState, setSyncState] = useState<SyncState>({
    watching: false,
    activeEnvironmentKey: localStorage.getItem(ACTIVE_ENV_STORAGE_KEY) ?? "",
    errors: []
  });

  const api = useMemo(() => (session ? new ComposerApiClient(session) : null), [session]);

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
      setEnvironments(await api.listEnvironments());
    } catch (error) {
      setEnvironmentsError(toErrorMessage(error));
      if (isUnauthorized(error)) {
        logout();
      }
    } finally {
      setEnvironmentsLoading(false);
    }
  }, [api, logout]);

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
    if (session && repoPath) {
      void refreshGitState();
    }
  }, [session, repoPath, refreshGitState]);

  useEffect(() => {
    if (session && repoPath && syncState.activeEnvironmentKey && !syncState.watching) {
      void startSync(syncState.activeEnvironmentKey);
    }
  }, [session, repoPath, syncState.activeEnvironmentKey, syncState.watching]);

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

  async function createEnvironment(input: { key?: string; useCurrentRepoState: boolean }): Promise<void> {
    if (!api) {
      return;
    }

    setCreateLoading(true);
    setCreateError(undefined);
    try {
      let source;
      if (input.useCurrentRepoState) {
        const latestGitState = await refreshGitState();
        if (!latestGitState || !repoPath) {
          throw new Error("Choose a valid repository before creating an environment from local state.");
        }
        if (!electronBridge) {
          throw new Error("Electron preload bridge is unavailable.");
        }
        const changedFiles = await electronBridge.readChangedFiles(repoPath);
        source = {
          branch: latestGitState.branch,
          commit: latestGitState.commit,
          dirty: latestGitState.isDirty,
          changedFiles: changedFiles.filter((file) => !file.warning)
        };
      }

      const created = await api.createEnvironment({
        key: input.key,
        source
      });

      setEnvironments((current) => [decorateEnvironment(created), ...current.filter((item) => item.key !== created.key)]);
      setActiveEnvironment(created.key);
      if (repoPath) {
        await startSync(created.key);
      }
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

  async function runEnvironmentAction(key: string, action: "start" | "stop" | "restart" | "resume" | "delete"): Promise<void> {
    if (!api) {
      return;
    }

    setEnvironmentsError(undefined);
    try {
      if (action === "start") {
        await api.startEnvironment(key);
      } else if (action === "stop") {
        await api.stopEnvironment(key);
      } else if (action === "restart") {
        await api.restartEnvironment(key);
      } else if (action === "resume") {
        await api.resumeEnvironment(key);
      } else {
        await api.deleteEnvironment(key);
      }
      if (action === "start" || action === "restart" || action === "resume") {
        setActiveEnvironment(key);
        await startSync(key);
      }
      await refreshEnvironments();
    } catch (error) {
      setEnvironmentsError(toErrorMessage(error));
      if (isUnauthorized(error)) {
        logout();
      }
    }
  }

  function setActiveEnvironment(key: string): void {
    localStorage.setItem(ACTIVE_ENV_STORAGE_KEY, key);
    setSyncState((current) => ({ ...current, activeEnvironmentKey: key }));
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
      await electronBridge.startWatchingRepo(repoPath);
      setSyncState((current) => ({ ...current, watching: true, activeEnvironmentKey: key }));
    } catch (error) {
      pushSyncError(toErrorMessage(error));
    }
  }

  async function stopSync(): Promise<void> {
    await electronBridge?.stopWatchingRepo();
    setSyncState((current) => ({ ...current, watching: false }));
  }

  async function handleRepoSyncSnapshot(snapshot: RepoSyncSnapshot): Promise<void> {
    setGitState(snapshot.gitState);

    if (!api || !repoPath || !syncState.activeEnvironmentKey) {
      return;
    }

    try {
      const syncableFiles = snapshot.files.filter((file) => !file.warning);
      snapshot.files.filter((file) => file.warning).forEach((file) => pushSyncError(`${file.path}: ${file.warning}`));

      await api.syncFiles(syncState.activeEnvironmentKey, {
        branch: snapshot.gitState.branch,
        commit: snapshot.gitState.commit,
        files: syncableFiles
      });

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

  if (!electronBridge) {
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
    <DashboardLayout apiBaseUrl={session.apiBaseUrl} onLogout={logout}>
      <Stack spacing={3}>
        <RepoPicker repoPath={repoPath} error={repoError} onChooseRepo={chooseRepo} />
        {!repoPath ? <Alert severity="info">Choose a local repository before creating or syncing environments.</Alert> : null}
        <Grid container spacing={3}>
          <Grid item xs={12} md={4}>
            <Stack spacing={3}>
              <GitStatusCard gitState={gitState} loading={gitLoading} error={gitError} />
              <SyncStatusCard repoPath={repoPath} gitState={gitState} syncState={syncState} onStart={() => startSync()} onStop={stopSync} />
            </Stack>
          </Grid>
          <Grid item xs={12} md={8}>
            <Stack spacing={3}>
              <EnvironmentCreateForm disabled={!repoPath} loading={createLoading} error={createError} onCreate={createEnvironment} />
              <EnvironmentList
                environments={environments.map(decorateEnvironment)}
                loading={environmentsLoading}
                error={environmentsError}
                activeEnvironmentKey={syncState.activeEnvironmentKey}
                onRefresh={refreshEnvironments}
                onSelectActive={setActiveEnvironment}
                onDetails={setDetailsEnvironment}
                onAction={runEnvironmentAction}
              />
            </Stack>
          </Grid>
        </Grid>
      </Stack>
      <EnvironmentDetails environment={detailsEnvironment ? decorateEnvironment(detailsEnvironment) : undefined} open={Boolean(detailsEnvironment)} onClose={() => setDetailsEnvironment(undefined)} />
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

function decorateEnvironment(environment: EnvironmentRecord): EnvironmentRecord {
  const domains = environment.domains ?? [
    `admin.${environment.key}.prmr.md`,
    `api.${environment.key}.prmr.md`,
  ];
  return { ...environment, domains };
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

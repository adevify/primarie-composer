import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import ClearIcon from "@mui/icons-material/Clear";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DataObjectIcon from "@mui/icons-material/DataObject";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import ManageSearchIcon from "@mui/icons-material/ManageSearch";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PauseCircleOutlineIcon from "@mui/icons-material/PauseCircleOutline";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RefreshIcon from "@mui/icons-material/Refresh";
import StorageIcon from "@mui/icons-material/Storage";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import SyncIcon from "@mui/icons-material/Sync";
import TerminalIcon from "@mui/icons-material/Terminal";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import { useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from "react";
import type {
  ComposeLogEntry,
  ContainerFileEntry,
  EnvironmentActionLog,
  EnvironmentActionLogsPage,
  EnvironmentActionRecord,
  EnvironmentActionsPage,
  EnvironmentContainer,
  EnvironmentRecord,
  FileSyncEvent,
  GitState,
  LiveLogSession,
  MongoCollectionSummary,
  MongoCollectionsResponse,
  MongoDeleteResult,
  MongoDocumentsPage,
  MongoInsertResult,
  MongoUpdateResult,
  StreamLogEvent,
  SyncState
} from "../types";

type UtilityTab = "logs" | "files" | "sync" | "exec" | "mongo" | "actions";
type LogScope = "environment" | "container";
type MongoFindMode = "findOne" | "findMany";
type MongoUpdateMode = "updateOne" | "updateMany";

const LOG_TAIL_PAGE_SIZE = 100;

type EnvironmentDetailsProps = {
  environment?: EnvironmentRecord;
  open: boolean;
  onClose: () => void;
  onListContainers: (key: string) => Promise<EnvironmentContainer[]>;
  onListContainerFiles: (key: string, container: string, path: string) => Promise<ContainerFileEntry[]>;
  onListEnvironmentFiles: (key: string, path: string) => Promise<ContainerFileEntry[]>;
  onListMongoCollections: (key: string) => Promise<MongoCollectionsResponse>;
  onSearchMongoDocuments: (key: string, collection: string, input: { filter: Record<string, unknown>; page: number; limit: number; sort: Record<string, unknown> }) => Promise<MongoDocumentsPage>;
  onInsertMongoDocuments: (key: string, collection: string, documents: Record<string, unknown>[]) => Promise<MongoInsertResult>;
  onDeleteMongoDocuments: (key: string, collection: string, input: { filter: Record<string, unknown>; many: boolean; confirm: true; allowEmptyFilter?: boolean }) => Promise<MongoDeleteResult>;
  onUpdateMongoDocuments: (key: string, collection: string, input: { filter: Record<string, unknown>; update: Record<string, unknown>; many: boolean; confirm: true; allowEmptyFilter?: boolean }) => Promise<MongoUpdateResult>;
  onListLifecycleActions: (key: string, page?: number, perPage?: number) => Promise<EnvironmentActionsPage>;
  onListComposeLogs: (key: string, page?: number, perPage?: number) => Promise<ComposeLogEntry[]>;
  onListContainerLogs: (key: string, container: string, page?: number, perPage?: number) => Promise<ComposeLogEntry[]>;
  onGetLifecycleActionLogs: (id: string, cursor?: string, limit?: number) => Promise<EnvironmentActionLogsPage>;
  onStreamLifecycleActionLogs: (id: string, options: { from?: number; replayTail?: number }, onEvent: (event: StreamLogEvent) => void, signal?: AbortSignal) => Promise<void>;
  onAction: (key: string, action: "start" | "stop" | "restart" | "resume" | "delete") => Promise<void>;
  onExecInContainer: (key: string, container: string, command: string) => Promise<{ command: string; exitCode: number; stdout: string; stderr: string }>;
  actionRefreshToken: number;
  focusAction?: { action: EnvironmentActionRecord; token: number };
  liveLogSessions: LiveLogSession[];
  repoPath: string;
  gitState?: GitState;
  syncState: SyncState;
  fileSyncEvents: FileSyncEvent[];
  onStartSync: (key: string) => Promise<void>;
  onStopSync: () => Promise<void>;
  onForceSync: (key: string) => Promise<void>;
  onStartComposeLogStream: (key: string) => void;
  onStartContainerLogStream: (key: string, container: string) => void;
  onStopLiveLogSession: (id: string) => void;
  onOpenExternalUrl: (url: string) => void;
};

export function EnvironmentDetails({
  environment,
  open,
  onClose,
  onListContainers,
  onListContainerFiles,
  onListEnvironmentFiles,
  onListMongoCollections,
  onSearchMongoDocuments,
  onInsertMongoDocuments,
  onDeleteMongoDocuments,
  onUpdateMongoDocuments,
  onListLifecycleActions,
  onListComposeLogs,
  onListContainerLogs,
  onGetLifecycleActionLogs,
  onStreamLifecycleActionLogs,
  onAction,
  onExecInContainer,
  actionRefreshToken,
  focusAction,
  liveLogSessions,
  repoPath,
  gitState,
  syncState,
  fileSyncEvents,
  onStartSync,
  onStopSync,
  onForceSync,
  onStartComposeLogStream,
  onStartContainerLogStream,
  onStopLiveLogSession,
  onOpenExternalUrl
}: EnvironmentDetailsProps) {
  const [containers, setContainers] = useState<EnvironmentContainer[]>([]);
  const [selectedContainer, setSelectedContainer] = useState("");
  const [containerPath, setContainerPath] = useState("/");
  const [files, setFiles] = useState<ContainerFileEntry[]>([]);
  const [loadingContainers, setLoadingContainers] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [toolError, setToolError] = useState<string>();
  const [actions, setActions] = useState<EnvironmentActionRecord[]>([]);
  const [actionsPage, setActionsPage] = useState<EnvironmentActionsPage>();
  const [selectedActionId, setSelectedActionId] = useState("");
  const [actionLogs, setActionLogs] = useState<EnvironmentActionLog[]>([]);
  const [actionLogsPage, setActionLogsPage] = useState<EnvironmentActionLogsPage>();
  const [loadingActions, setLoadingActions] = useState(false);
  const [loadingActionLogs, setLoadingActionLogs] = useState(false);
  const [logTailEntries, setLogTailEntries] = useState<Array<{ at: string; message: string; level: "info" | "error"; system: boolean }>>([]);
  const [logTailPage, setLogTailPage] = useState(0);
  const [logTailHasMore, setLogTailHasMore] = useState(false);
  const [loadingLogTail, setLoadingLogTail] = useState(false);
  const [execCommand, setExecCommand] = useState("pwd && ls -la");
  const [execOutput, setExecOutput] = useState("");
  const [execRunning, setExecRunning] = useState(false);
  const [utilityTab, setUtilityTab] = useState<UtilityTab>("logs");
  const fileRequestIdRef = useRef(0);

  const environmentSelected = selectedContainer === "";
  const activeTabs = useMemo<UtilityTab[]>(() => environmentSelected ? ["logs", "files", "sync", "mongo", "actions"] : ["logs", "files", "exec"], [environmentSelected]);
  const environmentLogSessions = useMemo(() => liveLogSessions.filter((session) => session.environmentKey === environment?.key), [liveLogSessions, environment?.key]);
  const selectedLiveSession = selectedContainer
    ? environmentLogSessions.find((session) => session.title === selectedContainer && session.status === "running")
      ?? environmentLogSessions.find((session) => session.title === selectedContainer)
    : environmentLogSessions.find((session) => session.subtitle === "Docker Compose logs" && session.status === "running")
      ?? environmentLogSessions.find((session) => session.subtitle === "Docker Compose logs");
  const displayedLiveLogs = useMemo(() => (selectedLiveSession?.entries ?? []).map((entry) => ({
    at: entry.at,
    message: entry.log,
    level: entry.level,
    system: true
  })), [selectedLiveSession]);
  const selectedAction = actions.find((action) => action.id === selectedActionId);
  const selectedContainerRecord = containers.find((container) => containerName(container) === selectedContainer);
  const displayedActionLogs = useMemo(() => {
    const historicalItems = actionLogs.length > 0 ? actionLogs : actionLogsPage?.items ?? [];
    const historical = historicalItems.map((entry) => ({
      at: entry.createdAt ?? selectedAction?.createdAt ?? new Date(0).toISOString(),
      message: entry.line ?? entry.log ?? "",
      level: entry.level,
      system: false
    }));

    const live = liveLogSessions.find((s) => s.id === selectedActionId)?.entries ?? [];
    const liveMapped = live.map((entry) => ({
      at: entry.at,
      message: entry.log,
      level: entry.level,
      system: false
    }));

    return [...historical, ...liveMapped];
  }, [actionLogs, actionLogsPage?.items, selectedAction?.createdAt, liveLogSessions, selectedActionId]);
  const showActionLogsInPrimaryTerminal = !selectedContainer && shouldShowLifecycleLogsInPrimaryTerminal(environment?.status);
  const displayedPrimaryLogs = displayedLiveLogs.length
    ? displayedLiveLogs
    : showActionLogsInPrimaryTerminal && displayedActionLogs.length > 0
      ? displayedActionLogs
      : logTailEntries;

  useEffect(() => {
    if (!open || !environment) {
      return;
    }

    if (canInspectContainers(environment.status)) {
      void loadContainers();
      return;
    }

    setContainers([]);
    setSelectedContainer("");
    setFiles([]);
  }, [open, environment?.key, environment?.status]);

  useEffect(() => {
    if (!open || !environment || !shouldPollContainers(environment.status)) {
      return undefined;
    }

    const interval = setInterval(() => {
      void loadContainers(false);
    }, 3000);

    return () => clearInterval(interval);
  }, [open, environment?.key, environment?.status]);

  useEffect(() => {
    if (!activeTabs.includes(utilityTab)) {
      setUtilityTab("logs");
    }
  }, [activeTabs, utilityTab]);

  useEffect(() => {
    if (!open || !environment || (utilityTab !== "actions" && !(utilityTab === "logs" && shouldShowLifecycleLogsInPrimaryTerminal(environment.status)))) {
      return;
    }

    void loadActions();
  }, [open, environment?.key, environment?.status, utilityTab, actionRefreshToken]);

  useEffect(() => {
    if (!open || !environment || !focusAction || focusAction.action.environmentKey !== environment.key) {
      return;
    }

    setSelectedContainer("");
    setContainerPath("/");
    setFiles([]);
    setExecOutput("");
    setToolError(undefined);
    setUtilityTab("actions");
    setSelectedActionId(focusAction.action.id);
    setActions((current) => upsertAction(current, focusAction.action));
    setActionLogs([]);
    setActionLogsPage(undefined);
  }, [open, environment?.key, focusAction?.action.id, focusAction?.token]);

  useEffect(() => {
    if (!open || !selectedActionId || (utilityTab !== "actions" && !(utilityTab === "logs" && shouldShowLifecycleLogsInPrimaryTerminal(environment?.status)))) {
      return;
    }

    void loadActionLogs(selectedActionId);
  }, [open, selectedActionId, utilityTab, environment?.status]);

  useEffect(() => {
    if (!open || !environment || environment.status !== "running" || !selectedContainer) {
      return;
    }

    setFiles([]);
    setExecOutput("");
    setContainerPath("/");
    void loadFiles("/");
  }, [open, environment?.key, environment?.status, selectedContainer]);

  useEffect(() => {
    setLogTailEntries([]);
    setLogTailPage(0);
    setLogTailHasMore(false);
    if (open && environment && utilityTab === "logs") {
      void loadLogTail(0, true);
    }
  }, [open, environment?.key, environment?.status, selectedContainer]);

  useEffect(() => {
    if (!open || !environment) {
      return;
    }

    if (utilityTab === "logs") {
      void loadLogTail(0, true);
    }
    if (utilityTab === "files") {
      void loadFiles("/");
    }
    if (utilityTab === "actions" && environmentSelected) {
      void loadActions();
    }
  }, [open, utilityTab, environmentSelected, environment?.key, environment?.status]);

  useEffect(() => {
    if (!open || !selectedActionId || !selectedAction || (selectedAction.status !== "queued" && selectedAction.status !== "running")) {
      return undefined;
    }

    const interval = setInterval(() => {
      void loadActions(false, selectedActionId);
      void loadActionLogs(selectedActionId, undefined, true, false);
    }, 1500);

    return () => clearInterval(interval);
  }, [open, selectedActionId, selectedAction?.status]);

  useEffect(() => {
    if (!open || !selectedActionId || !selectedAction || (selectedAction.status !== "queued" && selectedAction.status !== "running")) {
      return undefined;
    }

    const controller = new AbortController();
    void onStreamLifecycleActionLogs(
      selectedActionId,
      { replayTail: 200 },
      (event) => {
        if (event.type === "line") {
          const line = event.line ?? event.log ?? "";
          setActionLogs((current) => appendUniqueLogs(current, [{
            actionId: selectedActionId,
            line,
            log: line,
            level: event.level,
            byteStart: event.byteStart,
            byteEnd: event.byteEnd,
            createdAt: event.createdAt ?? new Date().toISOString()
          }]));
          return;
        }

        if (event.type === "action") {
          setActions((current) => current.map((action) => action.id === event.action.id ? event.action : action));
        }

        if (event.type === "error") {
          const line = event.message ?? event.log ?? "Action failed";
          setActionLogs((current) => appendUniqueLogs(current, [{
            actionId: selectedActionId,
            line,
            log: line,
            level: "error",
            createdAt: new Date().toISOString()
          }]));
        }
      },
      controller.signal
    ).catch((error) => {
      if (!controller.signal.aborted) {
        setToolError(toErrorMessage(error));
      }
    });

    return () => controller.abort();
  }, [open, selectedActionId, selectedAction?.status]);

  async function loadContainers(showSpinner = true): Promise<void> {
    if (!environment) {
      return;
    }
    if (!canInspectContainers(environment.status)) {
      setContainers([]);
      return;
    }

    if (showSpinner) {
      setLoadingContainers(true);
    }
    setToolError(undefined);
    try {
      const nextContainers = await onListContainers(environment.key);
      setContainers(nextContainers);
      setSelectedContainer((current) => current && nextContainers.some((container) => containerName(container) === current) ? current : "");
    } catch (error) {
      setToolError(toErrorMessage(error));
    } finally {
      if (showSpinner) {
        setLoadingContainers(false);
      }
    }
  }

  function selectContainer(name: string): void {
    if (name === selectedContainer) {
      return;
    }

    setSelectedContainer(name);
    setContainerPath("/");
    setFiles([]);
    setExecOutput("");
    setToolError(undefined);
  }

  function selectEnvironment(): void {
    if (environmentSelected) {
      return;
    }

    setSelectedContainer("");
    setContainerPath("/");
    setFiles([]);
    setExecOutput("");
    setToolError(undefined);
  }

  async function loadFiles(pathOverride = containerPath, containerOverride = selectedContainer): Promise<void> {
    if (!environment) {
      return;
    }
    if (containerOverride && environment.status !== "running") {
      setFiles([]);
      return;
    }

    const requestId = fileRequestIdRef.current + 1;
    fileRequestIdRef.current = requestId;
    setLoadingFiles(true);
    setToolError(undefined);
    try {
      const nextFiles = containerOverride
        ? await onListContainerFiles(environment.key, containerOverride, pathOverride)
        : await onListEnvironmentFiles(environment.key, pathOverride);
      if (requestId === fileRequestIdRef.current) {
        setFiles(nextFiles);
        setContainerPath(pathOverride);
      }
    } catch (error) {
      if (requestId === fileRequestIdRef.current) {
        setToolError(toErrorMessage(error));
      }
    } finally {
      if (requestId === fileRequestIdRef.current) {
        setLoadingFiles(false);
      }
    }
  }

  async function loadLogTail(page = 0, replace = true): Promise<void> {
    if (!environment || environment.status !== "running") {
      setLogTailEntries([]);
      setLogTailHasMore(false);
      return;
    }

    const scope: LogScope = selectedContainer ? "container" : "environment";
    const containerAtRequest = selectedContainer;
    setLoadingLogTail(true);
    setToolError(undefined);
    try {
      const entries = scope === "container"
        ? await onListContainerLogs(environment.key, containerAtRequest, page, LOG_TAIL_PAGE_SIZE)
        : await onListComposeLogs(environment.key, page, LOG_TAIL_PAGE_SIZE);

      if (containerAtRequest !== selectedContainer) {
        return;
      }

      const mapped = entries.map((entry, index) => ({
        at: new Date(Date.now() - Math.max(0, entries.length - index - 1) * 1000).toISOString(),
        message: entry.log,
        level: entry.level,
        system: true
      }));
      setLogTailPage(page);
      setLogTailHasMore(entries.length === LOG_TAIL_PAGE_SIZE);
      setLogTailEntries((current) => replace ? mapped : mergeTerminalLogs(mapped, current));
    } catch (error) {
      setToolError(toErrorMessage(error));
    } finally {
      setLoadingLogTail(false);
    }
  }

  async function loadOlderLogTail(): Promise<void> {
    if (!logTailHasMore || loadingLogTail) {
      return;
    }

    await loadLogTail(logTailPage + 1, false);
  }

  async function runExecCommand(): Promise<void> {
    if (!environment || !selectedContainer || !execCommand.trim()) {
      return;
    }

    setExecRunning(true);
    setToolError(undefined);
    try {
      const result = await onExecInContainer(environment.key, selectedContainer, execCommand);
      setExecOutput([
        `$ ${result.command}`,
        result.stdout.trimEnd(),
        result.stderr.trimEnd(),
        `[exit ${result.exitCode}]`
      ].filter(Boolean).join("\n"));
    } catch (error) {
      setToolError(toErrorMessage(error));
    } finally {
      setExecRunning(false);
    }
  }

  async function loadActions(showSpinner = true, preferredActionId = selectedActionId): Promise<void> {
    if (!environment) {
      return;
    }

    if (showSpinner) {
      setLoadingActions(true);
    }
    setToolError(undefined);
    try {
      const page = await onListLifecycleActions(environment.key, 0, 30);
      setActionsPage(page);
      setActions(page.items);
      const nextSelectedId = preferredActionId && page.items.some((action) => action.id === preferredActionId)
        ? preferredActionId
        : page.items[0]?.id ?? "";
      setSelectedActionId(nextSelectedId);
      if (!nextSelectedId) {
        setActionLogs([]);
        setActionLogsPage(undefined);
      }
    } catch (error) {
      setToolError(toErrorMessage(error));
    } finally {
      if (showSpinner) {
        setLoadingActions(false);
      }
    }
  }

  async function loadActionLogs(actionId = selectedActionId, cursor?: string, replace = true, showSpinner = true): Promise<void> {
    if (!actionId) {
      return;
    }

    if (showSpinner) {
      setLoadingActionLogs(true);
    }
    setToolError(undefined);
    try {
      const nextPage = await onGetLifecycleActionLogs(actionId, cursor, 500);
      setActionLogsPage(nextPage);
      setActionLogs((current) => replace ? nextPage.items : appendUniqueLogs(current, nextPage.items));
    } catch (error) {
      setToolError(toErrorMessage(error));
    } finally {
      if (showSpinner) {
        setLoadingActionLogs(false);
      }
    }
  }

  async function loadOlderActionLogs(): Promise<void> {
    if (!selectedActionId || !actionLogsPage?.hasMore || !actionLogsPage.nextCursor || loadingActionLogs) {
      return;
    }

    await loadActionLogs(selectedActionId, actionLogsPage.nextCursor, false, true);
  }

  async function loadMoreActions(): Promise<void> {
    if (!environment || !actionsPage || actionsPage.page + 1 >= actionsPage.pages) {
      return;
    }

    setLoadingActions(true);
    setToolError(undefined);
    try {
      const page = await onListLifecycleActions(environment.key, actionsPage.page + 1, actionsPage.perPage);
      setActionsPage(page);
      setActions((current) => appendUniqueActions(current, page.items));
    } catch (error) {
      setToolError(toErrorMessage(error));
    } finally {
      setLoadingActions(false);
    }
  }

  if (!open || !environment) {
    return null;
  }

  return (
    <Box sx={{ height: "calc(100vh - 48px)", bgcolor: "#0d1515", color: "text.primary", mx: { xs: -2, md: -3 }, my: { xs: -2, md: -3 }, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <Box
        sx={{
          px: { xs: 2, lg: 3 },
          py: 2,
          display: "grid",
          gridTemplateColumns: { xs: "1fr", xl: "1fr auto" },
          gap: 2,
          alignItems: "center",
          borderBottom: "1px solid #3b494b",
          bgcolor: "#151d1e"
        }}
      >
        <Stack direction="row" spacing={2} alignItems="center" minWidth={0}>
          <IconButton aria-label="Back to environments" onClick={onClose} sx={iconButtonSx}>
            <ArrowBackIcon />
          </IconButton>
          <Chip
            label={environment.status}
            size="small"
            sx={{
              borderRadius: "2px",
              color: statusColor(environment.status),
              border: `1px solid ${statusColor(environment.status)}`,
              bgcolor: environment.status === "running" ? "rgba(78, 222, 163, 0.12)" : "rgba(220, 228, 229, 0.08)",
              fontFamily: monoFont,
              textTransform: "capitalize"
            }}
          />
          <Box minWidth={0}>
            <Typography variant="h4" fontWeight={900} noWrap>
              {environment.key}
            </Typography>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
              <MetaLabel icon="user" label={ownerLabel(environment.createdBy)} />
              <MetaLabel icon="branch" label={environment.source.branch.toUpperCase()} />
              <MetaLabel icon="calendar" label={formatDate(environment.createdAt)} />
              <MetaLabel icon="refresh" label={`${relativeAge(environment.updatedAt).toUpperCase()} AGO`} accent />
            </Stack>
          </Box>
        </Stack>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }}>
          <Box sx={{ minWidth: { xl: 230 }, mr: { xl: 2 }, textAlign: { xs: "left", sm: "right" } }}>
            <Stack spacing={0.25} alignItems={{ xs: "flex-start", sm: "flex-end" }}>
              {buildDomains(environment).map((domain, index) => (
                <Button
                  key={domain}
                  onClick={() => onOpenExternalUrl(toExternalUrl(domain))}
                  endIcon={<OpenInNewIcon fontSize="small" />}
                  sx={{
                    color: index === 0 ? "#00f0ff" : "text.secondary",
                    fontWeight: index === 0 ? 800 : 400,
                    justifyContent: { xs: "flex-start", sm: "flex-end" },
                    maxWidth: "100%",
                    minWidth: 0,
                    p: 0,
                    textTransform: "none"
                  }}
                >
                  <Typography component="span" color="inherit" fontWeight="inherit" noWrap>
                    {domain}
                  </Typography>
                </Button>
              ))}
            </Stack>
          </Box>
          <Button
            variant="outlined"
            disabled={environment.status === "running" || environment.status === "creating"}
            onClick={() => void onAction(environment.key, "start")}
            startIcon={<PlayArrowIcon />}
            sx={startButtonSx}
          >
            Start
          </Button>
          {environment.status === "running" ? (
            <>
              <Button variant="outlined" onClick={() => void onAction(environment.key, "stop")} startIcon={<PauseCircleOutlineIcon />} sx={actionButtonSx}>
                Pause
              </Button>
              <Button variant="outlined" onClick={() => void onAction(environment.key, "stop")} startIcon={<StopCircleIcon />} sx={actionButtonSx}>
                Stop
              </Button>
              <Button variant="outlined" onClick={() => onStartComposeLogStream(environment.key)} startIcon={<TerminalIcon />} sx={logsButtonSx}>
                Logs
              </Button>
            </>
          ) : null}
          <Button variant="contained" color="error" onClick={() => void onAction(environment.key, "delete")} startIcon={<DeleteOutlineIcon />} sx={deleteButtonSx}>
            Delete
          </Button>
        </Stack>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflow: utilityTab === "actions" ? "hidden" : "auto", p: { xs: 2, lg: 3 }, display: "flex", flexDirection: "column" }}>
        {toolError ? <Alert severity="warning">{toolError}</Alert> : null}

        <Box sx={{ mt: toolError ? 2 : 0, display: "grid", gridTemplateColumns: { xs: "1fr", lg: "280px minmax(0, 1fr)" }, gap: 3, flex: utilityTab === "actions" ? 1 : undefined, height: utilityTab === "actions" ? undefined : { lg: "calc(100vh - 218px)" }, minHeight: utilityTab === "actions" ? 0 : 560 }}>
          <Box component="aside" sx={{ minHeight: 0, overflow: "auto" }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 0.5, mb: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont, fontWeight: 900, textTransform: "uppercase" }}>
                Environment Scope
              </Typography>
              <IconButton aria-label="Refresh containers" onClick={() => void loadContainers()} disabled={loadingContainers || !canInspectContainers(environment.status)} sx={iconButtonSx}>
                {loadingContainers ? <CircularProgress size={18} /> : <RefreshIcon />}
              </IconButton>
            </Stack>

            <Stack spacing={1.5}>
              <Button
                onClick={selectEnvironment}
                sx={{
                  display: "block",
                  textAlign: "left",
                  p: 2,
                  borderRadius: "8px",
                  border: environmentSelected ? "2px solid #00dbe9" : "1px solid #3b494b",
                  bgcolor: environmentSelected ? "rgba(0, 240, 255, 0.1)" : "#192122",
                  color: "text.primary",
                  textTransform: "none",
                  "&:hover": { borderColor: "rgba(0, 240, 255, 0.65)", bgcolor: environmentSelected ? "rgba(0, 240, 255, 0.13)" : "#232b2c" }
                }}
              >
                <Stack spacing={1}>
                  <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                    <Typography sx={{ color: environmentSelected ? "#dbfcff" : "text.primary", fontFamily: monoFont, fontSize: 14, fontWeight: 900 }} noWrap>
                      {environment.key}
                    </Typography>
                    <StorageIcon sx={{ color: environment.status === "running" ? "#4edea3" : "#849495", fontSize: 18, flexShrink: 0 }} />
                  </Stack>
                  <Typography sx={{ color: "text.secondary", fontFamily: monoFont, fontSize: 10, textTransform: "uppercase" }} noWrap>
                    Compose environment
                  </Typography>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    <Box component="span" sx={{ px: 0.75, py: 0.25, borderRadius: "2px", bgcolor: "#2e3637", color: "text.secondary", fontFamily: monoFont, fontSize: 10 }}>
                      {environment.status}
                    </Box>
                    <Box component="span" sx={{ px: 0.75, py: 0.25, borderRadius: "2px", bgcolor: "#2e3637", color: "#00f0ff", fontFamily: monoFont, fontSize: 10 }}>
                      {containers.length} containers
                    </Box>
                  </Stack>
                </Stack>
              </Button>

              <Typography variant="caption" color="text.secondary" sx={{ px: 0.5, fontFamily: monoFont, fontWeight: 900, textTransform: "uppercase" }}>
                Containers ({containers.filter((container) => container.State === "running").length || containers.length})
              </Typography>
              {containers.length === 0 ? (
                <Box sx={{ border: "1px solid #3b494b", bgcolor: "#192122", p: 2, color: "text.secondary", fontFamily: monoFont, fontSize: 13 }}>
                  {canInspectContainers(environment.status) ? "No containers found." : "Start the environment to inspect containers."}
                </Box>
              ) : containers.map((container, index) => {
                const name = containerName(container);
                const selected = selectedContainer === name;
                const running = container.State === "running";
                return (
                  <Button
                    key={name || index}
                    onClick={() => selectContainer(name)}
                    sx={{
                      display: "block",
                      textAlign: "left",
                      p: 2,
                      borderRadius: "8px",
                      border: selected ? "2px solid #00dbe9" : "1px solid #3b494b",
                      bgcolor: selected ? "rgba(0, 240, 255, 0.1)" : "#192122",
                      color: "text.primary",
                      textTransform: "none",
                      "&:hover": { borderColor: "rgba(0, 240, 255, 0.65)", bgcolor: selected ? "rgba(0, 240, 255, 0.13)" : "#232b2c" }
                    }}
                  >
                    <Stack spacing={1}>
                      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                        <Typography sx={{ color: selected ? "#dbfcff" : "text.primary", fontFamily: monoFont, fontSize: 14, fontWeight: 900 }} noWrap>
                          {shortName(name) || `container_${index + 1}`}
                        </Typography>
                        <Box sx={{ width: 8, height: 8, mt: 0.6, borderRadius: "50%", bgcolor: running ? "#4edea3" : "#fed639", boxShadow: running ? "0 0 8px rgba(78,222,163,0.5)" : "none", flexShrink: 0 }} />
                      </Stack>
                      <Typography sx={{ color: "text.secondary", fontFamily: monoFont, fontSize: 10, textTransform: "uppercase" }} noWrap>
                        {container.Service ?? container.Image ?? "service unavailable"}
                      </Typography>
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                        <Box component="span" sx={{ px: 0.75, py: 0.25, borderRadius: "2px", bgcolor: "#2e3637", color: "text.secondary", fontFamily: monoFont, fontSize: 10 }}>
                          {uptimeLabel(container.Status)}
                        </Box>
                        <Box component="span" sx={{ px: 0.75, py: 0.25, borderRadius: "2px", bgcolor: "#2e3637", color: "#00f0ff", fontFamily: monoFont, fontSize: 10 }}>
                          {portsLabel(container)}
                        </Box>
                      </Stack>
                    </Stack>
                  </Button>
                );
              })}
            </Stack>
          </Box>

          <Box sx={{ minWidth: 0, minHeight: 0, border: "1px solid #3b494b", borderRadius: "8px", bgcolor: "#192122", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <Box sx={{ display: "flex", alignItems: "center", px: 2, bgcolor: "#232b2c", borderBottom: "1px solid #3b494b", minHeight: 48, overflowX: "auto" }}>
              <Stack direction="row" sx={{ minWidth: 0 }}>
                {activeTabs.map((tab) => (
                  <UtilityTabButton
                    key={tab}
                    label={tab === "mongo" ? "Database" : tab === "sync" ? "File Sync" : tab}
                    active={utilityTab === tab}
                    onClick={() => {
                      setUtilityTab(tab);
                      if (tab === "files") {
                        void loadFiles("/");
                      }
                      if (tab === "actions") {
                        void loadActions();
                      }
                    }}
                  />
                ))}
              </Stack>
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ ml: "auto", pl: 2 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: selectedLiveSession?.status === "running" ? "#4edea3" : "#849495" }} />
                  <Typography sx={{ color: "text.secondary", fontFamily: monoFont, fontSize: 10, textTransform: "uppercase" }} noWrap>
                    {selectedLiveSession?.status === "running" ? "Streaming" : selectedContainer ? shortName(selectedContainer) : "Compose"}
                  </Typography>
                </Stack>
                {utilityTab === "logs" ? (
                  selectedLiveSession?.status === "running" ? (
                    <Button size="small" variant="outlined" onClick={() => onStopLiveLogSession(selectedLiveSession.id)} sx={smallButtonSx}>
                      Stop
                    </Button>
                  ) : (
                    <Button size="small" variant="outlined" disabled={environment.status !== "running"} onClick={() => selectedContainer ? onStartContainerLogStream(environment.key, selectedContainer) : onStartComposeLogStream(environment.key)} sx={smallButtonSx}>
                      Stream
                    </Button>
                  )
                ) : null}
              </Stack>
            </Box>

            <Box sx={{ flex: 1, minHeight: 0, overflow: utilityTab === "actions" ? "hidden" : "auto", bgcolor: utilityTab === "logs" || utilityTab === "exec" ? "#080f10" : "#192122" }}>
              {utilityTab === "logs" ? (
                <LogTerminal
                  logs={displayedPrimaryLogs}
                  emptyText={showActionLogsInPrimaryTerminal ? "Waiting for registered action log output." : environment.status === "running" ? "No log tail loaded yet." : "Start the environment to read logs."}
                  compact
                  hasOlder={!showActionLogsInPrimaryTerminal && logTailHasMore && displayedLiveLogs.length === 0}
                  loadingOlder={loadingLogTail}
                  onReachTop={() => {
                    if (!showActionLogsInPrimaryTerminal) {
                      void loadOlderLogTail();
                    }
                  }}
                />
              ) : null}

              {utilityTab === "files" ? (
                <FileExplorer
                  files={files}
                  path={containerPath}
                  onPathChange={setContainerPath}
                  onLoadPath={() => void loadFiles()}
                  onOpenDirectory={(path) => void loadFiles(path)}
                  sourceLabel={selectedContainer ? `Container filesystem: ${shortName(selectedContainer)}` : "Runtime directory filesystem"}
                  fill
                />
              ) : null}

              {utilityTab === "sync" ? (
                <FileSyncPanel
                  environment={environment}
                  repoPath={repoPath}
                  gitState={gitState}
                  syncState={syncState}
                  events={fileSyncEvents}
                  onStartSync={onStartSync}
                  onStopSync={onStopSync}
                  onForceSync={onForceSync}
                />
              ) : null}

              {utilityTab === "exec" ? (
                <Box sx={{ p: 2 }}>
                  <Box component="pre" sx={{ m: 0, minHeight: 380, overflow: "auto", color: "#dce4e5", fontFamily: monoFont, fontSize: 13, lineHeight: 1.5 }}>
                    {execOutput || `root@${shortName(selectedContainer) || "container"}:/#`}
                  </Box>
                </Box>
              ) : null}

              {utilityTab === "mongo" ? (
                <MongoInspector
                  environment={environment}
                  onListCollections={onListMongoCollections}
                  onSearchDocuments={onSearchMongoDocuments}
                  onInsertDocuments={onInsertMongoDocuments}
                  onDeleteDocuments={onDeleteMongoDocuments}
                  onUpdateDocuments={onUpdateMongoDocuments}
                  fill
                />
              ) : null}

              {utilityTab === "actions" ? (
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", lg: "260px minmax(0, 1fr)" },
                    gridTemplateRows: { xs: "minmax(180px, 34%) minmax(0, 1fr)", lg: "minmax(0, 1fr)" },
                    height: "100%",
                    minHeight: 0,
                    overflow: "hidden"
                  }}
                >
                  <ActionHistory
                    actions={actions}
                    selectedActionId={selectedActionId}
                    total={actionsPage?.total ?? actions.length}
                    loading={loadingActions}
                    onSelect={setSelectedActionId}
                    hasMore={Boolean(actionsPage && actionsPage.page + 1 < actionsPage.pages)}
                    onLoadMore={() => void loadMoreActions()}
                  />
                  <Box sx={{ minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                    <Box sx={{ px: 2, py: 1.2, borderBottom: "1px solid #3b494b", bgcolor: "#151d1e", display: "flex", justifyContent: "space-between", gap: 2, alignItems: "center" }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }} noWrap>
                        {selectedAction ? `${selectedAction.action.toUpperCase()} / ${selectedAction.id}` : "NO REGISTERED ACTION"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }}>
                        {actionLogsPage ? `${displayedActionLogs.length}${actionLogsPage.hasMore ? "+" : ""}` : "0"}
                      </Typography>
                    </Box>
                    <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                      <LogTerminal
                        logs={displayedActionLogs}
                        emptyText={selectedAction ? "Waiting for registered action log output." : "No actions registered for this environment yet."}
                        compact
                        fill
                        hasOlder={Boolean(actionLogsPage?.hasMore)}
                        loadingOlder={loadingActionLogs}
                        onReachTop={() => void loadOlderActionLogs()}
                      />
                    </Box>
                    {actionLogsPage?.hasMore ? (
                      <Box sx={{ px: 2, py: 1.5, borderTop: "1px solid #3b494b", bgcolor: "#151d1e" }}>
                        <Button size="small" variant="outlined" disabled={loadingActionLogs} onClick={() => void loadOlderActionLogs()} sx={smallButtonSx}>
                          Older
                        </Button>
                      </Box>
                    ) : null}
                  </Box>
                </Box>
              ) : null}
            </Box>

            {selectedContainer ? (
              <Box sx={{ p: 1.5, bgcolor: "#2e3637", borderTop: "1px solid #3b494b", display: "flex", alignItems: "center", gap: 1.5 }}>
                <TerminalIcon sx={{ color: "#00f0ff", fontSize: 18 }} />
                <TextField
                  size="small"
                  placeholder="Run command..."
                  value={execCommand}
                  onChange={(event) => setExecCommand(event.target.value)}
                  disabled={execRunning}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void runExecCommand();
                      setUtilityTab("exec");
                    }
                  }}
                  sx={commandFieldSx}
                />
                <Button variant="outlined" disabled={execRunning} onClick={() => { setUtilityTab("exec"); void runExecCommand(); }} sx={smallButtonSx}>
                  {execRunning ? "Running" : "Enter"}
                </Button>
              </Box>
            ) : null}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function Panel({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box sx={{ border: "1px solid #3b494b", bgcolor: "#192122", borderRadius: 0, overflow: "hidden" }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, px: 2, py: 1.5, borderBottom: "1px solid #3b494b", bgcolor: "#232b2c" }}>
        <Stack direction="row" spacing={1.2} alignItems="center" minWidth={0}>
          <Box sx={{ color: "#d7e3ee", display: "grid", placeItems: "center" }}>{icon}</Box>
          <Typography color="#d7e3ee" fontWeight={900} sx={{ fontFamily: monoFont }} noWrap>
            {title}
          </Typography>
        </Stack>
        {action}
      </Box>
      {children}
    </Box>
  );
}

function ActionHistory({
  actions,
  selectedActionId,
  total,
  loading,
  onSelect,
  hasMore,
  onLoadMore
}: {
  actions: EnvironmentActionRecord[];
  selectedActionId: string;
  total: number;
  loading: boolean;
  onSelect: (id: string) => void;
  hasMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <Stack sx={{ bgcolor: "#151d1e", borderRight: { lg: "1px solid #3b494b" }, borderBottom: { xs: "1px solid #3b494b", lg: "none" }, height: "100%", minHeight: 0, overflow: "hidden" }}>
      <Box sx={{ px: 1.5, py: 1.2, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont, fontWeight: 900 }}>
          REGISTERED ACTIONS
        </Typography>
        {loading ? <CircularProgress size={14} /> : <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }}>{total}</Typography>}
      </Box>
      <Stack sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {actions.length === 0 ? (
          <Box sx={{ px: 1.5, py: 2, color: "text.secondary", fontFamily: monoFont, fontSize: 13 }}>
            No actions yet.
          </Box>
        ) : actions.map((action) => {
          const selected = action.id === selectedActionId;
          return (
            <Button
              key={action.id}
              onClick={() => onSelect(action.id)}
              sx={{
                justifyContent: "flex-start",
                alignItems: "stretch",
                textAlign: "left",
                borderRadius: 0,
                px: 1.5,
                py: 1.25,
                borderTop: "1px solid #3b494b",
                bgcolor: selected ? "rgba(0, 240, 255, 0.08)" : "transparent",
                color: "text.primary",
                "&:hover": { bgcolor: "rgba(0, 240, 255, 0.11)" }
              }}
            >
              <Stack spacing={0.55} sx={{ width: "100%", minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                  <Typography sx={{ fontFamily: monoFont, fontWeight: 900, color: "#00f0ff" }}>
                    {action.action.toUpperCase()}
                  </Typography>
                  <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: statusColor(action.status), boxShadow: action.status === "running" ? "0 0 10px rgba(78, 222, 163, 0.55)" : "none" }} />
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }} noWrap>
                  {shortId(action.id)} / {action.status}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }}>
                  {formatTimestamp(action.createdAt)}
                </Typography>
              </Stack>
            </Button>
          );
        })}
        {hasMore ? (
          <Box sx={{ p: 1.25, borderTop: "1px solid #3b494b" }}>
            <Button size="small" variant="outlined" disabled={loading} onClick={onLoadMore} sx={{ ...smallButtonSx, width: "100%" }}>
              More
            </Button>
          </Box>
        ) : null}
      </Stack>
    </Stack>
  );
}

function ContainersTable({
  containers,
  selectedContainer,
  onSelect,
  onOpenLogs,
  onOpenFiles
}: {
  containers: EnvironmentContainer[];
  selectedContainer: string;
  onSelect: (name: string) => void;
  onOpenLogs: (name: string) => void;
  onOpenFiles: () => void;
}) {
  const rows = containers.length > 0 ? containers : [];

  return (
    <Box sx={{ overflowX: "auto" }}>
      <Box component="table" sx={{ width: "100%", minWidth: 1040, borderCollapse: "collapse", tableLayout: "fixed" }}>
        <Box component="thead" sx={{ bgcolor: "#232b2c" }}>
          <Box component="tr">
            {["NAME", "SERVICE", "IMAGE", "STATUS", "UPTIME", "PORTS", "CPU", "RAM", "ACTIONS"].map((heading) => (
              <Box key={heading} component="th" sx={tableHeadSx}>
                {heading}
              </Box>
            ))}
          </Box>
        </Box>
        <Box component="tbody">
          {rows.length === 0 ? (
            <Box component="tr">
              <Box component="td" colSpan={9} sx={{ px: 2, py: 4, color: "text.secondary" }}>
                No containers found for this environment.
              </Box>
            </Box>
          ) : rows.map((container, index) => {
            const name = containerName(container);
            const selected = selectedContainer === name;

            return (
              <Box
                key={name || index}
                component="tr"
                onClick={() => onSelect(name)}
                sx={{
                  cursor: "pointer",
                  bgcolor: selected ? "rgba(0, 240, 255, 0.06)" : "transparent",
                  "& td": { borderTop: "1px solid #3b494b" }
                }}
              >
                <DataCell strong>{name || `container_${index + 1}`}</DataCell>
                <DataCell>{container.Service ?? shortName(name)}</DataCell>
                <DataCell>{container.Image ?? "image unavailable"}</DataCell>
                <DataCell>
                  <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: container.State === "running" ? "#4edea3" : "#f5a524", boxShadow: container.State === "running" ? "0 0 12px rgba(78, 222, 163, 0.5)" : "none" }} />
                </DataCell>
                <DataCell>{uptimeLabel(container.Status)}</DataCell>
                <DataCell accent>{portsLabel(container)}</DataCell>
                <DataCell>{`${(0.8 + index * 0.7).toFixed(1)}%`}</DataCell>
                <DataCell>{`${180 + index * 210}MB`}</DataCell>
                <DataCell>
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                    <IconButton aria-label="Open logs" onClick={(event) => { event.stopPropagation(); onOpenLogs(name); }} sx={iconButtonSx}>
                      <TerminalIcon fontSize="small" />
                    </IconButton>
                    <IconButton aria-label="Open files" onClick={(event) => { event.stopPropagation(); onOpenFiles(); }} sx={iconButtonSx}>
                      <FolderOpenIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </DataCell>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

function DataCell({ children, strong = false, accent = false }: { children: React.ReactNode; strong?: boolean; accent?: boolean }) {
  return (
    <Box component="td" sx={{ px: 2, py: 2.2, color: accent ? "#00f0ff" : "text.primary", fontWeight: strong ? 900 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {children}
    </Box>
  );
}

function UtilityTabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Button
      onClick={onClick}
      sx={{
        px: 3,
        py: 1.5,
        minWidth: 0,
        borderRadius: 0,
        borderBottom: active ? "2px solid #00f0ff" : "2px solid transparent",
        color: active ? "#dbfcff" : "text.secondary",
        fontFamily: monoFont,
        fontSize: 11,
        fontWeight: 900,
        textTransform: "uppercase",
        "&:hover": { color: "text.primary", bgcolor: "rgba(0, 240, 255, 0.06)" }
      }}
    >
      {label}
    </Button>
  );
}

function LogTerminal({
  logs,
  emptyText = "Waiting for Docker Compose log output.",
  compact = false,
  fill = false,
  hasOlder = false,
  loadingOlder = false,
  onReachTop
}: {
  logs: Array<{ at: string; message: string; level: "info" | "error"; system: boolean }>;
  emptyText?: string;
  compact?: boolean;
  fill?: boolean;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onReachTop?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const latestLog = logs.at(-1);

  useEffect(() => {
    if (stickToBottomRef.current) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [logs.length, latestLog?.at, latestLog?.message]);

  function handleScroll(event: UIEvent<HTMLDivElement>): void {
    const target = event.currentTarget;
    stickToBottomRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 120;
    if (target.scrollTop < 80 && hasOlder && !loadingOlder) {
      onReachTop?.();
    }
  }

  return (
    <Box ref={containerRef} onScroll={handleScroll} sx={{ height: fill ? "100%" : undefined, minHeight: fill ? 0 : compact ? "100%" : 460, maxHeight: fill || compact ? "none" : 560, overflow: "auto", bgcolor: "#080f10", p: 2, fontFamily: monoFont, fontSize: 13, lineHeight: 1.5 }}>
      {loadingOlder ? (
        <Typography color="text.secondary" sx={{ fontFamily: monoFont, mb: 1 }}>
          Loading older output
        </Typography>
      ) : null}
      {logs.length === 0 ? (
        <Typography color="text.secondary" sx={{ fontFamily: monoFont }}>
          {emptyText}
        </Typography>
      ) : logs.map((log, index) => (
        <Box key={`${log.at}-${index}`} sx={{ display: "flex", gap: 0.5, minWidth: 0 }}>
          <Box component="span" sx={{ color: "#8ea0b3", flexShrink: 0 }}>
            [{formatTimestamp(log.at)}]
          </Box>
          <Box component="span" sx={{ color: log.level === "error" ? "#ffb4ab" : "text.primary", wordBreak: "break-word" }}>
            {log.message}
          </Box>
        </Box>
      ))}
      <Box sx={{ color: "#00f0ff", mt: 2 }}>$ _</Box>
      <Box ref={bottomRef} sx={{ height: 1 }} />
    </Box>
  );
}

function MongoInspector({
  environment,
  onListCollections,
  onSearchDocuments,
  onInsertDocuments,
  onDeleteDocuments,
  onUpdateDocuments,
  fill = false
}: {
  environment: EnvironmentRecord;
  onListCollections: (key: string) => Promise<MongoCollectionsResponse>;
  onSearchDocuments: (key: string, collection: string, input: { filter: Record<string, unknown>; page: number; limit: number; sort: Record<string, unknown> }) => Promise<MongoDocumentsPage>;
  onInsertDocuments: (key: string, collection: string, documents: Record<string, unknown>[]) => Promise<MongoInsertResult>;
  onDeleteDocuments: (key: string, collection: string, input: { filter: Record<string, unknown>; many: boolean; confirm: true; allowEmptyFilter?: boolean }) => Promise<MongoDeleteResult>;
  onUpdateDocuments: (key: string, collection: string, input: { filter: Record<string, unknown>; update: Record<string, unknown>; many: boolean; confirm: true; allowEmptyFilter?: boolean }) => Promise<MongoUpdateResult>;
  fill?: boolean;
}) {
  const [database, setDatabase] = useState("primarie");
  const [collections, setCollections] = useState<MongoCollectionSummary[]>([]);
  const [selectedCollection, setSelectedCollection] = useState("");
  const [documentsPage, setDocumentsPage] = useState<MongoDocumentsPage>();
  const [filterText, setFilterText] = useState("{\n}");
  const [sortText, setSortText] = useState("{\n  \"_id\": -1\n}");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [findMode, setFindMode] = useState<MongoFindMode>("findMany");
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [mongoError, setMongoError] = useState<string>();
  const [operationResult, setOperationResult] = useState<string>();
  const [insertText, setInsertText] = useState("{\n  \"name\": \"Test\"\n}");
  const [deleteFilterText, setDeleteFilterText] = useState("{\n  \"tenant\": \"moldova\"\n}");
  const [deleteMany, setDeleteMany] = useState(false);
  const [updateFilterText, setUpdateFilterText] = useState("{\n  \"tenant\": \"moldova\"\n}");
  const [updateText, setUpdateText] = useState("{\n  \"$set\": {\n    \"status\": \"active\"\n  }\n}");
  const [updateMode, setUpdateMode] = useState<MongoUpdateMode>("updateOne");
  const [expandedDocuments, setExpandedDocuments] = useState<Set<number>>(() => new Set());
  const selectedCollectionRecord = collections.find((collection) => collection.name === selectedCollection);
  const totalPages = documentsPage ? Math.max(1, Math.ceil(documentsPage.total / documentsPage.limit)) : 1;
  const filterError = useMemo(() => getJsonObjectError(filterText), [filterText]);
  const sortError = useMemo(() => getJsonObjectError(sortText), [sortText]);
  const queryHasError = Boolean(filterError || sortError);

  useEffect(() => {
    setCollections([]);
    setSelectedCollection("");
    setDocumentsPage(undefined);
    setMongoError(undefined);
    setOperationResult(undefined);
    if (environment.status === "running") {
      void loadCollections();
    }
  }, [environment.key, environment.status]);

  useEffect(() => {
    if (selectedCollection) {
      void searchDocuments(1);
    }
  }, [selectedCollection, limit, findMode]);

  async function loadCollections(): Promise<void> {
    setLoadingCollections(true);
    setMongoError(undefined);
    try {
      const response = await onListCollections(environment.key);
      if (response.available === false) {
        setMongoError(response.reason ?? "MongoDB is not available.");
        setCollections([]);
        return;
      }
      const nextCollections = response.collections ?? [];
      setDatabase(response.database ?? "primarie");
      setCollections(nextCollections);
      setSelectedCollection((current) => {
        if (current && nextCollections.some((collection) => collection.name === current)) {
          return current;
        }
        return nextCollections[0]?.name ?? "";
      });
    } catch (error) {
      setMongoError(toErrorMessage(error));
    } finally {
      setLoadingCollections(false);
    }
  }

  async function searchDocuments(nextPage = page): Promise<void> {
    if (!selectedCollection) {
      return;
    }

    setLoadingDocuments(true);
    setMongoError(undefined);
    setOperationResult(undefined);
    try {
      const filter = parseJsonObject(filterText, "Filter");
      const sort = parseJsonObject(sortText, "Sort");
      const effectiveLimit = findMode === "findOne" ? 1 : limit;
      const effectivePage = findMode === "findOne" ? 1 : nextPage;
      const nextDocumentsPage = await onSearchDocuments(environment.key, selectedCollection, { filter, page: effectivePage, limit: effectiveLimit, sort });
      setPage(nextDocumentsPage.page);
      setDocumentsPage(nextDocumentsPage);
      setExpandedDocuments(new Set());
    } catch (error) {
      setMongoError(toErrorMessage(error));
    } finally {
      setLoadingDocuments(false);
    }
  }

  async function insertDocuments(): Promise<void> {
    if (!selectedCollection) {
      return;
    }

    setMongoError(undefined);
    setOperationResult(undefined);
    try {
      const documents = parseMongoDocuments(insertText);
      const result = await onInsertDocuments(environment.key, selectedCollection, documents);
      setOperationResult(`Inserted ${result.insertedCount} document${result.insertedCount === 1 ? "" : "s"}.`);
      await loadCollections();
      await searchDocuments(1);
    } catch (error) {
      setMongoError(toErrorMessage(error));
    }
  }

  async function deleteDocuments(): Promise<void> {
    if (!selectedCollection) {
      return;
    }

    setMongoError(undefined);
    setOperationResult(undefined);
    try {
      const filter = parseJsonObject(deleteFilterText, "Delete filter");
      const confirmed = window.confirm(`Delete ${deleteMany ? "all matching documents" : "one matching document"} from ${selectedCollection}?`);
      if (!confirmed) {
        return;
      }
      const result = await onDeleteDocuments(environment.key, selectedCollection, { filter, many: deleteMany, confirm: true });
      setOperationResult(`Matched ${result.matchedCount}; deleted ${result.deletedCount}.`);
      await loadCollections();
      await searchDocuments(1);
    } catch (error) {
      setMongoError(toErrorMessage(error));
    }
  }

  async function updateDocuments(): Promise<void> {
    if (!selectedCollection) {
      return;
    }

    setMongoError(undefined);
    setOperationResult(undefined);
    try {
      const filter = parseJsonObject(updateFilterText, "Update filter");
      const update = parseJsonObject(updateText, "Update command");
      const many = updateMode === "updateMany";
      const confirmed = window.confirm(`Update ${many ? "all matching documents" : "one matching document"} in ${selectedCollection}?`);
      if (!confirmed) {
        return;
      }
      const result = await onUpdateDocuments(environment.key, selectedCollection, { filter, update, many, confirm: true });
      setOperationResult(`Matched ${result.matchedCount}; modified ${result.modifiedCount}.`);
      await loadCollections();
      await searchDocuments(page);
    } catch (error) {
      setMongoError(toErrorMessage(error));
    }
  }

  function toggleDocument(index: number): void {
    setExpandedDocuments((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  function formatJsonText(value: string, label: string, setter: (value: string) => void): void {
    setMongoError(undefined);
    try {
      setter(JSON.stringify(parseJsonObject(value, label), null, 2));
    } catch (error) {
      setMongoError(toErrorMessage(error));
    }
  }

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "285px minmax(0, 1fr)" }, minHeight: fill ? "100%" : 520, height: fill ? "100%" : undefined, overflow: "hidden" }}>
      <Stack sx={{ bgcolor: "#151d1e", borderRight: { lg: "1px solid #3b494b" }, borderBottom: { xs: "1px solid #3b494b", lg: 0 }, minHeight: 0, overflow: "auto" }}>
        <Box sx={{ px: 1.5, py: 1.2, borderBottom: "1px solid #3b494b" }}>
          <Typography sx={{ color: "#d7e3ee", fontFamily: monoFont, fontSize: 13, fontWeight: 900 }} noWrap>
            {environment.key}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }} noWrap>
            {database}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ p: 1 }}>
          <Button size="small" variant="outlined" disabled={loadingCollections} onClick={() => void loadCollections()} sx={smallButtonSx}>
            Refresh
          </Button>
          {loadingCollections ? <CircularProgress size={16} sx={{ alignSelf: "center" }} /> : null}
        </Stack>
        {collections.length === 0 ? (
          <Box sx={{ px: 1.5, py: 1, color: "text.secondary", fontFamily: monoFont, fontSize: 13 }}>
            {loadingCollections ? "Loading collections" : "No collections"}
          </Box>
        ) : collections.map((collection) => (
          <Button
            key={collection.name}
            onClick={() => {
              setSelectedCollection(collection.name);
              setPage(1);
            }}
            sx={{
              justifyContent: "space-between",
              textAlign: "left",
              borderRadius: 0,
              px: 1.5,
              py: 1,
              color: "text.primary",
              bgcolor: selectedCollection === collection.name ? "rgba(0, 240, 255, 0.08)" : "transparent",
              fontFamily: monoFont,
              textTransform: "none",
              "&:hover": { bgcolor: "rgba(0, 240, 255, 0.11)" }
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontFamily: monoFont, fontSize: 13 }} noWrap>
                {collection.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }} noWrap>
                {collection.sizeBytes !== undefined ? formatBytes(collection.sizeBytes) : "size n/a"}
              </Typography>
            </Box>
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1, fontFamily: monoFont }}>
              {collection.count}
            </Typography>
          </Button>
        ))}
      </Stack>

      <Stack sx={{ minWidth: 0, minHeight: 0, overflow: "hidden", bgcolor: "#080f10" }}>
        <Box sx={{ p: 1.5, borderBottom: "1px solid #3b494b", bgcolor: "#151d1e" }}>
          <Box sx={{ border: "1px solid #2d3a3c", bgcolor: "#0d1516", borderRadius: 1, overflow: "hidden" }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, px: 1.25, py: 1, borderBottom: "1px solid #263334", flexWrap: "wrap" }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                <DataObjectIcon fontSize="small" sx={{ color: "#4edea3" }} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ color: "#d7e3ee", fontFamily: monoFont, fontSize: 13, fontWeight: 900 }} noWrap>
                    Query builder
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }} noWrap>
                    {selectedCollectionRecord ? `${database}.${selectedCollectionRecord.name}` : "Select a collection"}
                  </Typography>
                </Box>
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={findMode}
                  onChange={(_, value: MongoFindMode | null) => {
                    if (value) {
                      setFindMode(value);
                      setPage(1);
                    }
                  }}
                  sx={mongoToggleSx}
                >
                  <ToggleButton value="findMany">findMany</ToggleButton>
                  <ToggleButton value="findOne">findOne</ToggleButton>
                </ToggleButtonGroup>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={updateMode}
                  onChange={(_, value: MongoUpdateMode | null) => {
                    if (value) {
                      setUpdateMode(value);
                    }
                  }}
                  sx={mongoToggleSx}
                >
                  <ToggleButton value="updateOne">updateOne</ToggleButton>
                  <ToggleButton value="updateMany">updateMany</ToggleButton>
                </ToggleButtonGroup>
              </Stack>
            </Box>

            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", xl: "minmax(0, 1.4fr) minmax(260px, 0.7fr)" }, gap: 1, p: 1 }}>
              <Stack spacing={0.8}>
                <Box sx={{ display: "flex", gap: 0.75, alignItems: "center", flexWrap: "wrap" }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont, fontWeight: 900, textTransform: "uppercase" }}>
                    Filter
                  </Typography>
                  {[
                    { label: "All", value: "{\n}" },
                    { label: "Has _id", value: "{\n  \"_id\": {\n    \"$exists\": true\n  }\n}" },
                    { label: "Tenant", value: "{\n  \"tenant\": \"moldova\"\n}" }
                  ].map((template) => (
                    <Chip
                      key={template.label}
                      size="small"
                      label={template.label}
                      onClick={() => setFilterText(template.value)}
                      sx={mongoTemplateChipSx}
                    />
                  ))}
                  <Tooltip title="Format filter JSON">
                    <IconButton size="small" onClick={() => formatJsonText(filterText, "Filter", setFilterText)} sx={mongoInlineIconButtonSx}>
                      <AutoFixHighIcon fontSize="inherit" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Clear filter">
                    <IconButton size="small" onClick={() => setFilterText("{\n}")} sx={mongoInlineIconButtonSx}>
                      <ClearIcon fontSize="inherit" />
                    </IconButton>
                  </Tooltip>
                </Box>
                <TextField
                  multiline
                  minRows={5}
                  value={filterText}
                  onChange={(event) => setFilterText(event.target.value)}
                  error={Boolean(filterError)}
                  helperText={filterError ?? `${findMode} filter JSON object`}
                  sx={mongoJsonFieldSx}
                />
              </Stack>

              <Stack spacing={0.8}>
                <Box sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 108px", gap: 1, alignItems: "start" }}>
                  <Stack spacing={0.8}>
                    <Box sx={{ display: "flex", gap: 0.75, alignItems: "center", flexWrap: "wrap" }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont, fontWeight: 900, textTransform: "uppercase" }}>
                        Sort
                      </Typography>
                      <Tooltip title="Format sort JSON">
                        <IconButton size="small" onClick={() => formatJsonText(sortText, "Sort", setSortText)} sx={mongoInlineIconButtonSx}>
                          <AutoFixHighIcon fontSize="inherit" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                    <TextField
                      multiline
                      minRows={5}
                      value={sortText}
                      onChange={(event) => setSortText(event.target.value)}
                      error={Boolean(sortError)}
                      helperText={sortError ?? "MongoDB sort JSON object"}
                      sx={mongoJsonFieldSx}
                    />
                  </Stack>
                  <Stack spacing={1}>
                    <TextField
                      select
                      label="Limit"
                      value={limit}
                      disabled={findMode === "findOne"}
                      onChange={(event) => {
                        setLimit(Number(event.target.value));
                        setPage(1);
                      }}
                      sx={compactFieldSx}
                    >
                      {[10, 20, 50, 100].map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
                    </TextField>
                    <Button
                      variant="contained"
                      startIcon={<ManageSearchIcon />}
                      disabled={!selectedCollection || loadingDocuments || queryHasError}
                      onClick={() => void searchDocuments(1)}
                      sx={{ ...smallButtonSx, minHeight: 40, bgcolor: "#167c5d", "&:hover": { bgcolor: "#1d916e" } }}
                    >
                      Run
                    </Button>
                    <Button variant="outlined" disabled={!selectedCollection || loadingDocuments || queryHasError} onClick={() => void searchDocuments(page)} sx={smallButtonSx}>
                      Reload
                    </Button>
                  </Stack>
                </Box>
              </Stack>
            </Box>
          </Box>
          <Box sx={{ display: "flex", gap: 1, alignItems: "center", justifyContent: "space-between", mt: 1, flexWrap: "wrap" }}>
            <Typography sx={{ color: "#4edea3", fontFamily: monoFont, fontSize: 12 }}>
              {selectedCollectionRecord ? `${database}.${selectedCollectionRecord.name} / ${findMode} / ${documentsPage?.documents.length ?? 0} shown of ${documentsPage?.total ?? selectedCollectionRecord.count}` : "Select a collection"}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ visibility: findMode === "findOne" ? "hidden" : "visible" }}>
              <Button size="small" variant="outlined" disabled={!documentsPage || page <= 1 || loadingDocuments} onClick={() => void searchDocuments(page - 1)} sx={smallButtonSx}>
                Prev
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }}>
                {page}/{totalPages}
              </Typography>
              <Button size="small" variant="outlined" disabled={!documentsPage || page >= totalPages || loadingDocuments} onClick={() => void searchDocuments(page + 1)} sx={smallButtonSx}>
                Next
              </Button>
            </Stack>
          </Box>
          {mongoError ? <Alert severity="warning" sx={{ mt: 1 }}>{mongoError}</Alert> : null}
          {operationResult ? <Alert severity="success" sx={{ mt: 1 }}>{operationResult}</Alert> : null}
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 1.5 }}>
          {loadingDocuments ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ color: "text.secondary", fontFamily: monoFont }}>
              <CircularProgress size={16} />
              <Box>Loading documents</Box>
            </Stack>
          ) : !documentsPage || documentsPage.documents.length === 0 ? (
            <Box sx={{ color: "text.secondary", fontFamily: monoFont, fontSize: 13 }}>
              {selectedCollection ? "No documents loaded." : "Select a collection."}
            </Box>
          ) : (
            <Stack spacing={1}>
              {documentsPage.documents.map((document, index) => (
                <JsonDocument
                  key={index}
                  value={document}
                  index={(documentsPage.page - 1) * documentsPage.limit + index + 1}
                  collection={selectedCollection}
                  expanded={expandedDocuments.has(index)}
                  onToggle={() => toggleDocument(index)}
                />
              ))}
            </Stack>
          )}
        </Box>

        <Box sx={{ borderTop: "1px solid #3b494b", bgcolor: "#151d1e", p: 1.5, maxHeight: "38%", overflow: "auto" }}>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", xl: "1fr 1fr 1fr" }, gap: 1.25 }}>
            <MongoActionPanel title="Insert" onRun={() => void insertDocuments()} disabled={!selectedCollection}>
              <TextField multiline minRows={7} value={insertText} onChange={(event) => setInsertText(event.target.value)} sx={compactFieldSx} />
            </MongoActionPanel>
            <MongoActionPanel title="Delete" onRun={() => void deleteDocuments()} disabled={!selectedCollection}>
              <TextField multiline minRows={7} value={deleteFilterText} onChange={(event) => setDeleteFilterText(event.target.value)} sx={compactFieldSx} />
              <FormControlLabel control={<Switch checked={deleteMany} onChange={(event) => setDeleteMany(event.target.checked)} />} label={deleteMany ? "Many" : "One"} sx={{ m: 0, color: "text.secondary", "& .MuiFormControlLabel-label": { fontFamily: monoFont, fontSize: 12, textTransform: "uppercase" } }} />
            </MongoActionPanel>
            <MongoActionPanel title="Update" onRun={() => void updateDocuments()} disabled={!selectedCollection}>
              <TextField
                select
                label="Operation"
                value={updateMode}
                onChange={(event) => setUpdateMode(event.target.value as MongoUpdateMode)}
                sx={compactFieldSx}
              >
                <MenuItem value="updateOne">updateOne</MenuItem>
                <MenuItem value="updateMany">updateMany</MenuItem>
              </TextField>
              <TextField label="Filter JSON" multiline minRows={4} value={updateFilterText} onChange={(event) => setUpdateFilterText(event.target.value)} sx={compactFieldSx} />
              <TextField label="Update JSON" multiline minRows={4} value={updateText} onChange={(event) => setUpdateText(event.target.value)} sx={compactFieldSx} />
            </MongoActionPanel>
          </Box>
        </Box>
      </Stack>
    </Box>
  );
}

function MongoActionPanel({ title, children, onRun, disabled }: { title: string; children: ReactNode; onRun: () => void; disabled?: boolean }) {
  return (
    <Stack spacing={1}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont, fontWeight: 900, textTransform: "uppercase" }}>
          {title}
        </Typography>
        <Button size="small" variant="outlined" disabled={disabled} onClick={onRun} sx={smallButtonSx}>
          Run
        </Button>
      </Box>
      {children}
    </Stack>
  );
}

function JsonDocument({ value, index, collection, expanded, onToggle }: { value: unknown; index: number; collection: string; expanded: boolean; onToggle: () => void }) {
  const json = JSON.stringify(value, null, 2);
  const large = json.length > 1800;
  const displayed = large && !expanded ? `${json.slice(0, 1800)}\n...` : json;

  return (
    <Box sx={{ border: "1px solid #263334", bgcolor: "#0f1718", borderRadius: 1, overflow: "hidden", boxShadow: "0 10px 30px rgba(0, 0, 0, 0.24)" }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1, alignItems: "center", px: 1, py: 0.75, borderBottom: "1px solid #263334", bgcolor: "#162122" }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <Chip size="small" label={`#${index}`} sx={{ height: 22, borderRadius: 1, bgcolor: "rgba(78, 222, 163, 0.12)", color: "#4edea3", fontFamily: monoFont, fontSize: 11 }} />
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }} noWrap>
            {collection} / {json.length} bytes
          </Typography>
        </Stack>
        {large ? (
          <Button size="small" variant="text" onClick={onToggle} sx={{ ...smallButtonSx, minHeight: 26, border: 0 }}>
            {expanded ? "Collapse" : "Expand"}
          </Button>
        ) : null}
      </Box>
      <Box component="pre" sx={{ m: 0, p: 1.2, color: "#d7e3ee", fontFamily: monoFont, fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {formatJsonForDisplay(displayed)}
      </Box>
    </Box>
  );
}

function formatJsonForDisplay(json: string): ReactNode[] {
  const tokenPattern = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?=\s*:)|"(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\.\.)/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(json)) !== null) {
    if (match.index > cursor) {
      nodes.push(json.slice(cursor, match.index));
    }

    const token = match[0];
    const color = token === "..."
      ? "#7d8d8f"
      : token.startsWith("\"") && json.slice(match.index + token.length).match(/^\s*:/)
        ? "#77c7ff"
        : token.startsWith("\"")
          ? "#f6c177"
          : token === "true" || token === "false"
            ? "#4edea3"
            : token === "null"
              ? "#9ca7a9"
              : "#c4a7ff";
    nodes.push(<Box key={`${match.index}-${token}`} component="span" sx={{ color }}>{token}</Box>);
    cursor = match.index + token.length;
  }

  if (cursor < json.length) {
    nodes.push(json.slice(cursor));
  }

  return nodes;
}

function FileExplorer({
  files,
  path,
  onPathChange,
  onLoadPath,
  onOpenDirectory,
  sourceLabel,
  fill = false
}: {
  files: ContainerFileEntry[];
  path: string;
  onPathChange: (path: string) => void;
  onLoadPath: () => void;
  onOpenDirectory: (path: string) => void;
  sourceLabel: string;
  fill?: boolean;
}) {
  return (
    <Stack spacing={1.5} sx={{ p: 1.5, minHeight: fill ? "100%" : 320 }}>
      <Stack direction="row" spacing={1}>
        <TextField
          size="small"
          value={path}
          onChange={(event) => onPathChange(event.target.value)}
          sx={compactFieldSx}
        />
        <Button variant="outlined" onClick={onLoadPath} sx={smallButtonSx}>
          Open
        </Button>
      </Stack>

      <Stack spacing={0.75} sx={{ maxHeight: fill ? "none" : 230, overflow: "auto", pr: 0.5, flex: fill ? 1 : undefined }}>
        {files.length === 0 ? (
          <Typography color="text.secondary" variant="body2">No files loaded.</Typography>
        ) : files.map((file) => {
          const isDirectory = file.type === "directory";
          return (
            <Stack
              key={file.path}
              direction="row"
              spacing={1}
              alignItems="center"
              onClick={() => isDirectory ? onOpenDirectory(file.path) : undefined}
              sx={{ cursor: isDirectory ? "pointer" : "default", color: "text.primary", minWidth: 0 }}
            >
              {isDirectory ? <FolderIcon fontSize="small" sx={{ color: "#fed639" }} /> : <InsertDriveFileIcon fontSize="small" sx={{ color: "#849495" }} />}
              <Typography variant="body2" noWrap>{file.name}</Typography>
            </Stack>
          );
        })}
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }}>
        {sourceLabel}
      </Typography>
    </Stack>
  );
}

function FileSyncPanel({
  environment,
  repoPath,
  gitState,
  syncState,
  events,
  onStartSync,
  onStopSync,
  onForceSync
}: {
  environment: EnvironmentRecord;
  repoPath: string;
  gitState?: GitState;
  syncState: SyncState;
  events: FileSyncEvent[];
  onStartSync: (key: string) => Promise<void>;
  onStopSync: () => Promise<void>;
  onForceSync: (key: string) => Promise<void>;
}) {
  const syncEnabled = syncState.watching && syncState.activeEnvironmentKey === environment.key;
  const selectedForSync = syncState.activeEnvironmentKey === environment.key;
  const canStartSync = Boolean(repoPath) && canEnvironmentSync(environment.status);
  const disabled = syncEnabled ? false : !canStartSync;
  const statusLabel = syncEnabled ? syncState.syncing ? "Sending" : "Watching" : selectedForSync ? "Selected" : "Stopped";

  async function toggleSync(checked: boolean): Promise<void> {
    if (checked) {
      await onStartSync(environment.key);
      return;
    }

    if (syncEnabled) {
      await onStopSync();
    }
  }

  return (
    <Stack spacing={1.5} sx={{ p: 1.5, minHeight: "100%" }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
        <Stack direction="row" spacing={1.1} alignItems="center" minWidth={0}>
          <SyncIcon sx={{ color: syncEnabled ? "#4edea3" : "#849495", fontSize: 20 }} />
          <Typography sx={{ color: "#d7e3ee", fontFamily: monoFont, fontWeight: 900 }} noWrap>
            PATCH SYNC
          </Typography>
          <Chip
            size="small"
            label={statusLabel}
            sx={{
              height: 22,
              borderRadius: "2px",
              color: syncEnabled ? "#4edea3" : selectedForSync ? "#00f0ff" : "text.secondary",
              border: `1px solid ${syncEnabled ? "#4edea3" : selectedForSync ? "#00f0ff" : "#3b494b"}`,
              bgcolor: syncEnabled ? "rgba(78, 222, 163, 0.1)" : "rgba(220, 228, 229, 0.05)",
              fontFamily: monoFont,
              textTransform: "uppercase"
            }}
          />
        </Stack>
        <FormControlLabel
          control={
            <Switch
              checked={syncEnabled}
              disabled={disabled}
              onChange={(event) => void toggleSync(event.target.checked)}
            />
          }
          label={syncEnabled ? "Enabled" : "Disabled"}
          sx={{ m: 0, color: "text.secondary", "& .MuiFormControlLabel-label": { fontFamily: monoFont, fontSize: 12, textTransform: "uppercase" } }}
        />
        <Button
          size="small"
          variant="outlined"
          startIcon={<RefreshIcon />}
          disabled={!canStartSync || syncState.syncing}
          onClick={() => void onForceSync(environment.key)}
          sx={smallButtonSx}
        >
          Force sync
        </Button>
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1.3fr repeat(4, 1fr)" }, gap: 1.25 }}>
        <SyncMetric label="Repository" value={repoPath || "None"} />
        <SyncMetric label="Branch" value={gitState?.branch ?? "n/a"} />
        <SyncMetric label="Local changes" value={gitState ? String(gitState.changedFiles.length) : "n/a"} />
        <SyncMetric label="Last file" value={syncState.activeEnvironmentKey === environment.key ? syncState.lastSyncedFile ?? "None" : "None"} />
        <SyncMetric label="Last sync" value={syncState.activeEnvironmentKey === environment.key ? syncState.lastSyncTime ?? "None" : "None"} />
      </Box>

      {syncState.activeEnvironmentKey === environment.key && syncState.errors.length > 0 ? (
        <Stack spacing={0.75}>
          {syncState.errors.slice(-3).map((error) => (
            <Box key={error} sx={{ px: 1.2, py: 0.85, border: "1px solid rgba(254, 214, 57, 0.35)", bgcolor: "rgba(254, 214, 57, 0.08)", color: "#fed639", fontFamily: monoFont, fontSize: 12, wordBreak: "break-word" }}>
              {error}
            </Box>
          ))}
        </Stack>
      ) : null}

      <Box sx={{ border: "1px solid #3b494b", bgcolor: "#151d1e", flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <Box sx={{ px: 1.5, py: 1.1, borderBottom: "1px solid #3b494b", display: "flex", justifyContent: "space-between", gap: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont, fontWeight: 900 }}>
            PATCH EVENTS
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }}>
            {events.length}
          </Typography>
        </Box>
        <Box sx={{ overflow: "auto", flex: 1 }}>
          {events.length === 0 ? (
            <Box sx={{ px: 1.5, py: 2, color: "text.secondary", fontFamily: monoFont, fontSize: 13 }}>
              No patch sync events yet.
            </Box>
          ) : (
            <Box sx={{ minWidth: 780 }}>
              <Box sx={{ display: "grid", gridTemplateColumns: "155px 90px 100px minmax(260px, 1fr) 90px", gap: 1, px: 1.5, py: 0.9, color: "text.secondary", fontFamily: monoFont, fontSize: 10, fontWeight: 900, textTransform: "uppercase", borderBottom: "1px solid #3b494b" }}>
                <Box>Time</Box>
                <Box>Result</Box>
                <Box>Status</Box>
                <Box>Path</Box>
                <Box>Commit</Box>
              </Box>
              {events.map((event) => (
                <Box key={event.id} sx={{ display: "grid", gridTemplateColumns: "155px 90px 100px minmax(260px, 1fr) 90px", gap: 1, px: 1.5, py: 1.05, borderBottom: "1px solid #263334", alignItems: "start", fontFamily: monoFont, fontSize: 12 }}>
                  <Box sx={{ color: "text.secondary" }}>{formatTimestamp(event.at)}</Box>
                  <Box sx={{ color: syncResultColor(event.result), fontWeight: 900, textTransform: "uppercase" }}>{event.result}</Box>
                  <Box sx={{ color: "#d7e3ee", textTransform: "uppercase" }}>{event.status}</Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ color: "text.primary", fontFamily: monoFont, fontSize: 12, wordBreak: "break-all" }}>
                      {event.path}
                    </Typography>
                    {event.warning || event.error ? (
                      <Typography sx={{ color: event.error ? "#ffb4ab" : "#fed639", fontFamily: monoFont, fontSize: 11, wordBreak: "break-word", mt: 0.25 }}>
                        {event.error ?? event.warning}
                      </Typography>
                    ) : null}
                  </Box>
                  <Box sx={{ color: "#00f0ff" }}>{shortId(event.commit)}</Box>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Box>
    </Stack>
  );
}

function SyncMetric({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ border: "1px solid #3b494b", bgcolor: "#151d1e", px: 1.25, py: 1, minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontFamily: monoFont, fontWeight: 900, textTransform: "uppercase" }}>
        {label}
      </Typography>
      <Typography sx={{ color: "#d7e3ee", fontFamily: monoFont, fontSize: 13, wordBreak: "break-word" }}>
        {value}
      </Typography>
    </Box>
  );
}

function MetaLabel({ icon, label, accent = false }: { icon: "user" | "branch" | "calendar" | "refresh"; label: string; accent?: boolean }) {
  return (
    <Stack direction="row" spacing={0.65} alignItems="center">
      <Typography color={accent ? "#00f0ff" : "text.secondary"} sx={{ fontFamily: monoFont, fontSize: 14 }}>
        {icon === "user" ? "@" : icon === "branch" ? "<>" : icon === "calendar" ? "[]" : "->"}
      </Typography>
      <Typography color={accent ? "#00f0ff" : "text.primary"} sx={{ fontFamily: monoFont, fontSize: 14 }}>
        {label}
      </Typography>
    </Stack>
  );
}

function buildDomains(environment: EnvironmentRecord): string[] {
  return [
    `admin-${environment.key}.prmr.md`,
    `api-${environment.key}.prmr.md`
  ];
}

function toExternalUrl(domain: string): string {
  return `https://${domain}`;
}

function isPullRequest(value: EnvironmentRecord["createdBy"]): value is { title?: string; url: string } {
  return "url" in value;
}

function ownerLabel(value: EnvironmentRecord["createdBy"]): string {
  return isPullRequest(value) ? value.title ?? "PR_SOURCE" : `@${value.name.replace(/\s+/g, "_").toUpperCase()}`;
}

function containerName(container: EnvironmentContainer): string {
  return container.Name ?? container.Names ?? container.ID ?? "";
}

function shortName(name: string): string {
  return name.split(/[-_/]/).filter(Boolean).slice(-2).join("-") || name;
}

function portsLabel(container: EnvironmentContainer): string {
  const status = container.Status ?? "";
  const match = status.match(/(\d+)->(\d+)/);
  if (match) {
    return `${match[1]}:${match[2]}`;
  }
  return "3000:3000";
}

function uptimeLabel(status?: string): string {
  if (!status) {
    return "42h 12m";
  }
  const match = status.match(/Up\s+(.+?)(?:\s{2,}|\s+\(|$)/i);
  return (match?.[1] ?? status.replace(/^Up\s+/i, "")) || "42h 12m";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }
  return date.toISOString().slice(0, 10);
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "n/a";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ["KB", "MB", "GB"];
  let next = value / 1024;
  for (const unit of units) {
    if (next < 1024 || unit === units.at(-1)) {
      return `${next.toFixed(next < 10 ? 1 : 0)} ${unit}`;
    }
    next /= 1024;
  }
  return `${value} B`;
}

function shortId(value: string): string {
  return value.slice(0, 8);
}

function appendUniqueLogs(current: EnvironmentActionLog[], next: EnvironmentActionLog[]): EnvironmentActionLog[] {
  const seen = new Set(current.map(logIdentity));
  const merged = [...current];
  next.forEach((entry) => {
    const key = logIdentity(entry);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(entry);
    }
  });
  return merged.sort((left, right) => {
    const leftOffset = left.byteStart ?? Number.MAX_SAFE_INTEGER;
    const rightOffset = right.byteStart ?? Number.MAX_SAFE_INTEGER;
    if (leftOffset !== rightOffset) {
      return leftOffset - rightOffset;
    }
    return (left.createdAt ?? "").localeCompare(right.createdAt ?? "");
  });
}

function mergeTerminalLogs(primary: Array<{ at: string; message: string; level: "info" | "error"; system: boolean }>, secondary: Array<{ at: string; message: string; level: "info" | "error"; system: boolean }>) {
  const seen = new Set<string>();
  const merged: Array<{ at: string; message: string; level: "info" | "error"; system: boolean }> = [];

  for (const entry of [...primary, ...secondary]) {
    const id = `${entry.level}:${entry.message}`;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    merged.push(entry);
  }

  return merged;
}

function logIdentity(entry: EnvironmentActionLog): string {
  if (entry.byteStart !== undefined || entry.byteEnd !== undefined) {
    return `${entry.actionId}:${entry.byteStart ?? "?"}:${entry.byteEnd ?? "?"}`;
  }
  return `${entry.actionId}:${entry.createdAt ?? ""}:${entry.line ?? entry.log ?? ""}`;
}

function appendUniqueActions(current: EnvironmentActionRecord[], next: EnvironmentActionRecord[]): EnvironmentActionRecord[] {
  const seen = new Set(current.map((action) => action.id));
  const merged = [...current];
  next.forEach((action) => {
    if (!seen.has(action.id)) {
      seen.add(action.id);
      merged.push(action);
    }
  });
  return merged.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function upsertAction(current: EnvironmentActionRecord[], action: EnvironmentActionRecord): EnvironmentActionRecord[] {
  return [action, ...current.filter((item) => item.id !== action.id)]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function relativeAge(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }
  const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds} secs`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} mins`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hrs`;
  return `${Math.floor(hours / 24)} days`;
}

function statusColor(status: string): string {
  if (status === "running") return "#4edea3";
  if (status === "failed") return "#ffb4ab";
  if (status === "error") return "#ffb4ab";
  if (status === "queued") return "#00f0ff";
  if (status === "creating") return "#00f0ff";
  if (status === "complete") return "#d7e3ee";
  return "#d7e3ee";
}

function canEnvironmentSync(status: EnvironmentRecord["status"]): boolean {
  return status === "running" || status === "stopped";
}

function canInspectContainers(status: EnvironmentRecord["status"]): boolean {
  return status === "running" || status === "starting" || status === "failed" || status === "stopped";
}

function shouldPollContainers(status: EnvironmentRecord["status"]): boolean {
  return status === "starting" || status === "failed" || status === "stopped";
}

function shouldShowLifecycleLogsInPrimaryTerminal(status?: EnvironmentRecord["status"]): boolean {
  return status === "creating"
    || status === "cloning"
    || status === "checking_out"
    || status === "applying_changes"
    || status === "starting"
    || status === "removing"
    || status === "failed";
}

function syncResultColor(result: FileSyncEvent["result"]): string {
  if (result === "sent") return "#4edea3";
  if (result === "skipped") return "#fed639";
  return "#ffb4ab";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${toErrorMessage(error)}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed;
}

function getJsonObjectError(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? undefined : "Must be a JSON object.";
  } catch (error) {
    return toErrorMessage(error);
  }
}

function parseMongoDocuments(value: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`Document input is not valid JSON: ${toErrorMessage(error)}`);
  }
  const documents = Array.isArray(parsed) ? parsed : [parsed];
  if (!documents.length || !documents.every(isRecord)) {
    throw new Error("Document input must be a JSON object or an array of JSON objects.");
  }
  return documents;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const monoFont = "Space Grotesk, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

const tableHeadSx = {
  px: 2,
  py: 1.5,
  color: "#c7d4e2",
  textAlign: "left",
  fontSize: 12,
  fontWeight: 900,
  fontFamily: monoFont
};

const actionButtonSx = {
  borderRadius: 0,
  borderColor: "rgba(215, 227, 238, 0.8)",
  color: "text.primary",
  px: 2.5,
  minHeight: 44,
  fontFamily: monoFont,
  textTransform: "uppercase"
};

const startButtonSx = {
  ...actionButtonSx,
  borderColor: "rgba(78, 222, 163, 0.82)",
  color: "#4edea3"
};

const logsButtonSx = {
  ...actionButtonSx,
  borderColor: "rgba(0, 240, 255, 0.72)",
  color: "#00f0ff"
};

const deleteButtonSx = {
  borderRadius: 0,
  minHeight: 44,
  px: 2.5,
  fontFamily: monoFont,
  textTransform: "uppercase",
  bgcolor: "#c72418"
};

const iconButtonSx = {
  color: "#d7e3ee",
  borderRadius: 0
};

const statusChipSx = {
  borderRadius: "2px",
  bgcolor: "rgba(215, 227, 238, 0.13)",
  color: "text.primary",
  fontFamily: monoFont
};

const compactFieldSx = {
  flex: 1,
  "& .MuiInputBase-root": {
    borderRadius: 0,
    bgcolor: "#151d1e",
    fontFamily: monoFont,
    fontSize: 13
  }
};

const mongoJsonFieldSx = {
  ...compactFieldSx,
  "& .MuiInputBase-root": {
    borderRadius: "6px",
    bgcolor: "#10191a",
    fontFamily: monoFont,
    fontSize: 13,
    alignItems: "flex-start"
  },
  "& .MuiFormHelperText-root": {
    mx: 0,
    fontFamily: monoFont,
    fontSize: 11
  }
};

const mongoToggleSx = {
  bgcolor: "#10191a",
  border: "1px solid #2d3a3c",
  "& .MuiToggleButton-root": {
    border: 0,
    borderRadius: 0,
    color: "text.secondary",
    fontFamily: monoFont,
    fontSize: 12,
    px: 1.5,
    textTransform: "none"
  },
  "& .Mui-selected": {
    bgcolor: "rgba(78, 222, 163, 0.16) !important",
    color: "#4edea3"
  }
};

const mongoTemplateChipSx = {
  height: 24,
  borderRadius: "4px",
  bgcolor: "rgba(215, 227, 238, 0.08)",
  color: "#d7e3ee",
  fontFamily: monoFont,
  fontSize: 11,
  "&:hover": {
    bgcolor: "rgba(78, 222, 163, 0.16)"
  }
};

const mongoInlineIconButtonSx = {
  width: 26,
  height: 26,
  borderRadius: "4px",
  color: "#d7e3ee",
  border: "1px solid #2d3a3c",
  "&:hover": {
    borderColor: "#4edea3",
    color: "#4edea3",
    bgcolor: "rgba(78, 222, 163, 0.08)"
  }
};

const commandFieldSx = {
  flex: 1,
  "& .MuiInputBase-root": {
    borderRadius: 0,
    bgcolor: "transparent",
    fontFamily: monoFont,
    fontSize: 13,
    color: "text.primary"
  },
  "& .MuiOutlinedInput-notchedOutline": {
    borderColor: "transparent"
  },
  "&:hover .MuiOutlinedInput-notchedOutline": {
    borderColor: "transparent"
  },
  "& .Mui-focused .MuiOutlinedInput-notchedOutline": {
    borderColor: "transparent"
  }
};

const smallButtonSx = {
  borderRadius: 0,
  minWidth: 76,
  fontFamily: monoFont,
  textTransform: "uppercase"
};

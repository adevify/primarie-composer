import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import PauseCircleOutlineIcon from "@mui/icons-material/PauseCircleOutline";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RefreshIcon from "@mui/icons-material/Refresh";
import StorageIcon from "@mui/icons-material/Storage";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import TerminalIcon from "@mui/icons-material/Terminal";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import type {
  ComposeLogEntry,
  ContainerFileEntry,
  EnvironmentActionLog,
  EnvironmentActionLogsPage,
  EnvironmentActionRecord,
  EnvironmentActionsPage,
  EnvironmentContainer,
  EnvironmentRecord,
  LiveLogSession,
  MongoPreview as MongoPreviewPayload,
  StreamLogEvent
} from "../types";

type UtilityTab = "logs" | "files" | "exec" | "mongo" | "actions";
type LogScope = "environment" | "container";

const LOG_TAIL_PAGE_SIZE = 100;

type EnvironmentDetailsProps = {
  environment?: EnvironmentRecord;
  open: boolean;
  onClose: () => void;
  onListContainers: (key: string) => Promise<EnvironmentContainer[]>;
  onListContainerFiles: (key: string, container: string, path: string) => Promise<ContainerFileEntry[]>;
  onListEnvironmentFiles: (key: string, path: string) => Promise<ContainerFileEntry[]>;
  onInspectMongo: (key: string) => Promise<MongoPreviewPayload>;
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
  onStartComposeLogStream: (key: string) => void;
  onStartContainerLogStream: (key: string, container: string) => void;
  onStopLiveLogSession: (id: string) => void;
};

export function EnvironmentDetails({
  environment,
  open,
  onClose,
  onListContainers,
  onListContainerFiles,
  onListEnvironmentFiles,
  onInspectMongo,
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
  onStartComposeLogStream,
  onStartContainerLogStream,
  onStopLiveLogSession
}: EnvironmentDetailsProps) {
  const [containers, setContainers] = useState<EnvironmentContainer[]>([]);
  const [selectedContainer, setSelectedContainer] = useState("");
  const [containerPath, setContainerPath] = useState("/");
  const [files, setFiles] = useState<ContainerFileEntry[]>([]);
  const [mongoPreview, setMongoPreview] = useState<MongoPreviewPayload>();
  const [loadingContainers, setLoadingContainers] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingMongo, setLoadingMongo] = useState(false);
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
  const activeTabs = useMemo<UtilityTab[]>(() => environmentSelected ? ["logs", "files", "mongo", "actions"] : ["logs", "files", "exec"], [environmentSelected]);
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
    const historical = actionLogs.map((entry) => ({
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
  }, [actionLogs, selectedAction?.createdAt, liveLogSessions, selectedActionId]);
  const displayedPrimaryLogs = displayedLiveLogs.length ? displayedLiveLogs : logTailEntries;

  useEffect(() => {
    if (!open || !environment) {
      return;
    }

    if (environment.status === "running") {
      void loadContainers();
      void loadMongo();
      return;
    }

    setContainers([]);
    setSelectedContainer("");
    setFiles([]);
    setMongoPreview(undefined);
  }, [open, environment?.key, environment?.status]);

  useEffect(() => {
    if (!activeTabs.includes(utilityTab)) {
      setUtilityTab("logs");
    }
  }, [activeTabs, utilityTab]);

  useEffect(() => {
    if (!open || !environment || utilityTab !== "actions") {
      return;
    }

    void loadActions();
  }, [open, environment?.key, utilityTab, actionRefreshToken]);

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
    if (!open || !selectedActionId || utilityTab !== "actions") {
      return;
    }

    void loadActionLogs(selectedActionId);
  }, [open, selectedActionId, utilityTab]);

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
  }, [open, environment?.key, selectedContainer]);

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
    if (utilityTab === "mongo" && environmentSelected) {
      void loadMongo();
    }
    if (utilityTab === "actions" && environmentSelected) {
      void loadActions();
    }
  }, [open, utilityTab, environmentSelected]);

  useEffect(() => {
    if (!open || !selectedActionId || !selectedAction || (selectedAction.status !== "queued" && selectedAction.status !== "running")) {
      return undefined;
    }

    const interval = setInterval(() => {
      void loadActions(false, selectedActionId);
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

  useEffect(() => {
    if (!open || !environment) {
      return undefined;
    }

    const interval = setInterval(() => {
      void loadMongo(false);
    }, 5000);

    return () => clearInterval(interval);
  }, [open, environment?.key]);

  async function loadMongo(showSpinner = true): Promise<void> {
    if (!environment) {
      return;
    }

    if (showSpinner) {
      setLoadingMongo(true);
    }
    setToolError(undefined);
    try {
      setMongoPreview(await onInspectMongo(environment.key));
    } catch (error) {
      setToolError(toErrorMessage(error));
    } finally {
      if (showSpinner) {
        setLoadingMongo(false);
      }
    }
  }

  async function loadContainers(): Promise<void> {
    if (!environment) {
      return;
    }
    if (environment.status !== "running") {
      setContainers([]);
      return;
    }

    setLoadingContainers(true);
    setToolError(undefined);
    try {
      const nextContainers = await onListContainers(environment.key);
      setContainers(nextContainers);
      setSelectedContainer((current) => current && nextContainers.some((container) => containerName(container) === current) ? current : "");
    } catch (error) {
      setToolError(toErrorMessage(error));
    } finally {
      setLoadingContainers(false);
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
    if (environment.status !== "running") {
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
            <Typography color="#00f0ff" fontWeight={800} noWrap>
              {buildDomains(environment)[0]}
            </Typography>
            <Typography color="text.secondary" noWrap>
              {buildDomains(environment)[1]}
            </Typography>
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

      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: { xs: 2, lg: 3 } }}>
        {toolError ? <Alert severity="warning">{toolError}</Alert> : null}

        <Box sx={{ mt: toolError ? 2 : 0, display: "grid", gridTemplateColumns: { xs: "1fr", lg: "280px minmax(0, 1fr)" }, gap: 3, height: { lg: "calc(100vh - 218px)" }, minHeight: 560 }}>
          <Box component="aside" sx={{ minHeight: 0, overflow: "auto" }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 0.5, mb: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont, fontWeight: 900, textTransform: "uppercase" }}>
                Environment Scope
              </Typography>
              <IconButton aria-label="Refresh containers" onClick={() => void loadContainers()} disabled={loadingContainers || environment.status !== "running"} sx={iconButtonSx}>
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
                  {environment.status === "running" ? "No containers found." : "Start the environment to inspect containers."}
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
                    label={tab === "mongo" ? "Database" : tab}
                    active={utilityTab === tab}
                    onClick={() => {
                      setUtilityTab(tab);
                      if (tab === "files") {
                        void loadFiles("/");
                      }
                      if (tab === "mongo") {
                        void loadMongo();
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

            <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", bgcolor: utilityTab === "logs" || utilityTab === "exec" ? "#080f10" : "#192122" }}>
              {utilityTab === "logs" ? (
                <LogTerminal
                  logs={displayedPrimaryLogs}
                  emptyText={environment.status === "running" ? "No log tail loaded yet." : "Start the environment to read logs."}
                  compact
                  hasOlder={logTailHasMore && displayedLiveLogs.length === 0}
                  loadingOlder={loadingLogTail}
                  onReachTop={() => void loadOlderLogTail()}
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

              {utilityTab === "exec" ? (
                <Box sx={{ p: 2 }}>
                  <Box component="pre" sx={{ m: 0, minHeight: 380, overflow: "auto", color: "#dce4e5", fontFamily: monoFont, fontSize: 13, lineHeight: 1.5 }}>
                    {execOutput || `root@${shortName(selectedContainer) || "container"}:/#`}
                  </Box>
                </Box>
              ) : null}

              {utilityTab === "mongo" ? (
                <MongoPreview preview={mongoPreview} fill />
              ) : null}

              {utilityTab === "actions" ? (
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "260px 1fr" }, minHeight: "100%" }}>
                  <ActionHistory
                    actions={actions}
                    selectedActionId={selectedActionId}
                    total={actionsPage?.total ?? actions.length}
                    loading={loadingActions}
                    onSelect={setSelectedActionId}
                    hasMore={Boolean(actionsPage && actionsPage.page + 1 < actionsPage.pages)}
                    onLoadMore={() => void loadMoreActions()}
                  />
                  <Box sx={{ minWidth: 0 }}>
                    <Box sx={{ px: 2, py: 1.2, borderBottom: "1px solid #3b494b", bgcolor: "#151d1e", display: "flex", justifyContent: "space-between", gap: 2, alignItems: "center" }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }} noWrap>
                        {selectedAction ? `${selectedAction.action.toUpperCase()} / ${selectedAction.id}` : "NO REGISTERED ACTION"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }}>
                        {actionLogsPage ? `${actionLogs.length}${actionLogsPage.hasMore ? "+" : ""}` : "0"}
                      </Typography>
                    </Box>
                    <LogTerminal
                      logs={displayedActionLogs}
                      emptyText={selectedAction ? "Waiting for registered action log output." : "No actions registered for this environment yet."}
                      compact
                      hasOlder={Boolean(actionLogsPage?.hasMore)}
                      loadingOlder={loadingActionLogs}
                      onReachTop={() => void loadOlderActionLogs()}
                    />
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
    <Stack sx={{ bgcolor: "#151d1e", borderRight: { lg: "1px solid #3b494b" }, borderBottom: { xs: "1px solid #3b494b", lg: "none" }, maxHeight: { lg: 620 }, overflow: "auto" }}>
      <Box sx={{ px: 1.5, py: 1.2, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont, fontWeight: 900 }}>
          REGISTERED ACTIONS
        </Typography>
        {loading ? <CircularProgress size={14} /> : <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }}>{total}</Typography>}
      </Box>
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
  hasOlder = false,
  loadingOlder = false,
  onReachTop
}: {
  logs: Array<{ at: string; message: string; level: "info" | "error"; system: boolean }>;
  emptyText?: string;
  compact?: boolean;
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
    <Box ref={containerRef} onScroll={handleScroll} sx={{ minHeight: compact ? "100%" : 460, maxHeight: compact ? "none" : 560, overflow: "auto", bgcolor: "#080f10", p: 2, fontFamily: monoFont, fontSize: 13, lineHeight: 1.5 }}>
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

function MongoPreview({ preview, fill = false }: { preview?: MongoPreviewPayload; fill?: boolean }) {
  const [selectedCollectionName, setSelectedCollectionName] = useState("");
  const collections = preview?.collections ?? [];
  const selected = collections.find((collection) => collection.name === selectedCollectionName) ?? collections[0];
  const documents = Array.isArray(selected?.sample) ? selected.sample : selected?.sample ? [selected.sample] : [];

  useEffect(() => {
    if (!collections.length) {
      setSelectedCollectionName("");
      return;
    }

    if (!selectedCollectionName || !collections.some((collection) => collection.name === selectedCollectionName)) {
      setSelectedCollectionName(collections[0].name);
    }
  }, [collections, selectedCollectionName]);

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "38% 62%", minHeight: fill ? "100%" : 320 }}>
      <Stack sx={{ bgcolor: "#151d1e", borderRight: "1px solid #3b494b", maxHeight: fill ? "none" : 420, overflow: "auto" }}>
        {!preview ? (
          <Box sx={{ px: 1.5, py: 1, color: "text.secondary" }}>Loading MongoDB status</Box>
        ) : !preview.available ? (
          <Box sx={{ px: 1.5, py: 1, color: "text.secondary" }}>{preview.reason ?? "MongoDB container is not running"}</Box>
        ) : collections.length === 0 ? (
          <Box sx={{ px: 1.5, py: 1, color: "text.secondary" }}>No collections</Box>
        ) : collections.map((collection, index) => (
          <Button
            key={collection.name}
            onClick={() => setSelectedCollectionName(collection.name)}
            sx={{
              justifyContent: "space-between",
              textAlign: "left",
              borderRadius: 0,
              px: 1.5,
              py: 1,
              color: "text.primary",
              bgcolor: selected?.name === collection.name || (!selectedCollectionName && index === 0) ? "rgba(0, 240, 255, 0.08)" : "transparent",
              fontFamily: monoFont,
              textTransform: "none",
              "&:hover": { bgcolor: "rgba(0, 240, 255, 0.11)" }
            }}
          >
            <Typography sx={{ fontFamily: monoFont, fontSize: 13 }} noWrap>
              {collection.name}
            </Typography>
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1, fontFamily: monoFont }}>
              {collection.count}
            </Typography>
          </Button>
        ))}
      </Stack>
      <Stack sx={{ bgcolor: "#080f10", maxHeight: fill ? "none" : 420, overflow: "auto" }}>
        <Box sx={{ px: 1.5, py: 1, borderBottom: "1px solid #3b494b", color: "#4edea3", fontFamily: monoFont, fontSize: 12 }}>
          {selected ? `${preview?.database}.${selected.name} / ${documents.length}/${selected.count} docs` : preview?.available ? `Database: ${preview.database}` : "{}"}
        </Box>
        <Box component="pre" sx={{ m: 0, p: 1.5, color: "#d7e3ee", fontFamily: monoFont, fontSize: 12, overflow: "auto" }}>
          {selected ? JSON.stringify(documents, null, 2) : preview?.available ? "[]" : "{}"}
        </Box>
      </Stack>
    </Box>
  );
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

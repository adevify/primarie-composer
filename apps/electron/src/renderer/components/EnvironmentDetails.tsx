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
import { useEffect, useMemo, useState } from "react";
import type {
  ContainerFileEntry,
  EnvironmentActionLog,
  EnvironmentActionLogsPage,
  EnvironmentActionRecord,
  EnvironmentActionsPage,
  EnvironmentContainer,
  EnvironmentRecord,
  LiveLogSession,
  MongoPreview as MongoPreviewPayload
} from "../types";

type EnvironmentDetailsProps = {
  environment?: EnvironmentRecord;
  open: boolean;
  onClose: () => void;
  onListContainers: (key: string) => Promise<EnvironmentContainer[]>;
  onListEnvironmentFiles: (key: string, path: string) => Promise<ContainerFileEntry[]>;
  onInspectMongo: (key: string) => Promise<MongoPreviewPayload>;
  onListLifecycleActions: (key: string, page?: number, perPage?: number) => Promise<EnvironmentActionsPage>;
  onGetLifecycleActionLogs: (id: string, page?: number, perPage?: number) => Promise<EnvironmentActionLogsPage>;
  onAction: (key: string, action: "start" | "stop" | "restart" | "resume" | "delete") => Promise<void>;
  actionRefreshToken: number;
  liveLogSessions: LiveLogSession[];
  onStartComposeLogStream: (key: string) => void;
  onStopLiveLogSession: (id: string) => void;
};

export function EnvironmentDetails({
  environment,
  open,
  onClose,
  onListContainers,
  onListEnvironmentFiles,
  onInspectMongo,
  onListLifecycleActions,
  onGetLifecycleActionLogs,
  onAction,
  actionRefreshToken,
  liveLogSessions,
  onStartComposeLogStream,
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

  const composeLogSessions = useMemo(
    () => liveLogSessions.filter((session) => session.subtitle === "Docker Compose logs"),
    [liveLogSessions]
  );
  const selectedLiveSession = composeLogSessions.find((session) => session.status === "running") ?? composeLogSessions[0];
  const selectedAction = actions.find((action) => action.id === selectedActionId);
  const displayedActionLogs = useMemo(() => actionLogs.map((entry) => ({
    at: entry.createdAt,
    message: entry.log,
    level: entry.level,
    system: false
  })), [actionLogs]);

  useEffect(() => {
    if (!open || !environment) {
      return;
    }

    void loadContainers();
    void loadFiles("/");
    void loadMongo();
  }, [open, environment?.key]);

  useEffect(() => {
    if (!open || !environment) {
      return;
    }

    void loadActions();
  }, [open, environment?.key, actionRefreshToken]);

  useEffect(() => {
    if (!open || !selectedActionId) {
      return;
    }

    void loadActionLogs(selectedActionId);
  }, [open, selectedActionId]);

  useEffect(() => {
    if (!open || !selectedActionId || !selectedAction || (selectedAction.status !== "queued" && selectedAction.status !== "running")) {
      return undefined;
    }

    const interval = setInterval(() => {
      void loadActions(false, selectedActionId);
      void loadActionLogs(selectedActionId, 0, true, false);
    }, 1500);

    return () => clearInterval(interval);
  }, [open, selectedActionId, selectedAction?.status]);

  useEffect(() => {
    if (!open || !environment) {
      return;
    }

    if (environment.status === "running") {
      onStartComposeLogStream(environment.key);
      return;
    }

    composeLogSessions
      .filter((session) => session.status === "running")
      .forEach((session) => onStopLiveLogSession(session.id));
  }, [open, environment?.key, environment?.status, composeLogSessions, onStartComposeLogStream, onStopLiveLogSession]);

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

    setLoadingContainers(true);
    setToolError(undefined);
    try {
      const nextContainers = await onListContainers(environment.key);
      setContainers(nextContainers);
      const firstName = nextContainers.map(containerName).find(Boolean) ?? "";
      setSelectedContainer((current) => current || firstName);
    } catch (error) {
      setToolError(toErrorMessage(error));
    } finally {
      setLoadingContainers(false);
    }
  }

  async function loadFiles(pathOverride = containerPath): Promise<void> {
    if (!environment) {
      return;
    }

    setLoadingFiles(true);
    setToolError(undefined);
    try {
      setFiles(await onListEnvironmentFiles(environment.key, pathOverride));
      setContainerPath(pathOverride);
    } catch (error) {
      setToolError(toErrorMessage(error));
    } finally {
      setLoadingFiles(false);
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

  async function loadActionLogs(actionId = selectedActionId, page = 0, replace = true, showSpinner = true): Promise<void> {
    if (!actionId) {
      return;
    }

    if (showSpinner) {
      setLoadingActionLogs(true);
    }
    setToolError(undefined);
    try {
      const nextPage = await onGetLifecycleActionLogs(actionId, page, 500);
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
    <Box sx={{ minHeight: "calc(100vh - 80px)", bgcolor: "#121f1c", color: "text.primary", mx: { xs: -2, md: -3.75 }, my: { xs: -2, md: -3.75 } }}>
      <Box
        sx={{
          px: { xs: 2, lg: 3 },
          py: 2.2,
          display: "grid",
          gridTemplateColumns: { xs: "1fr", xl: "1fr auto" },
          gap: 2,
          alignItems: "center",
          borderBottom: "1px solid rgba(159, 179, 195, 0.28)",
          bgcolor: "#172321"
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
              borderRadius: 0.5,
              color: statusColor(environment.status),
              border: `1px solid ${statusColor(environment.status)}`,
              bgcolor: "rgba(101, 255, 201, 0.08)",
              fontFamily: monoFont,
              textTransform: "capitalize"
            }}
          />
          <Box minWidth={0}>
            <Typography variant="h4" fontWeight={900} noWrap sx={{ letterSpacing: 0 }}>
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

        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ xs: "stretch", sm: "center" }}>
          <Box sx={{ minWidth: { xl: 230 } }}>
            <Typography color="#00e5ff" fontWeight={800} noWrap>
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

      <Stack spacing={3} sx={{ p: { xs: 2, lg: 3 } }}>
        {toolError ? <Alert severity="warning">{toolError}</Alert> : null}

        <Panel
          title="CONTAINERS"
          icon={<ViewInArIcon />}
          action={
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip size="small" label={`${containers.filter((container) => container.State === "running").length || containers.length} ACTIVE`} sx={statusChipSx} />
              <IconButton aria-label="Refresh containers" onClick={() => void loadContainers()} disabled={loadingContainers} sx={iconButtonSx}>
                {loadingContainers ? <CircularProgress size={18} /> : <RefreshIcon />}
              </IconButton>
            </Stack>
          }
        >
          <ContainersTable
            containers={containers}
            selectedContainer={selectedContainer}
            onSelect={setSelectedContainer}
            onOpenFiles={() => void loadFiles(containerPath)}
          />
        </Panel>

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", xl: "2.08fr 1fr" }, gap: 3 }}>
          <Panel
            title="ACTION LOGS"
            icon={<TerminalIcon />}
            action={
              <Stack direction="row" spacing={1.5} alignItems="center">
                {selectedAction ? <Chip size="small" label={selectedAction.status.toUpperCase()} sx={{ ...statusChipSx, color: statusColor(selectedAction.status) }} /> : null}
                <IconButton
                  aria-label="Refresh action logs"
                  onClick={() => {
                    void loadActions();
                    if (selectedActionId) {
                      void loadActionLogs(selectedActionId);
                    }
                  }}
                  sx={iconButtonSx}
                >
                  {loadingActions || loadingActionLogs ? <CircularProgress size={18} /> : <RefreshIcon />}
                </IconButton>
              </Stack>
            }
          >
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "260px 1fr" }, minHeight: 460 }}>
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
                <Box sx={{ px: 2, py: 1.2, borderBottom: "1px solid rgba(159, 179, 195, 0.18)", bgcolor: "#111d1b", display: "flex", justifyContent: "space-between", gap: 2, alignItems: "center" }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }} noWrap>
                    {selectedAction ? `${selectedAction.action.toUpperCase()} / ${selectedAction.id}` : "NO REGISTERED ACTION"}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }}>
                    {actionLogsPage ? `${actionLogs.length}/${actionLogsPage.total}` : "0/0"}
                  </Typography>
                </Box>
                <LogTerminal logs={displayedActionLogs} emptyText={selectedAction ? "Waiting for registered action log output." : "No actions registered for this environment yet."} />
                {actionLogsPage && actionLogsPage.page + 1 < actionLogsPage.pages ? (
                  <Box sx={{ px: 2, py: 1.5, borderTop: "1px solid rgba(159, 179, 195, 0.18)", bgcolor: "#111d1b" }}>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={loadingActionLogs}
                      onClick={() => void loadActionLogs(selectedActionId, actionLogsPage.page + 1, false)}
                      sx={smallButtonSx}
                    >
                      Load More
                    </Button>
                  </Box>
                ) : null}
              </Box>
            </Box>
          </Panel>

          <Stack spacing={3}>
            <Panel
              title="MONGODB [READ-ONLY]"
              icon={<StorageIcon />}
              action={loadingMongo ? <CircularProgress size={18} /> : <Typography variant="caption" color={mongoPreview?.available ? "#65ffc9" : "text.secondary"} fontWeight={900}>{mongoPreview?.available ? "CONNECTED" : "OFFLINE"}</Typography>}
            >
              <MongoPreview preview={mongoPreview} />
            </Panel>

            <Panel
              title="FILE EXPLORER"
              icon={<FolderOpenIcon />}
              action={loadingFiles ? <CircularProgress size={18} /> : null}
            >
              <FileExplorer
                files={files}
                path={containerPath}
                onPathChange={setContainerPath}
                onLoadPath={() => void loadFiles()}
                onOpenDirectory={(path) => void loadFiles(path)}
              />
            </Panel>
          </Stack>
        </Box>

        {selectedLiveSession?.status === "running" ? (
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Button size="small" variant="outlined" color="warning" onClick={() => onStopLiveLogSession(selectedLiveSession.id)}>
              Stop {selectedLiveSession.title} stream
            </Button>
          </Box>
        ) : null}
      </Stack>
    </Box>
  );
}

function Panel({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box sx={{ border: "1px solid rgba(159, 179, 195, 0.36)", bgcolor: "#202d2a", borderRadius: 1, overflow: "hidden" }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, px: 2, py: 1.8, borderBottom: "1px solid rgba(159, 179, 195, 0.28)", bgcolor: "#2d3a37" }}>
        <Stack direction="row" spacing={1.2} alignItems="center" minWidth={0}>
          <Box sx={{ color: "#d7e3ee", display: "grid", placeItems: "center" }}>{icon}</Box>
          <Typography color="#d7e3ee" fontWeight={900} sx={{ fontFamily: monoFont, letterSpacing: 4 }} noWrap>
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
    <Stack sx={{ bgcolor: "#172321", borderRight: { lg: "1px solid rgba(159, 179, 195, 0.24)" }, borderBottom: { xs: "1px solid rgba(159, 179, 195, 0.24)", lg: "none" }, maxHeight: { lg: 620 }, overflow: "auto" }}>
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
              borderTop: "1px solid rgba(159, 179, 195, 0.12)",
              bgcolor: selected ? "rgba(0, 229, 255, 0.08)" : "transparent",
              color: "text.primary",
              "&:hover": { bgcolor: "rgba(0, 229, 255, 0.11)" }
            }}
          >
            <Stack spacing={0.55} sx={{ width: "100%", minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                <Typography sx={{ fontFamily: monoFont, fontWeight: 900, color: "#00e5ff" }}>
                  {action.action.toUpperCase()}
                </Typography>
                <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: statusColor(action.status), boxShadow: action.status === "running" ? "0 0 10px rgba(101, 255, 201, 0.75)" : "none" }} />
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
        <Box sx={{ p: 1.25, borderTop: "1px solid rgba(159, 179, 195, 0.12)" }}>
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
  onOpenFiles
}: {
  containers: EnvironmentContainer[];
  selectedContainer: string;
  onSelect: (name: string) => void;
  onOpenFiles: () => void;
}) {
  const rows = containers.length > 0 ? containers : [];

  return (
    <Box sx={{ overflowX: "auto" }}>
      <Box component="table" sx={{ width: "100%", minWidth: 1040, borderCollapse: "collapse", tableLayout: "fixed" }}>
        <Box component="thead" sx={{ bgcolor: "#303d3a" }}>
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
                  bgcolor: selected ? "rgba(0, 229, 255, 0.04)" : "transparent",
                  "& td": { borderTop: "1px solid rgba(159, 179, 195, 0.16)" }
                }}
              >
                <DataCell strong>{name || `container_${index + 1}`}</DataCell>
                <DataCell>{container.Service ?? shortName(name)}</DataCell>
                <DataCell>{container.Image ?? "image unavailable"}</DataCell>
                <DataCell>
                  <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: container.State === "running" ? "#65ffc9" : "#f5a524", boxShadow: container.State === "running" ? "0 0 12px rgba(101, 255, 201, 0.7)" : "none" }} />
                </DataCell>
                <DataCell>{uptimeLabel(container.Status)}</DataCell>
                <DataCell accent>{portsLabel(container)}</DataCell>
                <DataCell>{`${(0.8 + index * 0.7).toFixed(1)}%`}</DataCell>
                <DataCell>{`${180 + index * 210}MB`}</DataCell>
                <DataCell>
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end">
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
    <Box component="td" sx={{ px: 2, py: 2.2, color: accent ? "#00e5ff" : "text.primary", fontWeight: strong ? 900 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {children}
    </Box>
  );
}

function LogTerminal({ logs, emptyText = "Waiting for Docker Compose log output." }: { logs: Array<{ at: string; message: string; level: "info" | "error"; system: boolean }>; emptyText?: string; }) {
  return (
    <Box sx={{ minHeight: 460, maxHeight: 560, overflow: "auto", bgcolor: "#02051d", p: 2, fontFamily: monoFont, fontSize: 14, lineHeight: 1.7 }}>
      {logs.length === 0 ? (
        <Typography color="text.secondary" sx={{ fontFamily: monoFont }}>
          {emptyText}
        </Typography>
      ) : logs.map((log, index) => (
        <Box key={`${log.at}-${index}`} sx={{ display: "flex", gap: 0.5, minWidth: 0 }}>
          <Box component="span" sx={{ color: "#8ea0b3", flexShrink: 0 }}>
            [{formatTimestamp(log.at)}]
          </Box>
          <Box component="span" sx={{ color: log.level === "error" ? "#ffc4b7" : "text.primary", wordBreak: "break-word" }}>
            {log.message}
          </Box>
        </Box>
      ))}
      <Box sx={{ color: "#00e5ff", mt: 2 }}>$ _</Box>
    </Box>
  );
}

function MongoPreview({ preview }: { preview?: MongoPreviewPayload }) {
  const collections = preview?.collections ?? [];
  const selected = collections[0];

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "42% 58%", minHeight: 230 }}>
      <Stack sx={{ bgcolor: "#243230", borderRight: "1px solid rgba(159, 179, 195, 0.28)" }}>
        {!preview ? (
          <Box sx={{ px: 1.5, py: 1, color: "text.secondary" }}>Loading MongoDB status</Box>
        ) : !preview.available ? (
          <Box sx={{ px: 1.5, py: 1, color: "text.secondary" }}>{preview.reason ?? "MongoDB container is not running"}</Box>
        ) : collections.length === 0 ? (
          <Box sx={{ px: 1.5, py: 1, color: "text.secondary" }}>No collections</Box>
        ) : collections.map((collection, index) => (
          <Box key={collection.name} sx={{ px: 1.5, py: 1, bgcolor: index === 0 ? "rgba(159, 179, 195, 0.13)" : "transparent", color: "text.primary" }}>
            {collection.name}
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              {collection.count}
            </Typography>
          </Box>
        ))}
      </Stack>
      <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: "#061312", color: "#55ffcf", fontFamily: monoFont, fontSize: 12, overflow: "auto" }}>
        {selected ? JSON.stringify(selected.sample, null, 2) : preview?.available ? `Database: ${preview.database}` : "{}"}
      </Box>
    </Box>
  );
}

function FileExplorer({
  files,
  path,
  onPathChange,
  onLoadPath,
  onOpenDirectory
}: {
  files: ContainerFileEntry[];
  path: string;
  onPathChange: (path: string) => void;
  onLoadPath: () => void;
  onOpenDirectory: (path: string) => void;
}) {
  return (
    <Stack spacing={1.5} sx={{ p: 1.5, minHeight: 320 }}>
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

      <Stack spacing={0.75} sx={{ maxHeight: 230, overflow: "auto", pr: 0.5 }}>
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
              {isDirectory ? <FolderIcon fontSize="small" sx={{ color: "#ffd900" }} /> : <InsertDriveFileIcon fontSize="small" sx={{ color: "#9fb3c3" }} />}
              <Typography variant="body2" noWrap>{file.name}</Typography>
            </Stack>
          );
        })}
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }}>
        Runtime directory filesystem
      </Typography>
    </Stack>
  );
}

function MetaLabel({ icon, label, accent = false }: { icon: "user" | "branch" | "calendar" | "refresh"; label: string; accent?: boolean }) {
  return (
    <Stack direction="row" spacing={0.65} alignItems="center">
      <Typography color={accent ? "#00e5ff" : "text.secondary"} sx={{ fontFamily: monoFont, fontSize: 14 }}>
        {icon === "user" ? "@" : icon === "branch" ? "<>" : icon === "calendar" ? "[]" : "->"}
      </Typography>
      <Typography color={accent ? "#00e5ff" : "text.primary"} sx={{ fontFamily: monoFont, fontSize: 14 }}>
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
  const seen = new Set(current.map((entry) => `${entry.actionId}:${entry.sequence}`));
  const merged = [...current];
  next.forEach((entry) => {
    const key = `${entry.actionId}:${entry.sequence}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(entry);
    }
  });
  return merged.sort((left, right) => left.sequence - right.sequence);
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
  if (status === "running") return "#65ffc9";
  if (status === "error") return "#ffc4b7";
  if (status === "queued") return "#00e5ff";
  if (status === "creating") return "#00e5ff";
  if (status === "complete") return "#d7e3ee";
  return "#d7e3ee";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const monoFont = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

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
  borderRadius: 0.75,
  borderColor: "rgba(215, 227, 238, 0.8)",
  color: "text.primary",
  px: 2.5,
  minHeight: 44,
  fontFamily: monoFont,
  textTransform: "uppercase",
  letterSpacing: 1
};

const startButtonSx = {
  ...actionButtonSx,
  borderColor: "rgba(101, 255, 201, 0.82)",
  color: "#65ffc9"
};

const logsButtonSx = {
  ...actionButtonSx,
  borderColor: "rgba(0, 229, 255, 0.72)",
  color: "#00e5ff"
};

const deleteButtonSx = {
  borderRadius: 0.75,
  minHeight: 44,
  px: 2.5,
  fontFamily: monoFont,
  textTransform: "uppercase",
  letterSpacing: 1,
  bgcolor: "#c72418"
};

const iconButtonSx = {
  color: "#d7e3ee",
  borderRadius: 0.75
};

const statusChipSx = {
  borderRadius: 0.75,
  bgcolor: "rgba(215, 227, 238, 0.13)",
  color: "text.primary",
  fontFamily: monoFont
};

const compactFieldSx = {
  flex: 1,
  "& .MuiInputBase-root": {
    borderRadius: 0,
    bgcolor: "#12211f",
    fontFamily: monoFont,
    fontSize: 13
  }
};

const smallButtonSx = {
  borderRadius: 0,
  minWidth: 76,
  fontFamily: monoFont,
  textTransform: "uppercase",
  letterSpacing: 1
};

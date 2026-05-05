import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RefreshIcon from "@mui/icons-material/Refresh";
import StopIcon from "@mui/icons-material/Stop";
import TerminalIcon from "@mui/icons-material/Terminal";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import { useEffect, useState } from "react";
import type { ContainerExecResult, ContainerFileEntry, EnvironmentContainer, EnvironmentLog, EnvironmentRecord, LiveLogSession } from "../types";

type EnvironmentDetailsProps = {
  environment?: EnvironmentRecord;
  open: boolean;
  onClose: () => void;
  onListContainers: (key: string) => Promise<EnvironmentContainer[]>;
  onListContainerFiles: (key: string, container: string, path: string) => Promise<ContainerFileEntry[]>;
  onExecInContainer: (key: string, container: string, command: string) => Promise<ContainerExecResult>;
  onGetLogs: (key: string) => Promise<EnvironmentLog[]>;
  onAction: (key: string, action: "start" | "stop" | "restart" | "resume" | "delete") => Promise<void>;
  liveLogSessions: LiveLogSession[];
  onStartContainerLogStream: (key: string, container: string) => void;
  onStopLiveLogSession: (id: string) => void;
  logRefreshToken: number;
};

export function EnvironmentDetails({
  environment,
  open,
  onClose,
  onListContainers,
  onListContainerFiles,
  onExecInContainer,
  onGetLogs,
  onAction,
  liveLogSessions,
  onStartContainerLogStream,
  onStopLiveLogSession,
  logRefreshToken
}: EnvironmentDetailsProps) {
  const [containers, setContainers] = useState<EnvironmentContainer[]>([]);
  const [logs, setLogs] = useState<EnvironmentLog[]>([]);
  const [selectedContainer, setSelectedContainer] = useState("");
  const [containerPath, setContainerPath] = useState("/");
  const [files, setFiles] = useState<ContainerFileEntry[]>([]);
  const [command, setCommand] = useState("pwd && ls -la");
  const [execResult, setExecResult] = useState<ContainerExecResult>();
  const [loadingContainers, setLoadingContainers] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [selectedLiveLogId, setSelectedLiveLogId] = useState("");
  const [toolError, setToolError] = useState<string>();
  const [logError, setLogError] = useState<string>();

  useEffect(() => {
    if (!open || !environment) {
      return;
    }

    void loadContainers();
    void loadLogs();
  }, [open, environment?.key]);

  useEffect(() => {
    if (!open || !environment) {
      return undefined;
    }

    const interval = setInterval(() => {
      void loadLogs(false);
    }, 1500);

    return () => clearInterval(interval);
  }, [open, environment?.key]);

  useEffect(() => {
    if (!open || !environment) {
      return;
    }

    void loadLogs();
  }, [logRefreshToken]);

  useEffect(() => {
    if (liveLogSessions.length === 0) {
      setSelectedLiveLogId("");
      return;
    }
    setSelectedLiveLogId((current) => liveLogSessions.some((session) => session.id === current) ? current : liveLogSessions[0].id);
  }, [liveLogSessions]);

  async function loadLogs(showSpinner = true): Promise<void> {
    if (!environment) {
      return;
    }

    if (showSpinner) {
      setLoadingLogs(true);
    }
    setLogError(undefined);
    try {
      setLogs(await onGetLogs(environment.key));
    } catch (error) {
      setLogError(toErrorMessage(error));
    } finally {
      if (showSpinner) {
        setLoadingLogs(false);
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
    if (!environment || !selectedContainer) {
      return;
    }

    setLoadingFiles(true);
    setToolError(undefined);
    try {
      setFiles(await onListContainerFiles(environment.key, selectedContainer, pathOverride));
      setContainerPath(pathOverride);
    } catch (error) {
      setToolError(toErrorMessage(error));
    } finally {
      setLoadingFiles(false);
    }
  }

  async function runCommand(): Promise<void> {
    if (!environment || !selectedContainer) {
      return;
    }

    setExecuting(true);
    setToolError(undefined);
    try {
      setExecResult(await onExecInContainer(environment.key, selectedContainer, command));
    } catch (error) {
      setToolError(toErrorMessage(error));
    } finally {
      setExecuting(false);
    }
  }

  return (
    <Card sx={{ display: open && environment ? "block" : "none", overflow: "hidden", bgcolor: "#101820" }}>
      {environment ? (
        <Box sx={{ minHeight: 720 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2,
              px: 2.5,
              py: 2,
              borderBottom: "1px solid",
              borderColor: "divider"
            }}
          >
            <Stack direction="row" spacing={2} alignItems="center" sx={{ minWidth: 0 }}>
              <IconButton aria-label="Back to list" onClick={onClose}>
                <ArrowBackIcon />
              </IconButton>
              <ViewInArIcon sx={{ fontSize: 44, color: "secondary.main" }} />
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="h5" fontWeight={900} noWrap>
                    {environment.key}
                  </Typography>
                  <Chip size="small" label={environment.status} color={environment.status === "running" ? "success" : "default"} />
                </Stack>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {environment.source.branch} @ {environment.source.commit.slice(0, 12)}
                </Typography>
              </Box>
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" onClick={() => void loadLogs()} disabled={loadingLogs} startIcon={loadingLogs ? <CircularProgress size={14} /> : <RefreshIcon />}>
                Refresh history
              </Button>
              <IconButton aria-label="start environment" onClick={() => void onAction(environment.key, "start")}>
                <PlayArrowIcon />
              </IconButton>
              <IconButton aria-label="stop environment" onClick={() => void onAction(environment.key, "stop")}>
                <StopIcon />
              </IconButton>
              <IconButton aria-label="delete environment" color="error" onClick={() => void onAction(environment.key, "delete")}>
                <DeleteOutlineIcon />
              </IconButton>
            </Stack>
          </Box>

          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "330px 1fr" }, minHeight: 650 }}>
            <Box sx={{ borderRight: { lg: "1px solid" }, borderColor: "divider", bgcolor: "#0d151b" }}>
              <Box sx={{ p: 2 }}>
                <Stack spacing={1}>
                  <Typography variant="caption" color="text.secondary" fontWeight={900}>
                    Description
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Chip size="small" label={`Seed ${environment.seed}`} />
                    <Chip size="small" label={`Port ${environment.port ?? "n/a"}`} />
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
                    {ownerLabel(environment.createdBy)}
                  </Typography>
                  <Stack spacing={0.5}>
                    {buildDomains(environment).map((domain) => (
                      <Button
                        key={domain}
                        size="small"
                        href={`https://${domain}`}
                        target="_blank"
                        rel="noreferrer"
                        endIcon={<OpenInNewIcon fontSize="small" />}
                        sx={{ justifyContent: "flex-start", px: 0 }}
                      >
                        {domain}
                      </Button>
                    ))}
                  </Stack>
                </Stack>
              </Box>
              <Divider />
              <Box sx={{ p: 2 }}>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                  <Typography variant="caption" color="text.secondary" fontWeight={900}>
                    Containers
                  </Typography>
                  <IconButton size="small" aria-label="Refresh containers" onClick={() => void loadContainers()} disabled={loadingContainers}>
                    {loadingContainers ? <CircularProgress size={14} /> : <RefreshIcon fontSize="small" />}
                  </IconButton>
                </Stack>
                {toolError ? <Alert severity="warning" sx={{ mb: 1 }}>{toolError}</Alert> : null}
                <List dense disablePadding>
                  {containers.length === 0 ? (
                    <ListItem disableGutters>
                      <ListItemText primary="No containers found" />
                    </ListItem>
                  ) : (
                    containers.map((container) => {
                      const name = containerName(container);
                      const selected = selectedContainer === name;
                      return (
                        <ListItemButton
                          key={name}
                          selected={selected}
                          onClick={() => setSelectedContainer(name)}
                          sx={{
                            borderBottom: "1px solid",
                            borderColor: "divider",
                            py: 1.35,
                            "&.Mui-selected": { bgcolor: "rgba(29, 99, 237, 0.14)" }
                          }}
                        >
                          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0, width: "100%" }}>
                            <ViewInArIcon color={container.State === "running" ? "secondary" : "disabled"} />
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                              <Stack direction="row" spacing={0.75} alignItems="center">
                                <Typography fontWeight={800} noWrap>
                                  {container.Service ?? name}
                                </Typography>
                                <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: container.State === "running" ? "secondary.main" : "warning.main" }} />
                              </Stack>
                              <Typography variant="body2" color="primary.light" noWrap>
                                {container.Image ?? name}
                              </Typography>
                            </Box>
                          </Stack>
                        </ListItemButton>
                      );
                    })
                  )}
                </List>
              </Box>
              <Divider />
              <Box sx={{ p: 2 }}>
                <Stack spacing={1}>
                  <TextField
                    size="small"
                    label="Container path"
                    value={containerPath}
                    onChange={(event) => setContainerPath(event.target.value)}
                    disabled={!selectedContainer}
                  />
                  <Button variant="outlined" onClick={() => void loadFiles()} disabled={!selectedContainer || loadingFiles}>
                    {loadingFiles ? "Loading files..." : "Show files"}
                  </Button>
                  <List dense sx={{ maxHeight: 160, overflow: "auto" }}>
                    {files.map((file) => (
                      <ListItemButton
                        key={file.path}
                        onClick={() => file.type === "directory" ? void loadFiles(file.path) : undefined}
                      >
                        <ListItemText
                          primary={`${file.type === "directory" ? "[dir]" : "[file]"} ${file.name}`}
                          secondary={`${file.path}${file.size !== undefined ? ` · ${file.size} bytes` : ""}`}
                          secondaryTypographyProps={{ sx: { wordBreak: "break-all" } }}
                        />
                      </ListItemButton>
                    ))}
                  </List>
                  <TextField
                    size="small"
                    label="Exec command"
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                    disabled={!selectedContainer}
                  />
                  <Button variant="contained" onClick={() => void runCommand()} disabled={!selectedContainer || executing}>
                    {executing ? "Running..." : "Exec in container"}
                  </Button>
                  <Button variant="outlined" onClick={() => environment ? onStartContainerLogStream(environment.key, selectedContainer) : undefined} disabled={!selectedContainer} startIcon={<TerminalIcon />}>
                    Stream container logs
                  </Button>
                  {execResult ? (
                    <Box
                      component="pre"
                      sx={{
                        bgcolor: "rgba(0,0,0,0.28)",
                        p: 1,
                        borderRadius: 1,
                        overflow: "auto",
                        maxHeight: 160,
                        whiteSpace: "pre-wrap",
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        fontSize: 12
                      }}
                    >
                      {execResult.stdout || execResult.stderr || "(no output)"}
                    </Box>
                  ) : null}
                </Stack>
              </Box>
            </Box>

            <Box sx={{ minWidth: 0, position: "relative" }}>
              {logError ? <Alert severity="warning">{logError}</Alert> : null}
              <LiveLogWorkspace
                sessions={liveLogSessions}
                selectedId={selectedLiveLogId}
                onSelect={setSelectedLiveLogId}
                onStop={onStopLiveLogSession}
              />
              <Box
                sx={{
                  height: 330,
                  overflow: "auto",
                  bgcolor: "#0f171d",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: 13,
                  lineHeight: 1.65
                }}
              >
                {logs.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ p: 3 }}>
                    No persisted history yet.
                  </Typography>
                ) : (
                  <Box>
                    {logs.map((log, index) => (
                      <Box
                        key={`${log.createdAt}-${log.log}-${index}`}
                        sx={{
                          display: "grid",
                          gridTemplateColumns: "80px 4px 1fr",
                          borderBottom: "1px solid",
                          borderColor: "divider"
                        }}
                      >
                        <Box sx={{ px: 1.25, py: 1, color: log.level === "error" ? "error.main" : "primary.light", textAlign: "right" }}>
                          {log.level === "error" ? "error" : log.system ? "system" : "api"}
                        </Box>
                        <Box sx={{ bgcolor: log.level === "error" ? "error.main" : "secondary.main" }} />
                        <Box sx={{ px: 2, py: 1 }}>
                          <Typography component="pre" sx={{ m: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", font: "inherit", color: log.level === "error" ? "error.main" : "text.primary" }}>
                            {log.log}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {new Date(log.createdAt).toLocaleString()}
                          </Typography>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            </Box>
          </Box>
        </Box>
      ) : null}
    </Card>
  );
}

function LiveLogWorkspace({
  sessions,
  selectedId,
  onSelect,
  onStop
}: {
  sessions: LiveLogSession[];
  selectedId: string;
  onSelect: (id: string) => void;
  onStop: (id: string) => void;
}) {
  const selected = sessions.find((session) => session.id === selectedId) ?? sessions[0];

  return (
    <Box sx={{ borderBottom: "1px solid", borderColor: "divider", bgcolor: "#071312" }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
        <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={1} alignItems="center">
            <TerminalIcon color="secondary" />
            <Typography fontWeight={900} sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
              LIVE DOCKER STREAMS
            </Typography>
          </Stack>
          {selected?.status === "running" ? (
            <Button size="small" variant="outlined" color="warning" onClick={() => onStop(selected.id)}>
              Stop stream
            </Button>
          ) : null}
        </Stack>
      </Box>
      {sessions.length > 0 ? (
        <Tabs
          value={selected?.id ?? false}
          onChange={(_event, value: string) => onSelect(value)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ minHeight: 42, borderBottom: "1px solid", borderColor: "divider" }}
        >
          {sessions.map((session) => (
            <Tab
              key={session.id}
              value={session.id}
              label={`${session.title} · ${session.status}`}
              sx={{ minHeight: 42, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
            />
          ))}
        </Tabs>
      ) : null}
      <Box
        sx={{
          height: 300,
          overflow: "auto",
          p: 2,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 12.5,
          lineHeight: 1.65,
          bgcolor: "#06100f"
        }}
      >
        {!selected ? (
          <Typography variant="body2" color="text.secondary">
            Start, stop, restart, resume, or open a container stream to create a separated live log page.
          </Typography>
        ) : selected.entries.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Waiting for stream output from {selected.subtitle}.
          </Typography>
        ) : (
          selected.entries.map((entry, index) => (
            <Box key={`${entry.at}-${index}`} sx={{ display: "grid", gridTemplateColumns: "92px 1fr", gap: 1.5, color: entry.level === "error" ? "error.main" : "text.primary" }}>
              <Box sx={{ color: entry.level === "error" ? "error.main" : "secondary.main" }}>
                {entry.level}
              </Box>
              <Box component="pre" sx={{ m: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", font: "inherit" }}>
                {entry.log}
              </Box>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}

function buildDomains(environment: EnvironmentRecord): string[] {
  return [
    `admin_${environment.key}.prmr.md`,
    `api_${environment.key}.prmr.md`,
  ];
}

function isPullRequest(value: EnvironmentRecord["createdBy"]): value is { title?: string; url: string } {
  return "url" in value;
}

function ownerLabel(value: EnvironmentRecord["createdBy"]): string {
  return isPullRequest(value) ? value.url : `${value.name} <${value.email}>`;
}

function containerName(container: EnvironmentContainer): string {
  return container.Name ?? container.Names ?? container.ID ?? "";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

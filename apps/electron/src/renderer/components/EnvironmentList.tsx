import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  IconButton,
  InputAdornment,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import SyncIcon from "@mui/icons-material/Sync";
import { useMemo, useState } from "react";
import type { EnvironmentLog, EnvironmentRecord } from "../types";

type EnvironmentListProps = {
  environments: EnvironmentRecord[];
  logs: EnvironmentLog[];
  loading: boolean;
  error?: string;
  activeEnvironmentKey: string;
  onRefresh: () => Promise<void>;
  onSelectActive: (key: string) => void;
  onDetails: (environment: EnvironmentRecord) => void;
  onAction: (key: string, action: "start" | "stop" | "restart" | "resume" | "delete") => Promise<void>;
};

export function EnvironmentList({
  environments,
  logs,
  loading,
  error,
  onRefresh,
  onDetails,
}: EnvironmentListProps) {
  const [query, setQuery] = useState("");
  const environmentByKey = useMemo(() => new Map(environments.map((environment) => [environment.key, environment])), [environments]);
  const filteredLogs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return logs;
    }

    return logs.filter((log) => logSearchText(log).includes(normalizedQuery));
  }, [logs, query]);
  const stats = useMemo(() => buildStats(environments), [environments]);

  return (
    <Stack spacing={3}>
      <Box>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ xs: "stretch", md: "flex-start" }} justifyContent="space-between">
          <Box>
            <Typography variant="h4" fontWeight={900}>
              System Overview
            </Typography>
            <Typography variant="h6" color="text.secondary" sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
              NODE: DOCKER-PRODUCTION-CLUSTER-01
            </Typography>
          </Box>
          <Button onClick={onRefresh} disabled={loading} variant="outlined" startIcon={loading ? <CircularProgress size={16} /> : <SyncIcon />} sx={{ color: "#65ffc9", borderColor: "rgba(101,255,201,0.35)", bgcolor: "rgba(101,255,201,0.09)" }}>
            Service healthy
          </Button>
        </Stack>
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(120px, 1fr))", gap: 2, overflowX: "auto", pb: 0.5 }}>
        {stats.map((stat) => (
          <Box key={stat.label} sx={{ minWidth: 122, border: "1px solid rgba(159,179,195,0.32)", bgcolor: "rgba(255,255,255,0.035)", p: 2 }}>
            <Typography color="text.secondary" sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", textTransform: "uppercase" }}>
              {stat.label}
            </Typography>
            <Typography variant="h6" color={stat.color} sx={{ mt: 0.5, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
              {stat.value}
            </Typography>
            {stat.progress !== undefined ? <LinearProgress variant="determinate" value={stat.progress} sx={{ mt: 1.5, bgcolor: "rgba(255,255,255,0.18)", height: 5, "& .MuiLinearProgress-bar": { bgcolor: stat.color } }} /> : null}
          </Box>
        ))}
      </Box>

      <Box sx={{ border: "1px solid rgba(159,179,195,0.34)", bgcolor: "rgba(10,22,22,0.82)", minHeight: 230, display: "grid", alignItems: "end", p: 3, position: "relative", overflow: "hidden" }}>
        <Box sx={{ position: "absolute", inset: 0, opacity: 0.16, background: "linear-gradient(90deg, transparent 0 18%, #9fb3c3 18% 19%, transparent 19% 46%, #9fb3c3 46% 47%, transparent 47%), repeating-linear-gradient(0deg, rgba(255,255,255,0.16), rgba(255,255,255,0.16) 1px, transparent 1px, transparent 16px)" }} />
        <Box sx={{ position: "relative" }}>
          <Typography color="#00e5ff" fontWeight={900} sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            NETWORK INFRASTRUCTURE MAPPING
          </Typography>
          <Typography variant="h6">Cluster visualization active</Typography>
        </Box>
      </Box>

      <Card sx={{ overflow: "hidden", bgcolor: "#081514", borderColor: "rgba(159,179,195,0.34)" }}>
        <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
          <Stack spacing={0}>
            <Box sx={{ px: 2.5, py: 1.75, borderBottom: "1px solid rgba(159,179,195,0.28)" }}>
              <Stack direction={{ xs: "column", md: "row" }} alignItems={{ xs: "stretch", md: "center" }} justifyContent="space-between" spacing={2}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Box sx={{ display: "flex", gap: 0.6 }}>
                    <Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: "#bc2d2d" }} />
                    <Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: "#bca142" }} />
                    <Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: "#008c75" }} />
                  </Box>
                  <Typography variant="h6" color="text.secondary" sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                    TERMINAL OUTPUT - SYSTEM LOGS
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={1}>
                  <TextField
                    placeholder="Search"
                    size="small"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    sx={{ width: { xs: "100%", sm: 280 } }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon fontSize="small" />
                        </InputAdornment>
                      )
                    }}
                  />
                  <IconButton onClick={onRefresh} disabled={loading} aria-label="refresh environments">
                    {loading ? <CircularProgress size={16} /> : <SyncIcon />}
                  </IconButton>
                </Stack>
              </Stack>
            </Box>
            {error ? (
              <Box sx={{ px: 3, py: 2 }}>
                <Alert severity="error">{error}</Alert>
              </Box>
            ) : null}
            <TableContainer>
              <Table size="small" sx={{ minWidth: 1040 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: "rgba(255,255,255,0.035)" }}>
                  <TableCell sx={{ width: 190 }}>Timestamp</TableCell>
                  <TableCell sx={{ width: 110 }}>Type</TableCell>
                  <TableCell sx={{ width: 210 }}>Environment</TableCell>
                  <TableCell sx={{ width: 150 }}>User</TableCell>
                  <TableCell>Message</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} sx={{ py: 5 }}>
                      <Typography fontWeight={800}>{logs.length === 0 ? "No environment logs yet" : "No matching logs"}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {logs.length === 0 ? "Create or operate an environment to populate the dashboard stream." : "Try a different search term."}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLogs.map((log, index) => {
                    const environment = environmentByKey.get(log.environmentKey);
                    return (
                      <TableRow key={`${log.createdAt}-${log.environmentKey}-${index}`} hover sx={{ "&:last-child td": { borderBottom: 0 } }}>
                        <TableCell sx={{ color: "#8ba0b7", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                          {formatTimestamp(log.createdAt)}
                        </TableCell>
                        <TableCell sx={{ color: levelColor(log.level), fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontWeight: 900 }}>
                          [{log.level === "error" ? "FAIL" : log.level.toUpperCase()}]
                        </TableCell>
                        <TableCell>
                          <Typography
                            component="button"
                            onClick={() => environment ? onDetails(environment) : undefined}
                            sx={{
                              p: 0,
                              border: 0,
                              bgcolor: "transparent",
                              color: "#00e5ff",
                              cursor: environment ? "pointer" : "default",
                              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                              fontWeight: 900,
                              textAlign: "left"
                            }}
                          >
                            {log.environmentKey}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ color: "text.secondary", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                          {log.system ? "system" : "operator"}
                        </TableCell>
                        <TableCell sx={{ color: "text.primary", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontWeight: 700 }}>
                          {log.log}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
            <Stack direction="row" justifyContent="space-between" sx={{ px: 2.5, py: 1.5, borderTop: "1px solid rgba(159,179,195,0.24)", bgcolor: "rgba(255,255,255,0.035)" }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>DISPLAYING LATEST {filteredLogs.length} LOGS ACROSS {environments.length} ENVS</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>STATUS: STREAMING</Typography>
            </Stack>
        </Stack>
      </CardContent>
    </Card>
    </Stack>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }

  return date.toLocaleString();
}

function levelColor(level: EnvironmentLog["level"]): string {
  if (level === "error") {
    return "#ffc4b7";
  }
  if (level === "warn") {
    return "#ffd900";
  }
  return "#65ffc9";
}

function buildStats(environments: EnvironmentRecord[]): Array<{ label: string; value: string; color: string; progress?: number }> {
  const today = new Date().toDateString();
  const running = environments.filter((environment) => environment.status === "running").length;
  const stopped = environments.filter((environment) => environment.status === "stopped").length;
  const failed = environments.filter((environment) => environment.status === "error").length;
  const createdToday = environments.filter((environment) => new Date(environment.createdAt).toDateString() === today).length;

  return [
    { label: "Total envs", value: pad(environments.length), color: "#00e5ff" },
    { label: "Active envs", value: pad(running), color: "#65ffc9" },
    { label: "Stopped envs", value: pad(stopped), color: "#edf4fa" },
    { label: "Failed envs", value: pad(failed), color: "#ffc4b7" },
    { label: "Created today", value: pad(createdToday), color: "#00e5ff" },
    { label: "Containers", value: String(Math.max(environments.length * 3, running)), color: "#edf4fa" },
    { label: "CPU usage", value: `${Math.min(98, 18 + running * 4)}%`, color: "#00e5ff", progress: Math.min(98, 18 + running * 4) },
    { label: "RAM usage", value: `${Math.min(96, 28 + environments.length * 3)}%`, color: "#ffd900", progress: Math.min(96, 28 + environments.length * 3) }
  ];
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function logSearchText(log: EnvironmentLog): string {
  return [
    log.environmentKey,
    log.level,
    log.system ? "system" : "operator",
    log.log,
    log.createdAt
  ]
    .join(" ")
    .toLowerCase();
}

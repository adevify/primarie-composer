import {
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography
} from "@mui/material";
import AddBoxIcon from "@mui/icons-material/AddBox";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useMemo, useState } from "react";
import type { EnvironmentRecord, SystemMetrics } from "../types";

type EnvironmentsPageProps = {
  environments: EnvironmentRecord[];
  activeEnvironmentKey: string;
  metrics?: SystemMetrics;
  repoPath: string;
  onCreate: () => void;
  onDetails: (environment: EnvironmentRecord) => void;
  onSelectActive: (key: string) => void;
  onAction: (key: string, action: "start" | "stop" | "restart" | "resume" | "delete") => Promise<void>;
};

type Filter = "all" | "mine" | "production" | "prs";

export function EnvironmentsPage({
  environments,
  activeEnvironmentKey,
  metrics,
  repoPath,
  onCreate,
  onDetails,
  onSelectActive,
  onAction
}: EnvironmentsPageProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const filtered = useMemo(() => {
    if (filter === "prs") {
      return environments.filter((environment) => isPullRequest(environment.createdBy));
    }
    if (filter === "production") {
      return environments.filter((environment) => environment.source.branch === "main" || environment.source.branch.includes("prod"));
    }
    return environments;
  }, [environments, filter]);

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ xs: "stretch", md: "flex-start" }} justifyContent="space-between">
        <Box>
          <Typography variant="h4" fontWeight={900}>
            Environments
          </Typography>
          <Typography variant="h6" color="text.secondary">
            Orchestrate Docker Compose services across clusters.
          </Typography>
        </Box>
        <Button variant="contained" disabled={!repoPath} onClick={onCreate} startIcon={<AddBoxIcon />} sx={{ bgcolor: "#00d9e8", color: "#02121b", minWidth: 230, py: 1.4, "&:hover": { bgcolor: "#35edff" } }}>
          Create environment
        </Button>
      </Stack>

      <Tabs
        value={filter}
        onChange={(_event, value: Filter) => setFilter(value)}
        sx={{
          borderBottom: "1px solid rgba(159,179,195,0.28)",
          "& .MuiTab-root": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: 2, color: "text.secondary", px: 3 },
          "& .Mui-selected": { color: "text.primary" }
        }}
      >
        <Tab value="all" label="All" />
        <Tab value="mine" label="My Environments" />
        <Tab value="production" label="Production" />
        <Tab value="prs" label="PRs" />
      </Tabs>

      <TableContainer sx={{ border: "1px solid rgba(159,179,195,0.32)", bgcolor: "rgba(255,255,255,0.035)", maxHeight: 520 }}>
        <Table stickyHeader sx={{ minWidth: 1180 }}>
          <TableHead>
            <TableRow>
              <HeaderCell>Env Name</HeaderCell>
              <HeaderCell>Owner</HeaderCell>
              <HeaderCell>Type</HeaderCell>
              <HeaderCell>Urls</HeaderCell>
              <HeaderCell>Branch</HeaderCell>
              <HeaderCell>Status</HeaderCell>
              <HeaderCell>Created</HeaderCell>
              <HeaderCell>Containers</HeaderCell>
              <HeaderCell align="right">Actions</HeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} sx={{ py: 5 }}>
                  <Typography fontWeight={900}>No environments found</Typography>
                  <Typography variant="body2" color="text.secondary">Create one from a local repository to populate this control surface.</Typography>
                </TableCell>
              </TableRow>
            ) : filtered.map((environment) => (
              <TableRow key={environment.key} hover sx={{ "& td": { py: 2.3, borderColor: "rgba(159,179,195,0.22)" } }}>
                <TableCell>
                  <Stack direction="row" spacing={1.4} alignItems="center">
                    <Typography color={environment.status === "error" ? "#ffc4b7" : "#00e5ff"} fontWeight={900}>#</Typography>
                    <Typography fontWeight={900} sx={{ maxWidth: 180, wordBreak: "break-word" }}>{environment.key}</Typography>
                  </Stack>
                </TableCell>
                <TableCell>{ownerLabel(environment.createdBy)}</TableCell>
                <TableCell>
                  <Chip size="small" label={isPullRequest(environment.createdBy) ? "PR" : "MANUAL"} sx={{ borderRadius: 0.5, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }} />
                </TableCell>
                <TableCell>
                  {environment.status === "running" ? (
                    <Button href={`https://${buildDomains(environment)[0]}`} target="_blank" rel="noreferrer" endIcon={<OpenInNewIcon fontSize="small" />} sx={{ color: "#00e5ff", justifyContent: "flex-start", p: 0 }}>
                      {buildDomains(environment)[0]}
                    </Button>
                  ) : (
                    <Typography color={environment.status === "error" ? "#ffc4b7" : "text.secondary"} fontStyle="italic">
                      {environment.status === "error" ? "connection refused" : environment.status === "creating" ? "provisioning..." : "offline"}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>{environment.source.branch}</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: statusColor(environment.status), boxShadow: environment.status === "running" ? "0 0 10px #65ffc9" : "none" }} />
                    <Typography color={statusColor(environment.status)} fontWeight={900} sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                      {environment.status.toUpperCase()}
                    </Typography>
                  </Stack>
                </TableCell>
                <TableCell>{formatDate(environment.createdAt)}</TableCell>
                <TableCell>
                  <Typography color={environment.status === "running" ? "#65ffc9" : "text.primary"} fontWeight={900}>
                    {containerCount(environment)}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <IconButton aria-label="View environment" onClick={() => onDetails(environment)}><VisibilityIcon /></IconButton>
                  <IconButton aria-label="Set active sync target" disabled={activeEnvironmentKey === environment.key} onClick={() => onSelectActive(environment.key)}><ContentCopyIcon /></IconButton>
                  {environment.status === "running" ? (
                    <IconButton aria-label="Stop environment" onClick={() => void onAction(environment.key, "stop")}><PauseIcon /></IconButton>
                  ) : (
                    <IconButton aria-label="Start environment" onClick={() => void onAction(environment.key, "start")}><PlayArrowIcon /></IconButton>
                  )}
                  <IconButton aria-label="Restart environment" onClick={() => void onAction(environment.key, "restart")}><RestartAltIcon /></IconButton>
                  <IconButton aria-label="Delete environment" onClick={() => void onAction(environment.key, "delete")}><DeleteOutlineIcon /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "2fr 0.9fr" }, gap: 3 }}>
        <Box sx={{ border: "1px solid rgba(159,179,195,0.32)", minHeight: 260, p: 2, display: "grid", alignItems: "end", position: "relative", overflow: "hidden" }}>
          <Box sx={{ position: "absolute", inset: 0, opacity: 0.16, background: "linear-gradient(90deg, transparent 0 21%, #9fb3c3 21% 22%, transparent 22% 47%, #00e5ff 47% 48%, transparent 48%), repeating-linear-gradient(0deg, rgba(255,255,255,0.16), rgba(255,255,255,0.16) 1px, transparent 1px, transparent 17px)" }} />
          <Box sx={{ position: "relative" }}>
            <Typography color="text.primary" fontWeight={900} sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: 3 }}>
              NODE CLUSTER VISUALIZATION
            </Typography>
            <Typography variant="body2">Real-time mapping of Docker daemon instances and traffic routing.</Typography>
          </Box>
        </Box>
        <Box sx={{ border: "1px solid rgba(159,179,195,0.32)", p: 3, bgcolor: "rgba(255,255,255,0.035)" }}>
          <Typography color="#ffd900" fontWeight={900} sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: 4, mb: 2 }}>
            RESOURCE USAGE
          </Typography>
          <ResourceBar label="CPU Load" value={metrics?.cpu.percent ?? 0} color="#65ffc9" />
          <ResourceBar label="Memory" value={metrics?.memory.percent ?? 0} color="#00e5ff" detail={metrics ? formatBytes(metrics.memory.usedBytes) : undefined} />
          <ResourceBar label="Storage" value={metrics?.storage.percent ?? 0} color="#d62929" />
          <Box sx={{ borderTop: "1px solid rgba(159,179,195,0.24)", mt: 3, pt: 2 }}>
            <Typography variant="caption" sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>UPTIME: 142h 12m</Typography>
          </Box>
        </Box>
      </Box>
    </Stack>
  );
}

function HeaderCell({ children, align }: { children: string; align?: "right" }) {
  return (
    <TableCell align={align} sx={{ color: "text.secondary", bgcolor: "#2a3735", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontWeight: 900, textTransform: "uppercase" }}>
      {children}
    </TableCell>
  );
}

function ResourceBar({ label, value, color, detail }: { label: string; value: number; color: string; detail?: string }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" justifyContent="space-between">
        <Typography variant="caption" fontWeight={900}>{label.toUpperCase()}</Typography>
        {detail ? <Typography variant="caption">{detail}</Typography> : null}
      </Stack>
      <LinearProgress variant="determinate" value={value} sx={{ mt: 0.8, bgcolor: "rgba(255,255,255,0.16)", "& .MuiLinearProgress-bar": { bgcolor: color } }} />
    </Box>
  );
}

function buildDomains(environment: EnvironmentRecord): string[] {
  return [`admin-${environment.key}.prmr.md`, `api-${environment.key}.prmr.md`];
}

function isPullRequest(value: EnvironmentRecord["createdBy"]): value is { title?: string; url: string } {
  return "url" in value;
}

function ownerLabel(value: EnvironmentRecord["createdBy"]): string {
  return isPullRequest(value) ? value.title ?? "PR" : `@${value.name.replace(/\s+/g, "_").toLowerCase()}`;
}

function statusColor(status: EnvironmentRecord["status"]): string {
  if (status === "running") return "#65ffc9";
  if (status === "error") return "#ffc4b7";
  if (status === "creating") return "#00e5ff";
  return "#d7e3ee";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toISOString().slice(0, 10);
}

function containerCount(environment: EnvironmentRecord): string {
  if (environment.status === "running") return "8/8";
  if (environment.status === "error") return "1/4";
  if (environment.status === "creating") return "...";
  return "0/4";
}

function formatBytes(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let nextValue = value;
  let unitIndex = 0;
  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }
  return `${nextValue >= 10 || unitIndex === 0 ? nextValue.toFixed(0) : nextValue.toFixed(1)}${units[unitIndex]}`;
}

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
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
import DeleteIcon from "@mui/icons-material/Delete";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import StopIcon from "@mui/icons-material/Stop";
import ReplayIcon from "@mui/icons-material/Replay";
import SearchIcon from "@mui/icons-material/Search";
import SyncIcon from "@mui/icons-material/Sync";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useMemo, useState } from "react";
import type { EnvironmentRecord } from "../types";

type EnvironmentListProps = {
  environments: EnvironmentRecord[];
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
  loading,
  error,
  activeEnvironmentKey,
  onRefresh,
  onSelectActive,
  onDetails,
  onAction
}: EnvironmentListProps) {
  const [query, setQuery] = useState("");
  const filteredEnvironments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return environments;
    }

    return environments.filter((environment) => environmentSearchText(environment).includes(normalizedQuery));
  }, [environments, query]);

  return (
    <Card sx={{ overflow: "hidden" }}>
      <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
        <Stack spacing={0}>
          <Box sx={{ px: 3, py: 2.5 }}>
            <Stack direction={{ xs: "column", md: "row" }} alignItems={{ xs: "stretch", md: "center" }} justifyContent="space-between" spacing={2}>
              <Box>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Typography variant="h5" fontWeight={800}>
                    Environments
                  </Typography>
                  <Chip size="small" label={`${filteredEnvironments.length} items`} />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  Runtime environments created from local Git state.
                </Typography>
              </Box>
              <Button onClick={onRefresh} disabled={loading} startIcon={loading ? <CircularProgress size={16} /> : <SyncIcon />}>
                Refresh
              </Button>
            </Stack>
          </Box>
          <Box sx={{ px: 3, pb: 2.5, display: "flex", alignItems: "center", gap: 2 }}>
            <TextField
              placeholder="Search"
              size="small"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              sx={{ width: { xs: "100%", sm: 380 } }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                )
              }}
            />
            <Typography variant="body2" color="text.secondary" sx={{ display: { xs: "none", md: "block" } }}>
              Only Git-status changes are synced to the active target.
            </Typography>
          </Box>
          {error ? (
            <Box sx={{ px: 3, pb: 2 }}>
              <Alert severity="error">{error}</Alert>
            </Box>
          ) : null}
          <TableContainer>
            <Table size="small" sx={{ minWidth: 1040 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: "rgba(255,255,255,0.02)" }}>
                  <TableCell sx={{ width: 168 }}>Name</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Port</TableCell>
                  <TableCell>Seed</TableCell>
                  <TableCell>Source</TableCell>
                  <TableCell>Owner / PR</TableCell>
                  <TableCell>Last updated</TableCell>
                  <TableCell align="right" sx={{ width: 260, bgcolor: "rgba(0,0,0,0.12)" }}>
                    Actions
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredEnvironments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} sx={{ py: 5 }}>
                      <Typography fontWeight={800}>{environments.length === 0 ? "No environments yet" : "No matching environments"}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {environments.length === 0 ? "Create one to start syncing local changes." : "Try a different search term."}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  groupEnvironments(filteredEnvironments).flatMap((group) => [
                    <TableRow key={group.id}>
                      <TableCell colSpan={8} sx={{ py: 1.25, bgcolor: "rgba(255,255,255,0.025)" }}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="subtitle2" fontWeight={800}>
                            {group.label}
                          </Typography>
                        </Stack>
                      </TableCell>
                    </TableRow>,
                    ...group.environments.map((environment) => (
                      <EnvironmentRow
                        key={environment.key}
                        environment={environment}
                        activeEnvironmentKey={activeEnvironmentKey}
                        onAction={onAction}
                        onDetails={onDetails}
                        onSelectActive={onSelectActive}
                      />
                    ))
                  ])
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <Stack direction="row" justifyContent="flex-end" sx={{ px: 3, py: 1.75, bgcolor: "rgba(0,0,0,0.12)" }}>
            <Typography fontWeight={800}>Showing {filteredEnvironments.length} items</Typography>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

type EnvironmentRowProps = {
  environment: EnvironmentRecord;
  activeEnvironmentKey: string;
  onSelectActive: (key: string) => void;
  onDetails: (environment: EnvironmentRecord) => void;
  onAction: (key: string, action: "start" | "stop" | "restart" | "resume" | "delete") => Promise<void>;
};

function EnvironmentRow({ environment, activeEnvironmentKey, onAction, onDetails, onSelectActive }: EnvironmentRowProps) {
  return (
    <TableRow hover sx={{ "&:last-child td": { borderBottom: 0 } }}>
      <TableCell>
        <Stack spacing={0.4}>
          <Typography fontWeight={800} color="primary.light" sx={{ textDecoration: "underline", cursor: "pointer" }} onClick={() => onDetails(environment)}>
            {environment.key}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {environment.key === activeEnvironmentKey ? "Active sync target" : "Environment"}
          </Typography>
        </Stack>
      </TableCell>
      <TableCell>
        <Chip size="small" label={environment.status} color={environment.status === "running" ? "success" : environment.status === "error" ? "error" : "default"} />
      </TableCell>
      <TableCell>{environment.port ?? "N/A"}</TableCell>
      <TableCell>{environment.seed}</TableCell>
      <TableCell>
        <Stack spacing={0.35}>
          <Typography variant="body2" noWrap sx={{ maxWidth: 220 }}>
            {environment.source.branch}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {environment.source.commit.slice(0, 12)}
          </Typography>
        </Stack>
      </TableCell>
      <TableCell>
        {isPullRequest(environment.createdBy) ? (
          <Button size="small" href={environment.createdBy.url} target="_blank" rel="noreferrer" sx={{ maxWidth: 220, justifyContent: "flex-start" }}>
            <Typography variant="body2" noWrap>
              {environment.createdBy.title ?? environment.createdBy.url}
            </Typography>
          </Button>
        ) : (
          <Typography variant="body2" noWrap sx={{ maxWidth: 220 }}>
            {environment.createdBy.name}
          </Typography>
        )}
      </TableCell>
      <TableCell>{formatRelative(environment.updatedAt)}</TableCell>
      <TableCell align="right" sx={{ bgcolor: "rgba(0,0,0,0.12)" }}>
        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
          <IconButton aria-label="details" size="small" onClick={() => onDetails(environment)}>
            <VisibilityIcon fontSize="small" />
          </IconButton>
          <IconButton aria-label="set active sync" size="small" onClick={() => onSelectActive(environment.key)} disabled={environment.key === activeEnvironmentKey}>
            <SyncIcon fontSize="small" />
          </IconButton>
          <IconButton aria-label="start" size="small" onClick={() => void onAction(environment.key, "start")}>
            <PlayArrowIcon fontSize="small" />
          </IconButton>
          <IconButton aria-label="stop" size="small" onClick={() => void onAction(environment.key, "stop")}>
            <StopIcon fontSize="small" />
          </IconButton>
          <IconButton aria-label="resume" size="small" onClick={() => void onAction(environment.key, "resume")}>
            <ReplayIcon fontSize="small" />
          </IconButton>
          <IconButton aria-label="restart" size="small" onClick={() => void onAction(environment.key, "restart")}>
            <RestartAltIcon fontSize="small" />
          </IconButton>
          <IconButton aria-label="delete" size="small" onClick={() => void onAction(environment.key, "delete")}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      </TableCell>
    </TableRow>
  );
}

function formatRelative(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    return "N/A";
  }

  const diffMs = Date.now() - time;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) {
    return "just now";
  }
  if (diffMs < hour) {
    return `${Math.floor(diffMs / minute)} minutes ago`;
  }
  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)} hours ago`;
  }
  return `${Math.floor(diffMs / day)} days ago`;
}

function groupEnvironments(environments: EnvironmentRecord[]): Array<{ id: string; label: string; environments: EnvironmentRecord[] }> {
  const groups = new Map<string, { id: string; label: string; environments: EnvironmentRecord[] }>();

  for (const environment of environments) {
    const createdBy = environment.createdBy;
    const id = isPullRequest(createdBy) ? "prs" : `user:${createdBy.email}`;
    const label = isPullRequest(createdBy) ? "All pull requests" : `User · ${createdBy.name}`;

    if (!groups.has(id)) {
      groups.set(id, { id, label, environments: [] });
    }
    groups.get(id)?.environments.push(environment);
  }

  return [...groups.values()];
}

function isPullRequest(value: EnvironmentRecord["createdBy"]): value is { title?: string; url: string } {
  return "url" in value;
}

function environmentSearchText(environment: EnvironmentRecord): string {
  const ownerText = isPullRequest(environment.createdBy)
    ? `${environment.createdBy.title ?? ""} ${environment.createdBy.url}`
    : `${environment.createdBy.name} ${environment.createdBy.email}`;

  return [
    environment.key,
    environment.status,
    String(environment.port),
    environment.seed,
    environment.source.branch,
    environment.source.commit,
    ownerText
  ]
    .join(" ")
    .toLowerCase();
}

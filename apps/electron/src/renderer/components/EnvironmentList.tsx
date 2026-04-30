import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import StopIcon from "@mui/icons-material/Stop";
import ReplayIcon from "@mui/icons-material/Replay";
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
  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
            <Typography variant="h6">Environments</Typography>
            <Button onClick={onRefresh} disabled={loading} startIcon={loading ? <CircularProgress size={16} /> : null}>
              Refresh
            </Button>
          </Stack>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <List disablePadding>
            {environments.length === 0 ? (
              <ListItem disableGutters>
                <ListItemText primary="No environments yet" secondary="Create one to start syncing local changes." />
              </ListItem>
            ) : (
              groupEnvironments(environments).map((group) => (
                <Box key={group.id}>
                  <Divider sx={{ my: 1 }} />
                  <Stack spacing={0.5} sx={{ py: 1 }}>
                    <Typography variant="subtitle2">{group.label}</Typography>
                    {group.prUrl ? (
                      <Button size="small" href={group.prUrl} target="_blank" rel="noreferrer" sx={{ alignSelf: "flex-start" }}>
                        Open PR
                      </Button>
                    ) : null}
                  </Stack>
                  {group.environments.map((environment) => (
                    <EnvironmentRow
                      key={environment.key}
                      environment={environment}
                      activeEnvironmentKey={activeEnvironmentKey}
                      onAction={onAction}
                      onDetails={onDetails}
                      onSelectActive={onSelectActive}
                    />
                  ))}
                </Box>
              ))
            )}
          </List>
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
    <ListItem
      disableGutters
      secondaryAction={
        <Stack direction="row" spacing={0.5}>
          <IconButton aria-label="start" onClick={() => void onAction(environment.key, "start")}>
            <PlayArrowIcon />
          </IconButton>
          <IconButton aria-label="stop" onClick={() => void onAction(environment.key, "stop")}>
            <StopIcon />
          </IconButton>
          <IconButton aria-label="resume" onClick={() => void onAction(environment.key, "resume")}>
            <ReplayIcon />
          </IconButton>
          <IconButton aria-label="restart" onClick={() => void onAction(environment.key, "restart")}>
            <RestartAltIcon />
          </IconButton>
          <IconButton aria-label="delete" onClick={() => void onAction(environment.key, "delete")}>
            <DeleteIcon />
          </IconButton>
        </Stack>
      }
    >
      <ListItemText
        primary={
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography fontWeight={700}>{environment.key}</Typography>
            <Chip size="small" label={environment.status} color={environment.status === "running" ? "success" : "default"} />
            {environment.key === activeEnvironmentKey ? <Chip size="small" label="Active sync" color="secondary" /> : null}
            {environment.dirty ? <Chip size="small" label="Dirty source" color="warning" /> : null}
          </Stack>
        }
        secondary={
          <Stack spacing={0.5} sx={{ mt: 0.75 }}>
            <Typography variant="body2" color="text.secondary">
              Seed {environment.seed} · Port {environment.port ?? "n/a"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Branch {environment.branch ?? "n/a"} · Commit {environment.commit?.slice(0, 12) ?? "n/a"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Owner {environment.createdBy?.name ?? "Unknown"}{environment.pullRequest ? ` · PR #${environment.pullRequest.number}` : ""}
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => onDetails(environment)}>
                Details
              </Button>
              <Button size="small" onClick={() => onSelectActive(environment.key)} disabled={environment.key === activeEnvironmentKey}>
                Set active sync
              </Button>
            </Stack>
          </Stack>
        }
      />
    </ListItem>
  );
}

function groupEnvironments(environments: EnvironmentRecord[]): Array<{ id: string; label: string; prUrl?: string; environments: EnvironmentRecord[] }> {
  const groups = new Map<string, { id: string; label: string; prUrl?: string; environments: EnvironmentRecord[] }>();

  for (const environment of environments) {
    const id = environment.pullRequest
      ? `pr:${environment.pullRequest.repository}:${environment.pullRequest.number}`
      : `user:${environment.createdBy?.id ?? "unknown"}`;
    const label = environment.pullRequest
      ? `GitHub PR #${environment.pullRequest.number} · ${environment.pullRequest.title ?? environment.pullRequest.repository}`
      : `User · ${environment.createdBy?.name ?? "Unknown"}`;

    if (!groups.has(id)) {
      groups.set(id, { id, label, prUrl: environment.pullRequest?.url, environments: [] });
    }
    groups.get(id)?.environments.push(environment);
  }

  return [...groups.values()];
}

import { Card, CardContent, Chip, FormControlLabel, Stack, Switch, Typography } from "@mui/material";
import type { EnvironmentRecord, SyncState } from "../types";

type ActiveEnvironmentCardProps = {
  environments: EnvironmentRecord[];
  activeEnvironmentKey: string;
  repoPath: string;
  syncState: SyncState;
  onStartSync: () => Promise<void>;
  onStopSync: () => Promise<void>;
};

export function ActiveEnvironmentCard({
  environments,
  activeEnvironmentKey,
  repoPath,
  syncState,
  onStartSync,
  onStopSync
}: ActiveEnvironmentCardProps) {
  const activeEnvironment = environments.find((environment) => environment.key === activeEnvironmentKey);
  const canToggleSync = Boolean(activeEnvironment && repoPath);

  async function toggleSync(checked: boolean): Promise<void> {
    if (checked) {
      await onStartSync();
    } else {
      await onStopSync();
    }
  }

  return (
    <Card>
      <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Stack spacing={1.5}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Typography variant="caption" color="text.secondary" fontWeight={800}>
              Active target
            </Typography>
            <Chip size="small" label={activeEnvironment?.status ?? "None"} color={activeEnvironment?.status === "running" ? "success" : "default"} />
          </Stack>
          <Typography variant="h6" fontWeight={800} noWrap>
            {activeEnvironment?.key ?? "Not selected"}
          </Typography>
          {activeEnvironment ? (
            <FormControlLabel
              control={
                <Switch
                  checked={syncState.watching}
                  disabled={!canToggleSync}
                  onChange={(event) => void toggleSync(event.target.checked)}
                />
              }
              label={syncState.watching ? "Sync running" : "Sync stopped"}
            />
          ) : null}
          <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-all" }}>
            {activeEnvironment
              ? `${activeEnvironment.source.branch} @ ${activeEnvironment.source.commit.slice(0, 12)}`
              : "Use the environment table action to set the sync target."}
          </Typography>
          {syncState.errors.at(-1) ? (
            <Typography variant="caption" color="warning.main" sx={{ wordBreak: "break-word" }}>
              {syncState.errors.at(-1)}
            </Typography>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

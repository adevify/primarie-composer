import { Alert, Button, Card, CardContent, Chip, Divider, List, ListItem, ListItemText, Stack, Typography } from "@mui/material";
import type { GitState, SyncState } from "../types";

type SyncStatusCardProps = {
  repoPath: string;
  gitState?: GitState;
  syncState: SyncState;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
};

export function SyncStatusCard({ repoPath, gitState, syncState, onStart, onStop }: SyncStatusCardProps) {
  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
            <Typography variant="h6">Sync status</Typography>
            <Chip label={syncState.watching ? "Watching" : "Stopped"} color={syncState.watching ? "success" : "default"} />
          </Stack>
          <List dense disablePadding>
            <ListItem disableGutters>
              <ListItemText primary="Repository" secondary={repoPath || "Not selected"} secondaryTypographyProps={{ sx: { wordBreak: "break-all" } }} />
            </ListItem>
            <ListItem disableGutters>
              <ListItemText primary="Branch" secondary={gitState?.branch ?? "n/a"} />
            </ListItem>
            <ListItem disableGutters>
              <ListItemText primary="Commit" secondary={gitState?.commit ?? "n/a"} secondaryTypographyProps={{ sx: { wordBreak: "break-all" } }} />
            </ListItem>
            <ListItem disableGutters>
              <ListItemText primary="Local changes" secondary={gitState ? `${gitState.changedFiles.length} changed files` : "n/a"} />
            </ListItem>
            <ListItem disableGutters>
              <ListItemText primary="Active environment key" secondary={syncState.activeEnvironmentKey || "None"} />
            </ListItem>
            <ListItem disableGutters>
              <ListItemText primary="Last synced file" secondary={syncState.lastSyncedFile ?? "None"} secondaryTypographyProps={{ sx: { wordBreak: "break-all" } }} />
            </ListItem>
            <ListItem disableGutters>
              <ListItemText primary="Last sync time" secondary={syncState.lastSyncTime ?? "None"} />
            </ListItem>
          </List>
          {syncState.errors.length ? (
            <Stack spacing={1}>
              {syncState.errors.slice(-3).map((error) => (
                <Alert key={error} severity="warning">
                  {error}
                </Alert>
              ))}
            </Stack>
          ) : null}
          <Divider />
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={onStart} disabled={!repoPath || !syncState.activeEnvironmentKey || syncState.watching}>
              Start sync
            </Button>
            <Button variant="outlined" onClick={onStop} disabled={!syncState.watching}>
              Stop sync
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

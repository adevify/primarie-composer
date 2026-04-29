import { Alert, Card, CardContent, Chip, CircularProgress, Divider, List, ListItem, ListItemText, Stack, Typography } from "@mui/material";
import type { GitState } from "../types";

type GitStatusCardProps = {
  gitState?: GitState;
  loading: boolean;
  error?: string;
};

export function GitStatusCard({ gitState, loading, error }: GitStatusCardProps) {
  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
            <Typography variant="h6">Git status</Typography>
            {loading ? <CircularProgress size={20} /> : gitState ? <Chip label={gitState.isDirty ? "Dirty" : "Clean"} color={gitState.isDirty ? "warning" : "success"} /> : null}
          </Stack>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {gitState ? (
            <>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Chip label={`Branch: ${gitState.branch}`} />
                <Chip label={`Commit: ${gitState.commit.slice(0, 12)}`} />
              </Stack>
              <Divider />
              <List dense disablePadding>
                {gitState.changedFiles.length === 0 ? (
                  <ListItem disableGutters>
                    <ListItemText primary="No changed files" />
                  </ListItem>
                ) : (
                  gitState.changedFiles.slice(0, 8).map((file) => (
                    <ListItem key={file} disableGutters>
                      <ListItemText primary={file} primaryTypographyProps={{ sx: { wordBreak: "break-all" } }} />
                    </ListItem>
                  ))
                )}
              </List>
              {gitState.changedFiles.length > 8 ? (
                <Typography variant="caption" color="text.secondary">
                  +{gitState.changedFiles.length - 8} more
                </Typography>
              ) : null}
            </>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

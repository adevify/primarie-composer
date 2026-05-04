import { Alert, Card, CardContent, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";

type RepoPickerProps = {
  repoPath: string;
  error?: string;
  onChooseRepo: () => Promise<void>;
};

export function RepoPicker({ repoPath, error, onChooseRepo }: RepoPickerProps) {
  return (
    <Card>
      <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Stack spacing={1}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Stack direction="row" spacing={1} alignItems="center">
            <Stack spacing={0.25} sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="caption" color="text.secondary" fontWeight={800}>
                Local repository
              </Typography>
              <Typography variant="body2" color={repoPath ? "text.primary" : "text.secondary"} noWrap title={repoPath || undefined}>
                {repoPath || "Not selected"}
              </Typography>
            </Stack>
            <Tooltip title="Choose local repository">
              <IconButton aria-label="choose local repository" onClick={onChooseRepo} size="small">
                <FolderOpenIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

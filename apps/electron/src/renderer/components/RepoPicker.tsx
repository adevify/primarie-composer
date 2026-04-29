import { Alert, Button, Card, CardContent, Stack, Typography } from "@mui/material";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";

type RepoPickerProps = {
  repoPath: string;
  error?: string;
  onChooseRepo: () => Promise<void>;
};

export function RepoPicker({ repoPath, error, onChooseRepo }: RepoPickerProps) {
  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">Local repository</Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Typography variant="body2" color={repoPath ? "text.primary" : "text.secondary"} sx={{ wordBreak: "break-all" }}>
            {repoPath || "Choose the repository whose branch, commit, and local changes should be mirrored."}
          </Typography>
          <Button variant="contained" startIcon={<FolderOpenIcon />} onClick={onChooseRepo} sx={{ alignSelf: "flex-start" }}>
            Choose local repository
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

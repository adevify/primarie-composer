import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import type { EnvExampleEntry } from "../types";

type EnvironmentEnvDialogProps = {
  open: boolean;
  entries: EnvExampleEntry[];
  loading: boolean;
  onCancel: () => void;
  onSubmit: (values: Record<string, string>) => Promise<void>;
};

export function EnvironmentEnvDialog({ open, entries, loading, onCancel, onSubmit }: EnvironmentEnvDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setValues(Object.fromEntries(entries.map((entry) => [entry.key, entry.value])));
  }, [entries]);

  async function submit(): Promise<void> {
    await onSubmit(values);
  }

  return (
    <Dialog open={open} onClose={loading ? undefined : onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>Environment variables</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Values are copied from the selected repository `.env` file. If `.env` is missing, `.env.example` is used as a
            fallback. These values are sent to the API and written before Docker Compose starts.
          </Typography>
          {entries.length === 0 ? <Alert severity="info">No `.env` or `.env.example` variables were found.</Alert> : null}
          {entries.map((entry) => (
            <TextField
              key={entry.key}
              label={entry.key}
              value={values[entry.key] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [entry.key]: event.target.value }))}
              fullWidth
              disabled={loading}
            />
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={loading}>
          Create environment
        </Button>
      </DialogActions>
    </Dialog>
  );
}

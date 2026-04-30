import { Alert, Button, Card, CardContent, CircularProgress, Stack, TextField, Typography } from "@mui/material";
import { FormEvent, useState } from "react";

type EnvironmentCreateFormProps = {
  disabled: boolean;
  loading: boolean;
  error?: string;
  onCreate: (input: { seed: string; useCurrentRepoState: boolean }) => Promise<void>;
};

export function EnvironmentCreateForm({ disabled, loading, error, onCreate }: EnvironmentCreateFormProps) {
  const [seed, setSeed] = useState("default");
  const [useCurrentRepoState, setUseCurrentRepoState] = useState(true);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    await onCreate({
      seed: seed.trim() || "default",
      useCurrentRepoState
    });
  }

  return (
    <Card>
      <CardContent>
        <Stack component="form" spacing={2} onSubmit={submit}>
          <Typography variant="h6">Create environment</Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField label="Seed name" value={seed} onChange={(event) => setSeed(event.target.value)} disabled={disabled || loading} />
          <Button
            variant={useCurrentRepoState ? "contained" : "outlined"}
            color={useCurrentRepoState ? "secondary" : "inherit"}
            onClick={() => setUseCurrentRepoState((value) => !value)}
            disabled={disabled || loading}
          >
            Use current repo state: {useCurrentRepoState ? "Yes" : "No"}
          </Button>
          <Button type="submit" variant="contained" disabled={disabled || loading} startIcon={loading ? <CircularProgress size={16} /> : null}>
            Create
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

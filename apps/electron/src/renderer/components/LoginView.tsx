import { Alert, Box, Button, Card, CardContent, CircularProgress, Stack, TextField, Typography } from "@mui/material";
import { FormEvent, useState } from "react";

type LoginViewProps = {
  loading: boolean;
  error?: string;
  onLogin: (baseUrl: string, accessKey: string) => Promise<void>;
};

export function LoginView({ loading, error, onLogin }: LoginViewProps) {
  const [baseUrl, setBaseUrl] = useState("http://localhost:3000");
  const [accessKey, setAccessKey] = useState("");

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    await onLogin(baseUrl, accessKey);
    setAccessKey("");
  }

  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 3 }}>
      <Card sx={{ width: "100%", maxWidth: 440 }}>
        <CardContent>
          <Stack component="form" spacing={2.5} onSubmit={submit}>
            <Box>
              <Typography variant="h5" fontWeight={700}>
                Primarie Composer
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Operator login
              </Typography>
            </Box>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <TextField
              label="API Base URL"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              fullWidth
              required
            />
            <TextField
              label="Access Key"
              type="password"
              value={accessKey}
              onChange={(event) => setAccessKey(event.target.value)}
              fullWidth
              required
            />
            <Button type="submit" variant="contained" disabled={loading} startIcon={loading ? <CircularProgress size={16} /> : null}>
              Login
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}

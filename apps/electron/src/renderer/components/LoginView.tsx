import { Alert, Box, Button, Card, CardContent, CircularProgress, Stack, TextField, Typography } from "@mui/material";
import { FormEvent, useState } from "react";

const DEFAULT_API_BASE_URL = "https://prmr.md";
const LAST_EMAIL_STORAGE_KEY = "primarie-composer.lastEmail";

type LoginViewProps = {
  loading: boolean;
  error?: string;
  onLogin: (baseUrl: string, email: string, password: string) => Promise<void>;
};

export function LoginView({ loading, error, onLogin }: LoginViewProps) {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [email, setEmail] = useState(() => localStorage.getItem(LAST_EMAIL_STORAGE_KEY) ?? "");
  const [password, setPassword] = useState("");

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    localStorage.setItem(LAST_EMAIL_STORAGE_KEY, email);
    await onLogin(baseUrl, email, password);
    setPassword("");
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
              label="Email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              fullWidth
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
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

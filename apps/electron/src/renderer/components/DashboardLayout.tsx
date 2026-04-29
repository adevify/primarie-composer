import { AppBar, Box, Button, Container, Stack, Toolbar, Typography } from "@mui/material";
import LogoutIcon from "@mui/icons-material/Logout";
import type { ReactNode } from "react";

type DashboardLayoutProps = {
  apiBaseUrl: string;
  children: ReactNode;
  onLogout: () => void;
};

export function DashboardLayout({ apiBaseUrl, children, onLogout }: DashboardLayoutProps) {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="sticky" color="inherit" elevation={0}>
        <Toolbar>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h6" fontWeight={700} noWrap>
              Primarie Composer
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {apiBaseUrl}
            </Typography>
          </Stack>
          <Button color="inherit" startIcon={<LogoutIcon />} onClick={onLogout}>
            Logout
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="xl" sx={{ py: 3 }}>
        {children}
      </Container>
    </Box>
  );
}

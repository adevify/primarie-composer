import { AppBar, Box, Button, Stack, Toolbar, Typography } from "@mui/material";
import DashboardIcon from "@mui/icons-material/Dashboard";
import LogoutIcon from "@mui/icons-material/Logout";
import type { ReactNode } from "react";

type DashboardLayoutProps = {
  apiBaseUrl: string;
  sidebar?: ReactNode;
  children: ReactNode;
  onLogout: () => void;
};

export function DashboardLayout({ apiBaseUrl, sidebar, children, onLogout }: DashboardLayoutProps) {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", color: "text.primary" }}>
      <AppBar position="sticky" elevation={0} sx={{ bgcolor: "#123fb5", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
        <Toolbar variant="dense" sx={{ minHeight: 56, gap: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ width: 300, flexShrink: 0 }}>
            <DashboardIcon />
            <Typography variant="h6" fontWeight={800} noWrap sx={{ letterSpacing: 0 }}>
              Primarie Desktop
            </Typography>
          </Stack>
          <Typography variant="body2" sx={{ flex: 1, minWidth: 0, fontWeight: 700 }} noWrap>
            API {apiBaseUrl}
          </Typography>
          <Button color="inherit" variant="contained" onClick={onLogout} startIcon={<LogoutIcon />} sx={{ bgcolor: "common.white", color: "#123fb5", "&:hover": { bgcolor: "#e9eefc" } }}>
            Logout
          </Button>
        </Toolbar>
      </AppBar>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "390px 1fr" }, minHeight: "calc(100vh - 56px)" }}>
        <Box
          component="aside"
          sx={{
            display: { xs: "none", md: "flex" },
            flexDirection: "column",
            bgcolor: "#070c11",
            borderRight: "1px solid rgba(159, 179, 195, 0.14)",
            p: 2.5
          }}
        >
          {sidebar ? (
            <Box sx={{ minHeight: 0, overflow: "auto", pr: 0.5 }}>
              {sidebar}
            </Box>
          ) : null}
        </Box>
        <Box component="main" sx={{ minWidth: 0, p: { xs: 2, md: 5 }, overflow: "auto" }}>
          {sidebar ? (
            <Box sx={{ display: { xs: "block", md: "none" }, mb: 2 }}>
              {sidebar}
            </Box>
          ) : null}
          {children}
        </Box>
      </Box>
    </Box>
  );
}

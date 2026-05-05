import { Box, Button, Stack, Typography } from "@mui/material";
import DashboardIcon from "@mui/icons-material/Dashboard";
import LayersIcon from "@mui/icons-material/Layers";
import SettingsIcon from "@mui/icons-material/Settings";
import TerminalIcon from "@mui/icons-material/Terminal";
import PeopleIcon from "@mui/icons-material/People";
import LogoutIcon from "@mui/icons-material/Logout";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import type { ReactNode } from "react";

type DashboardLayoutProps = {
  apiBaseUrl: string;
  sidebar?: ReactNode;
  children: ReactNode;
  onLogout: () => void;
};

export function DashboardLayout({ apiBaseUrl, sidebar, children, onLogout }: DashboardLayoutProps) {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#0f1d1b", color: "text.primary" }}>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "320px 1fr" }, minHeight: "100vh" }}>
        <Box
          component="aside"
          sx={{
            display: { xs: "none", md: "flex" },
            flexDirection: "column",
            bgcolor: "#030720",
            borderRight: "1px solid rgba(0, 229, 255, 0.35)",
            boxShadow: "18px 0 40px rgba(0,0,0,0.22)"
          }}
        >
          <Box sx={{ px: 3, py: 3.5, borderBottom: "1px solid rgba(0,229,255,0.08)" }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box sx={{ width: 40, height: 40, display: "grid", placeItems: "center", bgcolor: "#20d9ef", color: "#02121b", borderRadius: 0.75 }}>
                <TerminalIcon />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography fontWeight={900} color="#00e5ff" noWrap sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                  ELECTRO_TERMINAL
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                  v1.0.4-stable
                </Typography>
              </Box>
            </Stack>
          </Box>
          <Stack spacing={0.5} sx={{ py: 2 }}>
            <NavItem icon={<DashboardIcon />} label="Dashboard" active />
            <NavItem icon={<LayersIcon />} label="Environments" />
            <NavItem icon={<PeopleIcon />} label="Users" />
            <NavItem icon={<TerminalIcon />} label="System Logs" />
            <NavItem icon={<SettingsIcon />} label="Settings" />
          </Stack>
          {sidebar ? (
            <Box sx={{ mt: "auto", minHeight: 0, overflow: "auto", p: 3 }}>
              {sidebar}
              <Box sx={{ mt: 2, border: "1px solid rgba(159,179,195,0.24)", bgcolor: "#111d3b", p: 2, borderRadius: 0.75 }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                  <FolderOpenIcon fontSize="small" />
                  <Typography variant="caption" color="text.secondary" fontWeight={900} sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                    API ENDPOINT
                  </Typography>
                </Stack>
                <Typography variant="caption" color="#00e5ff" sx={{ wordBreak: "break-all" }}>
                  {apiBaseUrl}
                </Typography>
              </Box>
              <Box sx={{ mt: 2 }}>
                <Button fullWidth variant="outlined" color="inherit" onClick={onLogout} startIcon={<LogoutIcon />}>
                  Logout
                </Button>
              </Box>
            </Box>
          ) : null}
        </Box>
        <Box component="main" sx={{ minWidth: 0, p: { xs: 2, md: 3.75 }, overflow: "auto" }}>
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

function NavItem({ icon, label, active = false }: { icon: ReactNode; label: string; active?: boolean }) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        px: 3,
        py: 1.9,
        color: active ? "#00e5ff" : "text.secondary",
        bgcolor: active ? "rgba(0, 229, 255, 0.08)" : "transparent",
        borderRight: active ? "3px solid #00e5ff" : "3px solid transparent",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontWeight: 900
      }}
    >
      {icon}
      <Typography variant="body2" fontWeight={900} sx={{ fontFamily: "inherit" }}>
        {label}
      </Typography>
    </Box>
  );
}

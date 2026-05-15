import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
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
  activePage: "dashboard" | "environments" | "users";
  sidebar?: ReactNode;
  children: ReactNode;
  onLogout: () => void;
  onNavigate: (page: "dashboard" | "environments" | "users") => void;
};

export function DashboardLayout({ apiBaseUrl, activePage, sidebar, children, onLogout, onNavigate }: DashboardLayoutProps) {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#0d1515", color: "text.primary" }}>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "280px 1fr" }, minHeight: "100vh" }}>
        <Box
          component="aside"
          sx={{
            display: { xs: "none", md: "flex" },
            flexDirection: "column",
            position: "sticky",
            top: 0,
            height: "100vh",
            minHeight: 0,
            overflow: "hidden",
            bgcolor: "#080f10",
            borderRight: "1px solid #3b494b"
          }}
        >
          <Box sx={{ px: 3, py: 3, borderBottom: "1px solid #3b494b" }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box sx={{ width: 40, height: 40, display: "grid", placeItems: "center", bgcolor: "#00f0ff", color: "#002022", border: "1px solid #7df4ff" }}>
                <TerminalIcon />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography fontWeight={800} color="#00f0ff" noWrap sx={{ fontFamily: "Space Grotesk, ui-monospace, SFMono-Regular, Menlo, monospace", }}>
                  ELECTRO_TERMINAL
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "Space Grotesk, ui-monospace, SFMono-Regular, Menlo, monospace", }}>
                  v1.0.4-stable
                </Typography>
              </Box>
            </Stack>
          </Box>
          <Stack spacing={0.5} sx={{ py: 2 }}>
            <NavItem icon={<DashboardIcon />} label="Dashboard" active={activePage === "dashboard"} onClick={() => onNavigate("dashboard")} />
            <NavItem icon={<LayersIcon />} label="Environments" active={activePage === "environments"} onClick={() => onNavigate("environments")} />
            <NavItem icon={<PeopleIcon />} label="Users" active={activePage === "users"} onClick={() => onNavigate("users")} />
          </Stack>
          {sidebar ? (
            <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 3 }}>
              {sidebar}
              <Box sx={{ mt: 2, border: "1px solid #3b494b", bgcolor: "#151d1e", p: 2 }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                  <FolderOpenIcon fontSize="small" />
                  <Typography variant="caption" color="text.secondary" fontWeight={800} sx={{ fontFamily: "Space Grotesk, ui-monospace, SFMono-Regular, Menlo, monospace", }}>
                    API ENDPOINT
                  </Typography>
                </Stack>
                <Typography variant="caption" color="#00f0ff" sx={{ wordBreak: "break-all", fontFamily: "Space Grotesk, ui-monospace, SFMono-Regular, Menlo, monospace" }}>
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
        <Box component="main" sx={{ minWidth: 0, p: { xs: 2, md: 3 }, overflow: "auto", bgcolor: "#0d1515" }}>
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

function NavItem({ icon, label, active = false, onClick }: { icon: ReactNode; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        px: 3,
        py: 1.9,
        color: active ? "#00f0ff" : "text.secondary",
        bgcolor: active ? "rgba(0, 240, 255, 0.08)" : "transparent",
        borderRight: active ? "2px solid #00f0ff" : "2px solid transparent",
        fontFamily: "Space Grotesk, ui-monospace, SFMono-Regular, Menlo, monospace",
        fontWeight: 700,
        width: "100%",
        borderTop: 0,
        borderLeft: 0,
        borderBottom: 0,
        cursor: onClick ? "pointer" : "default",
        textAlign: "left",
        "&:hover": onClick ? { bgcolor: "rgba(0, 240, 255, 0.06)", color: "#dce4e5" } : undefined
      }}
    >
      {icon}
      <Typography variant="body2" fontWeight={900} sx={{ fontFamily: "inherit" }}>
        {label}
      </Typography>
    </Box>
  );
}

import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  IconButton,
  InputAdornment,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from "@mui/material";
import BlockIcon from "@mui/icons-material/Block";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import FilterListIcon from "@mui/icons-material/FilterList";
import HistoryIcon from "@mui/icons-material/History";
import PersonAddAltIcon from "@mui/icons-material/PersonAddAlt";
import PersonIcon from "@mui/icons-material/Person";
import SearchIcon from "@mui/icons-material/Search";
import VerifiedIcon from "@mui/icons-material/Verified";
import { useMemo, useState } from "react";
import type { UserDirectoryRecord } from "../types";

type UsersPageProps = {
  users: UserDirectoryRecord[];
  loading: boolean;
  onRefresh: () => Promise<void>;
};

export function UsersPage({ users, loading, onRefresh }: UsersPageProps) {
  const [query, setQuery] = useState("");
  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return users;
    }
    return users.filter((user) => `${user.name} ${user.email} ${user.role ?? ""} ${user.status ?? ""}`.toLowerCase().includes(normalized));
  }, [query, users]);
  const roleStats = useMemo(() => roleDistribution(users), [users]);

  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ xs: "stretch", md: "center" }} justifyContent="space-between">
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography variant="h4" fontWeight={900}>
            User Directory
          </Typography>
          <Button variant="outlined" startIcon={<FilterListIcon />} sx={{ color: "text.primary", borderColor: "rgba(159,179,195,0.24)" }}>
            {users.length} total users
          </Button>
        </Stack>
        <Stack direction="row" spacing={1.5}>
          <TextField
            placeholder="QUERY_USER_DB..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            size="small"
            sx={{ width: { xs: "100%", sm: 320 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              )
            }}
          />
          <Button variant="contained" startIcon={<PersonAddAltIcon />} sx={{ bgcolor: "#00e5ff", color: "#02121b", "&:hover": { bgcolor: "#35edff" } }}>
            Create user
          </Button>
          <IconButton onClick={() => void onRefresh()} disabled={loading} aria-label="Refresh users">
            {loading ? <CircularProgress size={16} /> : <HistoryIcon />}
          </IconButton>
        </Stack>
      </Stack>

      <Card sx={{ bgcolor: "rgba(255,255,255,0.035)", borderColor: "rgba(159,179,195,0.22)" }}>
        <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
          <TableContainer>
            <Table sx={{ minWidth: 1020 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: "rgba(255,255,255,0.055)" }}>
                  <HeaderCell>ID / Identity</HeaderCell>
                  <HeaderCell>Access Role</HeaderCell>
                  <HeaderCell>Provisioned</HeaderCell>
                  <HeaderCell>Last Auth</HeaderCell>
                  <HeaderCell>Status</HeaderCell>
                  <HeaderCell align="right">Operations</HeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ py: 5 }}>
                      <Typography fontWeight={900}>No matching users</Typography>
                      <Typography variant="body2" color="text.secondary">Try another query.</Typography>
                    </TableCell>
                  </TableRow>
                ) : filteredUsers.map((user, index) => (
                  <TableRow key={user.email} hover sx={{ "& td": { py: 2.1 } }}>
                    <TableCell>
                      <Stack direction="row" spacing={1.5} alignItems="center">
                        <Box sx={{ width: 40, height: 40, display: "grid", placeItems: "center", borderRadius: "50%", border: index === 0 ? "1px solid #00e5ff" : 0, bgcolor: "rgba(159,179,195,0.18)" }}>
                          <PersonIcon />
                        </Box>
                        <Box>
                          <Typography fontWeight={900}>{user.name}</Typography>
                          <Typography variant="body2" color="text.secondary">{user.email}</Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: "inline-flex", px: 1, py: 0.35, border: `1px solid ${roleColor(user.role)}`, color: roleColor(user.role), bgcolor: "rgba(0,0,0,0.16)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontWeight: 900, fontSize: 12 }}>
                        {user.role ?? "DEV_ENGINEER"}
                      </Box>
                    </TableCell>
                    <TableCell>{formatDate(user.provisionedAt)}</TableCell>
                    <TableCell>{lastAuthLabel(index)}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: statusColor(user.status), boxShadow: user.status === "online" ? "0 0 12px #65ffc9" : "none" }} />
                        <Typography color={statusColor(user.status)} fontWeight={900} sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                          {(user.status ?? "idle").toUpperCase()}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <IconButton aria-label="Edit user"><EditIcon /></IconButton>
                      <IconButton aria-label="Disable user"><BlockIcon /></IconButton>
                      <IconButton aria-label="Delete user"><DeleteOutlineIcon /></IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "2fr 1fr" }, gap: 2 }}>
        <Card sx={{ bgcolor: "rgba(255,255,255,0.035)" }}>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <HistoryIcon color="secondary" />
                <Typography variant="h6" fontWeight={900}>Global User Activity</Typography>
              </Stack>
              <Typography variant="caption" fontWeight={900}>EXPAND LOG</Typography>
            </Stack>
            <ActivityLine time="14:55:01" type="AUTH_OK" message={`User ${users[0]?.name ?? "operator"} initialized session from 192.168.1.45`} color="#65ffc9" />
            <ActivityLine time="14:52:30" type="MOD_ROLE" message={`Permissions changed for ${users[1]?.name ?? "developer"} by SYSTEM`} color="#ffd900" />
            <ActivityLine time="14:48:12" type="DENIED" message="Failed login attempt from IP 45.22.112.8" color="#ffc4b7" />
          </CardContent>
        </Card>
        <Card sx={{ bgcolor: "rgba(255,255,255,0.035)" }}>
          <CardContent>
            <Typography variant="h6" fontWeight={900} sx={{ mb: 1.5 }}>Role Distribution</Typography>
            {roleStats.map((role) => (
              <Box key={role.label} sx={{ mb: 1.5 }}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography>{role.label}</Typography>
                  <Typography color="#00e5ff">{role.count}</Typography>
                </Stack>
                <LinearProgress variant="determinate" value={role.percent} sx={{ mt: 0.7, bgcolor: "rgba(255,255,255,0.16)", "& .MuiLinearProgress-bar": { bgcolor: role.color } }} />
              </Box>
            ))}
          </CardContent>
        </Card>
      </Box>
    </Stack>
  );
}

function HeaderCell(props: { children: string; align?: "right" }) {
  return (
    <TableCell align={props.align} sx={{ color: "text.secondary", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontWeight: 900, textTransform: "uppercase" }}>
      {props.children}
    </TableCell>
  );
}

function ActivityLine({ time, type, message, color }: { time: string; type: string; message: string; color: string }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "80px 110px 1fr", gap: 1.5, py: 1.1, borderBottom: "1px solid rgba(159,179,195,0.08)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
      <Typography color="text.secondary">{time}</Typography>
      <Typography color={color} fontWeight={900}>[{type}]</Typography>
      <Typography>{message}</Typography>
    </Box>
  );
}

function roleDistribution(users: UserDirectoryRecord[]) {
  const labels = ["ROOT_SYSTEM", "DEV_ENGINEER", "READ_ONLY"];
  const total = Math.max(users.length, 1);
  return labels.map((label) => {
    const count = users.filter((user) => (user.role ?? "DEV_ENGINEER") === label).length;
    return {
      label: label.replace("_", " "),
      count,
      percent: (count / total) * 100,
      color: roleColor(label)
    };
  });
}

function roleColor(role?: string): string {
  if (role === "ROOT_SYSTEM") return "#ffd900";
  if (role === "READ_ONLY") return "#9fb3c3";
  return "#00d6b4";
}

function statusColor(status?: string): string {
  if (status === "online") return "#65ffc9";
  if (status === "locked") return "#ffc4b7";
  return "#d7e3ee";
}

function formatDate(value?: string): string {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toISOString().slice(0, 10);
}

function lastAuthLabel(index: number): string {
  return index % 3 === 0 ? "02:14:55 UTC" : index % 3 === 1 ? "18:22:10 UTC" : "3 days ago";
}

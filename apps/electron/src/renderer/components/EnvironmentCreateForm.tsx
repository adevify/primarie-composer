import {
  Alert,
  Box,
  Button,
  Collapse,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import AddBoxIcon from "@mui/icons-material/AddBox";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import { FormEvent, useEffect, useState } from "react";
import type { EnvExampleEntry, EnvironmentRecord, EnvironmentStatus } from "../types";

type EnvironmentCreateFormProps = {
  open: boolean;
  disabled: boolean;
  loading: boolean;
  envLoading: boolean;
  envEntries: EnvExampleEntry[];
  environment?: EnvironmentRecord;
  monitorLoading: boolean;
  error?: string;
  onCancel: () => void;
  onCreate: (input: { seed: string; useCurrentRepoState: boolean; env: Record<string, string> }) => Promise<void>;
};

const databaseSeedOptions = [
  { label: "default", seed: "default" }
];

const createSteps = [
  { label: "Environment key" },
  { label: "Clone repository" },
  { label: "Check out commit" },
  { label: "Apply changed files" },
  { label: "Ready to start" }
] as const;

export function EnvironmentCreateForm({ open, disabled, loading, envLoading, envEntries, environment, monitorLoading, error, onCancel, onCreate }: EnvironmentCreateFormProps) {
  const [seed, setSeed] = useState(databaseSeedOptions[0].seed);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [envOpen, setEnvOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setEnvValues(Object.fromEntries(envEntries.map((entry) => [entry.key, entry.value])));
      setEnvOpen(false);
    }
  }, [envEntries, open]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    await onCreate({
      seed: seed.trim() || "default",
      useCurrentRepoState: true,
      env: envValues
    });
  }

  const activeStep = createProgressIndex(environment?.status, loading);
  const finalStatus = environment?.status === "stopped" || environment?.status === "running";
  const failed = environment?.status === "failed";

  return (
    <Dialog
      open={open}
      onClose={loading ? undefined : onCancel}
      maxWidth="sm"
      fullWidth
      slotProps={{
        backdrop: {
          sx: {
            backgroundColor: "rgba(0, 0, 0, 0.78)",
            backdropFilter: "blur(8px)"
          }
        },
        paper: {
          component: "form",
          onSubmit: submit,
          sx: {
            width: 560,
            maxWidth: "calc(100vw - 32px)",
            borderRadius: 0,
            border: "1px solid #3b494b",
            backgroundImage: "none",
            bgcolor: "#192122",
            boxShadow: "none"
          }
        }
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
          px: 3,
          py: 2.2,
          bgcolor: "#232b2c",
          borderBottom: "1px solid #3b494b"
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center" minWidth={0}>
          <Box sx={{ width: 24, height: 24, display: "grid", placeItems: "center", color: "#00f0ff" }}>
            <AddBoxIcon fontSize="small" />
          </Box>
          <Typography
            fontWeight={900}
            color="#00f0ff"
            sx={{ fontFamily: "Space Grotesk, ui-monospace, SFMono-Regular, Menlo, monospace", }}
          >
            CREATE ENVIRONMENT
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1.2} alignItems="center">
          <Typography
            variant="caption"
            color="rgba(0, 240, 255, 0.48)"
            sx={{ display: { xs: "none", sm: "block" }, fontFamily: "Space Grotesk, ui-monospace, SFMono-Regular, Menlo, monospace" }}
          >
            SYSTEM_OVERRIDE_ACTIVE
          </Typography>
          <IconButton aria-label="Close create environment modal" onClick={onCancel} disabled={loading} sx={{ color: "#9fb3c3" }}>
            <CloseIcon />
          </IconButton>
        </Stack>
      </Box>

      <DialogContent sx={{ px: 3, py: 4, bgcolor: "#192122" }}>
        <Stack spacing={3}>
          {error ? <Alert severity="error">{error}</Alert> : null}

          {environment ? (
            <Stack spacing={0.8} sx={{ border: "1px solid #3b494b", bgcolor: "#151d1e", px: 2, py: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont, textTransform: "uppercase" }}>
                New environment
              </Typography>
              <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between">
                <Typography color="#00f0ff" fontWeight={900} sx={{ fontFamily: monoFont, fontSize: 18 }}>
                  {environment.key}
                </Typography>
                <Typography variant="caption" color={failed ? "#ffb4ab" : finalStatus ? "#4edea3" : "#c7d4e2"} sx={{ fontFamily: monoFont, textTransform: "uppercase" }}>
                  {monitorLoading && !finalStatus ? "refreshing" : environment.status}
                </Typography>
              </Stack>
            </Stack>
          ) : null}

          <Stack spacing={1.4}>
            <FieldLabel>Database seed</FieldLabel>
            <Select
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
              disabled={disabled || loading}
              IconComponent={ExpandMoreIcon}
              sx={fieldSx}
            >
              {databaseSeedOptions.map((option) => (
                <MenuItem key={option.seed} value={option.seed}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </Stack>

          <Stack spacing={1.2}>
            <Button
              type="button"
              onClick={() => setEnvOpen((current) => !current)}
              disabled={loading}
              endIcon={<ExpandMoreIcon sx={{ transform: envOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 160ms ease" }} />}
              sx={collapseButtonSx}
            >
              <Stack direction="row" spacing={1} alignItems="center" sx={{ width: "100%" }}>
                <Typography sx={{ fontFamily: monoFont, fontWeight: 900, fontSize: 12, textTransform: "uppercase" }}>
                  Env overrides
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }}>
                  {envLoading ? "loading" : `${envEntries.length} vars`}
                </Typography>
              </Stack>
            </Button>
            <Collapse in={envOpen} timeout="auto" unmountOnExit>
              <Stack spacing={1.2} sx={{ maxHeight: 260, overflow: "auto", pr: 0.5 }}>
                {envLoading ? (
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ border: "1px solid #3b494b", bgcolor: "#151d1e", px: 2, py: 1.5 }}>
                    <CircularProgress size={18} />
                    <Typography color="text.secondary">Loading environment values</Typography>
                  </Stack>
                ) : envEntries.length === 0 ? (
                  <Alert severity="info">No `.env` or `.env.example` values were found. Server defaults will still be applied.</Alert>
                ) : envEntries.map((entry) => (
                  <TextField
                    key={entry.key}
                    label={entry.key}
                    value={envValues[entry.key] ?? ""}
                    onChange={(event) => setEnvValues((current) => ({ ...current, [entry.key]: event.target.value }))}
                    disabled={disabled || loading}
                    sx={fieldSx}
                  />
                ))}
              </Stack>
            </Collapse>
          </Stack>

          <Stack spacing={2} sx={{ border: "1px solid #3b494b", bgcolor: "#151d1e", px: 2.5, py: 2.25 }}>
            {createSteps.map((step, index) => {
              const state = progressStepState(index, activeStep, finalStatus, failed);
              return (
                <Stack key={step.label} direction="row" spacing={1.5} alignItems="center">
                  {state === "done" ? (
                    <CheckCircleOutlineIcon sx={{ color: "#4edea3", fontSize: 20 }} />
                  ) : state === "active" && loading ? (
                    <CircularProgress size={20} thickness={5} sx={{ color: failed ? "#ffb4ab" : "#00f0ff" }} />
                  ) : (
                    <RadioButtonUncheckedIcon sx={{ color: state === "active" ? failed ? "#ffb4ab" : "#00f0ff" : "#6f879d", fontSize: 20 }} />
                  )}
                  <Typography
                    fontWeight={state === "active" ? 900 : 500}
                    color={state === "active" ? failed ? "#ffb4ab" : "#00f0ff" : state === "pending" ? "#71889e" : "text.primary"}
                    fontStyle={state === "pending" ? "italic" : "normal"}
                    sx={{ fontSize: 14 }}
                  >
                    {step.label}
                  </Typography>
                </Stack>
              );
            })}
            {environment?.status ? (
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont, textTransform: "uppercase" }}>
                STATUS / {environment.status}
              </Typography>
            ) : null}
          </Stack>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2.25, bgcolor: "#232b2c", borderTop: "1px solid #3b494b" }}>
        <Button onClick={onCancel} disabled={loading} sx={ghostButtonSx}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={disabled || loading || envLoading} sx={createButtonSx}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Typography
      variant="caption"
      color="#c7d4e2"
      sx={{ fontFamily: "Space Grotesk, ui-monospace, SFMono-Regular, Menlo, monospace", textTransform: "uppercase" }}
    >
      {children}
    </Typography>
  );
}

function createProgressIndex(status: EnvironmentStatus | undefined, loading: boolean): number {
  if (!status) {
    return loading ? 0 : -1;
  }

  if (status === "creating") return 0;
  if (status === "cloning") return 1;
  if (status === "checking_out") return 2;
  if (status === "applying_changes") return 3;
  if (status === "starting") return 4;
  if (status === "stopped" || status === "running") return 4;
  if (status === "failed") return 4;
  return -1;
}

function progressStepState(index: number, activeStep: number, finalStatus: boolean, failed: boolean): "done" | "active" | "pending" {
  if (finalStatus) {
    return "done";
  }
  if (failed && index === activeStep) {
    return "active";
  }
  if (index < activeStep) {
    return "done";
  }
  if (index === activeStep) {
    return "active";
  }
  return "pending";
}

const monoFont = "Space Grotesk, ui-monospace, SFMono-Regular, Menlo, monospace";

const fieldSx = {
  "& .MuiInputBase-root": {
    borderRadius: 0,
    bgcolor: "#151d1e",
    color: "text.primary",
    fontSize: 18,
    minHeight: 48
  },
  "& .MuiOutlinedInput-notchedOutline": {
    borderColor: "#3b494b"
  },
  "&:hover .MuiOutlinedInput-notchedOutline": {
    borderColor: "rgba(0, 240, 255, 0.55)"
  },
  "& .Mui-focused .MuiOutlinedInput-notchedOutline": {
    borderColor: "#00f0ff"
  },
  "& input::placeholder": {
    color: "#66819c",
    opacity: 1
  },
  "& .MuiSelect-icon": {
    color: "#9fb3c3"
  }
};

const collapseButtonSx = {
  justifyContent: "space-between",
  borderRadius: 0,
  border: "1px solid #3b494b",
  bgcolor: "#151d1e",
  color: "#c7d4e2",
  px: 2,
  py: 1.3,
  textTransform: "none",
  "&:hover": {
    borderColor: "rgba(0, 240, 255, 0.55)",
    bgcolor: "#1d2728"
  },
  "& .MuiButton-endIcon": {
    color: "#9fb3c3"
  }
};

const ghostButtonSx = {
  color: "#c7d4e2",
  px: 3,
  fontFamily: "Space Grotesk, ui-monospace, SFMono-Regular, Menlo, monospace",
  textTransform: "uppercase"
};

const createButtonSx = {
  borderRadius: 0,
  minWidth: 118,
  bgcolor: "#00f0ff",
  color: "#02121b",
  fontFamily: "Space Grotesk, ui-monospace, SFMono-Regular, Menlo, monospace",
  textTransform: "uppercase",
  "&:hover": {
    bgcolor: "#54f0ff"
  }
};

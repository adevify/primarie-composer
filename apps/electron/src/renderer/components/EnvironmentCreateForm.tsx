import {
  Alert,
  Box,
  Button,
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
import { FormEvent, useState } from "react";

type EnvironmentCreateFormProps = {
  open: boolean;
  disabled: boolean;
  loading: boolean;
  error?: string;
  onCancel: () => void;
  onCreate: (input: { seed: string; useCurrentRepoState: boolean }) => Promise<void>;
};

const databaseSidOptions = [
  { label: "ORCL_PROD_MASTER", seed: "default" }
];

const createSteps = [
  { label: "Preparing environment", state: "done" },
  { label: "Creating folder", state: "done" },
  { label: "Starting Docker Compose", state: "active" },
  { label: "Registering proxy URLs", state: "pending" },
  { label: "Ready", state: "pending" }
] as const;

export function EnvironmentCreateForm({ open, disabled, loading, error, onCancel, onCreate }: EnvironmentCreateFormProps) {
  const [seed, setSeed] = useState(databaseSidOptions[0].seed);
  const [environmentName, setEnvironmentName] = useState("");

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    await onCreate({
      seed: seed.trim() || "default",
      useCurrentRepoState: true
    });
  }

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
            border: "1px solid rgba(113, 136, 165, 0.42)",
            backgroundImage: "none",
            bgcolor: "#151925",
            boxShadow: "0 26px 90px rgba(0, 0, 0, 0.62)"
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
          bgcolor: "#1b2429",
          borderBottom: "1px solid rgba(113, 136, 165, 0.4)"
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center" minWidth={0}>
          <Box sx={{ width: 24, height: 24, display: "grid", placeItems: "center", color: "#00e5ff" }}>
            <AddBoxIcon fontSize="small" />
          </Box>
          <Typography
            fontWeight={900}
            color="#00e5ff"
            sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: 3 }}
          >
            CREATE ENVIRONMENT
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1.2} alignItems="center">
          <Typography
            variant="caption"
            color="rgba(0, 229, 255, 0.48)"
            sx={{ display: { xs: "none", sm: "block" }, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          >
            SYSTEM_OVERRIDE_ACTIVE
          </Typography>
          <IconButton aria-label="Close create environment modal" onClick={onCancel} disabled={loading} sx={{ color: "#9fb3c3" }}>
            <CloseIcon />
          </IconButton>
        </Stack>
      </Box>

      <DialogContent sx={{ px: 3, py: 4, bgcolor: "#151925" }}>
        <Stack spacing={3}>
          {error ? <Alert severity="error">{error}</Alert> : null}

          <Stack spacing={1.4}>
            <FieldLabel>Select database SID</FieldLabel>
            <Select
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
              disabled={disabled || loading}
              IconComponent={ExpandMoreIcon}
              sx={fieldSx}
            >
              {databaseSidOptions.map((option) => (
                <MenuItem key={option.seed} value={option.seed}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </Stack>

          <Stack spacing={1.4}>
            <FieldLabel>Environment name</FieldLabel>
            <TextField
              value={environmentName}
              onChange={(event) => setEnvironmentName(event.target.value)}
              placeholder="e.g. dev-cluster-west-01"
              disabled={disabled || loading}
              sx={fieldSx}
            />
          </Stack>

          <Stack spacing={2} sx={{ border: "1px solid rgba(113, 136, 165, 0.42)", bgcolor: "#0e2420", px: 2.5, py: 2.25 }}>
            {createSteps.map((step) => (
              <Stack key={step.label} direction="row" spacing={1.5} alignItems="center">
                {step.state === "done" ? (
                  <CheckCircleOutlineIcon sx={{ color: "#55ffcf", fontSize: 20 }} />
                ) : step.state === "active" && loading ? (
                  <CircularProgress size={20} thickness={5} sx={{ color: "#00e5ff" }} />
                ) : (
                  <RadioButtonUncheckedIcon sx={{ color: step.state === "active" ? "#00e5ff" : "#6f879d", fontSize: 20 }} />
                )}
                <Typography
                  fontWeight={step.state === "active" ? 900 : 500}
                  color={step.state === "active" ? "#00e5ff" : step.state === "pending" ? "#71889e" : "text.primary"}
                  fontStyle={step.state === "pending" ? "italic" : "normal"}
                  sx={{ fontSize: 14 }}
                >
                  {step.label}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2.25, bgcolor: "#1b2429", borderTop: "1px solid rgba(113, 136, 165, 0.32)" }}>
        <Button onClick={onCancel} disabled={loading} sx={ghostButtonSx}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={disabled || loading} sx={createButtonSx}>
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
      sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: 2, textTransform: "uppercase" }}
    >
      {children}
    </Typography>
  );
}

const fieldSx = {
  "& .MuiInputBase-root": {
    borderRadius: 0,
    bgcolor: "#0d211f",
    color: "text.primary",
    fontSize: 18,
    minHeight: 48
  },
  "& .MuiOutlinedInput-notchedOutline": {
    borderColor: "rgba(113, 136, 165, 0.55)"
  },
  "&:hover .MuiOutlinedInput-notchedOutline": {
    borderColor: "rgba(0, 229, 255, 0.55)"
  },
  "& .Mui-focused .MuiOutlinedInput-notchedOutline": {
    borderColor: "#00e5ff"
  },
  "& input::placeholder": {
    color: "#66819c",
    opacity: 1
  },
  "& .MuiSelect-icon": {
    color: "#9fb3c3"
  }
};

const ghostButtonSx = {
  color: "#c7d4e2",
  px: 3,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  letterSpacing: 1.5,
  textTransform: "uppercase"
};

const createButtonSx = {
  borderRadius: 0,
  minWidth: 118,
  bgcolor: "#18dced",
  color: "#02121b",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  letterSpacing: 1.5,
  textTransform: "uppercase",
  "&:hover": {
    bgcolor: "#54f0ff"
  }
};

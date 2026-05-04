import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: "#1d63ed"
    },
    secondary: {
      main: "#00a389"
    },
    background: {
      default: "#11191f",
      paper: "#17232c"
    },
    text: {
      primary: "#edf4fa",
      secondary: "#9fb3c3"
    },
    divider: "rgba(159, 179, 195, 0.18)",
    success: {
      main: "#00a389"
    },
    warning: {
      main: "#f5a524"
    }
  },
  shape: {
    borderRadius: 6
  },
  typography: {
    fontFamily: [
      "Inter",
      "-apple-system",
      "BlinkMacSystemFont",
      "Segoe UI",
      "sans-serif"
    ].join(",")
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: "#11191f"
        },
        "*": {
          scrollbarColor: "#405362 #11191f"
        }
      }
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: "1px solid rgba(159, 179, 195, 0.14)",
          boxShadow: "none"
        }
      }
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 700
        }
      }
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 700
        }
      }
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: "rgba(159, 179, 195, 0.16)"
        }
      }
    }
  }
});

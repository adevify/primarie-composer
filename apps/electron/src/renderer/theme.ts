import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: "#00f0ff",
      contrastText: "#002022"
    },
    secondary: {
      main: "#4edea3",
      contrastText: "#002113"
    },
    background: {
      default: "#0d1515",
      paper: "#192122"
    },
    text: {
      primary: "#dce4e5",
      secondary: "#b9cacb"
    },
    divider: "#3b494b",
    success: {
      main: "#4edea3"
    },
    warning: {
      main: "#fed639"
    },
    error: {
      main: "#ffb4ab"
    }
  },
  shape: {
    borderRadius: 0
  },
  typography: {
    fontFamily: [
      "Inter",
      "-apple-system",
      "BlinkMacSystemFont",
      "Segoe UI",
      "sans-serif"
    ].join(","),
    h4: {
      fontSize: 24,
      lineHeight: "32px",
      fontWeight: 600,
      letterSpacing: 0
    },
    h6: {
      fontSize: 18,
      lineHeight: "24px",
      fontWeight: 600,
      letterSpacing: 0
    },
    body1: {
      fontSize: 14,
      lineHeight: "20px"
    },
    body2: {
      fontSize: 14,
      lineHeight: "20px"
    },
    caption: {
      fontSize: 11,
      lineHeight: "16px"
    }
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: "#0d1515"
        },
        "*": {
          scrollbarColor: "#3b494b #080f10"
        },
        "::selection": {
          backgroundColor: "rgba(0, 240, 255, 0.28)"
        }
      }
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: "1px solid #3b494b",
          borderRadius: 0,
          boxShadow: "none",
          backgroundImage: "none"
        }
      }
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 700,
          borderRadius: 0,
          boxShadow: "none"
        },
        contained: {
          boxShadow: "none",
          "&:hover": {
            boxShadow: "none"
          }
        },
        outlined: {
          borderColor: "#3b494b"
        }
      }
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 700,
          borderRadius: 2,
          border: "1px solid #3b494b",
          fontFamily: "Space Grotesk, ui-monospace, SFMono-Regular, Menlo, monospace"
        }
      }
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: "#3b494b"
        },
        head: {
          backgroundColor: "#232b2c",
          color: "#b9cacb",
          fontFamily: "Space Grotesk, ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 11,
          lineHeight: "16px",
          fontWeight: 700,
          textTransform: "uppercase"
        }
      }
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            borderRadius: 0,
            backgroundColor: "#151d1e",
            "& fieldset": {
              borderColor: "#3b494b"
            },
            "&:hover fieldset": {
              borderColor: "#849495"
            },
            "&.Mui-focused fieldset": {
              borderColor: "#00f0ff"
            }
          }
        }
      }
    },
    MuiTabs: {
      styleOverrides: {
        indicator: {
          height: 2,
          backgroundColor: "#00f0ff"
        }
      }
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          height: 2,
          borderRadius: 0,
          backgroundColor: "#2e3637"
        }
      }
    }
  }
});

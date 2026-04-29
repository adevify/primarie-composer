import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#2457a6"
    },
    secondary: {
      main: "#117865"
    },
    background: {
      default: "#f5f7fb"
    }
  },
  shape: {
    borderRadius: 8
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
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: "0 1px 3px rgba(15, 23, 42, 0.08)"
        }
      }
    }
  }
});

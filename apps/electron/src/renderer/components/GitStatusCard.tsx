import { Alert, Box, Card, CardContent, Chip, CircularProgress, Divider, List, ListItem, Stack, Tooltip, Typography } from "@mui/material";
import ArticleIcon from "@mui/icons-material/Article";
import CodeIcon from "@mui/icons-material/Code";
import CssIcon from "@mui/icons-material/Css";
import DataObjectIcon from "@mui/icons-material/DataObject";
import DescriptionIcon from "@mui/icons-material/Description";
import HtmlIcon from "@mui/icons-material/Html";
import ImageIcon from "@mui/icons-material/Image";
import JavascriptIcon from "@mui/icons-material/Javascript";
import LockIcon from "@mui/icons-material/Lock";
import SettingsIcon from "@mui/icons-material/Settings";
import StorageIcon from "@mui/icons-material/Storage";
import TableChartIcon from "@mui/icons-material/TableChart";
import TerminalIcon from "@mui/icons-material/Terminal";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import type { SvgIconComponent } from "@mui/icons-material";
import type { GitState } from "../types";

type GitStatusCardProps = {
  gitState?: GitState;
  loading: boolean;
  error?: string;
};

export function GitStatusCard({ gitState, loading, error }: GitStatusCardProps) {
  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
            <Typography variant="h6">Git status</Typography>
            {loading ? (
              <CircularProgress size={20} />
            ) : gitState ? (
              <Chip
                label={gitState.changedFiles.length ? `${gitState.changedFiles.length} changed` : "No changes"}
                color={gitState.changedFiles.length ? "warning" : "success"}
              />
            ) : null}
          </Stack>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {gitState ? (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-all" }}>
                {gitState.branch} @ {gitState.commit.slice(0, 12)}
              </Typography>
              <Divider />
              <List dense disablePadding>
                {gitState.changedFiles.length === 0 ? (
                  <ListItem disableGutters>
                    <Typography variant="body2" color="text.secondary">
                      No changed files
                    </Typography>
                  </ListItem>
                ) : (
                  gitState.changedFiles.slice(0, 8).map((file) => (
                    <Tooltip key={file} title={file} placement="right">
                      <ListItem disableGutters sx={{ py: 0.35 }}>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                          <FileExtensionIcon path={file} />
                          <Typography variant="body2" noWrap title={fileName(file)} sx={{ minWidth: 0 }}>
                            {fileName(file)}
                          </Typography>
                        </Stack>
                      </ListItem>
                    </Tooltip>
                  ))
                )}
              </List>
              {gitState.changedFiles.length > 8 ? (
                <Typography variant="caption" color="text.secondary">
                  +{gitState.changedFiles.length - 8} more
                </Typography>
              ) : null}
            </>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

function FileExtensionIcon({ path }: { path: string }) {
  const fileType = fileTypeIcon(path);
  const Icon = fileType.icon;
  return (
    <Tooltip title={fileType.label} placement="left">
      <Box
        component="span"
        sx={{
          width: 26,
          height: 26,
          borderRadius: 0.75,
          bgcolor: `${fileType.color}22`,
          border: `1px solid ${fileType.color}55`,
          color: fileType.color,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0
        }}
      >
        <Icon sx={{ fontSize: 17 }} />
      </Box>
    </Tooltip>
  );
}

function fileName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

type FileTypeIcon = {
  icon: SvgIconComponent;
  label: string;
  color: string;
};

function fileTypeIcon(path: string): FileTypeIcon {
  const name = fileName(path);
  const lowerName = name.toLowerCase();

  if (lowerName === "dockerfile" || lowerName.startsWith("dockerfile.")) return icon(ViewInArIcon, "Docker", "#2496ed");
  if (lowerName === ".env" || lowerName.startsWith(".env.")) return icon(SettingsIcon, "Environment", "#00a389");
  if (lowerName === "package.json") return icon(DataObjectIcon, "Package JSON", "#cb3837");
  if (lowerName === "tsconfig.json") return icon(CodeIcon, "TypeScript config", "#3178c6");
  if (lowerName === "vite.config.ts" || lowerName === "electron.vite.config.ts") return icon(SettingsIcon, "Vite config", "#bd34fe");

  const extension = lowerName.includes(".") ? lowerName.split(".").at(-1) : "";
  switch (extension) {
    case "ts":
    case "tsx":
      return icon(CodeIcon, "TypeScript", "#3178c6");
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return icon(JavascriptIcon, "JavaScript", "#f7df1e");
    case "html":
      return icon(HtmlIcon, "HTML", "#e34f26");
    case "css":
      return icon(CssIcon, "CSS", "#1572b6");
    case "scss":
    case "sass":
      return icon(CssIcon, "Sass", "#cc6699");
    case "json":
      return icon(DataObjectIcon, "JSON", "#f5a524");
    case "md":
    case "mdx":
      return icon(ArticleIcon, "Markdown", "#9fb3c3");
    case "yml":
    case "yaml":
      return icon(SettingsIcon, "YAML", "#cb171e");
    case "sh":
    case "bash":
    case "zsh":
      return icon(TerminalIcon, "Shell", "#00a389");
    case "sql":
      return icon(StorageIcon, "SQL", "#4aa3ff");
    case "svg":
      return icon(ImageIcon, "SVG", "#ffb13b");
    case "png":
    case "jpg":
    case "jpeg":
    case "webp":
    case "gif":
      return icon(ImageIcon, "Image", "#d946ef");
    case "lock":
      return icon(LockIcon, "Lockfile", "#9fb3c3");
    case "toml":
      return icon(SettingsIcon, "TOML", "#9c4221");
    case "xml":
      return icon(CodeIcon, "XML", "#ff7a00");
    case "prisma":
      return icon(StorageIcon, "Prisma", "#5a67d8");
    case "csv":
    case "xls":
    case "xlsx":
      return icon(TableChartIcon, "Table", "#22c55e");
    default:
      return icon(extension ? DescriptionIcon : ArticleIcon, extension ? extension.toUpperCase() : "File", "#9fb3c3");
  }
}

function icon(iconComponent: SvgIconComponent, label: string, color: string): FileTypeIcon {
  return { icon: iconComponent, label, color };
}

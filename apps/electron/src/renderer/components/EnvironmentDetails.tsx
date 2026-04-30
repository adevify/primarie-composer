import { Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, List, ListItem, ListItemText, Stack, Typography } from "@mui/material";
import type { EnvironmentRecord } from "../types";

type EnvironmentDetailsProps = {
  environment?: EnvironmentRecord;
  open: boolean;
  onClose: () => void;
};

export function EnvironmentDetails({ environment, open, onClose }: EnvironmentDetailsProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Environment details</DialogTitle>
      <DialogContent>
        {environment ? (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h6">{environment.key}</Typography>
              <Chip label={environment.status} color={environment.status === "running" ? "success" : "default"} />
            </Stack>
            <List dense>
              <ListItem>
                <ListItemText primary="Seed" secondary={environment.seed} />
              </ListItem>
              <ListItem>
                <ListItemText primary="Port" secondary={environment.port ?? "n/a"} />
              </ListItem>
              <ListItem>
                <ListItemText primary="Runtime path" secondary={environment.runtimePath ?? "n/a"} secondaryTypographyProps={{ sx: { wordBreak: "break-all" } }} />
              </ListItem>
              <ListItem>
                <ListItemText primary="Source" secondary={`${environment.branch ?? "n/a"} @ ${environment.commit ?? "n/a"}`} secondaryTypographyProps={{ sx: { wordBreak: "break-all" } }} />
              </ListItem>
              <ListItem>
                <ListItemText primary="Owner" secondary={environment.createdBy?.name ?? "Unknown"} />
              </ListItem>
              {environment.pullRequest ? (
                <ListItem>
                  <ListItemText
                    primary={`GitHub PR #${environment.pullRequest.number}`}
                    secondary={environment.pullRequest.url}
                    secondaryTypographyProps={{ sx: { wordBreak: "break-all" } }}
                  />
                </ListItem>
              ) : null}
            </List>
            <Divider />
            <Stack spacing={0.5}>
              <Typography variant="subtitle2">Domains</Typography>
              {(environment.domains ?? buildDomains(environment)).map((domain) => (
                <Typography key={domain} variant="body2">
                  {domain}
                </Typography>
              ))}
            </Stack>
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function buildDomains(environment: EnvironmentRecord): string[] {
  return [
    `admin.${environment.key}.prmr.md`,
    `api.${environment.key}.prmr.md`,
  ];
}

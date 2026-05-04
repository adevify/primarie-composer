import { Card, CardContent, Chip, List, ListItem, Stack, Tooltip, Typography } from "@mui/material";

export type LatestChangeEvent = {
  id: string;
  path: string;
  status: string;
  at: string;
  warning?: string;
};

type LatestChangesCardProps = {
  events: LatestChangeEvent[];
};

export function LatestChangesCard({ events }: LatestChangesCardProps) {
  return (
    <Card>
      <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Stack spacing={1.25}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Typography variant="caption" color="text.secondary" fontWeight={800}>
              Latest changes
            </Typography>
            <Chip size="small" label={events.length} />
          </Stack>
          <List dense disablePadding>
            {events.length === 0 ? (
              <ListItem disableGutters>
                <Typography variant="body2" color="text.secondary">
                  No file events yet.
                </Typography>
              </ListItem>
            ) : (
              events.map((event) => (
                <Tooltip key={event.id} title={event.path} placement="right">
                  <ListItem disableGutters sx={{ py: 0.45 }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, width: "100%" }}>
                      <Chip size="small" label={event.status} color={event.warning ? "warning" : "default"} sx={{ width: 76 }} />
                      <Stack spacing={0.1} sx={{ minWidth: 0 }}>
                        <Typography variant="body2" noWrap>
                          {fileName(event.path)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {new Date(event.at).toLocaleTimeString()}
                        </Typography>
                      </Stack>
                    </Stack>
                  </ListItem>
                </Tooltip>
              ))
            )}
          </List>
        </Stack>
      </CardContent>
    </Card>
  );
}

function fileName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

import z from "zod";

export type EnvironmentStatus =
  | "creating"
  | "cloning"
  | "checking_out"
  | "applying_changes"
  | "starting"
  | "running"
  | "stopped"
  | "failed"
  | "removing"
  | "removed";
export type LifecycleAction = "start" | "stop" | "restart" | "resume" | "delete";

export type EnvironmentOwner = {
  email: string;
  name: string;
};

export const keySchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const changedFileSchema = z.object({
  path: z.string().min(1),
  status: z.enum(["modified", "added", "deleted"]),
  contentBase64: z.string().optional(),
  deleteConfirmed: z.boolean().optional()
});

export type ChangedFilePayload = z.infer<typeof changedFileSchema>;

export const sourceSchema = z.object({
  branch: z.string().min(1),
  commit: z.string().min(7),
  repoPath: z.string().min(1).optional()
});

export type EnvironmentSource = z.infer<typeof sourceSchema>;

export const syncFilesSchema = z.object({
  branch: z.string().min(1),
  commit: z.string().min(7),
  files: z.array(changedFileSchema).min(1),
  resetBeforeApply: z.boolean().optional()
});

export type SyncFilesPayload = z.infer<typeof syncFilesSchema>;

export const pullRequestSchema = z.object({
  title: z.string().optional(),
  url: z.string().url(),
});

export type PullRequestRef = z.infer<typeof pullRequestSchema>;

export const createEnvironmentSchema = z.object({
  seed: z.string().regex(/^[a-zA-Z0-9_-]+$/).default("default"),
  source: sourceSchema,
  env: z.record(z.string(), z.string()).default({}),
  changedFiles: z.array(changedFileSchema).default([])
});

export type CreateEnvironmentPayload = z.infer<typeof createEnvironmentSchema>;

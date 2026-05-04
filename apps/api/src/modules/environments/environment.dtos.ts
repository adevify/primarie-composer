import z from "zod";

export type EnvironmentStatus = "creating" | "running" | "stopped" | "error";

export type EnvironmentOwner = {
  email: string;
  name: string;
};

export const keySchema = z.string().regex(/^[a-z]+-[a-z]+$/);
export const changedFileSchema = z.object({
  path: z.string().min(1),
  status: z.enum(["modified", "added", "deleted"]),
  contentBase64: z.string().optional()
});

export type ChangedFilePayload = z.infer<typeof changedFileSchema>;

export const sourceSchema = z.object({
  branch: z.string().min(1),
  commit: z.string().min(7)
});

export type EnvironmentSource = z.infer<typeof sourceSchema>;

export const syncFilesSchema = z.object({
  branch: z.string().min(1),
  commit: z.string().min(7),
  files: z.array(changedFileSchema)
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
  env: z.record(z.string(), z.string()).default({})
});

export type CreateEnvironmentPayload = z.infer<typeof createEnvironmentSchema>;

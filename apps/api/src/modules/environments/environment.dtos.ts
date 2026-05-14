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
export const mongoCollectionNameSchema = z.string().regex(/^[A-Za-z0-9_.-]+$/).refine(
  (value) => !value.includes("..") && !value.startsWith("system."),
  "Invalid collection name."
);
const mongoJsonObjectSchema = z.record(z.string(), z.unknown());

export const mongoSearchDocumentsSchema = z.object({
  filter: mongoJsonObjectSchema.default({}),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sort: mongoJsonObjectSchema.default({ _id: -1 })
});
export type MongoSearchDocumentsPayload = z.infer<typeof mongoSearchDocumentsSchema>;

export const mongoInsertDocumentsSchema = z.object({
  documents: z.array(mongoJsonObjectSchema).min(1)
});
export type MongoInsertDocumentsPayload = z.infer<typeof mongoInsertDocumentsSchema>;

export const mongoDeleteDocumentsSchema = z.object({
  filter: mongoJsonObjectSchema,
  many: z.boolean().default(false),
  confirm: z.literal(true),
  allowEmptyFilter: z.boolean().optional()
});
export type MongoDeleteDocumentsPayload = z.infer<typeof mongoDeleteDocumentsSchema>;

export const mongoUpdateDocumentsSchema = z.object({
  filter: mongoJsonObjectSchema,
  update: mongoJsonObjectSchema,
  many: z.boolean().default(false),
  confirm: z.literal(true),
  allowEmptyFilter: z.boolean().optional()
});
export type MongoUpdateDocumentsPayload = z.infer<typeof mongoUpdateDocumentsSchema>;

export const gitPatchSchema = z.object({
  mode: z.enum(["delta", "full"]),
  data: z.string(),
  previousSha256: z.string().regex(/^[a-f0-9]{64}$/),
  currentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  currentSizeBytes: z.number().int().nonnegative(),
  changedFiles: z.array(z.string()).default([]),
  isEmpty: z.boolean()
});

export type GitPatchPayload = z.infer<typeof gitPatchSchema>;

export const sourceSchema = z.object({
  branch: z.string().min(1),
  commit: z.string().min(7)
});

export type EnvironmentSource = z.infer<typeof sourceSchema>;

export const syncFilesSchema = z.object({
  branch: z.string().min(1),
  commit: z.string().min(7),
  patch: gitPatchSchema,
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
  env: z.record(z.string(), z.string()).default({})
});

export type CreateEnvironmentPayload = z.infer<typeof createEnvironmentSchema>;

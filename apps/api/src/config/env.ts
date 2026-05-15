import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
dotenv.config({ path: path.join(workspaceRoot, ".env") });

const envSchema = z.object({
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("12h"),
  SIGNATURE_SECRET: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .min(1, "SIGNATURE_SECRET is required for production tenant imports")
      .optional(),
  ),
  SOURCE_REPO_URL: z.string().min(1, "SOURCE_REPO_URL is required"),
  BASE_ENV_PORT: z.coerce.number().int().positive().default(8001),
  ROOT_DOMAIN: z.string().default("prmr.md"),
  ROOT_DOMAIN_ALT: z.string().default("advf.md"),
  PROXY_UPSTREAM_HOST: z.string().default("auto"),
  RUNTIME_DIR: z
    .string()
    .default(path.resolve(workspaceRoot, "runtime/environments")),
  SEEDS_DIR: z.string().default(path.resolve(workspaceRoot, "seeds")),
  HOST_RUNTIME_DIR: z
    .string()
    .default(path.resolve(workspaceRoot, "runtime/environments")),
  HOST_SEEDS_DIR: z.string().default(path.resolve(workspaceRoot, "seeds")),
  BUS_PIPE_PATH: z.string().default("/bus/actions.pipe"),
  BUS_ACKS_DIR: z.string().default("/bus/acks"),
  BUS_RESULTS_DIR: z.string().default("/bus/results"),
  BUS_LOGS_DIR: z.string().default("/bus/logs"),
  BUS_WORKER_READY_PATH: z.string().default("/bus/worker.ready"),
  BUS_ACTION_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  BUS_LONG_ACTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(900_000),
  BUS_ACTION_ACCEPT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(10_000),
  BUS_PIPE_WRITE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  BUS_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(200),
});

export const env = envSchema.parse(process.env);

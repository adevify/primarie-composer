import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
dotenv.config({ path: path.join(workspaceRoot, ".env") });

const envSchema = z.object({
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("12h"),
  SOURCE_REPO_URL: z.string().min(1, "SOURCE_REPO_URL is required"),
  BASE_ENV_PORT: z.coerce.number().int().positive().default(8001),
  ROOT_DOMAIN: z.string().default("prmr.md"),
  PROXY_UPSTREAM_HOST: z.string().default("auto"),
  RUNTIME_DIR: z.string().default(path.resolve(workspaceRoot, "runtime/environments")),
  TEMPLATE_DIR: z.string().default(path.resolve(workspaceRoot, "templates/environment")),
  SEEDS_DIR: z.string().default(path.resolve(workspaceRoot, "seeds")),
  HOST_RUNTIME_DIR: z.string().default(path.resolve(workspaceRoot, "runtime/environments")),
  HOST_TEMPLATE_DIR: z.string().default(path.resolve(workspaceRoot, "templates/environment")),
  HOST_SEEDS_DIR: z.string().default(path.resolve(workspaceRoot, "seeds")),
  BUS_PIPE_PATH: z.string().default("/bus/actions.pipe"),
  BUS_RESULTS_DIR: z.string().default("/bus/results"),
  BUS_LOGS_DIR: z.string().default("/bus/logs"),
  BUS_WORKER_READY_PATH: z.string().default("/bus/worker.ready"),
  BUS_ACTION_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  BUS_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(200)
});

export const env = envSchema.parse(process.env);

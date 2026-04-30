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
  RUNTIME_DIR: z.string().default(path.resolve(workspaceRoot, "runtime/environments")),
  TEMPLATE_DIR: z.string().default(path.resolve(workspaceRoot, "templates/environment")),
  SEEDS_DIR: z.string().default(path.resolve(workspaceRoot, "seeds"))
});

export const env = envSchema.parse(process.env);

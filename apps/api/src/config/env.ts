import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const workspaceRoot = path.resolve(appRoot, "../..");

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  MONGO_URI: z.string().default("mongodb://mongo:27017/primarie_composer"),
  MONGO_DB_NAME: z.string().default("primarie_composer"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("12h"),
  ELECTRON_ACCESS_KEY: z.string().min(8, "ELECTRON_ACCESS_KEY must be at least 8 characters"),
  BASE_ENV_PORT: z.coerce.number().int().positive().default(8001),
  ROOT_DOMAIN: z.string().default("prmr.md"),
  RUNTIME_DIR: z.string().default(path.resolve(workspaceRoot, "runtime/environments")),
  TEMPLATE_DIR: z.string().default(path.resolve(workspaceRoot, "templates/environment")),
  SEEDS_DIR: z.string().default(path.resolve(workspaceRoot, "seeds"))
});

export const env = envSchema.parse(process.env);

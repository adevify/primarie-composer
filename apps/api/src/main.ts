import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";
import { connectMongo, closeMongo } from "./db/mongo.js";
import { createAuthRouter } from "./modules/auth/auth.routes.js";
import { createEnvironmentRouter } from "./modules/environments/environments.routes.js";
import { authenticateJwt } from "./modules/auth/auth.middleware.js";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "primarie-composer-api" });
});

app.use("/auth", createAuthRouter());
app.use("/environments", authenticateJwt, createEnvironmentRouter());

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "Unexpected error";
  const status = typeof err === "object" && err !== null && "status" in err ? Number((err as { status: unknown }).status) : 500;
  res.status(Number.isInteger(status) && status >= 400 ? status : 500).json({ error: message });
});

await connectMongo();

const server = app.listen(env.PORT, () => {
  console.log(`primarie-composer API listening on :${env.PORT}`);
});

const shutdown = async () => {
  server.close(async () => {
    await closeMongo();
    process.exit(0);
  });
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

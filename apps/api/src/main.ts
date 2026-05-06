import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createAuthRouter } from "./modules/auth/auth.routes.js";
import { createEnvironmentRouter } from "./modules/environments/environments.routes.js";
import { authenticateJwt } from "./modules/auth/auth.middleware.js";
import { createProxyRouter } from "./modules/proxy/proxy.routes.js";
import { connect, disconnect } from "./db/client.js";
import { EnvironmentActionCollection } from "./db/environment-actions.js";

const app = express();

app.set("trust proxy", 1);

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "25mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "primarie-composer-api" });
});

app.use("/auth", createAuthRouter());
app.use("/proxy", createProxyRouter());
app.use("/environments", authenticateJwt, createEnvironmentRouter());

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "Unexpected error";
  const status = typeof err === "object" && err !== null && "status" in err ? Number((err as { status: unknown }).status) : 500;
  res.status(Number.isInteger(status) && status >= 400 ? status : 500).json({ error: message });
});

await connect();
await EnvironmentActionCollection.ensureIndexes();

const server = await app.listen(80);
console.log(`primarie-composer API listening on :80`);

const shutdown = async () => {
  await disconnect();
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

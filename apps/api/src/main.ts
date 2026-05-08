import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createAuthRouter } from "./modules/auth/auth.routes.js";
import { createEnvironmentRouter } from "./modules/environments/environments.routes.js";
import { authenticateJwt } from "./modules/auth/auth.middleware.js";
import { createProxyRouter } from "./modules/proxy/proxy.routes.js";
import { connect, disconnect } from "./db/client.js";
import { EnvironmentActionCollection } from "./db/environment-actions.js";
import { HostActionBusService } from "./services/bus/HostActionBusService.js";

const app = express();
const bus = new HostActionBusService();

app.set("trust proxy", 1);

app.use(helmet());
app.use(express.json({ limit: "25mb" }));

app.get("/health", async (_req, res, next) => {
  try {
    const actionBus = await bus.health();
    if (!actionBus.ready) {
      logApi("warn", "health_checked", { actionBusReady: actionBus.ready, actionBusReason: actionBus.reason });
    }
    res.json({ ok: true, service: "primarie-composer-api", actionBus });
  } catch (error) {
    next(error);
  }
});

app.use("/auth", createAuthRouter());
app.use("/proxy", createProxyRouter());
app.use("/environments", authenticateJwt, createEnvironmentRouter());

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "Unexpected error";
  const status = typeof err === "object" && err !== null && "status" in err ? Number((err as { status: unknown }).status) : 500;
  logApi(status >= 500 ? "error" : "warn", "request_failed", { status, message });
  res.status(Number.isInteger(status) && status >= 400 ? status : 500).json({ error: message });
});

await connect();
logApi("info", "database_connected", {});
await EnvironmentActionCollection.ensureIndexes();
logApi("info", "indexes_ready", {});

const server = await app.listen(80);
logApi("info", "listening", { port: 80 });

const shutdown = async () => {
  logApi("info", "shutdown_started", {});
  await disconnect();
  server.close(() => {
    logApi("info", "shutdown_completed", {});
    process.exit(0);
  });
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

function logApi(level: "info" | "warn" | "error", event: string, details: Record<string, unknown>): void {
  console[level](JSON.stringify({
    at: new Date().toISOString(),
    scope: "api",
    event,
    ...details
  }));
}

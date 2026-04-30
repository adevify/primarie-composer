import { Router } from "express";
import type { Request } from "express";
import { env } from "../../config/env.js";
import { EnvironmentCollection } from "../../db/environments.js";

const keyPattern = /^[a-z0-9]{4,12}$/;

export function createProxyRouter(): Router {
  const router = Router();

  router.get("/authorize", async (req, res, next) => {
    try {
      const host = getOriginalHost(req);
      if (!host) {
        return res.status(403).json({ allowed: false, reason: "Missing host" });
      }

      const parsed = parseEnvironmentHost(host);
      if (!parsed) {
        return res.status(403).json({ allowed: false, reason: "Host is outside configured root domain" });
      }

      const record = await EnvironmentCollection.get(parsed.environmentKey);
      if (!record || record.status !== "running") {
        return res.status(403).json({ allowed: false, reason: "Environment is not running" });
      }

      res.setHeader("x-environment-key", record.key);
      res.setHeader("x-environment-port", String(record.port));
      res.setHeader("x-environment-subdomain", parsed.subdomain);
      res.setHeader("x-upstream-host", `${parsed.subdomain}.${env.ROOT_DOMAIN}`);
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

function getOriginalHost(req: Request): string | null {
  const header = req.header("x-original-host") ?? req.header("host");
  if (!header) {
    return null;
  }
  return header.split(":")[0].toLowerCase();
}

function parseEnvironmentHost(host: string): { environmentKey: string; subdomain: string } | null {
  const hostLabels = host.split(".").filter(Boolean);
  const rootLabels = env.ROOT_DOMAIN.toLowerCase().split(".").filter(Boolean);

  if (hostLabels.length <= rootLabels.length) {
    return null;
  }

  const hostRoot = hostLabels.slice(-rootLabels.length).join(".");
  if (hostRoot !== rootLabels.join(".")) {
    return null;
  }

  const subdomainLabels = hostLabels.slice(0, -rootLabels.length);
  if (subdomainLabels.length < 2) {
    return null;
  }

  const environmentKey = subdomainLabels.at(-1);
  if (!environmentKey || !keyPattern.test(environmentKey)) {
    return null;
  }

  return {
    environmentKey,
    subdomain: subdomainLabels.slice(0, -1).join(".")
  };
}

import dns from "node:dns/promises";
import fs from "node:fs/promises";
import net from "node:net";
import { Router } from "express";
import type { Request } from "express";
import { env } from "../../config/env.js";
import { EnvironmentCollection } from "../../db/environments.js";

const keyPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function createProxyRouter(): Router {
  const router = Router();

  router.get("/authorize", async (req, res, next) => {
    const requestId = req.header("x-request-id") ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      const host = getOriginalHost(req);
      if (!host) {
        logProxyDecision("warn", requestId, "deny", { reason: "missing_host" });
        return res.status(403).json({ allowed: false, reason: "Missing host" });
      }

      const parsed = parseEnvironmentHost(host);
      if (!parsed) {
        logProxyDecision("warn", requestId, "deny", {
          host,
          reason: "host_parse_failed",
          rootDomain: env.ROOT_DOMAIN
        });
        return res.status(403).json({ allowed: false, reason: "Host is outside configured root domain" });
      }

      const record = await EnvironmentCollection.getSilent(parsed.environmentKey);
      if (!record) {
        logProxyDecision("warn", requestId, "deny", {
          host,
          parsed,
          reason: "environment_not_found"
        });
        return res.status(404).json({ allowed: false, reason: "Environment not found" });
      }

      if (record.status !== "running") {
        logProxyDecision("warn", requestId, "deny", {
          host,
          parsed,
          environmentStatus: record.status,
          reason: "environment_not_running"
        });
        return res.status(503).json({ allowed: false, reason: "Environment is not running" });
      }

      const upstreamHost = await resolveProxyUpstreamHost(env.PROXY_UPSTREAM_HOST);
      const serviceHost = `${parsed.subdomain}.${env.ROOT_DOMAIN}`;
      logProxyDecision("info", requestId, "allow", {
        host,
        parsed,
        environmentStatus: record.status,
        environmentPort: record.port,
        upstreamHost,
        serviceHost
      });

      res.setHeader("x-environment-key", record.key);
      res.setHeader("x-environment-port", String(record.port));
      res.setHeader("x-environment-subdomain", parsed.subdomain);
      res.setHeader("x-upstream-host", upstreamHost);
      res.setHeader("x-service-host", serviceHost);
      return res.status(204).send();
    } catch (error) {
      logProxyDecision("error", requestId, "error", {
        reason: error instanceof Error ? error.message : String(error)
      });
      return next(error);
    }
  });

  return router;
}

async function resolveProxyUpstreamHost(host: string): Promise<string> {
  if (host === "auto" || host === "host.docker.internal") {
    return readDefaultGatewayAddress();
  }

  if (net.isIP(host)) {
    return host;
  }

  const result = await dns.lookup(host, { family: 4 });
  return result.address;
}

async function readDefaultGatewayAddress(): Promise<string> {
  const routeTable = await fs.readFile("/proc/net/route", "utf8");
  const defaultRoute = routeTable
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .find((columns) => columns[1] === "00000000" && columns[2]);

  if (!defaultRoute?.[2]) {
    throw new Error("Unable to resolve Docker gateway from /proc/net/route");
  }

  return littleEndianHexToIpv4(defaultRoute[2]);
}

function littleEndianHexToIpv4(value: string): string {
  const bytes = value.match(/../g);
  if (!bytes || bytes.length !== 4) {
    throw new Error(`Invalid gateway address: ${value}`);
  }

  return bytes.reverse().map((byte) => Number.parseInt(byte, 16)).join(".");
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
  const hyphenSafeHost = parseHyphenSafeEnvironmentHost(subdomainLabels);
  if (hyphenSafeHost) {
    return hyphenSafeHost;
  }

  return null;
}

function parseHyphenSafeEnvironmentHost(subdomainLabels: string[]): { environmentKey: string; subdomain: string } | null {
  if (subdomainLabels.length !== 1) {
    return null;
  }

  const separatorIndex = subdomainLabels[0].indexOf("-");
  if (separatorIndex <= 0 || separatorIndex === subdomainLabels[0].length - 1) {
    return null;
  }

  const subdomain = subdomainLabels[0].slice(0, separatorIndex);
  const environmentKey = subdomainLabels[0].slice(separatorIndex + 1);
  if (!keyPattern.test(environmentKey)) {
    return null;
  }

  return { environmentKey, subdomain };
}

function logProxyDecision(level: "info" | "warn" | "error", requestId: string, decision: string, details: Record<string, unknown>): void {
  const payload = {
    at: new Date().toISOString(),
    scope: "proxy.authorize",
    requestId,
    decision,
    ...details
  };

  console[level](JSON.stringify(payload));
}

import { randomUUID } from "node:crypto";
import { Collection } from "mongodb";
import { collection } from "./client.js";

export type SystemLogLevel = "info" | "error" | "warn";
export type SystemLogSource = "api" | "worker" | "electron" | "github" | "system";

export type SystemLogActor = {
  type: "user" | "system" | "github";
  email?: string;
  name?: string;
  url?: string;
};

export type SystemLogTarget = {
  type: "environment" | "pull_request" | "system";
  environmentKey?: string;
  pullRequestUrl?: string;
};

export type SystemLogRecord = {
  id: string;
  createdAt: Date;
  level: SystemLogLevel;
  event: string;
  message: string;
  source: SystemLogSource;
  actor?: SystemLogActor;
  target?: SystemLogTarget;
  environmentKey?: string;
  actionId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
};

export const SystemLogCollection = (() => {
  const withCol = async <T>(action: (col: Collection<SystemLogRecord>) => Promise<T>) => {
    const col = await collection<SystemLogRecord>("logs");
    return action(col);
  };

  return {
    add: async (log: Omit<SystemLogRecord, "id" | "createdAt" | "level" | "source" | "environmentKey"> & Partial<Pick<SystemLogRecord, "id" | "createdAt" | "level" | "source" | "environmentKey">>) => {
      const environmentKey = log.environmentKey ?? (log.target?.type === "environment" ? log.target.environmentKey : undefined);
      return withCol(col => col.insertOne({
        ...log,
        id: log.id ?? randomUUID(),
        createdAt: log.createdAt ?? new Date(),
        level: log.level ?? "info",
        source: log.source ?? "api",
        environmentKey
      }));
    },
    list: async (page = 0, perPage = 100) => withCol(async col => {
      const total = await col.countDocuments({});

      return {
        total,
        page,
        perPage,
        pages: Math.ceil(total / perPage),
        items: await col.find({})
          .sort({ createdAt: -1 })
          .skip(page * perPage)
          .limit(perPage)
          .toArray()
      };
    }),
    listByEnvironment: async (environmentKey: string, page = 0, perPage = 50) => withCol(async col => {
      const total = await col.countDocuments({ environmentKey });

      return {
        total,
        page,
        perPage,
        pages: Math.ceil(total / perPage),
        items: await col.find({ environmentKey })
          .sort({ createdAt: -1 })
          .skip(page * perPage)
          .limit(perPage)
          .toArray()
      };
    }),
    actionIdsByEnvironment: async (environmentKey: string) => withCol(async col => {
      const actionIds = await col.distinct("actionId", {
        $or: [
          { environmentKey },
          { "target.environmentKey": environmentKey }
        ]
      });
      return actionIds.filter((actionId): actionId is string => typeof actionId === "string" && actionId.length > 0);
    }),
    ensureIndexes: async () => {
      await withCol(col => col.createIndex({ createdAt: -1 }));
      await withCol(col => col.createIndex({ environmentKey: 1, createdAt: -1 }));
      await withCol(col => col.createIndex({ event: 1, createdAt: -1 }));
      await withCol(col => col.createIndex({ "actor.email": 1, createdAt: -1 }));
      await withCol(col => col.createIndex({ "target.pullRequestUrl": 1, createdAt: -1 }));
      await withCol(col => col.createIndex({ correlationId: 1, createdAt: -1 }));
    }
  };
})();

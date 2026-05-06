import { Collection } from "mongodb";
import { collection } from "./client.js";
import type { LifecycleAction } from "../modules/environments/environment.dtos.js";

export type EnvironmentActionStatus = "queued" | "running" | "complete" | "error";

export type EnvironmentActionRecord = {
  id: string;
  environmentKey: string;
  action: LifecycleAction;
  status: EnvironmentActionStatus;
  requestedBy?: {
    email: string;
    name: string;
  };
  environment?: unknown;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
};

export type EnvironmentActionLog = {
  actionId: string;
  environmentKey: string;
  createdAt: Date;
  sequence: number;
  log: string;
  level: "info" | "error";
};

export const EnvironmentActionCollection = (() => {
  const withActionsCol = async <T>(action: (col: Collection<EnvironmentActionRecord>) => Promise<T>) => {
    const col = await collection<EnvironmentActionRecord>("environment-actions");
    return action(col);
  };

  const withLogsCol = async <T>(action: (col: Collection<EnvironmentActionLog>) => Promise<T>) => {
    const col = await collection<EnvironmentActionLog>("environment-action-logs");
    return action(col);
  };

  return {
    create: async (record: Omit<EnvironmentActionRecord, "createdAt" | "updatedAt">) => withActionsCol(col => col.insertOne({
      ...record,
      createdAt: new Date(),
      updatedAt: new Date()
    })),
    get: async (id: string) => withActionsCol(async col => {
      const record = await col.findOne({ id });
      if (!record) {
        throw Object.assign(new Error(`Environment action not found: ${id}`), { status: 404 });
      }
      return record;
    }),
    listByEnvironment: async (environmentKey: string, page = 0, perPage = 20) => withActionsCol(async col => {
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
    update: async (id: string, patch: Partial<Omit<EnvironmentActionRecord, "id" | "createdAt">>) => withActionsCol(async col => {
      await col.updateOne({ id }, { $set: { ...patch, updatedAt: new Date() } });
      const record = await col.findOne({ id });
      if (!record) {
        throw Object.assign(new Error(`Environment action not found: ${id}`), { status: 404 });
      }
      return record;
    }),
    addLog: async (log: Omit<EnvironmentActionLog, "createdAt" | "sequence">) => withLogsCol(async col => {
      const sequence = await col.countDocuments({ actionId: log.actionId });
      await col.insertOne({
        ...log,
        sequence,
        createdAt: new Date()
      });
    }),
    listLogs: async (actionId: string, page = 0, perPage = 100) => withLogsCol(async col => {
      const total = await col.countDocuments({ actionId });
      return {
        total,
        page,
        perPage,
        pages: Math.ceil(total / perPage),
        items: await col.find({ actionId })
          .sort({ sequence: 1 })
          .skip(page * perPage)
          .limit(perPage)
          .toArray()
      };
    }),
    listLogsAfter: async (actionId: string, afterSequence: number, limit = 100) => withLogsCol(col => col.find({
      actionId,
      sequence: { $gt: afterSequence }
    })
      .sort({ sequence: 1 })
      .limit(limit)
      .toArray()
    ),
    countLogs: async (actionId: string) => withLogsCol(col => col.countDocuments({ actionId })),
    ensureIndexes: async () => {
      await withActionsCol(col => col.createIndex({ id: 1 }, { unique: true }));
      await withActionsCol(col => col.createIndex({ environmentKey: 1, createdAt: -1 }));
      await withLogsCol(col => col.createIndex({ actionId: 1, sequence: 1 }, { unique: true }));
    }
  };
})();

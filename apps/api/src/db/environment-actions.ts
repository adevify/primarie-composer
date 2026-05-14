import { Collection } from "mongodb";
import { collection } from "./client.js";
import type { LifecycleAction } from "../modules/environments/environment.dtos.js";

export type EnvironmentActionStatus = "queued" | "running" | "complete" | "error";

export type EnvironmentActionLogFile = {
  path: string;
  driver: "file";
  createdAt: Date;
  updatedAt?: Date;
  sizeBytes?: number;
};

export type EnvironmentActionRecord = {
  id: string;
  environmentKey: string;
  action: LifecycleAction;
  status: EnvironmentActionStatus;
  requestedBy?: {
    email: string;
    name: string;
  };
  logFile: EnvironmentActionLogFile;
  environment?: unknown;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
};

export const EnvironmentActionCollection = (() => {
  const withActionsCol = async <T>(action: (col: Collection<EnvironmentActionRecord>) => Promise<T>) => {
    const col = await collection<EnvironmentActionRecord>("environment-actions");
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
    listAllByEnvironment: async (environmentKey: string) => withActionsCol(col => col.find({ environmentKey }).toArray()),
    findActiveByEnvironment: async (environmentKey: string) => withActionsCol(col => col.findOne(
      {
        environmentKey,
        status: { $in: ["queued", "running"] }
      },
      { sort: { createdAt: -1 } }
    )),
    update: async (id: string, patch: Partial<Omit<EnvironmentActionRecord, "id" | "createdAt">>) => withActionsCol(async col => {
      await col.updateOne({ id }, { $set: { ...patch, updatedAt: new Date() } });
      const record = await col.findOne({ id });
      if (!record) {
        throw Object.assign(new Error(`Environment action not found: ${id}`), { status: 404 });
      }
      return record;
    }),
    deleteByEnvironment: async (environmentKey: string, exceptId?: string) => withActionsCol(col => col.deleteMany({
      environmentKey,
      ...(exceptId ? { id: { $ne: exceptId } } : {})
    })),
    ensureIndexes: async () => {
      await withActionsCol(col => col.createIndex({ id: 1 }, { unique: true }));
      await withActionsCol(col => col.createIndex({ environmentKey: 1, createdAt: -1 }));
    }
  };
})();

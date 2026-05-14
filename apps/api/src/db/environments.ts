import { Collection } from "mongodb";
import type { EnvironmentOwner, EnvironmentStatus, EnvironmentSource, PullRequestRef } from "../modules/environments/environment.dtos.js";
import { collection } from "./client.js";

export type EnvironmentRecord = {
    key: string;
    port: number;
    status: EnvironmentStatus;
    seed: string;
    createdBy: EnvironmentOwner | PullRequestRef;
    source: EnvironmentSource;
    createdAt: Date;
    updatedAt: Date;
}

export const EnvironmentCollection = (() => {
    const interruptedCreateStatuses: EnvironmentStatus[] = ["creating", "cloning"];

    const withCol = async <T>(action: (col: Collection<EnvironmentRecord>) => Promise<T>) => {
        const col = await collection<EnvironmentRecord>("environments");
        return action(col);
    }

    const get = async (key: string) => {
        const record = await withCol(col => col.findOne({ key }));

        if (!record) {
            throw Object.assign(new Error(`Environment not found: ${key}`), { status: 404 });
        }

        return record;
    }

    return {
        get,
        getSilent: async (key: string) => withCol(col => col.findOne({ key })),
        list: async () => withCol(col => col.find({}).toArray()),
        create: async (record: Omit<EnvironmentRecord, "createdAt" | "updatedAt">) => withCol(col => col.insertOne({ ...record, createdAt: new Date(), updatedAt: new Date() })),
        failInterruptedCreates: async () => withCol(async col => {
            const records = await col.find({ status: { $in: interruptedCreateStatuses } }).toArray();
            if (records.length === 0) {
                return records;
            }

            await col.updateMany(
                { key: { $in: records.map((record) => record.key) } },
                { $set: { status: "failed", updatedAt: new Date() } }
            );

            return records;
        }),
        update: async (key: string, mutator: (record: EnvironmentRecord) => Partial<EnvironmentRecord>) => {
            const record = await get(key);

            await withCol(col => col.updateOne({ key }, { $set: { ...record, ...mutator(record), updatedAt: new Date() } }));

            return get(key);
        },
        delete: async (key: string) => withCol(col => col.deleteOne({ key }))
    }
})()

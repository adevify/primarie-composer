import { Collection } from "mongodb";
import { collection } from "./client.js";

export type EnvironmentLog = {
    environmentKey: string;
    createdAt: Date;
    log: string;
    level: "info" | "error" | "warn";
    system: boolean;
}

export const EnvironmentLogCollection = (() => {
    const withCol = async <T>(action: (col: Collection<EnvironmentLog>) => Promise<T>) => {
        const col = await collection<EnvironmentLog>("environments-logs");
        return action(col);
    }

    return {
        add: async (log: Omit<EnvironmentLog, "createdAt" | "system" | "level"> & Partial<Pick<EnvironmentLog, "system" | "level">>) => withCol(col => col.insertOne({
            system: false,
            level: "info",
            ...log,
            createdAt: new Date()
        })),
        list: async (key: string, page = 0, perPage = 50) => withCol(async col => {
            const total = await col.countDocuments({ environmentKey: key });

            return {
                total: total,
                page,
                perPage,
                pages: Math.ceil(total / perPage),
                items: await col.find({ environmentKey: key })
                    .sort({ createdAt: -1 })
                    .skip(page * perPage)
                    .limit(perPage)
                    .toArray(),
            };
        }),
    }
})()
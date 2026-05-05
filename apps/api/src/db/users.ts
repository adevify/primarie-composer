import type { Collection } from "mongodb";
import type { AuthenticatedUser } from "../modules/auth/auth.middleware.js";
import { collection } from "./client.js";

export type UserRecord = AuthenticatedUser & {
    password: string;
}

export type PublicUserRecord = AuthenticatedUser & {
    provisionedAt?: Date;
    role?: string;
    status?: "online" | "idle" | "locked";
}

export const UserCollection = (() => {

    const withCol = async <T>(action: (col: Collection<UserRecord>) => Promise<T>) => {
        const col = await collection<UserRecord>("users");
        return action(col);
    }

    return {
        get: async (email: string): Promise<UserRecord | undefined> => {
            const record = await withCol(col => col.findOne({ email }));

            if (!record) {
                throw Object.assign(new Error(`User not found: ${email}`), { status: 404 });
            }

            return record;
        },
        listPublic: async (): Promise<PublicUserRecord[]> => withCol(async col => {
            const users = await col.find({})
                .project<PublicUserRecord>({ password: 0 })
                .sort({ name: 1 })
                .toArray();

            return users.map((user, index) => ({
                ...user,
                role: inferRole(user.email, index),
                status: inferStatus(index),
                provisionedAt: user.provisionedAt ?? fallbackProvisionedAt(index),
            }));
        }),
    }
})()

function inferRole(email: string, index: number): string {
    if (index === 0 || email.includes("admin") || email.includes("root")) {
        return "ROOT_SYSTEM";
    }
    if (email.includes("guest") || email.includes("external")) {
        return "READ_ONLY";
    }
    return "DEV_ENGINEER";
}

function inferStatus(index: number): "online" | "idle" | "locked" {
    return (["online", "idle", "locked", "online"] as const)[index % 4];
}

function fallbackProvisionedAt(index: number): Date {
    const date = new Date("2024-01-01T00:00:00.000Z");
    date.setUTCDate(date.getUTCDate() - index * 17);
    return date;
}

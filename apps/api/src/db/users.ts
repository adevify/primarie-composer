import type { Collection } from "mongodb";
import type { AuthenticatedUser } from "../modules/auth/auth.middleware.js";
import { collection } from "./client.js";

export type UserRecord = AuthenticatedUser & {
    password: string;
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
    }
})()
import { MongoClient } from "mongodb";

export const client = new MongoClient("mongodb://db");

export async function connect() {
    return client.connect();
}

export async function disconnect() {
    return client.close();
}

export async function collection<T extends Record<string, unknown>>(name: string) {
    await connect();

    return client.db("primarie").collection<T>(name);
}
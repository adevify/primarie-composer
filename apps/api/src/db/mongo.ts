import { MongoClient, Db, Collection } from "mongodb";
import { env } from "../config/env.js";
import type { EnvironmentRecord } from "../modules/environments/environment.types.js";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongo(): Promise<Db> {
  if (db) return db;

  client = new MongoClient(env.MONGO_URI);
  await client.connect();
  db = client.db(env.MONGO_DB_NAME);

  await environmentsCollection().createIndex({ key: 1 }, { unique: true });
  await environmentsCollection().createIndex({ port: 1 }, { unique: true });

  return db;
}

export function getDb(): Db {
  if (!db) {
    throw new Error("MongoDB is not connected");
  }
  return db;
}

export function environmentsCollection(): Collection<EnvironmentRecord> {
  return getDb().collection<EnvironmentRecord>("environments");
}

export async function closeMongo(): Promise<void> {
  await client?.close();
  client = null;
  db = null;
}

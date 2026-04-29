import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { env } from "../../config/env.js";
import { environmentsCollection } from "../../db/mongo.js";
import { DockerComposeService } from "../../services/docker/DockerComposeService.js";
import { SeedService } from "../../services/seeds/SeedService.js";
import type { EnvironmentRecord } from "./environment.types.js";

interface CreateEnvironmentInput {
  key?: string;
  seed: string;
  tenants: string[];
}

const keyPattern = /^[a-z0-9]{4,12}$/;

export class EnvironmentsService {
  constructor(
    private readonly docker = new DockerComposeService(),
    private readonly seeds = new SeedService()
  ) {}

  async create(input: CreateEnvironmentInput): Promise<EnvironmentRecord> {
    const key = input.key ?? (await this.generateKey());
    if (!keyPattern.test(key)) {
      throw Object.assign(new Error("Environment key must be 4-12 lowercase letters or numbers"), { status: 400 });
    }

    const existing = await environmentsCollection().findOne({ key });
    if (existing) {
      throw Object.assign(new Error(`Environment already exists: ${key}`), { status: 409 });
    }

    const port = await this.nextAvailablePort();
    const runtimePath = path.join(env.RUNTIME_DIR, key);
    const now = new Date();
    const record: EnvironmentRecord = {
      key,
      port,
      status: "creating",
      seed: input.seed,
      tenants: input.tenants,
      createdAt: now,
      updatedAt: now,
      runtimePath
    };

    await fs.mkdir(runtimePath, { recursive: true });
    await fs.cp(env.TEMPLATE_DIR, runtimePath, { recursive: true });
    await this.seeds.copySeed(input.seed, path.join(runtimePath, "seeds"));
    await this.writeEnvironmentFile(record);

    await environmentsCollection().insertOne(record);

    try {
      await this.docker.up(runtimePath);
      return await this.updateStatus(key, "running");
    } catch (error) {
      await this.updateStatus(key, "error");
      throw error;
    }
  }

  async list(): Promise<EnvironmentRecord[]> {
    return environmentsCollection().find().sort({ createdAt: -1 }).toArray();
  }

  async get(key: string): Promise<EnvironmentRecord> {
    const record = await environmentsCollection().findOne({ key });
    if (!record) {
      throw Object.assign(new Error(`Environment not found: ${key}`), { status: 404 });
    }
    return record;
  }

  async stop(key: string): Promise<EnvironmentRecord> {
    const record = await this.get(key);
    await this.docker.down(record.runtimePath);
    return this.updateStatus(key, "stopped");
  }

  async start(key: string): Promise<EnvironmentRecord> {
    const record = await this.get(key);
    await this.docker.up(record.runtimePath);
    return this.updateStatus(key, "running");
  }

  async restart(key: string): Promise<EnvironmentRecord> {
    const record = await this.get(key);
    await this.docker.restart(record.runtimePath);
    return this.updateStatus(key, "running");
  }

  async delete(key: string): Promise<void> {
    const record = await this.get(key);
    await this.docker.down(record.runtimePath).catch(() => undefined);
    await fs.rm(record.runtimePath, { recursive: true, force: true });
    await environmentsCollection().deleteOne({ key });
  }

  private async nextAvailablePort(): Promise<number> {
    const records = await environmentsCollection().find({}, { projection: { port: 1 } }).toArray();
    const usedPorts = new Set(records.map((record) => record.port));
    let port = env.BASE_ENV_PORT;

    while (usedPorts.has(port) || !(await this.isLocalPortAvailable(port))) {
      port += 1;
    }

    return port;
  }

  private async isLocalPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();

      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, "127.0.0.1");
    });
  }

  private async generateKey(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const key = crypto.randomBytes(4).toString("hex").slice(0, 5);
      const existing = await environmentsCollection().findOne({ key });
      if (!existing) return key;
    }

    throw new Error("Could not generate a unique environment key");
  }

  private async writeEnvironmentFile(record: EnvironmentRecord): Promise<void> {
    const content = [
      `ENV_KEY=${record.key}`,
      `ENV_PORT=${record.port}`,
      `ROOT_DOMAIN=${env.ROOT_DOMAIN}`,
      `MONGO_DATABASE=primarie_env_${record.key}`,
      `TENANTS=${record.tenants.join(",")}`
    ].join("\n");

    await fs.writeFile(path.join(record.runtimePath, ".env"), `${content}\n`, "utf8");
  }

  private async updateStatus(key: string, status: EnvironmentRecord["status"]): Promise<EnvironmentRecord> {
    const result = await environmentsCollection().findOneAndUpdate(
      { key },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!result) {
      throw Object.assign(new Error(`Environment not found: ${key}`), { status: 404 });
    }

    return result;
  }
}

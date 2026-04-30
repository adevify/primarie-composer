import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { env } from "../../config/env.js";
import { EnvironmentCollection, EnvironmentRecord } from "../../db/environments.js";
import { DockerComposeService } from "../../services/docker/DockerComposeService.js";
import { GitRepositoryService } from "../../services/git/GitRepositoryService.js";
import type { AuthenticatedUser } from "../auth/auth.middleware.js";
import type { CreateEnvironmentPayload, EnvironmentOwner, EnvironmentSource, PullRequestRef, SyncFilesPayload } from "./environment.dtos.js";
import { EnvironmentLogCollection } from "../../db/environment-logs.js";

const keyPattern = /^[a-z0-9]{4,12}$/;

export class EnvironmentsService {
  constructor(
    private readonly docker = new DockerComposeService(),
    private readonly git = new GitRepositoryService(),
  ) { }

  async create(input: CreateEnvironmentPayload, createdBy: EnvironmentOwner | PullRequestRef): Promise<EnvironmentRecord> {
    const key = await this.generateKey();

    if (!keyPattern.test(key)) {
      throw Object.assign(new Error("Environment key must be 4-12 lowercase letters or numbers"), { status: 400 });
    }

    const existing = await EnvironmentCollection.getSilent(key);

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
      source: input.source,
      createdBy,
      createdAt: now,
      updatedAt: now,
    };

    await EnvironmentCollection.create(record);

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Environment created",
    });

    await this.git.prepareRepository(runtimePath, input.source);

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Repository prepared",
    });

    try {
      await EnvironmentLogCollection.add({
        environmentKey: key,
        log: "Starting environment",
      });
      await this.docker.up(runtimePath);

      await EnvironmentLogCollection.add({
        environmentKey: key,
        log: "Environment started",
      });

      return await this.updateStatus(key, "running");
    } catch (error) {
      await EnvironmentLogCollection.add({
        environmentKey: key,
        log: `Environment failed to start: ${error}`,
        level: "error",
      });

      await this.updateStatus(key, "error");
      throw error;
    }
  }

  async list(): Promise<EnvironmentRecord[]> {
    return EnvironmentCollection.list();
  }

  async get(key: string): Promise<EnvironmentRecord> {
    const record = await EnvironmentCollection.get(key);
    if (!record) {
      throw Object.assign(new Error(`Environment not found: ${key}`), { status: 404 });
    }
    return record;
  }

  async getLogs(key: string, page: number, perPage: number) {
    return EnvironmentLogCollection.list(key, page, perPage);
  }

  async stop(key: string): Promise<EnvironmentRecord> {
    const record = await this.get(key);

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Stopping environment",
    });

    await this.docker.down(path.join(env.RUNTIME_DIR, record.key));

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Environment stopped",
    });

    return this.updateStatus(record.key, "stopped");
  }

  async resume(key: string, user: AuthenticatedUser): Promise<EnvironmentRecord> {
    const record = await this.get(key);
    const owner = this.toOwner(user);
    if (!("email" in record.createdBy) || record.createdBy.email !== owner.email) {
      throw Object.assign(new Error("Only the owner can reuse this environment"), { status: 403 });
    }

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Resuming environment",
    });

    if (record.status !== "running") {
      await this.docker.up(path.join(env.RUNTIME_DIR, key));

      await EnvironmentLogCollection.add({
        environmentKey: key,
        log: "Environment resumed",
      });
    }

    return this.updateStatus(key, "running");
  }

  async start(key: string): Promise<EnvironmentRecord> {
    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Starting environment",
    });
    await this.docker.up(path.join(env.RUNTIME_DIR, key));
    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Environment started",
    });
    return this.updateStatus(key, "running");
  }

  async restart(key: string): Promise<EnvironmentRecord> {
    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Restarting environment",
    });

    await this.docker.restart(path.join(env.RUNTIME_DIR, key));

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Environment restarted",
    });

    return this.updateStatus(key, "running");
  }

  async syncFiles(key: string, input: SyncFilesPayload): Promise<EnvironmentRecord> {
    const current = await this.get(key);

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: `Syncing files: ${input.branch}@${input.commit}${input.files.length ? ' with changed files: ' + JSON.stringify(input.files.map((file) => file.path), null, 2) : ''}`,
    });

    await this.git.updateRepository(path.join(env.RUNTIME_DIR, current.key, "repo"), input);

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Files synced",
    });

    return EnvironmentCollection.update(current.key, (record) => {
      return {
        ...record,
        branch: input.branch,
        commit: input.commit,
      };
    });
  }

  async delete(key: string): Promise<void> {
    const record = await this.get(key);

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Stopping environment",
    });

    await this.docker.down(path.join(env.RUNTIME_DIR, record.key)).catch(() => undefined);

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Environment stopped",
    });

    await fs.rm(path.join(env.RUNTIME_DIR, record.key), { recursive: true, force: true });

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Environment removed",
    });

    await EnvironmentCollection.delete(key);

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Environment deleted",
    });
  }

  async identifyPrEnvironment(reference: PullRequestRef) {
    const records = await EnvironmentCollection.list();
    const matching = records.find((record) => 'title' in record.createdBy && this.samePullRequest(record.createdBy, reference));

    if (!matching) {
      throw Object.assign(new Error("Pull request environment not found"), { status: 404 });
    }

    return matching;
  }

  async replacePullRequestEnvironment(pullRequest: PullRequestRef, source: EnvironmentSource): Promise<EnvironmentRecord> {
    await this.deletePullRequestEnvironments(pullRequest).catch(() => undefined);

    return this.create({
      source,
      seed: "default"
    }, pullRequest);
  }

  async deletePullRequestEnvironments(reference: PullRequestRef): Promise<void> {
    const matching = await this.identifyPrEnvironment(reference);

    await EnvironmentLogCollection.add({
      environmentKey: matching.key,
      log: "Deleting pull request environment",
    });

    await this.delete(matching.key);

    await EnvironmentLogCollection.add({
      environmentKey: matching.key,
      log: "Pull request environment deleted",
    });
  }

  private async nextAvailablePort(): Promise<number> {
    const records = await EnvironmentCollection.list();
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
      const existing = await EnvironmentCollection.getSilent(key);

      if (!existing) return key;
    }

    throw new Error("Could not generate a unique environment key");
  }

  private async updateStatus(key: string, status: EnvironmentRecord["status"]): Promise<EnvironmentRecord> {
    return EnvironmentCollection.update(key, (record) => {
      return {
        ...record,
        status,
      };
    });
  }

  toOwner(user: AuthenticatedUser): EnvironmentOwner {
    return {
      email: user.email,
      name: user.name,
    };
  }

  private samePullRequest(left: PullRequestRef, right: PullRequestRef): boolean {
    return left.url === right.url;
  }
}

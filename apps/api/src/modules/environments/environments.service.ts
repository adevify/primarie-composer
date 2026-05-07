import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "../../config/env.js";
import { EnvironmentCollection, EnvironmentRecord } from "../../db/environments.js";
import { HostActionBusService, type HostActionResult } from "../../services/bus/HostActionBusService.js";
import type { AuthenticatedUser } from "../auth/auth.middleware.js";
import type { CreateEnvironmentPayload, EnvironmentOwner, EnvironmentSource, LifecycleAction, PullRequestRef, SyncFilesPayload } from "./environment.dtos.js";
import { EnvironmentLogCollection } from "../../db/environment-logs.js";
import { EnvironmentActionCollection } from "../../db/environment-actions.js";

const keyPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const execFileAsync = promisify(execFile);
let previousCpuSnapshot = readCpuSnapshot();

const envNamesList = [
  'pizza',
  'burger',
  'sushi',
  'ramen',
  'taco',
  'burrito',
  'pasta',
  'lasagna',
  'kebab',
  'falafel',
  'shawarma',
  'steak',
  'pancake',
  'waffle',
  'donut',
  'croissant',
  'baguette',
  'pretzel',
  'muffin',
  'cupcake',
  'brownie',
  'cookie',
  'cheesecake',
  'tiramisu',
  'pudding',
  'omelette',
  'sandwich',
  'toast',
  'salad',
  'soup',
  'risotto',
  'gnocchi',
  'dumpling',
  'pierogi',
  'ravioli',
  'spaghetti',
  'linguine',
  'fettuccine',
  'macaroni',
  'carbonara',
  'bolognese',
  'pesto',
  'nachos',
  'quesadilla',
  'enchilada',
  'chimichanga',
  'fajita',
  'hummus',
  'tzatziki',
  'babaganoush',
  'couscous',
  'paella',
  'goulash',
  'schnitzel',
  'bratwurst',
  'sausage',
  'meatball',
  'pilaf',
  'biryani',
  'curry',
  'masala',
  'samosa',
  'pakora',
  'dosa',
  'idli',
  'chutney',
  'tempura',
  'udon',
  'soba',
  'teriyaki',
  'yakitori',
  'onigiri',
  'kimchi',
  'bibimbap',
  'bulgogi',
  'pho',
  'banhmi',
  'springroll',
  'eggroll',
  'hotdog',
  'fries',
  'nuggets',
  'popcorn',
  'granola',
  'oatmeal',
  'yogurt',
  'smoothie',
  'milkshake',
  'espresso',
  'cappuccino',
  'latte',
  'mocha',
  'frappe',
  'cola',
  'lemonade',
  'juice',
  'avocado',
  'cheddar',
  'tofu',
  'bagel',
  'avengers',
  'titanic',
  'gladiator',
  'rocky',
  'matrix',
  'inception',
  'interstellar',
  'godfather',
  'smallville',
  'vikings',
  'breakingbad',
  'bettercallsaul',
  'gameofthrones',
  'houseofdragon',
  'sopranos',
  'friends',
  'seinfeld',
  'office',
  'lost',
  'dark',
  'narcos',
  'ozark',
  'dexter',
  'homeland',
  'blacklist',
  'sherlock',
  'hannibal',
  'lucifer',
  'superman',
  'batman',
  'spiderman',
  'deadpool',
  'wolverine',
  'ironman',
  'thor',
  'hulk',
  'aquaman',
  'daredevil',
  'punisher',
  'flash',
  'arrow',
  'legends',
  'gotham',
  'watchmen',
  'invincible',
  'theboys',
  'mandalorian',
  'kenobi',
  'andor',
  'loki',
  'wandavision',
  'hawkeye',
  'eternals',
  'joker',
  'avatar',
  'dune',
  'tenet',
  'memento',
  'prestige',
  'dunkirk',
  'oppenheimer',
  'barbie',
  'transformers',
  'terminator',
  'predator',
  'alien',
  'blade',
  'tron',
  'robocop',
  'madmax',
  'furyroad',
  'johnwick',
  'taken',
  'equalizer',
  'expendables',
  'rambo',
  'creed',
  'rush',
  'fordferrari',
  'rushhour',
  'badboys',
  'meninblack',
  'ghostbusters',
  'jurassic',
  'kong',
  'godzilla',
  'pacificrim',
  'pirates',
  'harrypotter',
  'twilight',
  'hunger',
  'divergent',
  'maze',
  'shogun',
  'fallout',
  'silo',
  'severance',
  'chernobyl',
  'westworld',
  'suits',
  'billions',
  'peakyblinders'
];

export class EnvironmentsService {
  constructor(
    private readonly bus = new HostActionBusService(),
  ) { }

  async create(input: CreateEnvironmentPayload, createdBy: EnvironmentOwner | PullRequestRef): Promise<EnvironmentRecord> {
    const key = await this.generateKey();

    if (!keyPattern.test(key)) {
      throw Object.assign(new Error("Environment key must be a lowercase slug"), { status: 400 });
    }

    const existing = await EnvironmentCollection.getSilent(key);

    if (existing) {
      throw Object.assign(new Error(`Environment already exists: ${key}`), { status: 409 });
    }

    const port = await this.nextAvailablePort();
    const runtimePath = path.join(env.HOST_RUNTIME_DIR, key);
    logEnvironment("info", "create_requested", {
      key,
      port,
      branch: input.source.branch,
      commit: input.source.commit,
      seed: input.seed,
      owner: "email" in createdBy ? createdBy.email : createdBy.url
    });
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

    void this.prepareEnvironment(key, runtimePath, input.source, {
      ...input.env,
      PROXY_EXTERNAL_PORT: String(port),
    }).catch(async (error) => {
      logEnvironment("error", "create_failed", {
        key,
        message: error instanceof Error ? error.message : String(error)
      });
      await EnvironmentLogCollection.add({
        environmentKey: key,
        log: `Environment creation failed: ${error instanceof Error ? error.message : String(error)}`,
        level: "error",
      });
      await this.updateStatus(key, "failed").catch(() => undefined);
    });

    return record;
  }

  private async prepareEnvironment(
    key: string,
    runtimePath: string,
    source: EnvironmentSource,
    environmentVariables: Record<string, string>
  ): Promise<void> {
    logEnvironment("info", "prepare_started", {
      key,
      runtimePath,
      branch: source.branch,
      commit: source.commit
    });
    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Preparing repository",
    });

    await this.updateStatus(key, "cloning");
    const result = await this.publishEnvironmentAction("environment.prepare", key, {
      runtimePath,
      source,
      sourceRepoUrl: env.SOURCE_REPO_URL,
      templateDir: env.HOST_TEMPLATE_DIR,
      seedsDir: env.HOST_SEEDS_DIR,
      environmentVariables: {
        ...environmentVariables,
        HOST_1: "prmr.md",
        HOST_2: "adevify.md",
        NETWORK_NAME: `primarie-${key}-net`,
        ENV_KEY: key,
        ENV_PORT: String((await EnvironmentCollection.get(key)).port),
        ROOT_DOMAIN: env.ROOT_DOMAIN,
        MONGO_DATABASE: `primarie_env_${key}`
      }
    });

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: result.message || "Repository prepared",
    });

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Environment is ready to start",
    });

    await this.updateStatus(key, "stopped");
    logEnvironment("info", "prepare_completed", { key, status: "stopped" });
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

  async getAllLogs(page: number, perPage: number) {
    return EnvironmentLogCollection.listAll(page, perPage);
  }

  async getSystemMetrics() {
    const cpu = sampleCpuUsage();
    const totalMemoryBytes = os.totalmem();
    const freeMemoryBytes = os.freemem();
    const usedMemoryBytes = totalMemoryBytes - freeMemoryBytes;
    const storage = await readStorageUsage(env.RUNTIME_DIR);

    return {
      cpu,
      memory: {
        usedBytes: usedMemoryBytes,
        totalBytes: totalMemoryBytes,
        percent: percent(usedMemoryBytes, totalMemoryBytes),
      },
      storage
    };
  }

  async listContainers(key: string): Promise<unknown[]> {
    await this.get(key);
    throw busMigrationPending("Container inspection must be executed by the host action bus.");
  }

  async listContainerFiles(key: string, container: string, targetPath: string) {
    await this.get(key);
    void container;
    void targetPath;
    throw busMigrationPending("Container file browsing must be executed by the host action bus.");
  }

  async listEnvironmentFiles(key: string, targetPath: string) {
    await this.get(key);
    const rootPath = path.resolve(env.RUNTIME_DIR, key);
    const absolutePath = resolveInside(rootPath, targetPath || "/");
    const entries = await fs.readdir(absolutePath, { withFileTypes: true }).catch((error) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    });

    return Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(absolutePath, entry.name);
      const stats = await fs.stat(entryPath);
      const relativePath = `/${path.relative(rootPath, entryPath).split(path.sep).join("/")}`;
      return {
        path: relativePath,
        name: entry.name,
        type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
        size: stats.size,
        modifiedAt: stats.mtime.toISOString()
      };
    }));
  }

  async execInContainer(key: string, container: string, command: string) {
    await this.get(key);
    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: `Executing in ${container}: ${command}`,
    });
    throw busMigrationPending("Container command execution must be executed by the host action bus.");
  }

  async createLifecycleAction(key: string, action: LifecycleAction, user: AuthenticatedUser) {
    await this.get(key);

    const id = randomUUID();
    await EnvironmentActionCollection.create({
      id,
      environmentKey: key,
      action,
      status: "queued",
      requestedBy: this.toOwner(user)
    });

    void this.runLifecycleActionJob(id, key, action, user);
    return EnvironmentActionCollection.get(id);
  }

  getLifecycleAction(id: string) {
    return EnvironmentActionCollection.get(id);
  }

  getLifecycleActions(key: string, page: number, perPage: number) {
    return EnvironmentActionCollection.listByEnvironment(key, page, perPage);
  }

  getLifecycleActionLogs(id: string, page: number, perPage: number) {
    return EnvironmentActionCollection.listLogs(id, page, perPage);
  }

  getLifecycleActionLogsAfter(id: string, afterSequence: number, limit: number) {
    return EnvironmentActionCollection.listLogsAfter(id, afterSequence, limit);
  }

  private async runLifecycleActionJob(id: string, key: string, action: LifecycleAction, user: AuthenticatedUser): Promise<void> {
    logEnvironment("info", "lifecycle_job_started", {
      key,
      action,
      actionId: id,
      user: user.email
    });
    await EnvironmentActionCollection.update(id, { status: "running" });

    try {
      const environment = await this.streamLifecycleAction(
        key,
        action,
        user,
        async (entry) => {
          await EnvironmentActionCollection.addLog({
            actionId: id,
            environmentKey: key,
            log: entry.log,
            level: entry.level
          });
        }
      );

      await EnvironmentActionCollection.update(id, {
        status: "complete",
        environment,
        completedAt: new Date()
      });
      logEnvironment("info", "lifecycle_job_completed", {
        key,
        action,
        actionId: id,
        status: environment.status
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logEnvironment("error", "lifecycle_job_failed", {
        key,
        action,
        actionId: id,
        message
      });
      await EnvironmentActionCollection.addLog({
        actionId: id,
        environmentKey: key,
        log: message,
        level: "error"
      }).catch(() => undefined);
      await EnvironmentActionCollection.update(id, {
        status: "error",
        error: message,
        completedAt: new Date()
      }).catch(() => undefined);
    }
  }

  async streamLifecycleAction(
    key: string,
    action: LifecycleAction,
    user: AuthenticatedUser,
    onLog: (entry: { log: string; level: "info" | "error" }) => Promise<void> | void,
    signal?: AbortSignal
  ): Promise<EnvironmentRecord> {
    const record = await this.get(key);

    if (action === "resume") {
      const owner = this.toOwner(user);
      if (!("email" in record.createdBy) || record.createdBy.email !== owner.email) {
        throw Object.assign(new Error("Only the owner can reuse this environment"), { status: 403 });
      }
    }

    await onLog({ log: `${capitalize(action)} environment ${key}`, level: "info" });
    logEnvironment("info", "lifecycle_action_started", { key, action, currentStatus: record.status });

    try {
      if (action === "start" || action === "resume") {
        if (record.status === "running") {
          await onLog({ log: "Environment is already running", level: "info" });
          return record;
        }
        throwIfAborted(signal);
        await this.updateStatus(key, "starting");
        const result = await this.publishEnvironmentAction("environment.start", key);
        await emitBusResult(result, onLog);
        await onLog({ log: `Environment ${action === "resume" ? "resumed" : "started"}`, level: "info" });
        const updated = await this.updateStatus(key, "running");
        logEnvironment("info", "lifecycle_action_completed", { key, action, status: updated.status });
        return updated;
      }

      if (action === "restart") {
        throwIfAborted(signal);
        await this.updateStatus(key, "starting");
        const result = await this.publishEnvironmentAction("environment.restart", key);
        await emitBusResult(result, onLog);
        await onLog({ log: "Environment restarted", level: "info" });
        const updated = await this.updateStatus(key, "running");
        logEnvironment("info", "lifecycle_action_completed", { key, action, status: updated.status });
        return updated;
      }

      throwIfAborted(signal);
      const result = await this.publishEnvironmentAction("environment.stop", key);
      await emitBusResult(result, onLog);
      await onLog({ log: "Environment stopped", level: "info" });
      const updated = await this.updateStatus(key, "stopped");
      logEnvironment("info", "lifecycle_action_completed", { key, action, status: updated.status });
      return updated;
    } catch (error) {
      if (action !== "stop") {
        await this.updateStatus(key, "failed").catch(() => undefined);
      }
      logEnvironment("error", "lifecycle_action_failed", {
        key,
        action,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async streamContainerLogs(
    key: string,
    container: string,
    onLog: (entry: { log: string; level: "info" | "error" }) => Promise<void> | void,
    signal?: AbortSignal
  ): Promise<void> {
    await this.get(key);
    void container;
    void onLog;
    void signal;
    throw busMigrationPending("Container log streaming must be executed by the host action bus.");
  }

  async streamComposeLogs(
    key: string,
    onLog: (entry: { log: string; level: "info" | "error" }) => Promise<void> | void,
    signal?: AbortSignal
  ): Promise<void> {
    await this.get(key);
    void onLog;
    void signal;
    throw busMigrationPending("Compose log streaming must be executed by the host action bus.");
  }

  async listComposeLogs(key: string) {
    await this.get(key);
    throw busMigrationPending("Compose log listing must be executed by the host action bus.");
  }

  async inspectMongo(key: string) {
    await this.get(key);
    throw busMigrationPending("MongoDB inspection must be executed by the host action bus.");
  }

  async stop(key: string): Promise<EnvironmentRecord> {
    const record = await this.get(key);

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Stopping environment",
    });

    await this.publishEnvironmentAction("environment.stop", key);

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
      await this.updateStatus(key, "starting");
      await this.publishEnvironmentAction("environment.start", key);

      await EnvironmentLogCollection.add({
        environmentKey: key,
        log: "Environment resumed",
      });
    }

    return this.updateStatus(key, "running");
  }

  async start(key: string): Promise<EnvironmentRecord> {
    try {
      await this.get(key);
      await EnvironmentLogCollection.add({
        environmentKey: key,
        log: "Starting environment",
      });
      await this.updateStatus(key, "starting");
      await this.publishEnvironmentAction("environment.start", key);
      await EnvironmentLogCollection.add({
        environmentKey: key,
        log: "Environment started",
      });
      return this.updateStatus(key, "running");
    } catch (error) {
      await EnvironmentLogCollection.add({
        environmentKey: key,
        log: `Environment start failed: ${error instanceof Error ? error.message : String(error)}`,
        level: "error",
      });
      await this.updateStatus(key, "failed");

      throw error;
    }
  }

  async restart(key: string): Promise<EnvironmentRecord> {
    await this.get(key);

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Restarting environment",
    });

    await this.updateStatus(key, "starting");
    await this.publishEnvironmentAction("environment.restart", key);

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Environment restarted",
    });

    return this.updateStatus(key, "running");
  }

  async syncFiles(key: string, input: SyncFilesPayload): Promise<EnvironmentRecord> {
    const current = await this.get(key);
    logEnvironment("info", "sync_started", {
      key,
      branch: input.branch,
      commit: input.commit,
      files: input.files.length
    });

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: `Preparing environment with ${input.branch}@${input.commit}`,
    });

    await this.updateStatus(key, "checking_out");
    await this.publishEnvironmentAction("environment.files.sync", key, {
      source: {
        branch: input.branch,
        commit: input.commit
      },
      files: input.files
    });

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Environment synced successfully",
    });

    const updated = await EnvironmentCollection.update(current.key, (record) => {
      return {
        ...record,
        branch: input.branch,
        commit: input.commit,
      };
    });
    logEnvironment("info", "sync_completed", { key, files: input.files.length });
    return updated;
  }

  async delete(key: string): Promise<void> {
    const record = await this.get(key);
    logEnvironment("info", "delete_started", { key, status: record.status });

    await this.updateStatus(key, "removing");

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Removing environment",
    });

    await this.publishEnvironmentAction("environment.remove", record.key).catch(async (error) => {
      await EnvironmentLogCollection.add({
        environmentKey: key,
        log: `Environment remove failed: ${error instanceof Error ? error.message : String(error)}`,
        level: "error",
      });
      throw error;
    });

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Environment removed",
    });

    await this.updateStatus(key, "removed");
    await EnvironmentCollection.delete(key);

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Environment deleted",
    });
    logEnvironment("info", "delete_completed", { key });
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
      seed: "default",
      env: {}
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

  private async publishEnvironmentAction(type: string, key: string, payload: Record<string, unknown> = {}): Promise<HostActionResult> {
    logEnvironment("info", "bus_action_publish", { key, type });
    const result = await this.bus.publish(type, {
      environment: key,
      runtimeRoot: env.HOST_RUNTIME_DIR,
      runtimePath: path.join(env.HOST_RUNTIME_DIR, key),
      ...payload
    });

    await this.logHostActionResult(key, result);
    logEnvironment("info", "bus_action_completed", {
      key,
      type,
      status: result.status,
      message: result.message,
      outputLength: result.output?.length ?? 0
    });
    return result;
  }

  private async logHostActionResult(key: string, result: HostActionResult): Promise<void> {
    if (result.output) {
      await EnvironmentLogCollection.add({
        environmentKey: key,
        log: result.output,
        system: true
      });
    }
  }

  private async composeConfig(record: EnvironmentRecord): Promise<{ cwd: string; envFile: string }> {
    const runtimePath = path.join(env.RUNTIME_DIR, record.key);
    const envFile = path.join(runtimePath, ".env");
    const sourceRepoPath = record.source.repoPath ? path.resolve(record.source.repoPath) : undefined;

    if (sourceRepoPath && await fileExists(path.join(sourceRepoPath, "docker-compose.yml"))) {
      return { cwd: sourceRepoPath, envFile };
    }

    if (sourceRepoPath && await fileExists(path.join(sourceRepoPath, "compose.yml"))) {
      return { cwd: sourceRepoPath, envFile };
    }

    return { cwd: runtimePath, envFile };
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
    for (let attempt = 0; attempt < envNamesList.length; attempt += 1) {
      const key = randomItem(envNamesList);
      const existing = await EnvironmentCollection.getSilent(key);

      if (!existing) return key;
    }

    throw new Error("Could not generate a unique environment key");
  }

  private async updateStatus(key: string, status: EnvironmentRecord["status"]): Promise<EnvironmentRecord> {
    const updated = await EnvironmentCollection.update(key, (record) => {
      return {
        ...record,
        status,
      };
    });
    logEnvironment("info", "status_changed", { key, status });
    return updated;
  }

  private async writeEnvironmentFile(runtimePath: string, key: string, environmentVariables: Record<string, string>): Promise<void> {
    const content = {
      ...environmentVariables,
      ENV_KEY: environmentVariables.ENV_KEY ?? key,
      ENV_PORT: environmentVariables.ENV_PORT ?? String((await EnvironmentCollection.get(key)).port),
      ROOT_DOMAIN: environmentVariables.ROOT_DOMAIN ?? env.ROOT_DOMAIN,
      MONGO_DATABASE: environmentVariables.MONGO_DATABASE ?? `primarie_env_${key}`
    };

    const lines = Object.entries(content).map(([name, value]) => `${name}=${escapeEnvValue(value)}`);
    await fs.writeFile(path.join(runtimePath, ".env"), `${lines.join("\n")}\n`, "utf8");
  }

  private composeLogger(environmentKey: string) {
    return async ({ log, level }: { log: string; level: "info" | "error" }) => {
      await EnvironmentLogCollection.add({
        environmentKey,
        log,
        level,
        system: true,
      });
    };
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

function escapeEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@-]*$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

async function emitBusResult(
  result: HostActionResult,
  onLog: (entry: { log: string; level: "info" | "error" }) => Promise<void> | void
): Promise<void> {
  if (result.message) {
    await onLog({ log: result.message, level: "info" });
  }
  if (result.output) {
    await onLog({ log: result.output, level: "info" });
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw Object.assign(new Error("Action aborted"), { status: 499 });
  }
}

function busMigrationPending(message: string): Error {
  return Object.assign(new Error(message), { status: 501 });
}

function logEnvironment(level: "info" | "warn" | "error", event: string, details: Record<string, unknown>): void {
  console[level](JSON.stringify({
    at: new Date().toISOString(),
    scope: "environments",
    event,
    ...details
  }));
}

function resolveInside(rootPath: string, targetPath: string): string {
  const normalizedTarget = targetPath.startsWith("/") ? targetPath.slice(1) : targetPath;
  const resolvedPath = path.resolve(rootPath, normalizedTarget);
  const relativePath = path.relative(rootPath, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw Object.assign(new Error("Path is outside the environment runtime directory"), { status: 400 });
  }

  return resolvedPath;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true, () => false);
}

function sampleCpuUsage() {
  const current = readCpuSnapshot();
  const idleDelta = current.idle - previousCpuSnapshot.idle;
  const totalDelta = current.total - previousCpuSnapshot.total;
  previousCpuSnapshot = current;

  const usagePercent = totalDelta <= 0 ? 0 : percent(totalDelta - idleDelta, totalDelta);
  return {
    percent: usagePercent,
    loadAverage: os.loadavg(),
    cores: os.cpus().length
  };
}

function readCpuSnapshot(): { idle: number; total: number } {
  return os.cpus().reduce((snapshot, cpu) => {
    const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    return {
      idle: snapshot.idle + cpu.times.idle,
      total: snapshot.total + total
    };
  }, { idle: 0, total: 0 });
}

async function readStorageUsage(targetPath: string) {
  const { stdout } = await execFileAsync("df", ["-k", targetPath], { maxBuffer: 1024 * 64 });
  const [, line] = stdout.trim().split(/\r?\n/);
  const parts = line?.trim().split(/\s+/) ?? [];
  const totalBytes = Number(parts[1] ?? 0) * 1024;
  const usedBytes = Number(parts[2] ?? 0) * 1024;
  const availableBytes = Number(parts[3] ?? 0) * 1024;

  return {
    usedBytes,
    availableBytes,
    totalBytes,
    percent: percent(usedBytes, totalBytes)
  };
}

function percent(used: number, total: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Number(((used / total) * 100).toFixed(1))));
}

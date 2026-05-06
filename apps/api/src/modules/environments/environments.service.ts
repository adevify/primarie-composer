import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "../../config/env.js";
import { EnvironmentCollection, EnvironmentRecord } from "../../db/environments.js";
import { DockerComposeService } from "../../services/docker/DockerComposeService.js";
import { GitRepositoryService } from "../../services/git/GitRepositoryService.js";
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
    private readonly docker = new DockerComposeService(),
    private readonly git = new GitRepositoryService(),
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

    void this.prepareEnvironment(key, runtimePath, input.source, {
      ...input.env,
      PROXY_EXTERNAL_PORT: String(port),
    }).catch(async (error) => {
      await EnvironmentLogCollection.add({
        environmentKey: key,
        log: `Environment creation failed: ${error instanceof Error ? error.message : String(error)}`,
        level: "error",
      });
      await this.updateStatus(key, "error").catch(() => undefined);
    });

    return record;
  }

  private async prepareEnvironment(
    key: string,
    runtimePath: string,
    source: EnvironmentSource,
    environmentVariables: Record<string, string>
  ): Promise<void> {
    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Preparing repository",
    });

    await this.git.prepareRepository(runtimePath, source);

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Repository prepared",
    });

    await this.writeEnvironmentFile(runtimePath, key, {
      ...environmentVariables,
      HOST_1: 'prmr.md',
      HOST_2: 'adevify.md',
      NETWORK_NAME: `primarie-${key}-net`
    });

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Environment variables written",
    });

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Environment is ready to start",
    });

    await this.updateStatus(key, "stopped");
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
    const record = await this.get(key);
    const compose = await this.composeConfig(record);
    return this.docker.listContainers(compose.cwd, compose.envFile);
  }

  async listContainerFiles(key: string, container: string, targetPath: string) {
    await this.get(key);
    return this.docker.listContainerFiles(container, targetPath);
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
    return this.docker.execInContainer(container, command);
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

  getLifecycleActionLogs(id: string, page: number, perPage: number) {
    return EnvironmentActionCollection.listLogs(id, page, perPage);
  }

  getLifecycleActionLogsAfter(id: string, afterSequence: number, limit: number) {
    return EnvironmentActionCollection.listLogsAfter(id, afterSequence, limit);
  }

  private async runLifecycleActionJob(id: string, key: string, action: LifecycleAction, user: AuthenticatedUser): Promise<void> {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
    const compose = await this.composeConfig(record);

    if (action === "resume") {
      const owner = this.toOwner(user);
      if (!("email" in record.createdBy) || record.createdBy.email !== owner.email) {
        throw Object.assign(new Error("Only the owner can reuse this environment"), { status: 403 });
      }
    }

    await onLog({ log: `${capitalize(action)} environment ${key}`, level: "info" });

    try {
      if (action === "start" || action === "resume") {
        if (record.status === "running") {
          await onLog({ log: "Environment is already running", level: "info" });
          return record;
        }
        await this.docker.up(key, compose.cwd, onLog, signal, compose.envFile);
        await onLog({ log: `Environment ${action === "resume" ? "resumed" : "started"}`, level: "info" });
        return this.updateStatus(key, "running");
      }

      if (action === "restart") {
        await this.docker.restart(compose.cwd, onLog, signal, compose.envFile);
        await onLog({ log: "Environment restarted", level: "info" });
        return this.updateStatus(key, "running");
      }

      await this.docker.down(key, compose.cwd, onLog, signal, compose.envFile);
      await onLog({ log: "Environment stopped", level: "info" });
      return this.updateStatus(key, "stopped");
    } catch (error) {
      if (action !== "stop") {
        await this.updateStatus(key, "error").catch(() => undefined);
      }
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
    await this.docker.streamContainerLogs(container, onLog, signal);
  }

  async streamComposeLogs(
    key: string,
    onLog: (entry: { log: string; level: "info" | "error" }) => Promise<void> | void,
    signal?: AbortSignal
  ): Promise<void> {
    const record = await this.get(key);
    const compose = await this.composeConfig(record);
    await this.docker.streamComposeLogs(compose.cwd, onLog, signal, compose.envFile);
  }

  async listComposeLogs(key: string) {
    const record = await this.get(key);
    const compose = await this.composeConfig(record);
    return this.docker.listComposeLogs(compose.cwd, compose.envFile);
  }

  async inspectMongo(key: string) {
    const record = await this.get(key);
    const compose = await this.composeConfig(record);
    const containers = await this.docker.listContainers(compose.cwd, compose.envFile).catch(() => []);
    const mongoContainer = containers
      .map((container) => container as { Name?: string; Names?: string; Service?: string; State?: string; Image?: string })
      .find((container) => {
        const service = container.Service?.toLowerCase() ?? "";
        const name = (container.Name ?? container.Names ?? "").toLowerCase();
        const image = container.Image?.toLowerCase() ?? "";
        return container.State === "running" && (service === "mongo" || name.includes("mongo") || image.includes("mongo"));
      });

    if (!mongoContainer) {
      return { available: false, reason: "MongoDB container is not running" };
    }

    const containerName = mongoContainer.Name ?? mongoContainer.Names;
    if (!containerName) {
      return { available: false, reason: "MongoDB container name is unavailable" };
    }

    return {
      available: true,
      container: containerName,
      ...(await this.docker.inspectMongo(containerName))
    };
  }

  async stop(key: string): Promise<EnvironmentRecord> {
    const record = await this.get(key);
    const compose = await this.composeConfig(record);

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Stopping environment",
    });

    await this.docker.down(key, compose.cwd, this.composeLogger(key), undefined, compose.envFile);

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Environment stopped",
    });

    return this.updateStatus(record.key, "stopped");
  }

  async resume(key: string, user: AuthenticatedUser): Promise<EnvironmentRecord> {
    const record = await this.get(key);
    const compose = await this.composeConfig(record);
    const owner = this.toOwner(user);
    if (!("email" in record.createdBy) || record.createdBy.email !== owner.email) {
      throw Object.assign(new Error("Only the owner can reuse this environment"), { status: 403 });
    }

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Resuming environment",
    });

    if (record.status !== "running") {
      await this.docker.up(key, compose.cwd, this.composeLogger(key), undefined, compose.envFile);

      await EnvironmentLogCollection.add({
        environmentKey: key,
        log: "Environment resumed",
      });
    }

    return this.updateStatus(key, "running");
  }

  async start(key: string): Promise<EnvironmentRecord> {
    try {
      const record = await this.get(key);
      const compose = await this.composeConfig(record);
      await EnvironmentLogCollection.add({
        environmentKey: key,
        log: "Starting environment",
      });
      await this.docker.up(key, compose.cwd, this.composeLogger(key), undefined, compose.envFile);
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
      await this.updateStatus(key, "error");

      throw error;
    }
  }

  async restart(key: string): Promise<EnvironmentRecord> {
    const record = await this.get(key);
    const compose = await this.composeConfig(record);

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Restarting environment",
    });

    await this.docker.restart(compose.cwd, this.composeLogger(key), undefined, compose.envFile);

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
      log: `Preparing environment with ${input.branch}@${input.commit}`,
    });

    await this.git.updateRepository(path.join(env.RUNTIME_DIR, current.key), input);

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Environment prepared successfully",
    });

    await this.git.applyChangedFiles(path.join(env.RUNTIME_DIR, current.key), input.files);

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Environment synced successfully",
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
    const compose = await this.composeConfig(record);

    await EnvironmentLogCollection.add({
      environmentKey: key,
      log: "Stopping environment",
    });

    await this.docker.down(key, compose.cwd, this.composeLogger(key), undefined, compose.envFile).catch(() => undefined);

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
    return EnvironmentCollection.update(key, (record) => {
      return {
        ...record,
        status,
      };
    });
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

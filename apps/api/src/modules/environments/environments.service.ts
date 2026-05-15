import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "../../config/env.js";
import {
  EnvironmentCollection,
  EnvironmentRecord,
} from "../../db/environments.js";
import {
  HostActionBusService,
  type HostActionLogHandler,
  type HostActionResult,
} from "../../services/bus/HostActionBusService.js";
import type { AuthenticatedUser } from "../auth/auth.middleware.js";
import type {
  CreateEnvironmentPayload,
  EnvironmentOwner,
  EnvironmentSource,
  LifecycleAction,
  MongoDeleteDocumentsPayload,
  MongoInsertDocumentsPayload,
  MongoSearchDocumentsPayload,
  MongoUpdateDocumentsPayload,
  ImportProdTennantPayload,
  PullRequestRef,
  SyncFilesPayload,
} from "./environment.dtos.js";
import {
  SystemLogCollection,
  type SystemLogActor,
  type SystemLogLevel,
  type SystemLogSource,
  type SystemLogTarget,
} from "../../db/logs.js";
import {
  EnvironmentActionCollection,
  type EnvironmentActionLogFile,
  type EnvironmentActionRecord,
} from "../../db/environment-actions.js";

const keyPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const execFileAsync = promisify(execFile);
let previousCpuSnapshot = readCpuSnapshot();
const longRunningHostActions = new Set([
  "environment.prepare",
  "environment.start",
  "environment.restart",
  "environment.remove",
  "environment.mongo.importProdTennant",
]);

type ActionLogLine = {
  actionId: string;
  line: string;
  log: string;
  level: "info" | "error";
  byteStart: number;
  byteEnd: number;
  createdAt?: string;
};

const envNamesList = [
  "pizza",
  "burger",
  "sushi",
  "ramen",
  "taco",
  "burrito",
  "pasta",
  "lasagna",
  "kebab",
  "falafel",
  "shawarma",
  "steak",
  "pancake",
  "waffle",
  "donut",
  "croissant",
  "baguette",
  "pretzel",
  "muffin",
  "cupcake",
  "brownie",
  "cookie",
  "cheesecake",
  "tiramisu",
  "pudding",
  "omelette",
  "sandwich",
  "toast",
  "salad",
  "soup",
  "risotto",
  "ravioli",
  "spaghetti",
  "macaroni",
  "carbonara",
  "bolognese",
  "pesto",
  "nachos",
  "hummus",
  "couscous",
  "paella",
  "goulash",
  "schnitzel",
  "bratwurst",
  "sausage",
  "meatball",
  "pilaf",
  "curry",
  "tempura",
  "kimchi",
  "springroll",
  "eggroll",
  "hotdog",
  "fries",
  "nuggets",
  "popcorn",
  "oatmeal",
  "yogurt",
  "smoothie",
  "milkshake",
  "espresso",
  "cappuccino",
  "latte",
  "mocha",
  "frappe",
  "cola",
  "lemonade",
  "juice",
  "avocado",
  "cheddar",
  "tofu",
  "bagel",
  "avengers",
  "titanic",
  "gladiator",
  "rocky",
  "matrix",
  "inception",
  "interstellar",
  "godfather",
  "smallville",
  "vikings",
  "breaking-bad",
  "better-call-saul",
  "game-of-thrones",
  "house-of-the-dragon",
  "the-sopranos",
  "friends",
  "seinfeld",
  "the-office",
  "lost",
  "narcos",
  "ozark",
  "dexter",
  "homeland",
  "blacklist",
  "sherlock",
  "hannibal",
  "lucifer",
  "superman",
  "batman",
  "spiderman",
  "deadpool",
  "wolverine",
  "ironman",
  "thor",
  "hulk",
  "aquaman",
  "daredevil",
  "punisher",
  "flash",
  "arrow",
  "legends",
  "gotham",
  "watchmen",
  "invincible",
  "the-boys",
  "mandalorian",
  "kenobi",
  "andor",
  "loki",
  "wanda-vision",
  "hawkeye",
  "eternals",
  "joker",
  "avatar",
  "dune",
  "tenet",
  "memento",
  "prestige",
  "dunkirk",
  "oppenheimer",
  "barbie",
  "transformers",
  "terminator",
  "predator",
  "alien",
  "blade",
  "tron",
  "robocop",
  "mad-max",
  "fury-road",
  "john-wick",
  "taken",
  "equalizer",
  "expendables",
  "rambo",
  "rush",
  "ford-ferrari",
  "rush-hour",
  "bad-boys",
  "men-in-black",
  "ghost-busters",
  "jurassic-world",
  "kong",
  "godzilla",
  "pacific-rim",
  "pirates-of-caribbean",
  "harry-potter",
  "twilight",
  "hunger-games",
  "divergent",
  "maze",
  "fallout",
  "silo",
  "severance",
  "chernobyl",
  "westworld",
  "suits",
  "billions",
  "peaky-blinders",
];

export class EnvironmentsService {
  constructor(private readonly bus = new HostActionBusService()) {}

  async create(
    input: CreateEnvironmentPayload,
    createdBy: EnvironmentOwner | PullRequestRef,
  ): Promise<EnvironmentRecord> {
    logEnvironment("info", "create_start", {
      requestedSeed: input.seed,
      requestedBranch: input.source.branch,
      requestedCommit: input.source.commit,
      inputEnvKeys: Object.keys(input.env ?? {}).sort(),
      owner: "email" in createdBy ? createdBy.email : createdBy.url,
    });
    const key = await this.generateKey();
    logEnvironment("info", "create_key_generated", { key });

    if (!keyPattern.test(key)) {
      throw Object.assign(
        new Error("Environment key must be a lowercase slug"),
        { status: 400 },
      );
    }

    logEnvironment("info", "create_seed_assert_start", {
      key,
      seed: input.seed,
      seedsDir: env.SEEDS_DIR,
      hostSeedsDir: env.HOST_SEEDS_DIR,
    });
    await this.assertSeedReady(input.seed);
    logEnvironment("info", "create_seed_assert_done", {
      key,
      seed: input.seed,
    });

    const existing = await EnvironmentCollection.getSilent(key);

    if (existing) {
      throw Object.assign(new Error(`Environment already exists: ${key}`), {
        status: 409,
      });
    }

    const port = await this.nextAvailablePort();
    const runtimePath = path.join(env.HOST_RUNTIME_DIR, key);
    logEnvironment("info", "create_requested", {
      key,
      port,
      branch: input.source.branch,
      commit: input.source.commit,
      seed: input.seed,
      owner: "email" in createdBy ? createdBy.email : createdBy.url,
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

    logEnvironment("info", "create_db_insert_start", {
      key,
      port,
      runtimePath,
    });
    await EnvironmentCollection.create(record);
    logEnvironment("info", "create_db_insert_done", {
      key,
      status: record.status,
    });

    logEnvironment("info", "create_system_event_start", {
      key,
      event: "environment.created",
    });
    await this.logSystemEvent(
      key,
      "environment.created",
      "Environment created",
      {
        actor: actorFromOwnerOrPullRequest(createdBy),
        source: "email" in createdBy ? "api" : "github",
        target: targetForEnvironment(key, createdBy),
        metadata: {
          branch: input.source.branch,
          commit: input.source.commit,
          seed: input.seed,
          port,
        },
      },
    );
    logEnvironment("info", "create_system_event_done", {
      key,
      event: "environment.created",
    });

    logEnvironment("info", "create_prepare_background_start", {
      key,
      runtimePath,
      seed: input.seed,
      branch: input.source.branch,
      commit: input.source.commit,
      envKeys: Object.keys(input.env ?? {}).sort(),
    });
    void this.prepareEnvironment(key, runtimePath, input.seed, input.source, {
      ...input.env,
      PROXY_EXTERNAL_PORT: String(port),
    }).catch(async (error) => {
      logEnvironment("error", "create_failed", {
        key,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        status: isRecord(error) ? error.status : undefined,
        hostActionId: isRecord(error) ? error.hostActionId : undefined,
        outputLength:
          isRecord(error) && typeof error.output === "string"
            ? error.output.length
            : undefined,
        outputTail:
          isRecord(error) && typeof error.output === "string"
            ? tailText(error.output)
            : undefined,
      });
      await this.logSystemEvent(
        key,
        "environment.failed",
        `Environment creation failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          level: "error",
          actor: actorFromOwnerOrPullRequest(createdBy),
          source: "email" in createdBy ? "api" : "github",
          target: targetForEnvironment(key, createdBy),
          metadata: { phase: "create" },
        },
      );
      await this.updateStatus(key, "failed").catch(() => undefined);
      logEnvironment("info", "create_failed_status_marked", {
        key,
        status: "failed",
      });
    });

    logEnvironment("info", "create_returning_record", {
      key,
      status: record.status,
      port,
    });
    return record;
  }

  private async prepareEnvironment(
    key: string,
    runtimePath: string,
    seedName: string,
    source: EnvironmentSource,
    environmentVariables: Record<string, string>,
  ): Promise<void> {
    logEnvironment("info", "prepare_started", {
      key,
      runtimePath,
      branch: source.branch,
      commit: source.commit,
    });
    await this.logSystemEvent(
      key,
      "environment.prepare_started",
      "Preparing repository",
      {
        metadata: {
          branch: source.branch,
          commit: source.commit,
          seed: seedName,
        },
      },
    );

    await this.updateStatus(key, "cloning");
    const updatePrepareStatusFromLog: HostActionLogHandler = async ({
      log,
    }) => {
      logEnvironment("info", "prepare_worker_log", {
        key,
        line: log.length > 3000 ? `${log.slice(0, 3000)}...` : log,
      });
      const nextStatus = prepareStatusFromLog(log);
      if (nextStatus) {
        logEnvironment("info", "prepare_status_from_worker_log", {
          key,
          nextStatus,
          line: log,
        });
        await this.updateStatus(key, nextStatus).catch(() => undefined);
      }
    };

    logEnvironment("info", "prepare_publish_start", {
      key,
      runtimePath,
      seedName,
      source,
      hostSeedsDir: env.HOST_SEEDS_DIR,
      sourceRepoUrl: redactUrl(env.SOURCE_REPO_URL),
      environmentVariableKeys: Object.keys(environmentVariables).sort(),
    });
    const result = await this.publishEnvironmentAction(
      "environment.prepare",
      key,
      {
        runtimePath,
        seedName,
        hostSeedsDir: env.HOST_SEEDS_DIR,
        source,
        sourceRepoUrl: env.SOURCE_REPO_URL,
        environmentVariables: {
          ...environmentVariables,
          COMPANY_HOST: env.ROOT_DOMAIN_ALT,
          PLATFORM_HOST: env.ROOT_DOMAIN,
          NETWORK_NAME: `primarie-${key}-net`,
          ENV_KEY: key,
          ENV_PORT: String((await EnvironmentCollection.get(key)).port),
          MONGO_DATABASE: "primarie",
        },
      },
      updatePrepareStatusFromLog,
    );
    logEnvironment("info", "prepare_publish_done", {
      key,
      hostActionId: result.id,
      status: result.status,
      message: result.message,
      outputLength: result.output?.length ?? 0,
      outputTail: tailText(result.output),
    });

    await this.logSystemEvent(
      key,
      "environment.prepared",
      result.message || "Repository prepared",
      {
        metadata: {
          branch: source.branch,
          commit: source.commit,
          outputLength: result.output?.length ?? 0,
        },
      },
    );

    await this.updateStatus(key, "stopped");
    logEnvironment("info", "prepare_completed", { key, status: "stopped" });
  }

  private async assertSeedReady(seedName: string): Promise<void> {
    const seedPath = path.join(env.SEEDS_DIR, seedName);
    const mongoPath = path.join(seedPath, "mongodb");
    const seedStat = await fs.stat(seedPath).catch(() => null);
    const mongoStat = await fs.stat(mongoPath).catch(() => null);

    if (!seedStat?.isDirectory()) {
      throw Object.assign(new Error(`Seed folder not found: ${seedName}`), {
        status: 400,
      });
    }

    if (!mongoStat?.isDirectory()) {
      throw Object.assign(new Error(`Seed is not prepared yet: ${seedName}`), {
        status: 400,
      });
    }
  }

  async list(): Promise<EnvironmentRecord[]> {
    return EnvironmentCollection.list();
  }

  async get(key: string): Promise<EnvironmentRecord> {
    const record = await EnvironmentCollection.get(key);
    if (!record) {
      throw Object.assign(new Error(`Environment not found: ${key}`), {
        status: 404,
      });
    }
    return record;
  }

  async getLogs(key: string, page: number, perPage: number) {
    return SystemLogCollection.listByEnvironment(key, page, perPage);
  }

  async getAllLogs(page: number, perPage: number) {
    return SystemLogCollection.list(page, perPage);
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
      storage,
    };
  }

  async listContainers(key: string): Promise<unknown[]> {
    const record = await this.get(key);
    const result = await this.publishEnvironmentAction(
      "environment.containers.inspect",
      key,
    );
    const output = result.output?.trim() ?? "";
    if (!output) {
      return [];
    }

    const containers = parseJsonLinesOrArray(output);
    const runningCount = containers.filter(isRunningContainer).length;
    logEnvironment("info", "containers_listed", {
      key,
      status: record.status,
      count: containers.length,
      runningCount,
      proxyRunning: containers.some(
        (container) =>
          isContainerService(container, "proxy") &&
          isRunningContainer(container),
      ),
    });

    if (
      (record.status === "starting" ||
        record.status === "stopped" ||
        record.status === "failed") &&
      runningCount > 0
    ) {
      await this.updateStatus(key, "running").catch((error) => {
        logEnvironment("warn", "container_status_restore_failed", {
          key,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }

    return containers;
  }

  async listContainerFiles(key: string, container: string, targetPath: string) {
    await this.get(key);
    const result = await this.publishEnvironmentAction(
      "environment.container.files",
      key,
      { container, path: targetPath || "/" },
    );
    return parseJsonValue(result.output ?? "[]");
  }

  async listEnvironmentFiles(key: string, targetPath: string) {
    await this.get(key);
    const rootPath = path.resolve(env.RUNTIME_DIR, key);
    const absolutePath = resolveInside(rootPath, targetPath || "/");
    const entries = await fs
      .readdir(absolutePath, { withFileTypes: true })
      .catch((error) => {
        if (isNodeError(error) && error.code === "ENOENT") {
          return [];
        }
        throw error;
      });

    const files = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(absolutePath, entry.name);
        const stats = await fs.stat(entryPath);
        const relativePath = `/${path.relative(rootPath, entryPath).split(path.sep).join("/")}`;
        return {
          path: relativePath,
          name: entry.name,
          type: entry.isDirectory()
            ? "directory"
            : entry.isFile()
              ? "file"
              : "other",
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        };
      }),
    );
    logEnvironment("info", "environment_files_listed", {
      key,
      targetPath,
      rootPath,
      absolutePath,
      count: files.length,
    });
    return files;
  }

  async execInContainer(key: string, container: string, command: string) {
    await this.get(key);
    await this.logSystemEvent(
      key,
      "environment.container_exec",
      `Executing in ${container}: ${command}`,
      {
        metadata: { container, command },
      },
    );
    const result = await this.publishEnvironmentAction(
      "environment.container.exec",
      key,
      { container, command },
    );
    return parseJsonValue(result.output ?? "{}");
  }

  async createLifecycleAction(
    key: string,
    action: LifecycleAction,
    user: AuthenticatedUser,
  ) {
    await this.get(key);

    const activeAction =
      await EnvironmentActionCollection.findActiveByEnvironment(key);
    if (activeAction) {
      logEnvironment("info", "lifecycle_action_reused", {
        key,
        requestedAction: action,
        activeAction: activeAction.action,
        activeActionId: activeAction.id,
        activeStatus: activeAction.status,
        activeLogPath: this.actionLogPath(activeAction.id, activeAction.logFile),
      });
      return activeAction;
    }

    const id = randomUUID();
    const logFile = await this.reserveActionLogFile(id);
    await EnvironmentActionCollection.create({
      id,
      environmentKey: key,
      action,
      status: "queued",
      requestedBy: this.toOwner(user),
      logFile,
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

  async getLifecycleActionLogs(
    id: string,
    cursor: string | undefined,
    limit: number,
  ) {
    const action = await EnvironmentActionCollection.get(id);
    const logPath = this.actionLogPath(action.id, action.logFile);
    const page = await readActionLogPage(id, logPath, cursor, limit);
    logEnvironment("info", "action_log_page_read", {
      actionId: id,
      environment: action.environmentKey,
      action: action.action,
      actionStatus: action.status,
      logPath,
      cursor,
      limit,
      itemCount: page.items.length,
      hasMore: page.hasMore,
    });
    return page;
  }

  async getLifecycleActionLogSize(id: string) {
    const action = await EnvironmentActionCollection.get(id);
    return readFileSize(this.actionLogPath(action.id, action.logFile));
  }

  async getLifecycleActionLogTailStart(id: string, limit: number) {
    const action = await EnvironmentActionCollection.get(id);
    const page = await readActionLogPage(
      id,
      this.actionLogPath(action.id, action.logFile),
      undefined,
      limit,
    );
    return (
      page.items[0]?.byteStart ??
      (await readFileSize(this.actionLogPath(action.id, action.logFile)))
    );
  }

  async getLifecycleActionLogsFrom(id: string, fromOffset: number) {
    const action = await EnvironmentActionCollection.get(id);
    const logPath = this.actionLogPath(action.id, action.logFile);
    const page = await readActionLogForward(id, logPath, fromOffset);
    logEnvironment("info", "action_log_forward_read", {
      actionId: id,
      environment: action.environmentKey,
      action: action.action,
      actionStatus: action.status,
      logPath,
      fromOffset,
      nextOffset: page.offset,
      logSize: page.size,
      itemCount: page.items.length,
    });
    return page;
  }

  private async runLifecycleActionJob(
    id: string,
    key: string,
    action: LifecycleAction,
    user: AuthenticatedUser,
  ): Promise<void> {
    logEnvironment("info", "lifecycle_job_started", {
      key,
      action,
      actionId: id,
      user: user.email,
    });
    await EnvironmentActionCollection.update(id, { status: "running" });

    try {
      const environment = await this.streamLifecycleAction(
        key,
        action,
        user,
        async () => undefined,
        undefined,
        id,
      );

      await EnvironmentActionCollection.update(id, {
        status: "complete",
        environment,
        completedAt: new Date(),
        logFile: await this.refreshActionLogFile(id),
      });
      logEnvironment("info", "lifecycle_job_completed", {
        key,
        action,
        actionId: id,
        status: environment.status,
      });
      if (action === "delete") {
        setTimeout(() => {
          void this.cleanupEnvironmentData(key).catch((error) => {
            logEnvironment("error", "cleanup_failed", {
              key,
              message: error instanceof Error ? error.message : String(error),
            });
          });
        }, 3000);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logEnvironment("error", "lifecycle_job_failed", {
        key,
        action,
        actionId: id,
        message,
      });
      await fs
        .appendFile(this.actionLogPath(id), `${message}\n`, "utf8")
        .catch(() => undefined);
      await EnvironmentActionCollection.update(id, {
        status: "error",
        error: message,
        completedAt: new Date(),
        logFile: await this.refreshActionLogFile(id),
      }).catch(() => undefined);
    }
  }

  async streamLifecycleAction(
    key: string,
    action: LifecycleAction,
    user: AuthenticatedUser,
    onLog: (entry: {
      log: string;
      level: "info" | "error";
    }) => Promise<void> | void,
    signal?: AbortSignal,
    hostActionId?: string,
  ): Promise<EnvironmentRecord> {
    const record = await this.get(key);

    if (action === "resume") {
      const owner = this.toOwner(user);
      if (
        !("email" in record.createdBy) ||
        record.createdBy.email !== owner.email
      ) {
        throw Object.assign(
          new Error("Only the owner can reuse this environment"),
          { status: 403 },
        );
      }
    }

    await onLog({
      log: `${capitalize(action)} environment ${key}`,
      level: "info",
    });
    logEnvironment("info", "lifecycle_action_started", {
      key,
      action,
      currentStatus: record.status,
    });

    try {
      if (action === "start" || action === "resume") {
        if (record.status === "running") {
          await onLog({ log: "Environment is already running", level: "info" });
          return record;
        }
        if (record.status === "starting") {
          await onLog({
            log: "Environment start is already in progress",
            level: "info",
          });
          logEnvironment("info", "lifecycle_action_in_progress", {
            key,
            action,
            status: record.status,
          });
          return record;
        }
        throwIfAborted(signal);
        await this.updateStatus(key, "starting");
        const result = await this.publishEnvironmentAction(
          "environment.start",
          key,
          {},
          onLog,
          hostActionId,
        ).catch(async (error) => {
          const recovered = await this.recoverRunningEnvironmentFromContainers(
            key,
            action,
            error,
            onLog,
            hostActionId,
          );
          if (recovered) {
            return recovered;
          }
          throw error;
        });
        await emitBusResult(result, onLog);
        if (isHostActionAlreadyRunning(result)) {
          logEnvironment("info", "lifecycle_action_in_progress", {
            key,
            action,
            message: result.message,
          });
          return this.get(key);
        }
        await onLog({
          log: `Environment ${action === "resume" ? "resumed" : "started"}`,
          level: "info",
        });
        const updated = await this.updateStatus(key, "running");
        await this.logSystemEvent(
          key,
          action === "resume" ? "environment.resumed" : "environment.started",
          `Environment ${action === "resume" ? "resumed" : "started"}`,
          {
            actor: actorFromUser(user),
            actionId: hostActionId,
            metadata: { action, previousStatus: record.status },
          },
        );
        logEnvironment("info", "lifecycle_action_completed", {
          key,
          action,
          status: updated.status,
        });
        return updated;
      }

      if (action === "restart") {
        if (record.status === "starting") {
          await onLog({
            log: "Environment start is already in progress",
            level: "info",
          });
          logEnvironment("info", "lifecycle_action_in_progress", {
            key,
            action,
            status: record.status,
          });
          return record;
        }
        throwIfAborted(signal);
        await this.updateStatus(key, "starting");
        const result = await this.publishEnvironmentAction(
          "environment.restart",
          key,
          {},
          onLog,
          hostActionId,
        ).catch(async (error) => {
          const recovered = await this.recoverRunningEnvironmentFromContainers(
            key,
            action,
            error,
            onLog,
            hostActionId,
          );
          if (recovered) {
            return recovered;
          }
          throw error;
        });
        await emitBusResult(result, onLog);
        if (isHostActionAlreadyRunning(result)) {
          logEnvironment("info", "lifecycle_action_in_progress", {
            key,
            action,
            message: result.message,
          });
          return this.get(key);
        }
        await onLog({ log: "Environment restarted", level: "info" });
        const updated = await this.updateStatus(key, "running");
        await this.logSystemEvent(
          key,
          "environment.restarted",
          "Environment restarted",
          {
            actor: actorFromUser(user),
            actionId: hostActionId,
            metadata: { action, previousStatus: record.status },
          },
        );
        logEnvironment("info", "lifecycle_action_completed", {
          key,
          action,
          status: updated.status,
        });
        return updated;
      }

      if (action === "delete") {
        if (record.status === "removing") {
          await onLog({
            log: "Environment removal is already in progress",
            level: "info",
          });
          logEnvironment("info", "lifecycle_action_in_progress", {
            key,
            action,
            status: record.status,
          });
          return record;
        }
        throwIfAborted(signal);
        await this.updateStatus(key, "removing");
        await this.logSystemEvent(
          key,
          "environment.remove_requested",
          "Removing environment",
          {
            actor: actorFromUser(user),
            target: targetForEnvironment(key, record.createdBy),
            actionId: hostActionId,
            metadata: { action, previousStatus: record.status },
          },
        );
        const result = await this.publishEnvironmentAction(
          "environment.remove",
          key,
          {},
          onLog,
          hostActionId,
        );
        await emitBusResult(result, onLog);
        if (isHostActionAlreadyRunning(result)) {
          logEnvironment("info", "lifecycle_action_in_progress", {
            key,
            action,
            message: result.message,
          });
          return this.get(key);
        }
        await onLog({ log: "Environment removed", level: "info" });
        const removed = await this.updateStatus(key, "removed");
        await this.logSystemEvent(
          key,
          "environment.removed",
          "Environment removed",
          {
            actor: actorFromUser(user),
            target: targetForEnvironment(key, record.createdBy),
            actionId: hostActionId,
            metadata: { action, previousStatus: record.status },
          },
        );
        await this.cleanupEnvironmentData(key, {
          preserveActionId: hostActionId,
        });
        logEnvironment("info", "lifecycle_action_completed", {
          key,
          action,
          status: removed.status,
        });
        return removed;
      }

      throwIfAborted(signal);
      const result = await this.publishEnvironmentAction(
        "environment.stop",
        key,
        {},
        onLog,
        hostActionId,
      );
      await emitBusResult(result, onLog);
      if (isHostActionAlreadyRunning(result)) {
        logEnvironment("info", "lifecycle_action_in_progress", {
          key,
          action,
          message: result.message,
        });
        return this.get(key);
      }
      await onLog({ log: "Environment stopped", level: "info" });
      const updated = await this.updateStatus(key, "stopped");
      await this.logSystemEvent(
        key,
        "environment.stopped",
        "Environment stopped",
        {
          actor: actorFromUser(user),
          actionId: hostActionId,
          metadata: { action, previousStatus: record.status },
        },
      );
      logEnvironment("info", "lifecycle_action_completed", {
        key,
        action,
        status: updated.status,
      });
      return updated;
    } catch (error) {
      if (action !== "stop") {
        await this.updateStatus(key, "failed").catch(() => undefined);
      }
      logEnvironment("error", "lifecycle_action_failed", {
        key,
        action,
        message: error instanceof Error ? error.message : String(error),
      });
      await this.logSystemEvent(
        key,
        "environment.failed",
        `${capitalize(action)} failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          level: "error",
          actor: actorFromUser(user),
          actionId: hostActionId,
          metadata: { action, previousStatus: record.status },
        },
      ).catch(() => undefined);
      throw error;
    }
  }

  async streamContainerLogs(
    key: string,
    container: string,
    onLog: (entry: {
      log: string;
      level: "info" | "error";
    }) => Promise<void> | void,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.get(key);
    void signal;
    const result = await this.publishEnvironmentAction(
      "environment.container.logs",
      key,
      { container, tailLines: 300 },
    );
    for (const line of splitLogLines(result.output)) {
      await onLog({ log: line, level: "info" });
    }
  }

  async streamComposeLogs(
    key: string,
    onLog: (entry: {
      log: string;
      level: "info" | "error";
    }) => Promise<void> | void,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.get(key);
    void signal;
    const result = await this.publishEnvironmentAction(
      "environment.compose.logs",
      key,
      { tailLines: 300 },
    );
    for (const line of splitLogLines(result.output)) {
      await onLog({ log: line, level: "info" });
    }
  }

  async listContainerLogs(
    key: string,
    container: string,
    page = 0,
    perPage = 50,
  ) {
    await this.get(key);
    const safePage = Math.max(0, Number.isFinite(page) ? Math.floor(page) : 0);
    const safePerPage = Math.max(
      1,
      Math.min(100, Number.isFinite(perPage) ? Math.floor(perPage) : 50),
    );
    const tailLines = (safePage + 1) * safePerPage;
    const result = await this.publishEnvironmentAction(
      "environment.container.logs",
      key,
      { container, tailLines },
    );
    const lines = splitLogLines(result.output);
    const pageEnd = Math.max(0, lines.length - safePage * safePerPage);
    const pageStart = Math.max(0, pageEnd - safePerPage);

    return lines
      .slice(pageStart, pageEnd)
      .map((log) => ({ log, level: "info" as const }));
  }

  async listComposeLogs(key: string, page = 0, perPage = 50) {
    await this.get(key);
    const safePage = Math.max(0, Number.isFinite(page) ? Math.floor(page) : 0);
    const safePerPage = Math.max(
      1,
      Math.min(100, Number.isFinite(perPage) ? Math.floor(perPage) : 50),
    );
    const tailLines = (safePage + 1) * safePerPage;
    const result = await this.publishEnvironmentAction(
      "environment.compose.logs",
      key,
      { tailLines },
    );
    const lines = (result.output ?? "")
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    const pageEnd = Math.max(0, lines.length - safePage * safePerPage);
    const pageStart = Math.max(0, pageEnd - safePerPage);

    return lines
      .slice(pageStart, pageEnd)
      .map((log) => ({ log, level: "info" as const }));
  }

  async inspectMongo(key: string) {
    await this.get(key);
    const result = await this.publishEnvironmentAction(
      "environment.mongo.inspect",
      key,
      {
        operation: "preview",
        limit: 20,
        maxBytes: 50_000,
        maxDocBytes: 2_000,
      },
    );
    return parseMongoPreviewOutput(result.output ?? "{}");
  }

  async listMongoCollections(key: string) {
    await this.get(key);
    const result = await this.publishEnvironmentAction(
      "environment.mongo.inspect",
      key,
      {
        operation: "collections",
      },
    );
    return parseMongoJsonValue(result.output ?? "{}");
  }

  async searchMongoDocuments(
    key: string,
    collection: string,
    input: MongoSearchDocumentsPayload,
  ) {
    await this.get(key);
    const result = await this.publishEnvironmentAction(
      "environment.mongo.inspect",
      key,
      {
        operation: "search",
        collection,
        filter: input.filter,
        page: input.page,
        limit: input.limit,
        sort: input.sort,
      },
    );
    return parseMongoJsonValue(result.output ?? "{}");
  }

  async insertMongoDocuments(
    key: string,
    collection: string,
    input: MongoInsertDocumentsPayload,
    user: AuthenticatedUser,
  ) {
    await this.get(key);
    const result = await this.publishEnvironmentAction(
      "environment.mongo.command",
      key,
      {
        operation: "insert",
        collection,
        documents: input.documents,
      },
    );
    const parsed = parseMongoJsonValue(result.output ?? "{}");
    await this.logSystemEvent(
      key,
      "environment.mongo_insert",
      `Inserted MongoDB documents into ${collection}`,
      {
        actor: actorFromUser(user),
        metadata: {
          collection,
          requestedCount: input.documents.length,
          result: parsed,
        },
      },
    );
    return parsed;
  }

  async deleteMongoDocuments(
    key: string,
    collection: string,
    input: MongoDeleteDocumentsPayload,
    user: AuthenticatedUser,
  ) {
    await this.get(key);
    assertMongoFilterSafety(input.filter, input.allowEmptyFilter === true);
    const result = await this.publishEnvironmentAction(
      "environment.mongo.command",
      key,
      {
        operation: "delete",
        collection,
        filter: input.filter,
        many: input.many,
        confirm: input.confirm,
        allowEmptyFilter: input.allowEmptyFilter === true,
      },
    );
    const parsed = parseMongoJsonValue(result.output ?? "{}");
    await this.logSystemEvent(
      key,
      "environment.mongo_delete",
      `Deleted MongoDB documents from ${collection}`,
      {
        level: "warn",
        actor: actorFromUser(user),
        metadata: {
          collection,
          many: input.many,
          filter: input.filter,
          result: parsed,
        },
      },
    );
    return parsed;
  }

  async updateMongoDocuments(
    key: string,
    collection: string,
    input: MongoUpdateDocumentsPayload,
    user: AuthenticatedUser,
  ) {
    await this.get(key);
    assertMongoFilterSafety(input.filter, input.allowEmptyFilter === true);
    assertMongoUpdateSafety(input.update);
    const result = await this.publishEnvironmentAction(
      "environment.mongo.command",
      key,
      {
        operation: "update",
        collection,
        filter: input.filter,
        update: input.update,
        many: input.many,
        confirm: input.confirm,
        allowEmptyFilter: input.allowEmptyFilter === true,
      },
    );
    const parsed = parseMongoJsonValue(result.output ?? "{}");
    await this.logSystemEvent(
      key,
      "environment.mongo_update",
      `Updated MongoDB documents in ${collection}`,
      {
        actor: actorFromUser(user),
        metadata: {
          collection,
          many: input.many,
          filter: input.filter,
          update: input.update,
          result: parsed,
        },
      },
    );
    return parsed;
  }

  async importProdTennant(
    key: string,
    input: ImportProdTennantPayload,
    user: AuthenticatedUser,
  ) {
    await this.get(key);
    if (!env.SIGNATURE_SECRET) {
      throw Object.assign(new Error("SIGNATURE_SECRET is not configured."), {
        status: 500,
      });
    }

    const exportUrl = "https://api.primarie.md/tennants.export";
    const signature = createProdTennantExportSignature(input.tennant);
    logEnvironment("info", "prod_tennant_import_started", {
      key,
      tennant: input.tennant,
      exportUrl,
    });
    const result = await this.publishEnvironmentAction(
      "environment.mongo.importProdTennant",
      key,
      {
        operation: "importProdTennant",
        tennant: input.tennant,
        exportUrl,
        signature,
      },
    );
    const parsed = parseMongoJsonValue(result.output ?? "{}");
    await this.logSystemEvent(
      key,
      "environment.mongo_import_prod_tennant",
      `Imported production tenant ${input.tennant}`,
      {
        actor: actorFromUser(user),
        metadata: {
          tennant: input.tennant,
          exportUrl,
          result: parsed,
        },
      },
    );
    logEnvironment("info", "prod_tennant_import_completed", {
      key,
      tennant: input.tennant,
      result: parsed,
    });
    return parsed;
  }

  async stop(
    key: string,
    user?: AuthenticatedUser,
  ): Promise<EnvironmentRecord> {
    const record = await this.get(key);

    await this.logSystemEvent(
      key,
      "environment.stop_requested",
      "Stopping environment",
      {
        actor: user ? actorFromUser(user) : undefined,
      },
    );

    await this.publishEnvironmentAction("environment.stop", key);

    await this.logSystemEvent(
      key,
      "environment.stopped",
      "Environment stopped",
      {
        actor: user ? actorFromUser(user) : undefined,
        metadata: { previousStatus: record.status },
      },
    );

    return this.updateStatus(record.key, "stopped");
  }

  async resume(
    key: string,
    user: AuthenticatedUser,
  ): Promise<EnvironmentRecord> {
    const record = await this.get(key);
    const owner = this.toOwner(user);
    if (
      !("email" in record.createdBy) ||
      record.createdBy.email !== owner.email
    ) {
      throw Object.assign(
        new Error("Only the owner can reuse this environment"),
        { status: 403 },
      );
    }

    await this.logSystemEvent(
      key,
      "environment.resume_requested",
      "Resuming environment",
      {
        actor: actorFromUser(user),
      },
    );

    if (record.status !== "running") {
      await this.updateStatus(key, "starting");
      await this.publishEnvironmentAction("environment.start", key);

      await this.logSystemEvent(
        key,
        "environment.resumed",
        "Environment resumed",
        {
          actor: actorFromUser(user),
          metadata: { previousStatus: record.status },
        },
      );
    }

    return this.updateStatus(key, "running");
  }

  async start(
    key: string,
    user?: AuthenticatedUser,
  ): Promise<EnvironmentRecord> {
    try {
      const record = await this.get(key);
      if (record.status === "starting") {
        await this.logSystemEvent(
          key,
          "environment.start_requested",
          "Start already in progress",
          {
            actor: user ? actorFromUser(user) : undefined,
            source: "system",
            metadata: { previousStatus: record.status },
          },
        );
        return record;
      }

      await this.logSystemEvent(
        key,
        "environment.start_requested",
        "Starting environment",
        {
          actor: user ? actorFromUser(user) : undefined,
          metadata: { previousStatus: record.status },
        },
      );
      await this.updateStatus(key, "starting");
      await this.publishEnvironmentAction("environment.start", key);
      await this.logSystemEvent(
        key,
        "environment.started",
        "Environment started",
        {
          actor: user ? actorFromUser(user) : undefined,
          metadata: { previousStatus: record.status },
        },
      );
      return this.updateStatus(key, "running");
    } catch (error) {
      await this.logSystemEvent(
        key,
        "environment.failed",
        `Environment start failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          level: "error",
          actor: user ? actorFromUser(user) : undefined,
          metadata: { action: "start" },
        },
      );
      await this.updateStatus(key, "failed");

      throw error;
    }
  }

  async restart(
    key: string,
    user?: AuthenticatedUser,
  ): Promise<EnvironmentRecord> {
    const record = await this.get(key);

    await this.logSystemEvent(
      key,
      "environment.restart_requested",
      "Restarting environment",
      {
        actor: user ? actorFromUser(user) : undefined,
        metadata: { previousStatus: record.status },
      },
    );

    await this.updateStatus(key, "starting");
    await this.publishEnvironmentAction("environment.restart", key);

    await this.logSystemEvent(
      key,
      "environment.restarted",
      "Environment restarted",
      {
        actor: user ? actorFromUser(user) : undefined,
        metadata: { previousStatus: record.status },
      },
    );

    return this.updateStatus(key, "running");
  }

  async syncFiles(
    key: string,
    input: SyncFilesPayload,
    user?: AuthenticatedUser,
  ): Promise<EnvironmentRecord> {
    const current = await this.get(key);
    logEnvironment("info", "sync_started", {
      key,
      branch: input.branch,
      commit: input.commit,
      files: syncPayloadChangeCount(input),
      mode: syncPayloadMode(input),
      status: current.status,
    });

    await this.logSystemEvent(
      key,
      "environment.files_sync_started",
      `Preparing environment with ${input.branch}@${input.commit}`,
      {
        actor: user ? actorFromUser(user) : undefined,
        metadata: {
          branch: input.branch,
          commit: input.commit,
          files: syncPayloadChangeCount(input),
          mode: syncPayloadMode(input),
          resetBeforeApply: input.resetBeforeApply ?? true,
        },
      },
    );

    try {
      await this.publishEnvironmentAction("environment.files.sync", key, {
        source: {
          branch: input.branch,
          commit: input.commit,
        },
        resetBeforeApply: input.resetBeforeApply ?? true,
        patch: input.patch,
      });

      await this.logSystemEvent(
        key,
        "environment.files_synced",
        "Environment synced successfully",
        {
          actor: user ? actorFromUser(user) : undefined,
          metadata: {
            branch: input.branch,
            commit: input.commit,
            mode: syncPayloadMode(input),
            files: input.patch.changedFiles.map((path) => ({
              path,
              status: "patched",
            })),
          },
        },
      );

      const updated = await EnvironmentCollection.update(
        current.key,
        (record) => {
          return {
            source: {
              ...record.source,
              branch: input.branch,
              commit: input.commit,
            },
          };
        },
      );
      logEnvironment("info", "sync_completed", {
        key,
        files: syncPayloadChangeCount(input),
        mode: syncPayloadMode(input),
        status: updated.status,
      });
      return updated;
    } catch (error) {
      const output =
        typeof error === "object" && error !== null && "output" in error
          ? String((error as { output?: unknown }).output ?? "")
          : "";
      const outputTail = tailText(output);
      const message = error instanceof Error ? error.message : String(error);
      logEnvironment("error", "sync_failed", {
        key,
        branch: input.branch,
        commit: input.commit,
        message,
        outputTail,
      });
      await this.logSystemEvent(
        key,
        "environment.files_sync_failed",
        [`Environment sync failed: ${message}`, outputTail]
          .filter(Boolean)
          .join("\n"),
        {
          level: "error",
          actor: user ? actorFromUser(user) : undefined,
          metadata: {
            branch: input.branch,
            commit: input.commit,
            mode: syncPayloadMode(input),
            files: input.patch.changedFiles.map((path) => ({
              path,
              status: "patched",
            })),
            preservedStatus: current.status,
            outputTail,
          },
        },
      ).catch(() => undefined);
      throw error;
    }
  }

  async delete(key: string, user?: AuthenticatedUser): Promise<void> {
    const record = await this.get(key);
    logEnvironment("info", "delete_started", { key, status: record.status });

    await this.updateStatus(key, "removing");

    await this.logSystemEvent(
      key,
      "environment.remove_requested",
      "Removing environment",
      {
        actor: user ? actorFromUser(user) : undefined,
        target: targetForEnvironment(key, record.createdBy),
        metadata: { previousStatus: record.status },
      },
    );

    await this.publishEnvironmentAction("environment.remove", record.key).catch(
      async (error) => {
        const output =
          typeof error === "object" && error !== null && "output" in error
            ? String((error as { output?: unknown }).output ?? "")
            : "";
        const outputTail = tailText(output);
        logEnvironment("error", "delete_failed", {
          key,
          message: error instanceof Error ? error.message : String(error),
          outputTail,
        });
        await this.logSystemEvent(
          key,
          "environment.failed",
          [
            `Environment remove failed: ${error instanceof Error ? error.message : String(error)}`,
            outputTail,
          ]
            .filter(Boolean)
            .join("\n"),
          {
            level: "error",
            actor: user ? actorFromUser(user) : undefined,
            target: targetForEnvironment(key, record.createdBy),
            metadata: { action: "remove", outputTail },
          },
        );
        throw error;
      },
    );

    await this.logSystemEvent(
      key,
      "environment.removed",
      "Environment removed",
      {
        actor: user ? actorFromUser(user) : undefined,
        target: targetForEnvironment(key, record.createdBy),
        metadata: { previousStatus: record.status },
      },
    );

    await this.updateStatus(key, "removed");
    await this.cleanupEnvironmentData(key);
    logEnvironment("info", "delete_completed", { key });
  }

  async identifyPrEnvironment(reference: PullRequestRef) {
    const records = await EnvironmentCollection.list();
    const matching = records.find(
      (record) =>
        "title" in record.createdBy &&
        this.samePullRequest(record.createdBy, reference),
    );

    if (!matching) {
      throw Object.assign(new Error("Pull request environment not found"), {
        status: 404,
      });
    }

    return matching;
  }

  async replacePullRequestEnvironment(
    pullRequest: PullRequestRef,
    source: EnvironmentSource,
  ): Promise<EnvironmentRecord> {
    await this.deletePullRequestEnvironments(pullRequest).catch(
      () => undefined,
    );

    const record = await this.create(
      {
        source,
        seed: "default",
        env: {},
      },
      pullRequest,
    );

    await this.logSystemEvent(
      record.key,
      "environment.pr_updated",
      "Pull request environment updated",
      {
        actor: actorFromPullRequest(pullRequest),
        source: "github",
        target: targetForEnvironment(record.key, pullRequest),
        metadata: {
          branch: source.branch,
          commit: source.commit,
        },
      },
    );

    return record;
  }

  async deletePullRequestEnvironments(
    reference: PullRequestRef,
  ): Promise<void> {
    const matching = await this.identifyPrEnvironment(reference);

    await this.logSystemEvent(
      matching.key,
      "environment.pr_removed",
      "Deleting pull request environment",
      {
        actor: actorFromPullRequest(reference),
        source: "github",
        target: targetForEnvironment(matching.key, reference),
      },
    );

    await this.delete(matching.key);
  }

  private async publishEnvironmentAction(
    type: string,
    key: string,
    payload: Record<string, unknown> = {},
    onLog?: HostActionLogHandler,
    actionId?: string,
  ): Promise<HostActionResult> {
    const startedAt = Date.now();
    logEnvironment("info", "bus_action_publish", {
      key,
      type,
      actionId,
      timeoutMs: hostActionTimeoutMs(type),
      payloadKeys: Object.keys(payload).sort(),
    });
    const record = await EnvironmentCollection.get(key);
    logEnvironment("info", "bus_action_record_loaded", {
      key,
      type,
      recordFound: Boolean(record),
      recordStatus: record?.status,
      recordPort: record?.port,
    });
    const proxyUpstreamHost = await resolveHost(env.PROXY_UPSTREAM_HOST);
    const busPayload = {
      environment: key,
      environmentPort: record?.port,
      proxyUpstreamHost,
      runtimeRoot: env.HOST_RUNTIME_DIR,
      runtimePath: path.join(env.HOST_RUNTIME_DIR, key),
      ...payload,
    };
    logEnvironment("info", "bus_action_payload_ready", {
      key,
      type,
      proxyUpstreamHost,
      payload: summarizeEnvironmentBusPayload(busPayload),
    });
    const result = await this.bus.publish(
      type,
      busPayload,
      hostActionTimeoutMs(type),
      onLog,
      { id: actionId },
    );

    if (!isReadOnlyHostAction(type)) {
      await this.logHostActionResult(key, type, result, actionId);
    }
    logEnvironment("info", "bus_action_completed", {
      key,
      type,
      status: result.status,
      message: result.message,
      outputLength: result.output?.length ?? 0,
      outputTail: tailText(result.output),
      durationMs: Date.now() - startedAt,
      hostActionId: result.id,
    });
    return result;
  }

  private async logHostActionResult(
    key: string,
    type: string,
    result: HostActionResult,
    actionId?: string,
  ): Promise<void> {
    await this.logSystemEvent(
      key,
      "host_action.completed",
      result.message || `${type} completed`,
      {
        source: "worker",
        actionId: actionId ?? result.id,
        metadata: {
          hostActionId: result.id,
          type,
          status: result.status,
          outputLength: result.output?.length ?? 0,
        },
      },
    );
  }

  private async recoverRunningEnvironmentFromContainers(
    key: string,
    action: LifecycleAction,
    error: unknown,
    onLog: HostActionLogHandler,
    actionId?: string,
  ): Promise<HostActionResult | undefined> {
    const containers = await this.listContainers(key).catch((inspectError) => {
      logEnvironment("warn", "container_recovery_inspect_failed", {
        key,
        action,
        message:
          inspectError instanceof Error
            ? inspectError.message
            : String(inspectError),
      });
      return [];
    });
    const runningCount = containers.filter(isRunningContainer).length;
    if (runningCount === 0) {
      return undefined;
    }

    const originalMessage =
      error instanceof Error ? error.message : String(error);
    const message = `${capitalize(action)} host action did not finish cleanly, but ${runningCount} running container${runningCount === 1 ? "" : "s"} were found.`;
    logEnvironment("warn", "container_recovery_running", {
      key,
      action,
      runningCount,
      message: originalMessage,
    });
    await onLog({ log: `${message} ${originalMessage}`, level: "info" });
    return {
      id: actionId ?? randomUUID(),
      status: "success",
      message,
    };
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

  private async updateStatus(
    key: string,
    status: EnvironmentRecord["status"],
  ): Promise<EnvironmentRecord> {
    const updated = await EnvironmentCollection.update(key, (record) => {
      return {
        ...record,
        status,
      };
    });
    logEnvironment("info", "status_changed", { key, status });
    return updated;
  }

  private async reserveActionLogFile(
    id: string,
  ): Promise<EnvironmentActionLogFile> {
    const logFilePath = this.actionLogPath(id);
    const logDir = path.dirname(logFilePath);
    await fs.mkdir(logDir, { recursive: true });
    await fs.chmod(logDir, 0o777).catch(() => undefined);
    const createdAt = new Date();
    return {
      path: logFilePath,
      driver: "file",
      createdAt,
      updatedAt: createdAt,
      sizeBytes: 0,
    };
  }

  private async refreshActionLogFile(
    id: string,
  ): Promise<EnvironmentActionLogFile> {
    const action = await EnvironmentActionCollection.get(id).catch(
      () => undefined,
    );
    const existing = action?.logFile;
    const logFilePath = this.actionLogPath(id, existing);
    const stats = await fs.stat(logFilePath).catch(() => undefined);
    return {
      path: logFilePath,
      driver: "file",
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: stats?.mtime ?? new Date(),
      sizeBytes: stats?.size ?? 0,
    };
  }

  private actionLogPath(
    id: string,
    logFile?: EnvironmentActionLogFile,
  ): string {
    return logFile?.path ?? path.join(env.BUS_LOGS_DIR, `${id}.log`);
  }

  private async cleanupEnvironmentData(
    key: string,
    options: { preserveActionId?: string } = {},
  ): Promise<void> {
    const actions = await EnvironmentActionCollection.listAllByEnvironment(key);
    const actionIdsFromLogs =
      await SystemLogCollection.actionIdsByEnvironment(key);
    const actionRecordIds = new Set(actions.map((action) => action.id));
    await Promise.all(
      actions
        .filter((action) => action.id !== options.preserveActionId)
        .map((action) => this.deleteActionLogFile(action)),
    );
    await Promise.all(
      actionIdsFromLogs
        .filter(
          (actionId) =>
            actionId !== options.preserveActionId &&
            !actionRecordIds.has(actionId),
        )
        .map((actionId) => this.deleteLogPath(this.actionLogPath(actionId))),
    );
    await EnvironmentActionCollection.deleteByEnvironment(
      key,
      options.preserveActionId,
    );
    // Keep Mongo-backed system logs as the persisted audit trail for removed environments.
    await EnvironmentCollection.delete(key);
    logEnvironment("info", "cleanup_completed", {
      key,
      actionRecords: actions.filter(
        (action) => action.id !== options.preserveActionId,
      ).length,
      hostActionLogs: actionIdsFromLogs.filter(
        (actionId) =>
          actionId !== options.preserveActionId &&
          !actionRecordIds.has(actionId),
      ).length,
      preservedActionId: options.preserveActionId,
    });
  }

  private async deleteActionLogFile(
    action: EnvironmentActionRecord,
  ): Promise<void> {
    await this.deleteLogPath(this.actionLogPath(action.id, action.logFile));
  }

  private async deleteLogPath(logPath: string): Promise<void> {
    await fs.unlink(logPath).catch((error) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    });
  }

  private async logSystemEvent(
    environmentKey: string,
    event: string,
    message: string,
    options: {
      level?: SystemLogLevel;
      source?: SystemLogSource;
      actor?: SystemLogActor;
      target?: SystemLogTarget;
      actionId?: string;
      correlationId?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ): Promise<void> {
    await SystemLogCollection.add({
      event,
      message,
      level: options.level,
      source: options.source,
      actor: options.actor,
      target: options.target ?? { type: "environment", environmentKey },
      environmentKey,
      actionId: options.actionId,
      correlationId: options.correlationId,
      metadata: options.metadata,
    });
  }

  toOwner(user: AuthenticatedUser): EnvironmentOwner {
    return {
      email: user.email,
      name: user.name,
    };
  }

  private samePullRequest(
    left: PullRequestRef,
    right: PullRequestRef,
  ): boolean {
    return left.url === right.url;
  }
}

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

async function readActionLogPage(
  actionId: string,
  filePath: string,
  cursor: string | undefined,
  limit: number,
) {
  const safeLimit = normalizeLimit(limit, 200, 1000);
  const size = await readFileSize(filePath);
  const requestedEndOffset = cursor ? decodeLogCursor(cursor) : size;
  const endOffset = Math.max(0, Math.min(size, requestedEndOffset));
  const items =
    endOffset > 0
      ? await readPreviousLogLines(actionId, filePath, endOffset, safeLimit)
      : [];
  const firstOffset = items[0]?.byteStart ?? 0;
  const hasMore = firstOffset > 0;

  return {
    actionId,
    cursor,
    nextCursor: hasMore ? encodeLogCursor(firstOffset) : undefined,
    hasMore,
    items,
  };
}

async function readActionLogForward(
  actionId: string,
  filePath: string,
  fromOffset: number,
): Promise<{ offset: number; size: number; items: ActionLogLine[] }> {
  const size = await readFileSize(filePath);
  const offset = Math.max(
    0,
    Math.min(size, Number.isFinite(fromOffset) ? Math.floor(fromOffset) : size),
  );
  if (offset >= size) {
    return { offset: size, size, items: [] };
  }

  const handle = await fs.open(filePath, "r").catch((error) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });

  if (!handle) {
    return { offset: 0, size: 0, items: [] };
  }

  try {
    const readSize = size - offset;
    const buffer = Buffer.alloc(readSize);
    const { bytesRead } = await handle.read(buffer, 0, readSize, offset);
    const items = bufferToLogLines(
      actionId,
      buffer.subarray(0, bytesRead),
      offset,
    );
    return {
      offset: items.at(-1)?.byteEnd ?? offset,
      size,
      items,
    };
  } finally {
    await handle.close();
  }
}

async function readPreviousLogLines(
  actionId: string,
  filePath: string,
  endOffset: number,
  limit: number,
): Promise<ActionLogLine[]> {
  const handle = await fs.open(filePath, "r").catch((error) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });

  if (!handle) {
    return [];
  }

  try {
    const chunks: Buffer[] = [];
    let position = endOffset;
    let newlineCount = 0;
    const chunkSize = 64 * 1024;

    while (position > 0 && newlineCount <= limit) {
      const readSize = Math.min(chunkSize, position);
      position -= readSize;
      const buffer = Buffer.alloc(readSize);
      const { bytesRead } = await handle.read(buffer, 0, readSize, position);
      const chunk = buffer.subarray(0, bytesRead);
      chunks.unshift(chunk);
      newlineCount += countNewlines(chunk);
    }

    const buffer = Buffer.concat(chunks);
    let items = bufferToLogLines(actionId, buffer, position);
    if (position > 0) {
      items = items.slice(1);
    }

    return items.slice(-limit);
  } finally {
    await handle.close();
  }
}

function bufferToLogLines(
  actionId: string,
  buffer: Buffer,
  baseOffset: number,
): ActionLogLine[] {
  const items: ActionLogLine[] = [];
  let lineStart = 0;

  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 10) {
      items.push(
        toActionLogLine(actionId, buffer, baseOffset, lineStart, index + 1),
      );
      lineStart = index + 1;
    }
  }

  if (lineStart < buffer.length) {
    items.push(
      toActionLogLine(actionId, buffer, baseOffset, lineStart, buffer.length),
    );
  }

  return items;
}

function toActionLogLine(
  actionId: string,
  buffer: Buffer,
  baseOffset: number,
  start: number,
  end: number,
): ActionLogLine {
  const raw = buffer
    .subarray(start, end)
    .toString("utf8")
    .replace(/\r?\n$/, "");
  return {
    actionId,
    line: raw,
    log: raw,
    level: inferLogLevel(raw),
    byteStart: baseOffset + start,
    byteEnd: baseOffset + end,
  };
}

function inferLogLevel(line: string): "info" | "error" {
  return /\b(error|failed|failure|fatal|exception)\b/i.test(line)
    ? "error"
    : "info";
}

function countNewlines(buffer: Buffer): number {
  let count = 0;
  for (const byte of buffer) {
    if (byte === 10) {
      count += 1;
    }
  }
  return count;
}

async function readFileSize(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath).catch((error) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  return stats?.size ?? 0;
}

function encodeLogCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset })).toString("base64url");
}

function decodeLogCursor(cursor: string): number {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { offset?: unknown };
    if (
      typeof parsed.offset !== "number" ||
      !Number.isFinite(parsed.offset) ||
      parsed.offset < 0
    ) {
      throw new Error("Invalid cursor offset");
    }
    return Math.floor(parsed.offset);
  } catch (error) {
    throw Object.assign(
      new Error(
        `Invalid action log cursor: ${error instanceof Error ? error.message : String(error)}`,
      ),
      { status: 400 },
    );
  }
}

function normalizeLimit(value: number, fallback: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function actorFromUser(user: AuthenticatedUser): SystemLogActor {
  return {
    type: "user",
    email: user.email,
    name: user.name,
  };
}

function actorFromOwnerOrPullRequest(
  value: EnvironmentOwner | PullRequestRef,
): SystemLogActor {
  if ("email" in value) {
    return {
      type: "user",
      email: value.email,
      name: value.name,
    };
  }

  return actorFromPullRequest(value);
}

function actorFromPullRequest(value: PullRequestRef): SystemLogActor {
  return {
    type: "github",
    name: value.title,
    url: value.url,
  };
}

function targetForEnvironment(
  environmentKey: string,
  createdBy?: EnvironmentOwner | PullRequestRef,
): SystemLogTarget {
  return {
    type: "environment",
    environmentKey,
    pullRequestUrl: createdBy && "url" in createdBy ? createdBy.url : undefined,
  };
}

async function emitBusResult(
  result: HostActionResult,
  onLog: (entry: {
    log: string;
    level: "info" | "error";
  }) => Promise<void> | void,
): Promise<void> {
  if (result.message) {
    await onLog({ log: result.message, level: "info" });
  }
  if (result.output) {
    await onLog({ log: result.output, level: "info" });
  }
}

function isHostActionAlreadyRunning(result: HostActionResult): boolean {
  return (
    result.status === "success" &&
    /^Environment action already running\b/.test(result.message)
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw Object.assign(new Error("Action aborted"), { status: 499 });
  }
}

function prepareStatusFromLog(
  log: string,
): EnvironmentRecord["status"] | undefined {
  if (log.includes("[composer-progress] cloning")) {
    return "cloning";
  }
  if (log.includes("[composer-progress] checking_out")) {
    return "checking_out";
  }
  if (log.includes("[composer-progress] applying_changes")) {
    return "applying_changes";
  }
  return undefined;
}

function logEnvironment(
  level: "info" | "warn" | "error",
  event: string,
  details: Record<string, unknown>,
): void {
  console[level](
    JSON.stringify({
      at: new Date().toISOString(),
      scope: "environments",
      event,
      ...details,
    }),
  );
}

function summarizeEnvironmentBusPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const source = isRecord(payload.source) ? payload.source : undefined;
  const environmentVariables = isRecord(payload.environmentVariables)
    ? payload.environmentVariables
    : undefined;

  return {
    keys: Object.keys(payload).sort(),
    environment: payload.environment,
    environmentPort: payload.environmentPort,
    proxyUpstreamHost: payload.proxyUpstreamHost,
    runtimeRoot: payload.runtimeRoot,
    runtimePath: payload.runtimePath,
    seedName: payload.seedName,
    hostSeedsDir: payload.hostSeedsDir,
    source: source
      ? { branch: source.branch, commit: source.commit }
      : undefined,
    sourceRepoUrl:
      typeof payload.sourceRepoUrl === "string"
        ? redactUrl(payload.sourceRepoUrl)
        : undefined,
    environmentVariableKeys: environmentVariables
      ? Object.keys(environmentVariables).sort()
      : undefined,
  };
}

function redactUrl(value: string): string {
  return value.replace(/\/\/([^/@]+)@/, "//***@");
}

function createProdTennantExportSignature(tennant: string): string {
  if (!env.SIGNATURE_SECRET) {
    throw Object.assign(new Error("SIGNATURE_SECRET is not configured."), {
      status: 500,
    });
  }
  return createHash("sha256")
    .update(`${env.SIGNATURE_SECRET}|${tennant}||`)
    .digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tailText(
  value: string | undefined,
  maxLength = 4000,
): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length > maxLength ? value.slice(-maxLength) : value;
}

async function resolveHost(host: string): Promise<string> {
  if (host === "auto" || host === "host.docker.internal") {
    return readDefaultGatewayAddress();
  }

  if (net.isIP(host)) {
    return host;
  }

  const result = await dns.lookup(host, { family: 4 });
  return result.address;
}

async function readDefaultGatewayAddress(): Promise<string> {
  const routeTable = await fs.readFile("/proc/net/route", "utf8");
  const defaultRoute = routeTable
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .find((columns) => columns[1] === "00000000" && columns[2]);

  if (!defaultRoute?.[2]) {
    throw new Error("Unable to resolve Docker gateway from /proc/net/route");
  }

  return littleEndianHexToIpv4(defaultRoute[2]);
}

function littleEndianHexToIpv4(value: string): string {
  const bytes = value.match(/../g);
  if (!bytes || bytes.length !== 4) {
    throw new Error(`Invalid gateway address: ${value}`);
  }

  return bytes
    .reverse()
    .map((byte) => Number.parseInt(byte, 16))
    .join(".");
}

function parseJsonLinesOrArray(output: string): unknown[] {
  const trimmed = output.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown);
  }
}

function parseJsonValue(output: string): unknown {
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }
  return JSON.parse(trimmed) as unknown;
}

function parseMongoJsonValue(output: string): unknown {
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }

  const candidates = mongoJsonCandidates(trimmed);
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Invalid JSON";
  throw Object.assign(new Error(`Mongo inspect returned invalid JSON: ${message}`), {
    status: 502,
    output: tailText(output),
  });
}

function mongoJsonCandidates(output: string): string[] {
  const cleaned = stripMongoShellPrompts(output);
  const candidates = [output];
  if (cleaned !== output) {
    candidates.push(cleaned);
  }

  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line.startsWith("{") || line.startsWith("[")) {
      candidates.push(line);
    }
  }

  return [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))];
}

function stripMongoShellPrompts(output: string): string {
  return output
    .split(/\r?\n/)
    .map((line) => stripAnsi(line).replace(/^[A-Za-z0-9_.-]+>\s?/, "").trimEnd())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function isRunningContainer(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    typeof value.State === "string" &&
    value.State.toLowerCase() === "running"
  );
}

function isContainerService(value: unknown, service: string): boolean {
  return (
    isPlainRecord(value) &&
    typeof value.Service === "string" &&
    value.Service === service
  );
}

function assertMongoFilterSafety(
  filter: Record<string, unknown>,
  allowEmptyFilter: boolean,
): void {
  if (!isPlainRecord(filter)) {
    throw Object.assign(new Error("MongoDB filter must be a JSON object."), {
      status: 400,
    });
  }
  if (!allowEmptyFilter && Object.keys(filter).length === 0) {
    throw Object.assign(
      new Error("Empty MongoDB filters are not allowed for this operation."),
      { status: 400 },
    );
  }
}

function assertMongoUpdateSafety(update: Record<string, unknown>): void {
  if (!isPlainRecord(update) || Object.keys(update).length === 0) {
    throw Object.assign(
      new Error("MongoDB update must be a non-empty JSON object."),
      { status: 400 },
    );
  }
  if (!Object.keys(update).every((key) => key.startsWith("$"))) {
    throw Object.assign(
      new Error(
        "MongoDB update must use update operators such as $set, $unset, or $inc.",
      ),
      { status: 400 },
    );
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMongoPreviewOutput(output: string): unknown {
  try {
    return parseMongoJsonValue(output);
  } catch (error) {
    const trimmed = stripMongoShellPrompts(output.trim());
    if (trimmed.startsWith("[output truncated")) {
      return {
        available: false,
        reason:
          "MongoDB preview was too large and was truncated by the host worker. Restart the worker with the bounded preview script.",
        truncated: true,
      };
    }
    throw error;
  }
}

function splitLogLines(output: string | undefined): string[] {
  return (output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function syncPayloadMode(
  input: SyncFilesPayload,
): "patch-delta" | "patch-full" {
  return input.patch.mode === "full" ? "patch-full" : "patch-delta";
}

function syncPayloadChangeCount(input: SyncFilesPayload): number {
  return input.patch.changedFiles.length;
}

function isReadOnlyHostAction(type: string): boolean {
  return (
    type === "environment.containers.inspect" ||
    type === "environment.compose.logs" ||
    type === "environment.container.logs" ||
    type === "environment.container.files" ||
    type === "environment.container.exec" ||
    type === "environment.mongo.inspect"
  );
}

function hostActionTimeoutMs(type: string): number {
  return longRunningHostActions.has(type)
    ? env.BUS_LONG_ACTION_TIMEOUT_MS
    : env.BUS_ACTION_TIMEOUT_MS;
}

function resolveInside(rootPath: string, targetPath: string): string {
  const normalizedTarget = targetPath.startsWith("/")
    ? targetPath.slice(1)
    : targetPath;
  const resolvedPath = path.resolve(rootPath, normalizedTarget);
  const relativePath = path.relative(rootPath, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw Object.assign(
      new Error("Path is outside the environment runtime directory"),
      { status: 400 },
    );
  }

  return resolvedPath;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function sampleCpuUsage() {
  const current = readCpuSnapshot();
  const idleDelta = current.idle - previousCpuSnapshot.idle;
  const totalDelta = current.total - previousCpuSnapshot.total;
  previousCpuSnapshot = current;

  const usagePercent =
    totalDelta <= 0 ? 0 : percent(totalDelta - idleDelta, totalDelta);
  return {
    percent: usagePercent,
    loadAverage: os.loadavg(),
    cores: os.cpus().length,
  };
}

function readCpuSnapshot(): { idle: number; total: number } {
  return os.cpus().reduce(
    (snapshot, cpu) => {
      const total = Object.values(cpu.times).reduce(
        (sum, value) => sum + value,
        0,
      );
      return {
        idle: snapshot.idle + cpu.times.idle,
        total: snapshot.total + total,
      };
    },
    { idle: 0, total: 0 },
  );
}

async function readStorageUsage(targetPath: string) {
  const { stdout } = await execFileAsync("df", ["-k", targetPath], {
    maxBuffer: 1024 * 64,
  });
  const [, line] = stdout.trim().split(/\r?\n/);
  const parts = line?.trim().split(/\s+/) ?? [];
  const totalBytes = Number(parts[1] ?? 0) * 1024;
  const usedBytes = Number(parts[2] ?? 0) * 1024;
  const availableBytes = Number(parts[3] ?? 0) * 1024;

  return {
    usedBytes,
    availableBytes,
    totalBytes,
    percent: percent(usedBytes, totalBytes),
  };
}

function percent(used: number, total: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Number(((used / total) * 100).toFixed(1))));
}

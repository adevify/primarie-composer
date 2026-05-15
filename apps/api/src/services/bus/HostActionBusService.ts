import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { env } from "../../config/env.js";

const execFileAsync = promisify(execFile);

export type HostActionResult = {
  id: string;
  status: "success" | "error";
  message: string;
  output?: string;
  finishedAt?: string;
};

export type HostActionLogHandler = (entry: {
  log: string;
  level: "info" | "error";
}) => Promise<void> | void;

type BusHealth = {
  ready: boolean;
  pipePath: string;
  acksDir: string;
  resultsDir: string;
  logsDir: string;
  workerReadyPath: string;
  reason?: string;
  workerReadyAt?: string;
};

type ActionAck = {
  id: string;
  type: string;
  environment?: string;
  acceptedAt?: string;
  pid?: number;
  logFile?: string;
};

export class HostActionBusService {
  async health(): Promise<BusHealth> {
    const healthStartedAt = Date.now();
    logBus("info", "health_check_start", {
      pipePath: env.BUS_PIPE_PATH,
      acksDir: env.BUS_ACKS_DIR,
      resultsDir: env.BUS_RESULTS_DIR,
      logsDir: env.BUS_LOGS_DIR,
      workerReadyPath: env.BUS_WORKER_READY_PATH,
      acceptTimeoutMs: env.BUS_ACTION_ACCEPT_TIMEOUT_MS,
      writeTimeoutMs: env.BUS_PIPE_WRITE_TIMEOUT_MS,
      pollIntervalMs: env.BUS_POLL_INTERVAL_MS,
    });

    const [
      pipeExists,
      acksDirExists,
      resultsDirExists,
      logsDirExists,
      workerReadyExists,
      workerReadyAt,
    ] = await Promise.all([
      exists(env.BUS_PIPE_PATH),
      exists(env.BUS_ACKS_DIR),
      exists(env.BUS_RESULTS_DIR),
      exists(env.BUS_LOGS_DIR),
      exists(env.BUS_WORKER_READY_PATH),
      fs.readFile(env.BUS_WORKER_READY_PATH, "utf8").then(
        (value) => value.trim(),
        () => undefined,
      ),
    ]);

    if (!pipeExists) {
      await this.logHealthFailure("FIFO pipe is missing", workerReadyAt, {
        pipeExists,
        acksDirExists,
        resultsDirExists,
        logsDirExists,
        workerReadyExists,
        durationMs: Date.now() - healthStartedAt,
      });
      return this.healthResult(false, "FIFO pipe is missing", workerReadyAt);
    }
    if (!acksDirExists) {
      await this.logHealthFailure("Acknowledgement directory is missing", workerReadyAt, {
        pipeExists,
        acksDirExists,
        resultsDirExists,
        logsDirExists,
        workerReadyExists,
        durationMs: Date.now() - healthStartedAt,
      });
      return this.healthResult(
        false,
        "Acknowledgement directory is missing",
        workerReadyAt,
      );
    }
    if (!resultsDirExists) {
      await this.logHealthFailure("Results directory is missing", workerReadyAt, {
        pipeExists,
        acksDirExists,
        resultsDirExists,
        logsDirExists,
        workerReadyExists,
        durationMs: Date.now() - healthStartedAt,
      });
      return this.healthResult(
        false,
        "Results directory is missing",
        workerReadyAt,
      );
    }
    if (!logsDirExists) {
      await this.logHealthFailure("Logs directory is missing", workerReadyAt, {
        pipeExists,
        acksDirExists,
        resultsDirExists,
        logsDirExists,
        workerReadyExists,
        durationMs: Date.now() - healthStartedAt,
      });
      return this.healthResult(
        false,
        "Logs directory is missing",
        workerReadyAt,
      );
    }
    if (!workerReadyExists) {
      await this.logHealthFailure("Host worker is not ready", workerReadyAt, {
        pipeExists,
        acksDirExists,
        resultsDirExists,
        logsDirExists,
        workerReadyExists,
        durationMs: Date.now() - healthStartedAt,
      });
      return this.healthResult(
        false,
        "Host worker is not ready",
        workerReadyAt,
      );
    }

    const workerAlive = await checkFifoHasReader(env.BUS_PIPE_PATH);
    if (!workerAlive.alive) {
      await this.logHealthFailure(
        "Host worker process is not reading the FIFO (worker may have crashed)",
        workerReadyAt,
        {
          pipeExists,
          acksDirExists,
          resultsDirExists,
          logsDirExists,
          workerReadyExists,
          durationMs: Date.now() - healthStartedAt,
          fifoProbe: workerAlive,
        },
      );
      return this.healthResult(
        false,
        "Host worker process is not reading the FIFO (worker may have crashed)",
        workerReadyAt,
      );
    }

    logBus("info", "health_check_ready", {
      durationMs: Date.now() - healthStartedAt,
      workerReadyAt,
      pipePath: env.BUS_PIPE_PATH,
    });
    return this.healthResult(true, undefined, workerReadyAt);
  }

  async publish(
    type: string,
    payload: Record<string, unknown>,
    timeoutMs = env.BUS_ACTION_TIMEOUT_MS,
    onLog?: HostActionLogHandler,
    options: { id?: string } = {},
  ): Promise<HostActionResult> {
    const health = await this.health();
    if (!health.ready) {
      logBus("warn", "unavailable", {
        type,
        reason: health.reason,
        ...health,
        diagnostics: await collectBusDiagnostics(),
      });
      throw Object.assign(
        new Error(`Host action bus is unavailable: ${health.reason}`),
        { status: 503 },
      );
    }

    const id = options.id ?? randomUUID();
    const action = {
      id,
      type,
      payload,
      createdAt: new Date().toISOString(),
    };

    logBus("info", "publish", {
      id,
      type,
      timeoutMs,
      writeTimeoutMs: env.BUS_PIPE_WRITE_TIMEOUT_MS,
      health,
      payload: summarizePayload(payload),
      environment:
        typeof payload.environment === "string"
          ? payload.environment
          : undefined,
    });
    try {
      await writeActionToPipe(
        env.BUS_PIPE_PATH,
        `${JSON.stringify(action)}\n`,
        env.BUS_PIPE_WRITE_TIMEOUT_MS,
        { id, type },
      );
    } catch (error) {
      const message = busWriteErrorMessage(error);
      logBus("error", "publish_failed", {
        id,
        type,
        message,
        error: serializeError(error),
        diagnostics: await collectBusDiagnostics(),
      });
      throw Object.assign(
        new Error(`Host action bus is unavailable: ${message}`),
        { status: 503 },
      );
    }

    const ack = await this.waitForAck(id, type);
    logBus("info", "accepted", {
      id,
      type,
      ack,
    });

    const result = await this.waitForResult(id, timeoutMs, type, onLog);
    if (result.status === "error") {
      logBus("error", "result_error", {
        id,
        type,
        message: result.message,
        outputLength: result.output?.length ?? 0,
        outputTail: tailText(result.output),
      });
      throw Object.assign(new Error(result.message || "Host action failed"), {
        status: 500,
        output: result.output,
        hostActionId: result.id,
      });
    }

    return result;
  }

  private async waitForAck(actionId: string, type: string): Promise<ActionAck> {
    const ackPath = `${env.BUS_ACKS_DIR}/${actionId}.json`;
    const startedAt = Date.now();
    const deadlineAt = startedAt + env.BUS_ACTION_ACCEPT_TIMEOUT_MS;
    let nextWaitingLogAt = startedAt + 1000;

    logBus("info", "ack_wait_start", {
      id: actionId,
      type,
      ackPath,
      timeoutMs: env.BUS_ACTION_ACCEPT_TIMEOUT_MS,
    });

    while (Date.now() < deadlineAt) {
      const content = await fs.readFile(ackPath, "utf8").catch((error) => {
        if (isNodeError(error) && error.code === "ENOENT") {
          return null;
        }
        throw error;
      });

      if (content !== null) {
        await fs.unlink(ackPath).catch(() => undefined);
        const ack = parseAck(content, actionId, type);
        logBus("info", "ack_found", {
          id: actionId,
          type,
          durationMs: Date.now() - startedAt,
          ack,
        });
        return ack;
      }

      if (Date.now() >= nextWaitingLogAt) {
        logBus("info", "ack_waiting", {
          id: actionId,
          type,
          elapsedMs: Date.now() - startedAt,
          remainingMs: Math.max(0, deadlineAt - Date.now()),
          ackPath,
        });
        nextWaitingLogAt = Date.now() + 1000;
      }

      await delay(Math.min(env.BUS_POLL_INTERVAL_MS, 200));
    }

    logBus("error", "ack_timeout", {
      id: actionId,
      type,
      timeoutMs: env.BUS_ACTION_ACCEPT_TIMEOUT_MS,
      ackPath: `${env.BUS_ACKS_DIR}/${actionId}.json`,
      pipePath: env.BUS_PIPE_PATH,
      workerReadyPath: env.BUS_WORKER_READY_PATH,
    });
    throw Object.assign(
      new Error(
        `Host action was not accepted by the worker within ${env.BUS_ACTION_ACCEPT_TIMEOUT_MS}ms: ${actionId}`,
      ),
      { status: 503 },
    );
  }

  private async waitForResult(
    actionId: string,
    timeoutMs: number,
    type: string,
    onLog?: HostActionLogHandler,
  ): Promise<HostActionResult> {
    const filePath = `${env.BUS_RESULTS_DIR}/${actionId}.json`;
    const logPath = `${env.BUS_LOGS_DIR}/${actionId}.log`;
    const startedAt = Date.now();
    let deadlineAt = startedAt + timeoutMs;
    let logOffset = 0;
    let nextWaitingLogAt = startedAt + 5000;

    logBus("info", "wait_start", {
      id: actionId,
      type,
      resultPath: filePath,
      logPath,
      timeoutMs,
      pollIntervalMs: env.BUS_POLL_INTERVAL_MS,
    });

    while (Date.now() < deadlineAt) {
      const logProgress = await readNewLogLines(logPath, logOffset, onLog, {
        id: actionId,
        type,
      });
      logOffset = logProgress.offset;
      if (logProgress.advanced) {
        deadlineAt = Date.now() + timeoutMs;
        logBus("info", "action_log_advanced", {
          id: actionId,
          type,
          logPath,
          logOffset,
          logSize: logProgress.size,
          deadlineExtendedByMs: timeoutMs,
        });
      }

      const content = await fs.readFile(filePath, "utf8").catch((error) => {
        if (isNodeError(error) && error.code === "ENOENT") {
          return null;
        }
        throw error;
      });

      if (content !== null) {
        logBus("info", "result_file_found", {
          id: actionId,
          type,
          resultPath: filePath,
          resultBytes: content.length,
        });
        const finalLogProgress = await readNewLogLines(
          logPath,
          logOffset,
          onLog,
          { id: actionId, type },
        );
        logOffset = finalLogProgress.offset;
        await fs.unlink(filePath).catch(() => undefined);
        const result = parseResult(content, actionId);
        logBus("info", "result", {
          id: actionId,
          type,
          status: result.status,
          durationMs: Date.now() - startedAt,
          message: result.message,
          outputLength: result.output?.length ?? 0,
        });
        return result;
      }

      if (Date.now() >= nextWaitingLogAt) {
        logBus("info", "waiting", {
          id: actionId,
          type,
          elapsedMs: Date.now() - startedAt,
          remainingMs: Math.max(0, deadlineAt - Date.now()),
          resultPath: filePath,
          logPath,
          logOffset,
          logSize: logProgress.size,
        });
        nextWaitingLogAt = Date.now() + 5000;
      }

      await delay(env.BUS_POLL_INTERVAL_MS);
    }

    logBus("error", "timeout", {
      id: actionId,
      type,
      timeoutMs,
      idleMs: Date.now() - (deadlineAt - timeoutMs),
    });
    throw Object.assign(new Error(`Host action timed out: ${actionId}`), {
      status: 504,
    });
  }

  private healthResult(
    ready: boolean,
    reason?: string,
    workerReadyAt?: string,
  ) {
    return {
      ready,
      pipePath: env.BUS_PIPE_PATH,
      acksDir: env.BUS_ACKS_DIR,
      resultsDir: env.BUS_RESULTS_DIR,
      logsDir: env.BUS_LOGS_DIR,
      workerReadyPath: env.BUS_WORKER_READY_PATH,
      workerReadyAt,
      reason,
    };
  }

  private async logHealthFailure(
    reason: string,
    workerReadyAt: string | undefined,
    checks: Record<string, unknown>,
  ): Promise<void> {
    logBus("warn", "health_check_failed", {
      reason,
      workerReadyAt,
      checks,
      diagnostics: await collectBusDiagnostics(),
    });
  }
}

function parseAck(content: string, actionId: string, type: string): ActionAck {
  try {
    const parsed = JSON.parse(content) as Partial<ActionAck>;
    if (parsed.id !== actionId || parsed.type !== type) {
      throw new Error("Ack does not match expected action");
    }

    return {
      id: parsed.id,
      type: parsed.type,
      environment:
        typeof parsed.environment === "string" ? parsed.environment : undefined,
      acceptedAt:
        typeof parsed.acceptedAt === "string" ? parsed.acceptedAt : undefined,
      pid: typeof parsed.pid === "number" ? parsed.pid : undefined,
      logFile: typeof parsed.logFile === "string" ? parsed.logFile : undefined,
    };
  } catch (error) {
    throw Object.assign(
      new Error(
        `Malformed host action ack for ${actionId}: ${error instanceof Error ? error.message : String(error)}`,
      ),
      { status: 502 },
    );
  }
}

function parseResult(content: string, actionId: string): HostActionResult {
  try {
    const parsed = JSON.parse(content) as Partial<HostActionResult>;
    if (
      parsed.id !== actionId ||
      (parsed.status !== "success" && parsed.status !== "error")
    ) {
      throw new Error("Result does not match expected shape");
    }

    return {
      id: parsed.id,
      status: parsed.status,
      message: typeof parsed.message === "string" ? parsed.message : "",
      output: typeof parsed.output === "string" ? parsed.output : undefined,
      finishedAt:
        typeof parsed.finishedAt === "string" ? parsed.finishedAt : undefined,
    };
  } catch (error) {
    throw Object.assign(
      new Error(
        `Malformed host action result for ${actionId}: ${error instanceof Error ? error.message : String(error)}`,
      ),
      { status: 502 },
    );
  }
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false,
  );
}

async function checkFifoHasReader(pipePath: string): Promise<Record<string, unknown> & { alive: boolean }> {
  const startedAt = Date.now();
  logBus("info", "fifo_reader_probe_start", { pipePath });
  try {
    const handle = await fs.open(
      pipePath,
      fsConstants.O_WRONLY | fsConstants.O_NONBLOCK,
    );
    await handle.close().catch(() => undefined);
    logBus("info", "fifo_reader_probe_success", {
      pipePath,
      durationMs: Date.now() - startedAt,
    });
    return { alive: true, durationMs: Date.now() - startedAt };
  } catch (error) {
    const serializedError = serializeError(error);
    const result = {
      alive: false,
      durationMs: Date.now() - startedAt,
      error: serializedError,
      interpretedReason:
        isNodeError(error) && error.code === "ENXIO"
          ? "no_fifo_reader"
          : "fifo_open_failed",
    };
    logBus("warn", "fifo_reader_probe_failed", {
      pipePath,
      ...result,
    });
    if (isNodeError(error) && error.code === "ENXIO") {
      return result; // no process is reading the FIFO
    }
    // Any other error (e.g. ENOENT, EACCES) — treat as not alive
    return result;
  }
}

async function writeActionToPipe(
  pipePath: string,
  value: string,
  timeoutMs: number,
  context: { id: string; type: string },
): Promise<void> {
  const deadlineAt = Date.now() + timeoutMs;
  const buffer = Buffer.from(value, "utf8");
  let handle: fs.FileHandle | undefined;

  try {
    logBus("info", "pipe_open_start", {
      ...context,
      pipePath,
      bytes: buffer.length,
      timeoutMs,
      deadlineAt: new Date(deadlineAt).toISOString(),
    });
    handle = await fs.open(
      pipePath,
      fsConstants.O_WRONLY | fsConstants.O_NONBLOCK,
    );
    logBus("info", "pipe_opened", {
      ...context,
      pipePath,
      openDurationMs: Date.now() - (deadlineAt - timeoutMs),
    });
    let offset = 0;
    let retryCount = 0;

    while (offset < buffer.length) {
      try {
        const result = await handle.write(
          buffer,
          offset,
          buffer.length - offset,
        );
        offset += result.bytesWritten;
        logBus("info", "pipe_write_progress", {
          ...context,
          pipePath,
          bytesWritten: result.bytesWritten,
          offset,
          totalBytes: buffer.length,
        });
        continue;
      } catch (error) {
        if (!isRetryablePipeWriteError(error)) {
          logBus("error", "pipe_write_failed_non_retryable", {
            ...context,
            pipePath,
            offset,
            totalBytes: buffer.length,
            error: serializeError(error),
          });
          throw error;
        }
        retryCount += 1;
        logBus("warn", "pipe_write_retryable_error", {
          ...context,
          pipePath,
          retryCount,
          offset,
          totalBytes: buffer.length,
          remainingMs: Math.max(0, deadlineAt - Date.now()),
          error: serializeError(error),
        });
      }

      if (Date.now() >= deadlineAt) {
        throw Object.assign(
          new Error(
            `Timed out writing action to host worker FIFO after ${timeoutMs}ms`,
          ),
          { code: "ETIMEDOUT" },
        );
      }

      await delay(25);
    }
    logBus("info", "pipe_write_complete", {
      ...context,
      pipePath,
      totalBytes: buffer.length,
      durationMs: Date.now() - (deadlineAt - timeoutMs),
    });
  } finally {
    await handle
      ?.close()
      .then(() => {
        logBus("info", "pipe_closed", { ...context, pipePath });
      })
      .catch((error) => {
        logBus("warn", "pipe_close_failed", {
          ...context,
          pipePath,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }
}

function busWriteErrorMessage(error: unknown): string {
  if (isNodeError(error) && error.code === "ENXIO") {
    return "no active host worker is reading the FIFO";
  }
  if (isNodeError(error) && error.code === "EPIPE") {
    return "host worker disconnected while receiving the action";
  }
  if (isNodeError(error) && error.code === "ETIMEDOUT") {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

async function collectBusDiagnostics(): Promise<Record<string, unknown>> {
  const busRoot = env.BUS_PIPE_PATH.split("/").slice(0, -1).join("/") || "/";
  const [
    pipe,
    acksDir,
    resultsDir,
    logsDir,
    readyFile,
    readyContent,
    workerLock,
    workerLockInfo,
    workerPids,
    fifoOpenProcesses,
    currentProcess,
  ] = await Promise.all([
    describePath(env.BUS_PIPE_PATH),
    describeDirectory(env.BUS_ACKS_DIR),
    describeDirectory(env.BUS_RESULTS_DIR),
    describeDirectory(env.BUS_LOGS_DIR),
    describePath(env.BUS_WORKER_READY_PATH),
    readTextPreview(env.BUS_WORKER_READY_PATH),
    describePath(`${busRoot}/worker.lock`),
    readTextPreview(`${busRoot}/worker.lock/info`),
    findWorkerPids(),
    findOpenFifoProcesses(env.BUS_PIPE_PATH),
    describeCurrentProcess(),
  ]);

  const likelyCause = inferBusLikelyCause({
    pipe,
    readyFile,
    workerLock,
    workerPids,
  });

  return {
    busRoot,
    likelyCause,
    pipe,
    acksDir,
    resultsDir,
    logsDir,
    readyFile,
    readyContent,
    workerLock,
    workerLockInfo,
    workerPids,
    fifoOpenProcesses,
    currentProcess,
    env: {
      BUS_PIPE_PATH: env.BUS_PIPE_PATH,
      BUS_ACKS_DIR: env.BUS_ACKS_DIR,
      BUS_RESULTS_DIR: env.BUS_RESULTS_DIR,
      BUS_LOGS_DIR: env.BUS_LOGS_DIR,
      BUS_WORKER_READY_PATH: env.BUS_WORKER_READY_PATH,
      BUS_ACTION_ACCEPT_TIMEOUT_MS: env.BUS_ACTION_ACCEPT_TIMEOUT_MS,
      BUS_PIPE_WRITE_TIMEOUT_MS: env.BUS_PIPE_WRITE_TIMEOUT_MS,
      BUS_POLL_INTERVAL_MS: env.BUS_POLL_INTERVAL_MS,
    },
  };
}

function inferBusLikelyCause(input: {
  pipe: Record<string, unknown>;
  readyFile: Record<string, unknown>;
  workerLock: Record<string, unknown>;
  workerPids: Record<string, unknown>;
}): string {
  if (input.pipe.exists !== true) {
    return "api_cannot_see_fifo_pipe";
  }
  if (input.pipe.isFIFO !== true) {
    return "bus_path_exists_but_is_not_fifo";
  }
  const workerPidLines = Array.isArray(input.workerPids.pids)
    ? input.workerPids.pids
    : [];
  if (workerPidLines.length === 0) {
    return input.readyFile.exists === true || input.workerLock.exists === true
      ? "worker_process_missing_with_stale_ready_or_lock"
      : "worker_process_missing";
  }
  if (input.readyFile.exists !== true) {
    return "worker_process_exists_but_ready_file_missing";
  }
  return "worker_process_detected_but_fifo_has_no_reader_check_bus_mount_or_worker_fd";
}

async function describeCurrentProcess(): Promise<Record<string, unknown>> {
  return {
    pid: process.pid,
    ppid: process.ppid,
    cwd: process.cwd(),
    node: process.version,
    platform: process.platform,
    uid: typeof process.getuid === "function" ? process.getuid() : undefined,
    gid: typeof process.getgid === "function" ? process.getgid() : undefined,
  };
}

async function describePath(filePath: string): Promise<Record<string, unknown>> {
  try {
    const stat = await fs.lstat(filePath);
    return {
      path: filePath,
      exists: true,
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      isFIFO: stat.isFIFO(),
      isSocket: stat.isSocket(),
      mode: `0${(stat.mode & 0o7777).toString(8)}`,
      uid: stat.uid,
      gid: stat.gid,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      ctime: stat.ctime.toISOString(),
    };
  } catch (error) {
    return {
      path: filePath,
      exists: false,
      error: serializeError(error),
    };
  }
}

async function describeDirectory(dirPath: string): Promise<Record<string, unknown>> {
  const description = await describePath(dirPath);
  if (description.exists !== true || description.isDirectory !== true) {
    return description;
  }

  try {
    const entries = await fs.readdir(dirPath);
    return {
      ...description,
      entryCount: entries.length,
      sampleEntries: entries.slice(0, 20).sort(),
    };
  } catch (error) {
    return {
      ...description,
      readError: serializeError(error),
    };
  }
}

async function readTextPreview(filePath: string): Promise<Record<string, unknown>> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return {
      path: filePath,
      exists: true,
      bytes: content.length,
      preview: content.trim().slice(0, 4000),
    };
  } catch (error) {
    return {
      path: filePath,
      exists: false,
      error: serializeError(error),
    };
  }
}

async function findWorkerPids(): Promise<Record<string, unknown>> {
  try {
    const { stdout, stderr } = await execFileAsync("pgrep", [
      "-af",
      "composer-worker.sh",
    ]);
    return {
      command: "pgrep -af composer-worker.sh",
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      pids: stdout
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => line.trim()),
    };
  } catch (error) {
    const pgrepError = serializeError(error);
    try {
      const { stdout, stderr } = await execFileAsync("ps", ["axo", "pid,ppid,command"]);
      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.includes("composer-worker.sh"));
      return {
        command: "ps axo pid,ppid,command",
        fallbackFrom: "pgrep -af composer-worker.sh",
        fallbackError: pgrepError,
        stdout: lines.join("\n"),
        stderr: stderr.trim(),
        pids: lines,
      };
    } catch (fallbackError) {
      return {
        command: "pgrep -af composer-worker.sh",
        fallbackCommand: "ps axo pid,ppid,command",
        error: pgrepError,
        fallbackError: serializeError(fallbackError),
      };
    }
  }
}

async function findOpenFifoProcesses(pipePath: string): Promise<Record<string, unknown>> {
  try {
    const { stdout, stderr } = await execFileAsync("lsof", [pipePath]);
    return {
      command: `lsof ${pipePath}`,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      lines: stdout
        .trim()
        .split(/\r?\n/)
        .filter(Boolean),
    };
  } catch (error) {
    return {
      command: `lsof ${pipePath}`,
      error: serializeError(error),
    };
  }
}

function serializeError(error: unknown): Record<string, unknown> {
  if (isNodeError(error)) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      errno: error.errno,
      syscall: error.syscall,
      path: error.path,
      stack: error.stack,
    };
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

function isRetryablePipeWriteError(error: unknown): boolean {
  return (
    isNodeError(error) &&
    (error.code === "EAGAIN" || error.code === "EWOULDBLOCK")
  );
}

function summarizePayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const source = isRecord(payload.source) ? payload.source : undefined;
  const environmentVariables = isRecord(payload.environmentVariables)
    ? payload.environmentVariables
    : undefined;

  return {
    keys: Object.keys(payload).sort(),
    environment:
      typeof payload.environment === "string" ? payload.environment : undefined,
    environmentPort: payload.environmentPort,
    runtimeRoot: payload.runtimeRoot,
    runtimePath: payload.runtimePath,
    seedName: payload.seedName,
    hostSeedsDir: payload.hostSeedsDir,
    proxyUpstreamHost: payload.proxyUpstreamHost,
    source: source
      ? {
          branch: source.branch,
          commit: source.commit,
        }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readNewLogLines(
  logPath: string,
  offset: number,
  onLog?: HostActionLogHandler,
  context?: { id: string; type: string },
): Promise<{ offset: number; size: number; advanced: boolean }> {
  const content = await fs.readFile(logPath, "utf8").catch((error) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  });

  if (content === null) {
    return { offset: 0, size: 0, advanced: false };
  }

  const normalizedOffset = offset > content.length ? 0 : offset;
  if (normalizedOffset >= content.length) {
    return { offset: normalizedOffset, size: content.length, advanced: false };
  }

  const nextChunk = content.slice(normalizedOffset);
  const lastNewlineIndex = nextChunk.lastIndexOf("\n");
  if (lastNewlineIndex === -1) {
    return { offset: normalizedOffset, size: content.length, advanced: false };
  }

  const completeChunk = nextChunk.slice(0, lastNewlineIndex + 1);
  const completeLines = completeChunk.split(/\r?\n/).filter(Boolean);
  const hasActionOutput = completeLines.some((line) => !isHeartbeatLine(line));

  if (onLog) {
    for (const line of completeLines) {
      await onLog({ log: line, level: "info" });
    }
  }

  if (context) {
    for (const line of completeLines) {
      logBus("info", "action_log_line", {
        ...context,
        logPath,
        line: line.length > 2000 ? `${line.slice(0, 2000)}...` : line,
      });
    }
  }

  return {
    offset: normalizedOffset + completeChunk.length,
    size: content.length,
    advanced: hasActionOutput,
  };
}

function isHeartbeatLine(line: string): boolean {
  return line.startsWith("[composer-worker] action still running at ");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function logBus(
  level: "info" | "warn" | "error",
  event: string,
  details: Record<string, unknown>,
): void {
  console[level](
    JSON.stringify({
      at: new Date().toISOString(),
      scope: "host-action-bus",
      event,
      ...details,
    }),
  );
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

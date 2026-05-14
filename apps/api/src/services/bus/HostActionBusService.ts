import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { env } from "../../config/env.js";

export type HostActionResult = {
  id: string;
  status: "success" | "error";
  message: string;
  output?: string;
  finishedAt?: string;
};

export type HostActionLogHandler = (entry: { log: string; level: "info" | "error" }) => Promise<void> | void;

export class HostActionBusService {
  async health(): Promise<{ ready: boolean; pipePath: string; resultsDir: string; workerReadyPath: string; reason?: string }> {
    const [pipeExists, resultsDirExists, workerReadyExists] = await Promise.all([
      exists(env.BUS_PIPE_PATH),
      exists(env.BUS_RESULTS_DIR),
      exists(env.BUS_WORKER_READY_PATH)
    ]);

    if (!pipeExists) {
      return this.healthResult(false, "FIFO pipe is missing");
    }
    if (!resultsDirExists) {
      return this.healthResult(false, "Results directory is missing");
    }
    if (!workerReadyExists) {
      return this.healthResult(false, "Host worker is not ready");
    }

    return this.healthResult(true);
  }

  async publish(
    type: string,
    payload: Record<string, unknown>,
    timeoutMs = env.BUS_ACTION_TIMEOUT_MS,
    onLog?: HostActionLogHandler,
    options: { id?: string } = {}
  ): Promise<HostActionResult> {
    const health = await this.health();
    if (!health.ready) {
      logBus("warn", "unavailable", { type, reason: health.reason });
      throw Object.assign(new Error(`Host action bus is unavailable: ${health.reason}`), { status: 503 });
    }

    const id = options.id ?? randomUUID();
    const action = {
      id,
      type,
      payload,
      createdAt: new Date().toISOString()
    };

    logBus("info", "publish", {
      id,
      type,
      timeoutMs,
      environment: typeof payload.environment === "string" ? payload.environment : undefined
    });
    try {
      await writeActionToPipe(env.BUS_PIPE_PATH, `${JSON.stringify(action)}\n`, env.BUS_PIPE_WRITE_TIMEOUT_MS);
    } catch (error) {
      const message = busWriteErrorMessage(error);
      logBus("error", "publish_failed", {
        id,
        type,
        message
      });
      throw Object.assign(new Error(`Host action bus is unavailable: ${message}`), { status: 503 });
    }

    const result = await this.waitForResult(id, timeoutMs, type, onLog);
    if (result.status === "error") {
      logBus("error", "result_error", {
        id,
        type,
        message: result.message,
        outputLength: result.output?.length ?? 0,
        outputTail: tailText(result.output)
      });
      throw Object.assign(new Error(result.message || "Host action failed"), {
        status: 500,
        output: result.output,
        hostActionId: result.id
      });
    }

    return result;
  }

  private async waitForResult(actionId: string, timeoutMs: number, type: string, onLog?: HostActionLogHandler): Promise<HostActionResult> {
    const filePath = `${env.BUS_RESULTS_DIR}/${actionId}.json`;
    const logPath = `${env.BUS_LOGS_DIR}/${actionId}.log`;
    const startedAt = Date.now();
    let deadlineAt = startedAt + timeoutMs;
    let logOffset = 0;

    while (Date.now() < deadlineAt) {
      const logProgress = await readNewLogLines(logPath, logOffset, onLog);
      logOffset = logProgress.offset;
      if (logProgress.advanced) {
        deadlineAt = Date.now() + timeoutMs;
      }

      const content = await fs.readFile(filePath, "utf8").catch((error) => {
        if (isNodeError(error) && error.code === "ENOENT") {
          return null;
        }
        throw error;
      });

      if (content !== null) {
        const finalLogProgress = await readNewLogLines(logPath, logOffset, onLog);
        logOffset = finalLogProgress.offset;
        await fs.unlink(filePath).catch(() => undefined);
        const result = parseResult(content, actionId);
        logBus("info", "result", {
          id: actionId,
          type,
          status: result.status,
          durationMs: Date.now() - startedAt,
          message: result.message,
          outputLength: result.output?.length ?? 0
        });
        return result;
      }

      await delay(env.BUS_POLL_INTERVAL_MS);
    }

    logBus("error", "timeout", { id: actionId, type, timeoutMs, idleMs: Date.now() - (deadlineAt - timeoutMs) });
    throw Object.assign(new Error(`Host action timed out: ${actionId}`), { status: 504 });
  }

  private healthResult(ready: boolean, reason?: string) {
    return {
      ready,
      pipePath: env.BUS_PIPE_PATH,
      resultsDir: env.BUS_RESULTS_DIR,
      workerReadyPath: env.BUS_WORKER_READY_PATH,
      reason
    };
  }
}

function parseResult(content: string, actionId: string): HostActionResult {
  try {
    const parsed = JSON.parse(content) as Partial<HostActionResult>;
    if (parsed.id !== actionId || (parsed.status !== "success" && parsed.status !== "error")) {
      throw new Error("Result does not match expected shape");
    }

    return {
      id: parsed.id,
      status: parsed.status,
      message: typeof parsed.message === "string" ? parsed.message : "",
      output: typeof parsed.output === "string" ? parsed.output : undefined,
      finishedAt: typeof parsed.finishedAt === "string" ? parsed.finishedAt : undefined
    };
  } catch (error) {
    throw Object.assign(new Error(`Malformed host action result for ${actionId}: ${error instanceof Error ? error.message : String(error)}`), { status: 502 });
  }
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true, () => false);
}

async function writeActionToPipe(pipePath: string, value: string, timeoutMs: number): Promise<void> {
  const deadlineAt = Date.now() + timeoutMs;
  const buffer = Buffer.from(value, "utf8");
  let handle: fs.FileHandle | undefined;

  try {
    handle = await fs.open(pipePath, fsConstants.O_WRONLY | fsConstants.O_NONBLOCK);
    let offset = 0;

    while (offset < buffer.length) {
      try {
        const result = await handle.write(buffer, offset, buffer.length - offset);
        offset += result.bytesWritten;
        continue;
      } catch (error) {
        if (!isRetryablePipeWriteError(error)) {
          throw error;
        }
      }

      if (Date.now() >= deadlineAt) {
        throw Object.assign(new Error(`Timed out writing action to host worker FIFO after ${timeoutMs}ms`), { code: "ETIMEDOUT" });
      }

      await delay(25);
    }
  } finally {
    await handle?.close().catch(() => undefined);
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

function isRetryablePipeWriteError(error: unknown): boolean {
  return isNodeError(error) && (error.code === "EAGAIN" || error.code === "EWOULDBLOCK");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readNewLogLines(
  logPath: string,
  offset: number,
  onLog?: HostActionLogHandler
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

  return { offset: normalizedOffset + completeChunk.length, size: content.length, advanced: hasActionOutput };
}

function isHeartbeatLine(line: string): boolean {
  return line.startsWith("[composer-worker] action still running at ");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function logBus(level: "info" | "warn" | "error", event: string, details: Record<string, unknown>): void {
  console[level](JSON.stringify({
    at: new Date().toISOString(),
    scope: "host-action-bus",
    event,
    ...details
  }));
}

function tailText(value: string | undefined, maxLength = 4000): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length > maxLength ? value.slice(-maxLength) : value;
}

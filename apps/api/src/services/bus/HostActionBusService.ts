import { randomUUID } from "node:crypto";
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
    onLog?: HostActionLogHandler
  ): Promise<HostActionResult> {
    const health = await this.health();
    if (!health.ready) {
      logBus("warn", "unavailable", { type, reason: health.reason });
      throw Object.assign(new Error(`Host action bus is unavailable: ${health.reason}`), { status: 503 });
    }

    const id = randomUUID();
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
    await fs.appendFile(env.BUS_PIPE_PATH, `${JSON.stringify(action)}\n`, "utf8");
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
    let observedLogSize = 0;

    while (Date.now() < deadlineAt) {
      const logProgress = await readNewLogLines(logPath, logOffset, observedLogSize, onLog);
      logOffset = logProgress.offset;
      observedLogSize = logProgress.size;
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
        const finalLogProgress = await readNewLogLines(logPath, logOffset, observedLogSize, onLog);
        logOffset = finalLogProgress.offset;
        await fs.unlink(filePath).catch(() => undefined);
        await fs.unlink(logPath).catch(() => undefined);
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readNewLogLines(
  logPath: string,
  offset: number,
  observedSize: number,
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
  const advanced = content.length > observedSize;
  if (!onLog) {
    return { offset: content.length, size: content.length, advanced };
  }

  if (normalizedOffset >= content.length) {
    return { offset: normalizedOffset, size: content.length, advanced };
  }

  const nextChunk = content.slice(normalizedOffset);
  const lastNewlineIndex = nextChunk.lastIndexOf("\n");
  if (lastNewlineIndex === -1) {
    return { offset: normalizedOffset, size: content.length, advanced };
  }

  const completeChunk = nextChunk.slice(0, lastNewlineIndex + 1);
  const completeLines = completeChunk.split(/\r?\n/).filter(Boolean);

  for (const line of completeLines) {
    await onLog({ log: line, level: "info" });
  }

  return { offset: normalizedOffset + completeChunk.length, size: content.length, advanced };
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

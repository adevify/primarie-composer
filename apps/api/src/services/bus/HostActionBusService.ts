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

  async publish(type: string, payload: Record<string, unknown>, timeoutMs = env.BUS_ACTION_TIMEOUT_MS): Promise<HostActionResult> {
    const health = await this.health();
    if (!health.ready) {
      throw Object.assign(new Error(`Host action bus is unavailable: ${health.reason}`), { status: 503 });
    }

    const id = randomUUID();
    const action = {
      id,
      type,
      payload,
      createdAt: new Date().toISOString()
    };

    await fs.appendFile(env.BUS_PIPE_PATH, `${JSON.stringify(action)}\n`, "utf8");
    const result = await this.waitForResult(id, timeoutMs);
    if (result.status === "error") {
      throw Object.assign(new Error(result.message || "Host action failed"), {
        status: 500,
        output: result.output,
        hostActionId: result.id
      });
    }

    return result;
  }

  private async waitForResult(actionId: string, timeoutMs: number): Promise<HostActionResult> {
    const filePath = `${env.BUS_RESULTS_DIR}/${actionId}.json`;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const content = await fs.readFile(filePath, "utf8").catch((error) => {
        if (isNodeError(error) && error.code === "ENOENT") {
          return null;
        }
        throw error;
      });

      if (content !== null) {
        await fs.unlink(filePath).catch(() => undefined);
        return parseResult(content, actionId);
      }

      await delay(env.BUS_POLL_INTERVAL_MS);
    }

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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type ComposeLogHandler = (entry: { log: string; level: "info" | "error" }) => Promise<void> | void;

export type ComposeLogEntry = {
  log: string;
  level: "info" | "error";
};

export type MongoPreview = {
  database: string;
  collections: Array<{
    name: string;
    count: number;
    sample: unknown;
  }>;
};

export class DockerComposeService {
  async up(composePath: string, onLog?: ComposeLogHandler, signal?: AbortSignal, envFilePath?: string): Promise<void> {
    await this.runCompose(composePath, ["up", "-d", "--build"], onLog, signal, envFilePath);
  }

  async down(composePath: string, onLog?: ComposeLogHandler, signal?: AbortSignal, envFilePath?: string): Promise<void> {
    await this.runCompose(composePath, ["down"], onLog, signal, envFilePath);
  }

  async restart(composePath: string, onLog?: ComposeLogHandler, signal?: AbortSignal, envFilePath?: string): Promise<void> {
    await this.runCompose(composePath, ["restart"], onLog, signal, envFilePath);
  }

  async streamContainerLogs(container: string, onLog: ComposeLogHandler, signal?: AbortSignal): Promise<void> {
    this.assertContainerName(container);
    await this.spawnProcess("docker", ["logs", "--follow", "--tail", "200", "--timestamps", container], undefined, onLog, signal);
  }

  async streamComposeLogs(composePath: string, onLog: ComposeLogHandler, signal?: AbortSignal, envFilePath?: string): Promise<void> {
    await this.runCompose(composePath, ["logs", "--follow", "--tail", "200", "--timestamps"], onLog, signal, envFilePath);
  }

  async listComposeLogs(composePath: string, envFilePath?: string): Promise<ComposeLogEntry[]> {
    const output = await this.runComposeWithOutput(composePath, ["logs", "--tail", "200", "--timestamps"], envFilePath);
    return output
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((log) => ({ log, level: "info" }));
  }

  async listContainers(composePath: string, envFilePath?: string): Promise<unknown[]> {
    const output = await this.runComposeWithOutput(composePath, ["ps", "--format", "json"], envFilePath);
    return parseComposeJsonOutput(output);
  }

  async listContainerFiles(container: string, targetPath: string): Promise<Array<{ path: string; name: string; type: string; size?: number }>> {
    this.assertContainerName(container);
    const output = await this.runDockerWithOutput([
      "exec",
      "-e",
      `TARGET_PATH=${targetPath || "/"}`,
      container,
      "sh",
      "-lc",
      [
        'p="${TARGET_PATH:-/}"',
        `if [ ! -e "$p" ]; then echo "Path not found: $p" >&2; exit 2; fi`,
        `if [ -d "$p" ]; then`,
        `  find "$p" -maxdepth 1 -mindepth 1 -exec sh -c 'for item do if [ -d "$item" ]; then type=directory; elif [ -f "$item" ]; then type=file; else type=other; fi; size=$(wc -c < "$item" 2>/dev/null || echo 0); name=$(basename "$item"); printf "%s\\t%s\\t%s\\t%s\\n" "$type" "$size" "$name" "$item"; done' sh {} +`,
        `else`,
        `  if [ -f "$p" ]; then type=file; elif [ -d "$p" ]; then type=directory; else type=other; fi`,
        `  size=$(wc -c < "$p" 2>/dev/null || echo 0); name=$(basename "$p"); printf "%s\\t%s\\t%s\\t%s\\n" "$type" "$size" "$name" "$p"`,
        `fi`
      ].join("; ")
    ]);

    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [type, size, name, filePath] = line.split("\t");
        return { type, size: Number(size), name, path: filePath };
      });
  }

  async execInContainer(container: string, command: string): Promise<{ command: string; exitCode: number; stdout: string; stderr: string }> {
    this.assertContainerName(container);
    if (!command.trim()) {
      throw Object.assign(new Error("Command is required"), { status: 400 });
    }

    try {
      const { stdout, stderr } = await execFileAsync("docker", ["exec", "-i", container, "sh", "-lc", command], {
        maxBuffer: 1024 * 1024 * 5
      });
      return { command, exitCode: 0, stdout, stderr };
    } catch (error) {
      const maybe = error as { code?: number; stdout?: string; stderr?: string };
      return {
        command,
        exitCode: typeof maybe.code === "number" ? maybe.code : 1,
        stdout: maybe.stdout ?? "",
        stderr: maybe.stderr ?? (error instanceof Error ? error.message : String(error))
      };
    }
  }

  async inspectMongo(container: string): Promise<MongoPreview> {
    const script = [
      "const collections = db.getCollectionNames();",
      "const result = { database: db.getName(), collections: collections.map((name) => ({ name, count: db.getCollection(name).countDocuments(), sample: db.getCollection(name).findOne() })) };",
      "print(JSON.stringify(result));"
    ].join(" ");
    const command = `dbName="\${MONGO_INITDB_DATABASE:-test}"; mongosh --quiet "$dbName" --eval '${script.replace(/'/g, "'\\''")}'`;
    const result = await this.execInContainer(
      container,
      command
    );

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || "MongoDB inspection failed.");
    }

    return JSON.parse(result.stdout.trim()) as MongoPreview;
  }

  private async runCompose(cwd: string, args: string[], onLog?: ComposeLogHandler, signal?: AbortSignal, envFilePath?: string): Promise<void> {
    const composeArgs = withEnvFile(args, envFilePath);
    try {
      await this.spawnCompose(cwd, "docker", ["compose", ...composeArgs], onLog, signal);
    } catch (primaryError) {
      try {
        await this.spawnCompose(cwd, "docker-compose", composeArgs, onLog, signal);
      } catch (fallbackError) {
        throw new Error(this.formatComposeError(args, primaryError, fallbackError));
      }
    }
  }

  private async spawnCompose(cwd: string, command: string, args: string[], onLog?: ComposeLogHandler, signal?: AbortSignal): Promise<void> {
    await this.spawnProcess(command, args, cwd, onLog, signal);
  }

  private async spawnProcess(command: string, args: string[], cwd: string | undefined, onLog?: ComposeLogHandler, signal?: AbortSignal): Promise<void> {
    const child = spawn(command, args, { cwd });
    const output: string[] = [];
    let logQueue = Promise.resolve();
    let aborted = false;

    const abort = () => {
      aborted = true;
      child.kill("SIGTERM");
    };

    if (signal?.aborted) {
      abort();
    } else {
      signal?.addEventListener("abort", abort, { once: true });
    }

    const emitLine = (line: string, level: "info" | "error") => {
      const trimmed = line.trimEnd();
      if (!trimmed) {
        return;
      }

      output.push(trimmed);
      if (onLog) {
        logQueue = logQueue
          .then(() => onLog({ log: `[docker compose] ${trimmed}`, level }))
          .then(() => undefined, () => undefined);
      }
    };

    const attachLineReader = (stream: NodeJS.ReadableStream, level: "info" | "error") => {
      let buffer = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          emitLine(line, level);
        }
      });
      stream.on("end", () => {
        emitLine(buffer, level);
        buffer = "";
      });
    };

    attachLineReader(child.stdout, "info");
    attachLineReader(child.stderr, "error");

    await new Promise<void>((resolve, reject) => {
      child.once("error", (error) => {
        if (aborted) {
          resolve();
          return;
        }
        reject(error);
      });
      child.once("close", (code) => {
        signal?.removeEventListener("abort", abort);
        if (aborted) {
          resolve();
          return;
        }
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}\n${output.join("\n")}`));
      });
    });

    await logQueue;
  }

  private async runComposeWithOutput(cwd: string, args: string[], envFilePath?: string): Promise<string> {
    const composeArgs = withEnvFile(args, envFilePath);
    try {
      const { stdout } = await execFileAsync("docker", ["compose", ...composeArgs], {
        cwd,
        maxBuffer: 1024 * 1024 * 5
      });
      return stdout;
    } catch (primaryError) {
      try {
        const { stdout } = await execFileAsync("docker-compose", composeArgs, {
          cwd,
          maxBuffer: 1024 * 1024 * 5
        });
        return stdout;
      } catch (fallbackError) {
        throw new Error(this.formatComposeError(args, primaryError, fallbackError));
      }
    }
  }

  private async runDockerWithOutput(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("docker", args, {
      maxBuffer: 1024 * 1024 * 5
    });
    return stdout;
  }

  private assertContainerName(container: string): void {
    if (!/^[a-zA-Z0-9_.-]+$/.test(container)) {
      throw Object.assign(new Error("Invalid container name"), { status: 400 });
    }
  }

  private formatComposeError(args: string[], primaryError: unknown, fallbackError: unknown): string {
    const details = [primaryError, fallbackError]
      .map((error) => {
        if (error && typeof error === "object") {
          const maybe = error as { message?: string; stdout?: string; stderr?: string };
          return [maybe.message, maybe.stdout, maybe.stderr].filter(Boolean).join("\n");
        }
        return String(error);
      })
      .filter(Boolean)
      .join("\n--- fallback ---\n");

    return `docker compose ${args.join(" ")} failed:\n${details}`;
  }
}

function parseComposeJsonOutput(output: string): unknown[] {
  const trimmed = output.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown);
  }
}

function withEnvFile(args: string[], envFilePath?: string): string[] {
  return envFilePath ? ["--env-file", envFilePath, ...args] : args;
}

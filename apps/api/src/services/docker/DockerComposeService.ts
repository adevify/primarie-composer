import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class DockerComposeService {
  async up(composePath: string): Promise<void> {
    await this.runCompose(composePath, ["up", "-d"]);
  }

  async down(composePath: string): Promise<void> {
    await this.runCompose(composePath, ["down"]);
  }

  async restart(composePath: string): Promise<void> {
    await this.runCompose(composePath, ["restart"]);
  }

  private async runCompose(cwd: string, args: string[]): Promise<void> {
    try {
      await execFileAsync("docker", ["compose", ...args], {
        cwd,
        maxBuffer: 1024 * 1024 * 5
      });
    } catch (primaryError) {
      try {
        await execFileAsync("docker-compose", args, {
          cwd,
          maxBuffer: 1024 * 1024 * 5
        });
      } catch (fallbackError) {
        throw new Error(this.formatComposeError(args, primaryError, fallbackError));
      }
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

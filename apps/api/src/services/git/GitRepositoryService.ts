import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { env } from "../../config/env.js";
import type { ChangedFilePayload, EnvironmentSource, SyncFilesPayload } from "../../modules/environments/environment.dtos.js";

const execFileAsync = promisify(execFile);

export class GitRepositoryService {
  async prepareRepository(runtimePath: string, source: EnvironmentSource): Promise<string> {
    await this.git(["clone", env.SOURCE_REPO_URL, runtimePath]);

    await this.checkoutSource(runtimePath, source);
    return runtimePath;
  }

  async updateRepository(repoPath: string, source: SyncFilesPayload): Promise<void> {
    await this.git(["fetch", "--all", "--prune"], repoPath);
    await this.git(["reset", "--hard"], repoPath);
    await this.git(["clean", "-fd"], repoPath);
    await this.checkoutSource(repoPath, source);
  }

  private async checkoutSource(repoPath: string, source: EnvironmentSource): Promise<void> {
    if (source.branch && source.branch !== "HEAD") {
      await this.git(["checkout", "-f", `origin/${source.branch}`], repoPath);
    }
    await this.git(["reset", "--hard", source.commit], repoPath);
  }

  async applyChangedFiles(repoPath: string, files: ChangedFilePayload[]): Promise<void> {
    for (const file of files) {
      const destinationPath = this.resolveInsideRepo(repoPath, file.path);

      if (file.status === "deleted") {
        await fs.rm(destinationPath, { force: true });
        continue;
      }

      if (!file.contentBase64) {
        continue;
      }

      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.writeFile(destinationPath, Buffer.from(file.contentBase64, "base64"));
    }
  }

  private resolveInsideRepo(repoPath: string, relativePath: string): string {
    const resolved = path.resolve(repoPath, relativePath);
    const relative = path.relative(repoPath, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw Object.assign(new Error(`Changed file is outside repository: ${relativePath}`), { status: 400 });
    }
    return resolved;
  }

  private async git(args: string[], cwd?: string): Promise<string> {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0"
      },
      maxBuffer: 1024 * 1024 * 10
    });
    return stdout.trim();
  }
}

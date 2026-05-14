import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_PATCH_SIZE_BYTES = 20 * 1024 * 1024;
const EMPTY_PATCH_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const IGNORED_SEGMENTS = new Set([".git", "node_modules", "dist", "build", ".next", "coverage"]);
const IGNORED_FILES = new Set([".env"]);

type ChangedFileStatus = "modified" | "added" | "deleted";

export type GitState = {
  branch: string;
  commit: string;
  isDirty: boolean;
  changedFiles: string[];
};

export type GitPatchMode = "delta" | "full";

export type GitPatchPayload = {
  mode: GitPatchMode;
  data: string;
  previousSha256: string;
  currentSha256: string;
  currentSizeBytes: number;
  changedFiles: string[];
  isEmpty: boolean;
};

export type EnvExampleEntry = {
  key: string;
  value: string;
};

type PorcelainEntry = {
  path: string;
  status: ChangedFileStatus;
};

const committedPatchByRepo = new Map<string, string>();
const pendingPatchesByRepo = new Map<string, Map<string, string>>();

export function assertRepoPath(repoPath: string): string {
  if (typeof repoPath !== "string" || repoPath.trim().length === 0) {
    throw new Error("Repository path is required.");
  }

  const resolved = path.resolve(repoPath);
  if (!existsSync(path.join(resolved, ".git"))) {
    throw new Error("Selected folder is not a Git repository.");
  }

  return resolved;
}

export function isIgnoredRelativePath(relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join("/");
  const segments = normalized.split("/");
  const fileName = segments[segments.length - 1];

  return segments.some((segment) => IGNORED_SEGMENTS.has(segment)) || IGNORED_FILES.has(fileName);
}

async function git(repoPath: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return (await gitRaw(repoPath, args, env)).replace(/\r?\n$/, "");
}

async function gitRaw(repoPath: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const cwd = assertRepoPath(repoPath);
  const { stdout } = await execFileAsync("git", args, { cwd, env: env ? { ...process.env, ...env } : process.env });
  return stdout;
}

export async function getGitState(repoPath: string): Promise<GitState> {
  const [branch, commit, statusOutput] = await Promise.all([
    git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(repoPath, ["rev-parse", "HEAD"]),
    git(repoPath, ["status", "--porcelain"])
  ]);

  const entries = parsePorcelain(statusOutput);
  return {
    branch,
    commit,
    isDirty: entries.length > 0,
    changedFiles: entries.map((entry) => entry.path)
  };
}

export async function readGitPatch(repoPath: string, mode: GitPatchMode = "delta"): Promise<GitPatchPayload> {
  const resolvedRepo = assertRepoPath(repoPath);
  const [gitState, currentPatch] = await Promise.all([
    getGitState(resolvedRepo),
    buildGitDiffPatch(resolvedRepo)
  ]);
  const patchChangedFiles = gitState.changedFiles.filter((relativePath) => !isIgnoredRelativePath(relativePath));
  const currentSizeBytes = Buffer.byteLength(currentPatch, "utf8");

  if (currentSizeBytes > MAX_PATCH_SIZE_BYTES) {
    throw new Error(`Git patch is larger than ${MAX_PATCH_SIZE_BYTES} bytes.`);
  }

  const previousPatch = committedPatchByRepo.get(resolvedRepo) ?? "";
  const previousSha256 = sha256(previousPatch);
  const currentSha256 = sha256(currentPatch);
  storePendingPatch(resolvedRepo, currentSha256, currentPatch);

  if (mode === "full") {
    return {
      mode,
      data: currentPatch,
      previousSha256,
      currentSha256,
      currentSizeBytes,
      changedFiles: patchChangedFiles,
      isEmpty: currentPatch.length === 0
    };
  }

  if (currentPatch === previousPatch) {
    return {
      mode,
      data: "",
      previousSha256,
      currentSha256,
      currentSizeBytes,
      changedFiles: patchChangedFiles,
      isEmpty: true
    };
  }

  const data = await buildPatchDelta(previousPatch, currentPatch);
  if (Buffer.byteLength(data, "utf8") > MAX_PATCH_SIZE_BYTES) {
    throw new Error(`Git patch delta is larger than ${MAX_PATCH_SIZE_BYTES} bytes.`);
  }

  return {
    mode,
    data,
    previousSha256,
    currentSha256,
    currentSizeBytes,
    changedFiles: patchChangedFiles,
    isEmpty: data.length === 0
  };
}

export function commitGitPatchBaseline(repoPath: string, expectedSha256: string): void {
  const resolvedRepo = assertRepoPath(repoPath);
  const pendingPatches = pendingPatchesByRepo.get(resolvedRepo);
  const pendingPatch = pendingPatches?.get(expectedSha256);

  if (pendingPatch === undefined) {
    if (expectedSha256 === EMPTY_PATCH_SHA256) {
      committedPatchByRepo.set(resolvedRepo, "");
      return;
    }
    throw new Error("No pending Git patch baseline is available.");
  }

  committedPatchByRepo.set(resolvedRepo, pendingPatch);
  pendingPatchesByRepo.delete(resolvedRepo);
}

export function resetGitPatchBaseline(repoPath?: string): void {
  if (!repoPath) {
    committedPatchByRepo.clear();
    pendingPatchesByRepo.clear();
    return;
  }

  const resolvedRepo = assertRepoPath(repoPath);
  committedPatchByRepo.delete(resolvedRepo);
  pendingPatchesByRepo.delete(resolvedRepo);
}

export async function readEnvExample(repoPath: string): Promise<EnvExampleEntry[]> {
  const resolvedRepo = assertRepoPath(repoPath);
  const envPath = path.join(resolvedRepo, ".env");
  const envExamplePath = path.join(resolvedRepo, ".env.example");
  const sourcePath = existsSync(envPath) ? envPath : envExamplePath;

  if (!existsSync(sourcePath)) {
    return [];
  }

  const content = await fs.readFile(sourcePath, "utf8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.replace(/^export\s+/, ""))
    .map((line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        return { key: line, value: "" };
      }
      return {
        key: line.slice(0, separatorIndex).trim(),
        value: unquoteEnvValue(line.slice(separatorIndex + 1).trim())
      };
    })
    .filter((entry) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.key));
}

async function buildGitDiffPatch(repoPath: string): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "primarie-composer-diff-"));
  const indexPath = path.join(tempDir, "index");
  const env = { GIT_INDEX_FILE: indexPath };

  try {
    await git(repoPath, ["read-tree", "HEAD"], env);
    await git(repoPath, ["add", "-A", "--", ...gitPatchPathspecs()], env);
    return await gitRaw(repoPath, ["diff", "--cached", "--binary", "HEAD", "--"], env);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function buildPatchDelta(previousPatch: string, currentPatch: string): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "primarie-composer-patch-delta-"));
  const previousPath = path.join(tempDir, "previous.patch");
  const currentPath = path.join(tempDir, "current.patch");

  try {
    await Promise.all([
      fs.writeFile(previousPath, previousPatch, "utf8"),
      fs.writeFile(currentPath, currentPatch, "utf8")
    ]);

    try {
      const { stdout } = await execFileAsync("diff", [
        "-u",
        "--label",
        "previous.patch",
        previousPath,
        "--label",
        "current.patch",
        currentPath
      ]);
      return stdout;
    } catch (error) {
      if (isExecError(error) && error.code === 1 && typeof error.stdout === "string") {
        return error.stdout;
      }
      throw error;
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function gitPatchPathspecs(): string[] {
  const ignoredSegmentPathspecs = [...IGNORED_SEGMENTS]
    .filter((segment) => segment !== ".git")
    .flatMap((segment) => [`:(exclude)${segment}/**`, `:(exclude)**/${segment}/**`]);
  const ignoredFilePathspecs = [...IGNORED_FILES].flatMap((fileName) => [`:(exclude)${fileName}`, `:(exclude)**/${fileName}`]);
  return [".", ...ignoredSegmentPathspecs, ...ignoredFilePathspecs];
}

function storePendingPatch(repoPath: string, sha: string, patch: string): void {
  const patches = pendingPatchesByRepo.get(repoPath) ?? new Map<string, string>();
  patches.set(sha, patch);

  while (patches.size > 20) {
    const oldestSha = patches.keys().next().value;
    if (!oldestSha) {
      break;
    }
    patches.delete(oldestSha);
  }

  pendingPatchesByRepo.set(repoPath, patches);
}

function parsePorcelain(output: string): PorcelainEntry[] {
  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const code = line.slice(0, 2);
      const rawPath = line.slice(3);
      const pathPart = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) ?? rawPath : rawPath;
      return {
        path: normalizeRelativePath(pathPart),
        status: toChangedFileStatus(code)
      };
    });
}

function toChangedFileStatus(code: string): ChangedFileStatus {
  if (code.includes("D")) {
    return "deleted";
  }
  if (code.includes("A") || code.includes("?")) {
    return "added";
  }
  return "modified";
}

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/^"|"$/g, "").split(path.sep).join("/");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isExecError(error: unknown): error is Error & { code?: string | number; stdout?: string } {
  return error instanceof Error && "code" in error;
}

function unquoteEnvValue(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

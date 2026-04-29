import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_FILE_SIZE_BYTES = 1024 * 1024;
const IGNORED_SEGMENTS = new Set([".git", "node_modules", "dist", "build", ".next", "coverage"]);
const IGNORED_FILES = new Set([".env"]);

export type ChangedFileStatus = "modified" | "added" | "deleted";

export type GitState = {
  branch: string;
  commit: string;
  isDirty: boolean;
  changedFiles: string[];
};

export type ChangedFilePayload = {
  path: string;
  contentBase64?: string;
  status: ChangedFileStatus;
  warning?: string;
};

type PorcelainEntry = {
  path: string;
  status: ChangedFileStatus;
};

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

export function ensureInsideRepo(repoPath: string, candidatePath: string): string {
  const resolvedRepo = assertRepoPath(repoPath);
  const resolvedCandidate = path.resolve(resolvedRepo, candidatePath);
  const relative = path.relative(resolvedRepo, resolvedCandidate);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Refusing to read a file outside the selected repository.");
  }

  return resolvedCandidate;
}

async function git(repoPath: string, args: string[]): Promise<string> {
  const cwd = assertRepoPath(repoPath);
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
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

export async function readChangedFiles(repoPath: string, specificPaths?: string[]): Promise<ChangedFilePayload[]> {
  const resolvedRepo = assertRepoPath(repoPath);
  const porcelainEntries = parsePorcelain(await git(resolvedRepo, ["status", "--porcelain"]));
  const statusByPath = new Map(porcelainEntries.map((entry) => [entry.path, entry.status]));
  const entries = specificPaths?.length
    ? specificPaths.map((filePath) => {
        const normalizedPath = normalizeRelativePath(filePath);
        return {
          path: normalizedPath,
          status: statusByPath.get(normalizedPath) ?? "modified"
        };
      })
    : porcelainEntries;

  const uniqueEntries = new Map<string, PorcelainEntry>();
  for (const entry of entries) {
    if (!entry.path || isIgnoredRelativePath(entry.path)) {
      continue;
    }
    uniqueEntries.set(entry.path, entry);
  }

  const payloads = await Promise.all(
    [...uniqueEntries.values()].map((entry) => readChangedFile(resolvedRepo, entry))
  );

  return payloads.filter((payload): payload is ChangedFilePayload => Boolean(payload));
}

async function readChangedFile(repoPath: string, entry: PorcelainEntry): Promise<ChangedFilePayload | null> {
  const relativePath = normalizeRelativePath(entry.path);
  const absolutePath = ensureInsideRepo(repoPath, relativePath);

  if (entry.status === "deleted" || !existsSync(absolutePath)) {
    return { path: relativePath, status: "deleted" };
  }

  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) {
    return null;
  }

  if (stat.size > MAX_FILE_SIZE_BYTES) {
    return {
      path: relativePath,
      status: entry.status,
      warning: `Skipped file larger than ${MAX_FILE_SIZE_BYTES} bytes.`
    };
  }

  const buffer = await fs.readFile(absolutePath);
  if (isProbablyBinary(buffer)) {
    return {
      path: relativePath,
      status: entry.status,
      warning: "Skipped binary file."
    };
  }

  return {
    path: relativePath,
    status: entry.status,
    contentBase64: buffer.toString("base64")
  };
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

function isProbablyBinary(buffer: Buffer): boolean {
  const length = Math.min(buffer.length, 8000);
  for (let index = 0; index < length; index += 1) {
    if (buffer[index] === 0) {
      return true;
    }
  }
  return false;
}

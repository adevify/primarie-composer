import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
// Editors can save through unlink + replace; confirm before syncing a delete.
const DELETE_CONFIRMATION_DELAY_MS = 1500;
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
  deleteConfirmed?: boolean;
  warning?: string;
};

export type EnvExampleEntry = {
  key: string;
  value: string;
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
  return stdout.replace(/\r?\n$/, "");
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
  const entries: PorcelainEntry[] = specificPaths?.length
    ? specificPaths.flatMap((filePath) => {
        const normalizedPath = normalizeRelativePath(filePath);
        const status = statusByPath.get(normalizedPath);
        return status ? [{ path: normalizedPath, status }] : [];
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

async function readChangedFile(repoPath: string, entry: PorcelainEntry): Promise<ChangedFilePayload | null> {
  const relativePath = normalizeRelativePath(entry.path);
  const absolutePath = ensureInsideRepo(repoPath, relativePath);

  if (!existsSync(absolutePath)) {
    await delay(DELETE_CONFIRMATION_DELAY_MS);
  }

  if (!existsSync(absolutePath)) {
    const recheckedStatus = await readPathStatus(repoPath, relativePath);
    if (recheckedStatus !== "deleted") {
      return null;
    }
    return { path: relativePath, status: "deleted", deleteConfirmed: true };
  }

  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) {
    return null;
  }

  const status = entry.status === "deleted" ? "modified" : entry.status;

  if (stat.size > MAX_FILE_SIZE_BYTES) {
    return {
      path: relativePath,
      status,
      warning: `Skipped file larger than ${MAX_FILE_SIZE_BYTES} bytes.`
    };
  }

  const buffer = await fs.readFile(absolutePath);
  return {
    path: relativePath,
    status,
    contentBase64: buffer.toString("base64")
  };
}

async function readPathStatus(repoPath: string, relativePath: string): Promise<ChangedFileStatus | undefined> {
  const output = await git(repoPath, ["status", "--porcelain", "--", relativePath]);
  return parsePorcelain(output).find((entry) => entry.path === relativePath)?.status;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function unquoteEnvValue(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

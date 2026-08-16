import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

export interface GitCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  spawnError: string | null;
}

export interface GitCommandRunner {
  run(cwd: string, args: string[]): Promise<GitCommandResult>;
}

export class NodeGitCommandRunner implements GitCommandRunner {
  run(cwd: string, args: string[]): Promise<GitCommandResult> {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn("git", args, {
          cwd,
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        resolve({
          exitCode: null,
          stdout: "",
          stderr: "",
          spawnError: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let spawnError: string | null = null;
      child.stdout.on("data", (chunk: Buffer | string) => stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      child.stderr.on("data", (chunk: Buffer | string) => stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      child.once("error", (error) => {
        spawnError = error.message;
      });
      child.once("close", (exitCode) => {
        resolve({
          exitCode,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          spawnError,
        });
      });
    });
  }
}

export interface GitStatusEntry {
  indexStatus: string;
  worktreeStatus: string;
  path: string;
  originalPath: string | null;
  raw: string;
}

export interface GitSnapshot {
  capturedAt: string;
  cwd: string;
  isGit: boolean;
  repositoryRoot: string | null;
  entries: GitStatusEntry[];
  paths: string[];
  error: string | null;
  contentDigests: Record<string, string>;
  headState: "born" | "unborn" | "unknown";
}

export interface GitScopeComparison {
  before: GitSnapshot;
  after: GitSnapshot;
  status: "clean" | "in-scope" | "out-of-scope" | "ambiguous" | "not-git";
  introducedPaths: string[];
  preExistingPaths: string[];
  changedExistingPaths: string[];
  inScopePaths: string[];
  outOfScopePaths: string[];
  ambiguousPaths: string[];
  requiresHumanReview: boolean;
  reason: string;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/").replace(/\/$/, "");
}

function comparisonKey(value: string): string {
  return normalizePath(value).toLowerCase();
}

function parseStatus(output: string): GitStatusEntry[] {
  const fields = output.split("\0");
  const entries: GitStatusEntry[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const token = fields[index] ?? "";
    if (!token) continue;
    const indexStatus = token[0] ?? " ";
    const worktreeStatus = token[1] ?? " ";
    const pathText = token.length > 3 ? token.slice(3) : "";
    if (!pathText) continue;
    if ((indexStatus === "R" || indexStatus === "C" || worktreeStatus === "R" || worktreeStatus === "C") && fields[index + 1]) {
      const destination = fields[index + 1] as string;
      entries.push({
        indexStatus,
        worktreeStatus,
        path: normalizePath(destination),
        originalPath: normalizePath(pathText),
        raw: token + "\0" + destination,
      });
      index += 1;
    } else {
      entries.push({
        indexStatus,
        worktreeStatus,
        path: normalizePath(pathText),
        originalPath: null,
        raw: token,
      });
    }
  }
  return entries;
}

export async function captureGitSnapshot(
  cwd: string,
  runner: GitCommandRunner = new NodeGitCommandRunner(),
): Promise<GitSnapshot> {
  const capturedAt = new Date().toISOString();
  const rootResult = await runner.run(cwd, ["rev-parse", "--show-toplevel"]);
  if (rootResult.exitCode !== 0 || rootResult.spawnError) {
    return {
      capturedAt,
      cwd,
      isGit: false,
      repositoryRoot: null,
      entries: [],
      paths: [],
      error: (rootResult.spawnError || rootResult.stderr || "Not a Git repository.").trim(),
      contentDigests: {},
      headState: "unknown",
    };
  }
  const repositoryRoot = rootResult.stdout.trim();
  if (!repositoryRoot) {
    return {
      capturedAt,
      cwd,
      isGit: false,
      repositoryRoot: null,
      entries: [],
      paths: [],
      error: "Git returned an empty repository root.",
      contentDigests: {},
      headState: "unknown",
    };
  }
  const statusResult = await runner.run(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (statusResult.exitCode !== 0 || statusResult.spawnError) {
    return {
      capturedAt,
      cwd,
      isGit: true,
      repositoryRoot,
      entries: [],
      paths: [],
      error: (statusResult.spawnError || statusResult.stderr || "Git status failed.").trim(),
      contentDigests: {},
      headState: "unknown",
    };
  }
  const repositoryEntries = parseStatus(statusResult.stdout);
  const trackedResult = await runner.run(cwd, ["ls-files", "--full-name", "-z"]);
  if (trackedResult.exitCode !== 0 || trackedResult.spawnError) {
    return { capturedAt, cwd, isGit: true, repositoryRoot, entries: repositoryEntries, paths: [], error: (trackedResult.spawnError || trackedResult.stderr || "Git ls-files failed.").trim(), contentDigests: {}, headState: "unknown" };
  }
  const tracked = trackedResult.stdout.split("\0").filter(Boolean).map(normalizePath);
  const repositoryPaths = [...new Set([...tracked, ...repositoryEntries.flatMap((entry) => [entry.path, ...(entry.originalPath ? [entry.originalPath] : [])])])];
  const contentDigests: Record<string, string> = {};
  const workspacePath = (path: string): string => normalizePath(relative(resolve(cwd), join(repositoryRoot, path)) || ".");
  for (const path of repositoryPaths) {
    const mapped = workspacePath(path);
    try { contentDigests[mapped] = createHash("sha256").update(await readFile(join(repositoryRoot, path))).digest("hex"); }
    catch { contentDigests[mapped] = "missing"; }
  }
  const entries = repositoryEntries.map((entry) => ({ ...entry, path: workspacePath(entry.path), originalPath: entry.originalPath ? workspacePath(entry.originalPath) : null }));
  const paths = repositoryPaths.map(workspacePath);
  const headResult = await runner.run(cwd, ["rev-parse", "--verify", "HEAD"]);
  return {
    capturedAt,
    cwd,
    isGit: true,
    repositoryRoot,
    entries,
    paths,
    error: null,
    contentDigests,
    headState: headResult.exitCode === 0 ? "born" : "unborn",
  };
}

function hasGlob(pattern: string): boolean { return /[*?\[]/.test(pattern); }

function pathAllowed(path: string, allowedPaths: string[], baselinePaths: readonly string[]): boolean {
  const target = comparisonKey(path);
  return allowedPaths.some((allowed) => {
    const pattern = comparisonKey(allowed);
    if (pattern === "*" || pattern === "**" || pattern === "**/*" || pattern === ".") return true;
    if (pattern.endsWith("/**/*")) {
      const prefix = pattern.slice(0, -5);
      return target === prefix || target.startsWith(prefix + "/");
    }
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3).replace(/\/$/, "");
      return target === prefix || target.startsWith(prefix + "/");
    }
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2).replace(/\/$/, "");
      return target === prefix || target.startsWith(prefix + "/");
    }
    if (hasGlob(pattern)) return false;
    const baseline = baselinePaths.map(comparisonKey);
    const existedAsFile = baseline.includes(pattern);
    const existedAsDirectory = baseline.some((item) => item.startsWith(pattern + "/"));
    if (existedAsFile) return target === pattern;
    if (existedAsDirectory) return target === pattern || target.startsWith(pattern + "/");
    return false;
  });
}

export function compareGitSnapshots(
  before: GitSnapshot,
  after: GitSnapshot,
  allowedPaths: string[],
): GitScopeComparison {
  if (!before.isGit || !after.isGit) {
    return {
      before,
      after,
      status: "not-git",
      introducedPaths: [],
      preExistingPaths: [],
      changedExistingPaths: [],
      inScopePaths: [],
      outOfScopePaths: [],
      ambiguousPaths: [],
      requiresHumanReview: true,
      reason: "Git status evidence is unavailable for the before/after comparison.",
    };
  }
  if (before.error || after.error) {
    return {
      before,
      after,
      status: "ambiguous",
      introducedPaths: [],
      preExistingPaths: [],
      changedExistingPaths: [],
      inScopePaths: [],
      outOfScopePaths: [],
      ambiguousPaths: [before.error || after.error || "unknown Git audit error"],
      requiresHumanReview: true,
      reason: "Git status evidence is incomplete or ambiguous.",
    };
  }

  const beforeByPath = new Map(before.entries.flatMap((entry) => {
    const values: Array<[string, GitStatusEntry]> = [[comparisonKey(entry.path), entry]];
    if (entry.originalPath) values.push([comparisonKey(entry.originalPath), entry]);
    return values;
  }));
  const afterByPath = new Map(after.entries.flatMap((entry) => {
    const values: Array<[string, GitStatusEntry]> = [[comparisonKey(entry.path), entry]];
    if (entry.originalPath) values.push([comparisonKey(entry.originalPath), entry]);
    return values;
  }));

  const introducedPaths: string[] = [];
  const preExistingPaths: string[] = [];
  const changedExistingPaths: string[] = [];
  const ambiguousPaths: string[] = [];
  for (const [key, entry] of afterByPath) {
    const beforeEntry = beforeByPath.get(key);
    if (!beforeEntry) {
      introducedPaths.push(entry.path);
    } else if (beforeEntry.raw === entry.raw && before.contentDigests[entry.path] === after.contentDigests[entry.path]) {
      preExistingPaths.push(entry.path);
    } else {
      changedExistingPaths.push(entry.path);
    }
  }

  const allDigestPaths = new Set([...Object.keys(before.contentDigests), ...Object.keys(after.contentDigests)]);
  for (const path of allDigestPaths) {
    if (before.contentDigests[path] === after.contentDigests[path]) continue;
    if (!before.contentDigests[path]) introducedPaths.push(path);
    else if (!changedExistingPaths.includes(path)) changedExistingPaths.push(path);
  }

  const changedPaths = [...new Set([...introducedPaths, ...changedExistingPaths])];
  const baselineScopePaths = [...before.paths, ...changedExistingPaths];
  const inScopePaths = changedPaths.filter((path) => pathAllowed(path, allowedPaths, baselineScopePaths));
  const outOfScopePaths = changedPaths.filter((path) => !pathAllowed(path, allowedPaths, baselineScopePaths));
  const requiresHumanReview = ambiguousPaths.length > 0 || outOfScopePaths.length > 0;
  const status = outOfScopePaths.length > 0
    ? "out-of-scope"
    : ambiguousPaths.length > 0
      ? "ambiguous"
      : changedPaths.length === 0
        ? "clean"
        : "in-scope";
  const reason = outOfScopePaths.length > 0
    ? "New Git paths are outside Handoff allowedPaths."
    : ambiguousPaths.length > 0
      ? "A pre-existing Git change changed shape during execution; attribution is ambiguous."
      : changedPaths.length === 0
        ? "No new Git paths were introduced."
        : "All changed Git paths match Handoff allowedPaths.";

  return {
    before,
    after,
    status,
    introducedPaths,
    preExistingPaths,
    changedExistingPaths,
    inScopePaths,
    outOfScopePaths,
    ambiguousPaths,
    requiresHumanReview,
    reason,
  };
}

export const auditGitScope = compareGitSnapshots;

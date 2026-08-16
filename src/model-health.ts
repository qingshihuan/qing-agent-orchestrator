import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeProcessRunner, type ProcessRequest, type ProcessResult, type ProcessRunner } from "./process-runner.js";
import { redactSensitiveText } from "./executors/codex-exec-executor.js";
import type { ModelCandidate, ModelHealthState, ModelSelection } from "./types.js";

export type ModelHealthFailure = "timeout" | "authentication" | "process" | "jsonl" | "schema" | "capability" | null;

export interface ModelHealthRecord {
  candidateId: string;
  fingerprint: string;
  cliVersion: string;
  state: ModelHealthState;
  cacheState: "fresh" | "cached";
  checkedAt: string | null;
  expiresAt: string | null;
  failure: ModelHealthFailure;
  reason: string;
}

export interface ModelHealthOptions {
  command: string;
  cwd: string;
  schemaPath: string;
  timeoutMs: number;
  ttlMs: number;
  maxOutputBytes?: number;
  ephemeral?: boolean;
  ignoreUserConfig?: boolean;
  now?: () => number;
}

function jsonlError(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return "Codex preflight returned no JSONL events.";
  for (const [index, line] of lines.entries()) {
    try {
      const value = JSON.parse(line) as { type?: unknown };
      if (typeof value.type !== "string") return `JSONL event ${index + 1} has no string type.`;
    } catch {
      return `JSONL event ${index + 1} is malformed.`;
    }
  }
  return null;
}

function failureFrom(result: ProcessResult): { failure: Exclude<ModelHealthFailure, null>; reason: string } {
  const diagnostic = redactSensitiveText(result.spawnError ?? result.stderr ?? result.stdout).slice(0, 500);
  if (result.timedOut) return { failure: "timeout", reason: "Model preflight timed out." };
  if (/auth|login|unauthori[sz]ed|forbidden|401|403/i.test(diagnostic)) {
    return { failure: "authentication", reason: "Model preflight authentication failed." };
  }
  return { failure: "process", reason: `Model preflight process failed${diagnostic ? `: ${diagnostic}` : "."}` };
}

export function candidateFingerprint(candidate: ModelCandidate, cliVersion: string): string {
  return createHash("sha256").update(JSON.stringify({
    cliVersion,
    model: candidate.model,
    profile: candidate.profile,
    reasoningEffort: candidate.reasoningEffort,
    roles: [...candidate.roles].sort(),
  })).digest("hex");
}

export function modelCandidateArgs(candidate: ModelCandidate): string[] {
  return modelSelectionArgs(candidate);
}

export function modelSelectionArgs(candidate: Pick<ModelSelection, "model" | "profile" | "reasoningEffort">): string[] {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/.test(candidate.model)) throw new Error("Model ID contains unsafe characters.");
  if (candidate.profile !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(candidate.profile)) throw new Error("Profile contains unsafe characters.");
  if (!(["low", "medium", "high", "xhigh"] as string[]).includes(candidate.reasoningEffort)) throw new Error("Reasoning effort is unsupported.");
  const args = ["-m", candidate.model];
  if (candidate.profile) args.push("--profile", candidate.profile);
  args.push("-c", `model_reasoning_effort=\"${candidate.reasoningEffort}\"`);
  return args;
}

export class ModelHealthChecker {
  private readonly cache = new Map<string, ModelHealthRecord>();
  private readonly pending = new Map<string, Promise<ModelHealthRecord>>();
  private versionPromise?: Promise<string>;

  constructor(
    private readonly options: ModelHealthOptions,
    private readonly runner: ProcessRunner = new NodeProcessRunner(),
  ) {}

  async check(candidate: ModelCandidate): Promise<ModelHealthRecord> {
    if (!candidate.enabled) return this.unverified(candidate.id, "Candidate is disabled.");
    const cliVersion = await this.cliVersion();
    const fingerprint = candidateFingerprint(candidate, cliVersion);
    const now = (this.options.now ?? Date.now)();
    const cached = this.cache.get(fingerprint);
    if (cached?.expiresAt && Date.parse(cached.expiresAt) > now) return { ...cached, cacheState: "cached" };
    const current = this.pending.get(fingerprint);
    if (current) return { ...(await current), cacheState: "cached" };
    const task = this.runProbe(candidate, cliVersion, fingerprint, now).finally(() => this.pending.delete(fingerprint));
    this.pending.set(fingerprint, task);
    return task;
  }

  status(candidate: ModelCandidate): ModelHealthRecord {
    const records = [...this.cache.values()].filter(({ candidateId }) => candidateId === candidate.id);
    const latest = records.sort((left, right) => String(right.checkedAt).localeCompare(String(left.checkedAt)))[0];
    if (!latest) return this.unverified(candidate.id, candidate.enabled ? "Candidate has not been preflighted." : "Candidate is disabled.");
    const now = (this.options.now ?? Date.now)();
    if (!latest.expiresAt || Date.parse(latest.expiresAt) <= now) return { ...latest, state: "expired", cacheState: "cached", reason: "Cached preflight has expired." };
    return { ...latest, cacheState: "cached" };
  }

  private unverified(candidateId: string, reason: string): ModelHealthRecord {
    return { candidateId, fingerprint: "", cliVersion: "unknown", state: "unverified", cacheState: "fresh", checkedAt: null, expiresAt: null, failure: null, reason };
  }

  private async cliVersion(): Promise<string> {
    if (!this.versionPromise) {
      this.versionPromise = this.runner.run(this.request(["--version"], "", Math.min(this.options.timeoutMs, 10_000))).then((result) => {
        if (result.exitCode !== 0 || result.spawnError || result.timedOut) throw new Error(failureFrom(result).reason);
        return redactSensitiveText(result.stdout || result.stderr).trim().split(/\r?\n/)[0] || "unknown";
      });
    }
    return this.versionPromise;
  }

  private request(args: string[], stdin: string, timeoutMs = this.options.timeoutMs): ProcessRequest {
    return {
      command: this.options.command,
      args,
      cwd: this.options.cwd,
      stdin,
      timeoutMs,
      maxOutputBytes: this.options.maxOutputBytes ?? 128 * 1024,
    };
  }

  private async runProbe(candidate: ModelCandidate, cliVersion: string, fingerprint: string, now: number): Promise<ModelHealthRecord> {
    const temporary = await mkdtemp(join(tmpdir(), "qing-model-health-"));
    const outputPath = join(temporary, "result.json");
    const args = [
      "exec", "--json", "--sandbox", "read-only",
      "--output-schema", resolve(this.options.schemaPath),
      "--output-last-message", outputPath,
      ...modelCandidateArgs(candidate),
    ];
    if (this.options.ephemeral !== false) args.push("--ephemeral");
    if (this.options.ignoreUserConfig !== false) args.push("--ignore-user-config");
    args.push("--skip-git-repo-check", "-");
    const checkedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + this.options.ttlMs).toISOString();
    let record: ModelHealthRecord;
    try {
      const result = await this.runner.run(this.request(args, "Return only the structured health object with status ok and capabilities planner, executor, reviewer. Do not inspect files or use tools."));
      if (result.exitCode !== 0 || result.spawnError || result.timedOut || result.outputLimitExceeded) {
        const failed = failureFrom(result);
        record = { candidateId: candidate.id, fingerprint, cliVersion, state: "unhealthy", cacheState: "fresh", checkedAt, expiresAt, ...failed };
      } else {
        const protocol = jsonlError(result.stdout);
        if (protocol) {
          record = { candidateId: candidate.id, fingerprint, cliVersion, state: "unhealthy", cacheState: "fresh", checkedAt, expiresAt, failure: "jsonl", reason: protocol };
        } else {
          let value: unknown;
          try { value = JSON.parse(await readFile(outputPath, "utf8")); }
          catch { value = null; }
          const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
          const capabilities = raw?.capabilities;
          if (raw?.status !== "ok" || !Array.isArray(capabilities) || !capabilities.every((item) => typeof item === "string")) {
            record = { candidateId: candidate.id, fingerprint, cliVersion, state: "unhealthy", cacheState: "fresh", checkedAt, expiresAt, failure: "schema", reason: "Model preflight final output failed the health schema." };
          } else if (!candidate.roles.every((role) => capabilities.includes(role))) {
            record = { candidateId: candidate.id, fingerprint, cliVersion, state: "unhealthy", cacheState: "fresh", checkedAt, expiresAt, failure: "capability", reason: "Model preflight did not confirm every configured role." };
          } else {
            record = { candidateId: candidate.id, fingerprint, cliVersion, state: "healthy", cacheState: "fresh", checkedAt, expiresAt, failure: null, reason: "Bounded structured preflight passed." };
          }
        }
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    this.cache.set(fingerprint, record!);
    return record!;
  }
}

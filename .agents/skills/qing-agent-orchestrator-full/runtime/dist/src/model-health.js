import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseCodexModelCatalog, validateCandidateAgainstCatalog, validateKnownModelMinimum } from "./codex-model-catalog.js";
import { NodeProcessRunner } from "./process-runner.js";
import { formatProcessDiagnostic, redactSensitiveText } from "./executors/codex-exec-executor.js";
import { validateModelCapability } from "./model-router.js";
function jsonlError(stdout) {
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0)
        return "Codex preflight returned no JSONL events.";
    for (const [index, line] of lines.entries()) {
        try {
            const value = JSON.parse(line);
            if (typeof value.type !== "string")
                return `JSONL event ${index + 1} has no string type.`;
        }
        catch {
            return `JSONL event ${index + 1} is malformed.`;
        }
    }
    return null;
}
function failureFrom(result) {
    const diagnostic = formatProcessDiagnostic(result);
    if (result.timedOut)
        return { failure: "timeout", reason: `Model preflight timed out. ${diagnostic}` };
    if (/auth|login|unauthori[sz]ed|forbidden|401|403/i.test(diagnostic)) {
        return { failure: "authentication", reason: `Model preflight authentication failed. ${diagnostic}` };
    }
    return { failure: "process", reason: `Model preflight process failed. ${diagnostic}` };
}
export function candidateFingerprint(candidate, cliVersion) {
    return createHash("sha256").update(JSON.stringify({
        cliVersion,
        backend: candidate.backend,
        model: candidate.model,
        profile: candidate.profile,
        reasoningEffort: candidate.reasoningEffort,
        availability: candidate.availability,
        roles: [...candidate.roles].sort(),
    })).digest("hex");
}
export function modelCandidateArgs(candidate) {
    return modelSelectionArgs(candidate);
}
export function modelSelectionArgs(candidate) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/.test(candidate.model))
        throw new Error("Model ID contains unsafe characters.");
    if (candidate.profile !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(candidate.profile))
        throw new Error("Profile contains unsafe characters.");
    if (candidate.backend !== "codex-cli")
        throw new Error("Codex CLI arguments require a codex-cli model selection.");
    const capabilityError = validateModelCapability(candidate);
    if (capabilityError)
        throw new Error(`Reasoning/model capability is unsupported: ${capabilityError}`);
    const args = ["-m", candidate.model];
    if (candidate.profile)
        args.push("--profile", candidate.profile);
    args.push("-c", `model_reasoning_effort=\"${candidate.reasoningEffort}\"`);
    return args;
}
export class ModelHealthChecker {
    options;
    runner;
    cache = new Map();
    pending = new Map();
    versionPromise;
    catalogPromise;
    persistentCacheLoad;
    persistentCacheWrite = Promise.resolve();
    constructor(options, runner = new NodeProcessRunner()) {
        this.options = options;
        this.runner = runner;
    }
    async check(candidate, force = false) {
        if (!candidate.enabled)
            return this.unverified(candidate.id, "Candidate is disabled.");
        const capabilityError = validateModelCapability(candidate);
        if (candidate.backend !== "codex-cli" || capabilityError)
            return this.unverified(candidate.id, capabilityError ?? "Desktop child candidates are not probed through Codex CLI.");
        await this.loadPersistentCache();
        const cliVersion = await this.cliVersion();
        const knownMinimum = validateKnownModelMinimum(candidate.model, cliVersion);
        if (knownMinimum)
            return this.unverified(candidate.id, knownMinimum);
        const fingerprint = candidateFingerprint(candidate, cliVersion);
        const now = (this.options.now ?? Date.now)();
        const cached = this.cache.get(fingerprint);
        if (!force && cached?.expiresAt && Date.parse(cached.expiresAt) > now)
            return { ...cached, candidateId: candidate.id, cacheState: "cached" };
        const current = this.pending.get(fingerprint);
        if (current)
            return { ...(await current), candidateId: candidate.id, cacheState: "cached" };
        const task = this.validateCatalogThenProbe(candidate, cliVersion, fingerprint, now).finally(() => this.pending.delete(fingerprint));
        this.pending.set(fingerprint, task);
        return task;
    }
    status(candidate) {
        if (!candidate.enabled)
            return this.unverified(candidate.id, "Candidate is disabled.");
        // IDs can be reused after a configuration edit. Only the exact pair,
        // profile and roles that were checked may reuse a health result.
        const records = [...this.cache.values()].filter((record) => record.fingerprint === candidateFingerprint(candidate, record.cliVersion));
        const latest = records.sort((left, right) => String(right.checkedAt).localeCompare(String(left.checkedAt)))[0];
        if (!latest)
            return this.unverified(candidate.id, "Candidate has not been preflighted.");
        const now = (this.options.now ?? Date.now)();
        if (!latest.expiresAt || Date.parse(latest.expiresAt) <= now)
            return { ...latest, candidateId: candidate.id, state: "expired", cacheState: "cached", reason: "Cached preflight has expired." };
        return { ...latest, candidateId: candidate.id, cacheState: "cached" };
    }
    loadPersistentCache() {
        // Every concurrent check must await the same initial disk read, not just
        // the first check. Otherwise later callers may launch unnecessary probes.
        this.persistentCacheLoad ??= this.readPersistentCache();
        return this.persistentCacheLoad;
    }
    async readPersistentCache() {
        if (!this.options.cachePath)
            return;
        try {
            const parsed = JSON.parse(await readFile(this.options.cachePath, "utf8"));
            if (parsed.version !== "1.0" || !Array.isArray(parsed.records))
                return;
            for (const value of parsed.records.slice(-128)) {
                if (!value || typeof value !== "object" || Array.isArray(value))
                    continue;
                const record = value;
                if (typeof record.candidateId !== "string" || typeof record.fingerprint !== "string" || typeof record.reason !== "string" || typeof record.cliVersion !== "string")
                    continue;
                if (!/^[a-f0-9]{64}$/.test(record.fingerprint))
                    continue;
                if (typeof record.checkedAt !== "string" || typeof record.expiresAt !== "string")
                    continue;
                const checkedAt = Date.parse(record.checkedAt);
                const expiresAt = Date.parse(record.expiresAt);
                if (!Number.isFinite(checkedAt) || !Number.isFinite(expiresAt) || expiresAt <= checkedAt)
                    continue;
                if (record.state === "healthy" ? record.failure !== null :
                    record.state !== "unhealthy" || !["timeout", "authentication", "process", "jsonl", "schema", "capability"].includes(record.failure ?? ""))
                    continue;
                this.cache.set(record.fingerprint, { ...record, reason: redactSensitiveText(record.reason) });
            }
        }
        catch {
            // A missing or malformed optimization cache never blocks execution.
        }
    }
    persistCache() {
        const target = this.options.cachePath;
        if (!target)
            return Promise.resolve();
        this.persistentCacheWrite = this.persistentCacheWrite.then(async () => {
            // Serialize snapshots per checker and use a unique path across checkers.
            // This is a best-effort cache, not a cross-process evidence transaction.
            const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
            try {
                await mkdir(dirname(target), { recursive: true });
                const records = [...this.cache.values()]
                    .sort((left, right) => String(left.checkedAt).localeCompare(String(right.checkedAt)))
                    .slice(-128);
                await writeFile(temporary, JSON.stringify({ version: "1.0", records }, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
                await rename(temporary, target);
            }
            catch {
                // Cache permissions, disk space or concurrent replacement failures do
                // not change the actual probe result or disable the in-memory cache.
            }
            finally {
                await rm(temporary, { force: true }).catch(() => undefined);
            }
        });
        return this.persistentCacheWrite;
    }
    async storeRecord(record) {
        this.cache.set(record.fingerprint, record);
        await this.persistCache();
    }
    unverified(candidateId, reason) {
        return { candidateId, fingerprint: "", cliVersion: "unknown", state: "unverified", cacheState: "fresh", checkedAt: null, expiresAt: null, failure: null, reason };
    }
    async cliVersion() {
        if (!this.versionPromise) {
            this.versionPromise = this.runner.run(this.request(["--version"], "", Math.min(this.options.timeoutMs, 10_000))).then((result) => {
                if (result.exitCode !== 0 || result.spawnError || result.timedOut || result.outputLimitExceeded || result.cancelled)
                    throw new Error(failureFrom(result).reason);
                return redactSensitiveText(result.stdout || result.stderr).trim().split(/\r?\n/)[0] || "unknown";
            }).catch((error) => {
                // A failed discovery is not a permanent rejection for this checker.
                // Retry only on a later explicit check, never in an internal loop.
                this.versionPromise = undefined;
                throw error;
            });
        }
        return this.versionPromise;
    }
    async catalog() {
        if (!this.catalogPromise) {
            this.catalogPromise = this.runner.run(this.request(["debug", "models", "--bundled"], "", Math.min(this.options.timeoutMs, 15_000), Math.max(this.options.maxOutputBytes ?? 0, 8 * 1024 * 1024))).then((result) => {
                if (result.exitCode !== 0 || result.spawnError || result.timedOut || result.outputLimitExceeded || result.cancelled) {
                    throw new Error(`Codex bundled model catalog command failed. ${formatProcessDiagnostic(result)}`);
                }
                return parseCodexModelCatalog(result.stdout);
            }).catch((error) => {
                this.catalogPromise = undefined;
                throw error;
            });
        }
        return this.catalogPromise;
    }
    request(args, stdin, timeoutMs = this.options.timeoutMs, maxOutputBytes = this.options.maxOutputBytes ?? 128 * 1024) {
        return {
            command: this.options.command,
            args,
            cwd: this.options.cwd,
            stdin,
            timeoutMs,
            maxOutputBytes,
        };
    }
    async validateCatalogThenProbe(candidate, cliVersion, fingerprint, now) {
        const checkedAt = new Date(now).toISOString();
        const expiresAt = new Date(now + this.options.ttlMs).toISOString();
        try {
            const catalog = await this.catalog();
            const capabilityError = validateCandidateAgainstCatalog(candidate, catalog, cliVersion);
            if (capabilityError) {
                const record = {
                    candidateId: candidate.id,
                    fingerprint,
                    cliVersion,
                    state: "unhealthy",
                    cacheState: "fresh",
                    checkedAt,
                    expiresAt,
                    failure: "capability",
                    reason: capabilityError,
                };
                await this.storeRecord(record);
                return record;
            }
        }
        catch (error) {
            const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
            const record = {
                candidateId: candidate.id,
                fingerprint,
                cliVersion,
                state: "unhealthy",
                cacheState: "fresh",
                checkedAt,
                expiresAt,
                failure: "capability",
                reason: `Codex bundled model catalog validation failed: ${message}`,
            };
            this.cache.set(fingerprint, record);
            return record;
        }
        return this.runProbe(candidate, cliVersion, fingerprint, now);
    }
    async runProbe(candidate, cliVersion, fingerprint, now) {
        const temporary = await mkdtemp(join(tmpdir(), "qing-model-health-"));
        const outputPath = join(temporary, "result.json");
        const args = [
            "exec", "--json", "--sandbox", "read-only",
            "--output-schema", resolve(this.options.schemaPath),
            "--output-last-message", outputPath,
            ...modelCandidateArgs(candidate),
        ];
        if (this.options.ephemeral !== false)
            args.push("--ephemeral");
        if (this.options.ignoreUserConfig !== false)
            args.push("--ignore-user-config");
        args.push("--skip-git-repo-check", "-");
        const checkedAt = new Date(now).toISOString();
        const expiresAt = new Date(now + this.options.ttlMs).toISOString();
        let record;
        try {
            const result = await this.runner.run(this.request(args, "Return only the structured health object with status ok and capabilities planner, executor, reviewer. Do not inspect files or use tools."));
            if (result.exitCode !== 0 || result.spawnError || result.timedOut || result.outputLimitExceeded || result.cancelled) {
                const failed = failureFrom(result);
                record = { candidateId: candidate.id, fingerprint, cliVersion, state: "unhealthy", cacheState: "fresh", checkedAt, expiresAt, ...failed };
            }
            else {
                const protocol = jsonlError(result.stdout);
                if (protocol) {
                    record = { candidateId: candidate.id, fingerprint, cliVersion, state: "unhealthy", cacheState: "fresh", checkedAt, expiresAt, failure: "jsonl", reason: `${protocol} ${formatProcessDiagnostic(result)}` };
                }
                else {
                    let value;
                    try {
                        value = JSON.parse(await readFile(outputPath, "utf8"));
                    }
                    catch {
                        value = null;
                    }
                    const raw = value && typeof value === "object" && !Array.isArray(value) ? value : null;
                    const capabilities = raw?.capabilities;
                    if (raw?.status !== "ok" || !Array.isArray(capabilities) || !capabilities.every((item) => typeof item === "string")) {
                        record = { candidateId: candidate.id, fingerprint, cliVersion, state: "unhealthy", cacheState: "fresh", checkedAt, expiresAt, failure: "schema", reason: `Model preflight final output failed the health schema. ${formatProcessDiagnostic(result)}` };
                    }
                    else if (!candidate.roles.every((role) => capabilities.includes(role))) {
                        record = { candidateId: candidate.id, fingerprint, cliVersion, state: "unhealthy", cacheState: "fresh", checkedAt, expiresAt, failure: "capability", reason: `Model preflight did not confirm every configured role. ${formatProcessDiagnostic(result)}` };
                    }
                    else {
                        record = { candidateId: candidate.id, fingerprint, cliVersion, state: "healthy", cacheState: "fresh", checkedAt, expiresAt, failure: null, reason: "Bundled catalog validation and bounded structured preflight passed." };
                    }
                }
            }
        }
        finally {
            await rm(temporary, { recursive: true, force: true });
        }
        await this.storeRecord(record);
        return record;
    }
}

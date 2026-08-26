import { appendFile, mkdir, open, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { validateRelayCriterionEvidence } from "./validation.js";
function safeSegment(value) {
    const normalized = value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+$/, "_");
    return normalized.slice(0, 96) || "run";
}
function now() {
    return new Date().toISOString();
}
async function writeUtf8Atomic(path, contents) {
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporaryPath, contents, "utf8");
        await rename(temporaryPath, path);
    }
    catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
    }
}
function defaultProcessMetadata() {
    return {
        state: "not-started",
        pid: null,
        command: null,
        args: [],
        cwd: null,
        startedAt: null,
        endedAt: null,
        exitCode: null,
        signal: null,
        cancelled: false,
        timedOut: false,
        outputLimitExceeded: false,
    };
}
class FileRunHandle {
    runId;
    directory;
    artifacts;
    recordPath;
    processPath;
    eventsPath;
    record;
    sequence = 0;
    queue = Promise.resolve();
    lockPath;
    constructor(runId, directory, artifacts, record) {
        this.runId = runId;
        this.directory = directory;
        this.artifacts = artifacts;
        this.record = record;
        this.recordPath = join(directory, "run-record.json");
        this.processPath = artifacts.process;
        this.eventsPath = artifacts.events;
        this.lockPath = join(directory, ".run-store-lock");
    }
    enqueue(operation) {
        const next = this.queue.then(async () => {
            for (let attempt = 0;; attempt += 1) {
                try {
                    const lock = await open(this.lockPath, "wx");
                    await lock.close();
                    break;
                }
                catch (error) {
                    if (error.code !== "EEXIST" || attempt >= 500)
                        throw error;
                    await new Promise((resolve) => setTimeout(resolve, 10));
                }
            }
            try {
                this.record = JSON.parse(await readFile(this.recordPath, "utf8"));
                this.sequence = Math.max(this.sequence, this.record.lastEvent?.sequence ?? 0);
                return await operation();
            }
            finally {
                await unlink(this.lockPath).catch(() => undefined);
            }
        });
        this.queue = next.then(() => undefined, () => undefined);
        return next;
    }
    async persistRecord() {
        this.record = { ...this.record, updatedAt: now() };
        await writeUtf8Atomic(this.recordPath, JSON.stringify(this.record, null, 2) + "\n");
    }
    restoreSequence(sequence) {
        this.sequence = Math.max(0, Math.trunc(sequence));
    }
    async writeAttemptFile(iteration, name, value) {
        const attemptDirectory = join(this.directory, "attempts", String(iteration));
        await mkdir(attemptDirectory, { recursive: true });
        await writeFile(join(attemptDirectory, name), JSON.stringify(value, null, 2) + "\n", "utf8");
    }
    appendEvent(type, phase, iteration, message, payload) {
        return this.enqueue(async () => {
            if (this.record.status === "cancelled" && type !== "run.cancelled" && !(type === "test.exited" && this.record.lastEvent?.type !== "run.cancelled"))
                throw new Error("Run cancellation is terminal.");
            const event = {
                sequence: this.sequence + 1,
                timestamp: now(),
                type,
                phase,
                iteration,
                message,
                ...(payload ? { payload } : {}),
            };
            this.sequence = event.sequence;
            await appendFile(this.eventsPath, JSON.stringify(event) + "\n", "utf8");
            this.record = { ...this.record, phase, iteration, lastEvent: event };
            await this.persistRecord();
            return event;
        });
    }
    appendHeartbeat(iteration, payload) {
        return this.enqueue(async () => {
            if (this.record.status === "cancelled")
                throw new Error("Run cancellation is terminal.");
            const event = {
                sequence: this.sequence + 1,
                timestamp: now(),
                type: "process.heartbeat",
                phase: "executing",
                iteration,
                message: "Relay has not observed the process exit.",
                payload,
            };
            this.sequence = event.sequence;
            await appendFile(this.eventsPath, JSON.stringify(event) + "\n", "utf8");
            this.record = { ...this.record, phase: "executing", iteration, processState: "running", lastEvent: event };
            await this.persistRecord();
            return event;
        });
    }
    writeProcessMetadata(metadata) {
        return this.enqueue(async () => {
            if (this.record.status === "cancelled")
                return;
            await writeFile(this.processPath, JSON.stringify(metadata, null, 2) + "\n", "utf8");
            this.record = { ...this.record, processState: metadata.state };
            await this.persistRecord();
        });
    }
    writeSandboxPreflight(value) {
        return this.enqueue(async () => {
            await writeFile(this.artifacts.sandboxPreflight, JSON.stringify(value, null, 2) + "\n", "utf8");
        });
    }
    writeGitBefore(value) {
        return this.enqueue(async () => {
            await writeFile(this.artifacts.gitBefore, JSON.stringify(value, null, 2) + "\n", "utf8");
        });
    }
    writeGitAfter(value) {
        return this.enqueue(async () => {
            await writeFile(this.artifacts.gitAfter, JSON.stringify(value, null, 2) + "\n", "utf8");
        });
    }
    writeGitAudit(value) {
        return this.enqueue(async () => {
            await writeFile(this.artifacts.gitAudit, JSON.stringify(value, null, 2) + "\n", "utf8");
        });
    }
    writeExecutorResult(result, iteration) {
        return this.enqueue(async () => {
            await writeFile(this.artifacts.executorResult, JSON.stringify(result, null, 2) + "\n", "utf8");
            await this.writeAttemptFile(iteration, "executor-result.json", result);
        });
    }
    writeReview(review, iteration) {
        return this.enqueue(async () => {
            await writeFile(this.artifacts.review, JSON.stringify(review, null, 2) + "\n", "utf8");
            await this.writeAttemptFile(iteration, "review.json", review);
        });
    }
    finalize(status, phase, iteration, processState, summary) {
        return this.enqueue(async () => {
            if (this.record.status === "cancelled") {
                return JSON.parse(await readFile(this.artifacts.finalSummary, "utf8"));
            }
            await this.ensureGitArtifacts();
            const completedAt = now();
            const finalSummary = {
                version: "1.0",
                runId: this.runId,
                handoffId: this.record.handoffId,
                status,
                phase,
                summary,
                startedAt: this.record.startedAt,
                completedAt,
                iteration,
                processState,
                artifacts: this.artifacts,
            };
            await writeFile(this.artifacts.finalSummary, JSON.stringify(finalSummary, null, 2) + "\n", "utf8");
            this.record = { ...this.record, phase, status, iteration, processState, completedAt };
            await this.persistRecord();
            return finalSummary;
        });
    }
    persistCancellation(summary) {
        return this.enqueue(async () => {
            if (this.record.status === "cancelled" && this.record.lastEvent?.type === "run.cancelled")
                return JSON.parse(await readFile(this.artifacts.finalSummary, "utf8"));
            await this.ensureGitArtifacts();
            const metadata = JSON.parse(await readFile(this.processPath, "utf8"));
            const endedAt = now();
            const cancelledMetadata = {
                ...metadata,
                state: "cancelled",
                endedAt: metadata.endedAt ?? endedAt,
                cancelled: true,
            };
            await writeFile(this.processPath, JSON.stringify(cancelledMetadata, null, 2) + "\n", "utf8");
            const event = {
                sequence: this.sequence + 1,
                timestamp: endedAt,
                type: "run.cancelled",
                phase: "cancelled",
                iteration: this.record.iteration,
                message: summary,
            };
            this.sequence = event.sequence;
            await appendFile(this.eventsPath, JSON.stringify(event) + "\n", "utf8");
            this.record = { ...this.record, phase: "cancelled", status: "cancelled", processState: "cancelled", completedAt: endedAt, lastEvent: event };
            const finalSummary = {
                version: "1.0",
                runId: this.runId,
                handoffId: this.record.handoffId,
                status: "cancelled",
                phase: "cancelled",
                summary,
                startedAt: this.record.startedAt,
                completedAt: endedAt,
                iteration: this.record.iteration,
                processState: "cancelled",
                artifacts: this.artifacts,
            };
            await writeFile(this.artifacts.finalSummary, JSON.stringify(finalSummary, null, 2) + "\n", "utf8");
            await this.persistRecord();
            return finalSummary;
        });
    }
    requestCancellation(summary) {
        return this.enqueue(async () => {
            if (this.record.status === "cancelled")
                return;
            const event = { sequence: this.sequence + 1, timestamp: now(), type: "run.cancel.requested", phase: "cancelled", iteration: this.record.iteration, message: summary };
            this.sequence = event.sequence;
            await appendFile(this.eventsPath, JSON.stringify(event) + "\n", "utf8");
            this.record = { ...this.record, phase: "cancelled", status: "cancelled", processState: "cancelled", lastEvent: event };
            await this.persistRecord();
        });
    }
    readRecord() {
        return this.enqueue(async () => JSON.parse(await readFile(this.recordPath, "utf8")));
    }
    readEvents() {
        return this.enqueue(async () => {
            const text = await readFile(this.eventsPath, "utf8");
            return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
                try {
                    return JSON.parse(line);
                }
                catch {
                    throw new Error("Malformed current-run event line " + String(index + 1) + ".");
                }
            });
        });
    }
    appendCriterionEvidence(value) {
        return this.enqueue(async () => {
            const validated = validateRelayCriterionEvidence(value);
            const reject = async (reason) => {
                const event = { sequence: ++this.sequence, timestamp: now(), type: "criterion-evidence.rejected", phase: this.record.phase, iteration: this.record.iteration, message: reason };
                await appendFile(this.eventsPath, JSON.stringify(event) + "\n", "utf8");
                this.record = { ...this.record, lastEvent: event };
                await this.persistRecord();
                throw new Error(reason);
            };
            if (!validated.ok || !validated.value)
                return reject("Relay criterion evidence rejected: " + validated.errors.join("; "));
            const evidence = validated.value;
            if (evidence.runId !== this.runId)
                return reject("Relay criterion evidence runId binding mismatch.");
            if (evidence.handoffId !== this.record.handoffId)
                return reject("Relay criterion evidence handoffId binding mismatch.");
            if (evidence.iteration !== this.record.iteration)
                return reject("Relay criterion evidence iteration binding mismatch.");
            const handoff = JSON.parse(await readFile(this.artifacts.handoff, "utf8"));
            if (!handoff.acceptanceCriteria.some(({ id }) => id === evidence.criterionId))
                return reject("Relay criterion evidence criterionId is unknown.");
            const existing = await this.readCriterionEvidenceFile();
            if (existing.some(({ evidenceId }) => evidenceId === evidence.evidenceId))
                return reject("Relay criterion evidence evidenceId is a replay.");
            await appendFile(this.artifacts.criterionEvidence, JSON.stringify(evidence) + "\n", "utf8");
            const event = {
                sequence: ++this.sequence,
                timestamp: now(),
                type: "criterion-evidence.appended",
                phase: "reviewing",
                iteration: this.record.iteration,
                message: "Validated Relay criterion evidence appended.",
                payload: { evidenceId: evidence.evidenceId, criterionId: evidence.criterionId, runId: evidence.runId, handoffId: evidence.handoffId, result: evidence.result },
            };
            await appendFile(this.eventsPath, JSON.stringify(event) + "\n", "utf8");
            this.record = { ...this.record, lastEvent: event };
            await this.persistRecord();
            return evidence;
        });
    }
    readCriterionEvidence() {
        return this.enqueue(() => this.readCriterionEvidenceFile());
    }
    writeTestEvidence(iteration, evidence) {
        return this.enqueue(async () => {
            if (this.record.status === "cancelled")
                throw new Error("Run cancellation is terminal.");
            this.validateTestEvidence(iteration, evidence);
            await writeFile(this.artifacts.testEvidence, JSON.stringify(evidence, null, 2) + "\n", "utf8");
            await this.writeAttemptFile(iteration, "test-evidence.json", evidence);
        });
    }
    readTestEvidence(iteration) {
        return this.enqueue(async () => {
            const value = JSON.parse(await readFile(join(this.directory, "attempts", String(iteration), "test-evidence.json"), "utf8"));
            this.validateTestEvidence(iteration, value);
            return value;
        });
    }
    isCancelled() {
        return this.enqueue(async () => this.record.status === "cancelled");
    }
    validateTestEvidence(iteration, value) {
        if (!Array.isArray(value))
            throw new Error("Persisted test evidence must be an array.");
        const handoff = JSON.parse(readFileSync(this.artifacts.handoff, "utf8"));
        const keys = ["version", "source", "runId", "handoffId", "iteration", "command", "exitCode", "startedAt", "endedAt", "timedOut", "cancelled", "outputLimitExceeded", "spawnError", "stdout", "stderr", "recordedAt"].sort();
        for (const item of value) {
            if (!item || typeof item !== "object" || Array.isArray(item))
                throw new Error("Invalid test evidence object.");
            const raw = item;
            if (JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify(keys))
                throw new Error("Test evidence has missing or unknown fields.");
            if (raw.version !== "1.0" || raw.source !== "relay" || raw.runId !== this.runId || raw.handoffId !== this.record.handoffId || raw.iteration !== iteration)
                throw new Error("Test evidence binding mismatch.");
            if (typeof raw.command !== "string" || !handoff.testPlan.includes(raw.command))
                throw new Error("Test evidence command mismatch.");
            if (!(raw.exitCode === null || Number.isInteger(raw.exitCode)) || typeof raw.timedOut !== "boolean" || typeof raw.cancelled !== "boolean" || typeof raw.outputLimitExceeded !== "boolean" || !(raw.spawnError === null || typeof raw.spawnError === "string") || typeof raw.stdout !== "string" || typeof raw.stderr !== "string")
                throw new Error("Test evidence field type mismatch.");
            for (const field of ["startedAt", "endedAt", "recordedAt"])
                if (typeof raw[field] !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(raw[field]) || Number.isNaN(Date.parse(raw[field])))
                    throw new Error("Test evidence UTC timestamp is invalid.");
            if (Date.parse(raw.endedAt) < Date.parse(raw.startedAt) || Date.parse(raw.recordedAt) < Date.parse(raw.endedAt))
                throw new Error("Test evidence timestamps are not monotonic.");
        }
        const commands = value.map(({ command }) => command);
        if (commands.length !== handoff.testPlan.length || new Set(commands).size !== commands.length || handoff.testPlan.some((command) => !commands.includes(command)))
            throw new Error("Test evidence must contain exactly one record per declared command.");
    }
    async readCriterionEvidenceFile() {
        const text = await readFile(this.artifacts.criterionEvidence, "utf8");
        const handoff = JSON.parse(await readFile(this.artifacts.handoff, "utf8"));
        const seen = new Set();
        return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
            let value;
            try {
                value = JSON.parse(line);
            }
            catch {
                throw new Error("Malformed criterion evidence line " + String(index + 1) + ".");
            }
            const validated = validateRelayCriterionEvidence(value);
            if (!validated.ok || !validated.value)
                throw new Error("Invalid criterion evidence line " + String(index + 1) + ": " + validated.errors.join("; "));
            if (validated.value.runId !== this.runId || validated.value.handoffId !== this.record.handoffId || validated.value.iteration < 1)
                throw new Error("Criterion evidence binding mismatch on line " + String(index + 1) + ".");
            if (!handoff.acceptanceCriteria.some(({ id }) => id === validated.value.criterionId))
                throw new Error("Unknown criterion evidence on line " + String(index + 1) + ".");
            if (seen.has(validated.value.evidenceId))
                throw new Error("Replayed criterion evidence on line " + String(index + 1) + ".");
            seen.add(validated.value.evidenceId);
            return validated.value;
        });
    }
    async ensureGitArtifacts() {
        const entries = [
            [this.artifacts.gitBefore, "git-before"],
            [this.artifacts.gitAfter, "git-after"],
            [this.artifacts.gitAudit, "git-audit"],
        ];
        for (const [path, role] of entries) {
            try {
                const text = await readFile(path, "utf8");
                JSON.parse(text);
                if (!text.endsWith("\n"))
                    await writeFile(path, text + "\n", "utf8");
            }
            catch {
                await writeFile(path, JSON.stringify(gitArtifactPlaceholder(role, "unavailable", "Artifact was missing or malformed at terminal persistence."), null, 2) + "\n", "utf8");
            }
        }
    }
}
function gitArtifactPlaceholder(role, status, reason) {
    return { version: "1.0", artifactRole: role, status, reason };
}
export class RunStore {
    root;
    constructor(options) {
        this.root = typeof options === "string" ? resolve(options) : resolve(options.root);
    }
    async createRun(handoff) {
        await mkdir(this.root, { recursive: true });
        const startedAt = now();
        const runId = safeSegment(handoff.id) + "-" + Date.now() + "-" + randomUUID().slice(0, 8);
        const directory = join(this.root, runId);
        await mkdir(join(directory, "attempts"), { recursive: true });
        const artifacts = {
            handoff: join(directory, "handoff.json"),
            events: join(directory, "events.jsonl"),
            process: join(directory, "process.json"),
            executorResult: join(directory, "executor-result.json"),
            review: join(directory, "review.json"),
            finalSummary: join(directory, "final-summary.json"),
            gitBefore: join(directory, "git-before.json"),
            gitAfter: join(directory, "git-after.json"),
            gitAudit: join(directory, "git-audit.json"),
            sandboxPreflight: join(directory, "sandbox-preflight.json"),
            criterionEvidence: join(directory, "criterion-evidence.jsonl"),
            testEvidence: join(directory, "test-evidence.json"),
        };
        const record = {
            version: "1.0",
            runId,
            handoffId: handoff.id,
            phase: "created",
            status: "active",
            iteration: 0,
            processState: "not-started",
            startedAt,
            updatedAt: startedAt,
            completedAt: null,
            artifactDirectory: directory,
            artifacts,
            lastEvent: null,
        };
        await writeFile(artifacts.handoff, JSON.stringify(handoff, null, 2) + "\n", "utf8");
        await writeFile(artifacts.events, "", "utf8");
        await writeFile(artifacts.process, JSON.stringify(defaultProcessMetadata(), null, 2) + "\n", "utf8");
        await writeFile(artifacts.executorResult, JSON.stringify({ status: "pending", runId, handoffId: handoff.id }, null, 2) + "\n", "utf8");
        await writeFile(artifacts.review, JSON.stringify({ status: "pending", runId, handoffId: handoff.id }, null, 2) + "\n", "utf8");
        await writeFile(artifacts.criterionEvidence, "", "utf8");
        await writeFile(artifacts.testEvidence, "[]\n", "utf8");
        await writeFile(artifacts.gitBefore, JSON.stringify(gitArtifactPlaceholder("git-before", "not-applicable", "Git snapshot has not been collected yet."), null, 2) + "\n", "utf8");
        await writeFile(artifacts.gitAfter, JSON.stringify(gitArtifactPlaceholder("git-after", "not-applicable", "Git snapshot has not been collected yet."), null, 2) + "\n", "utf8");
        await writeFile(artifacts.gitAudit, JSON.stringify(gitArtifactPlaceholder("git-audit", "not-applicable", "Git audit has not been performed yet."), null, 2) + "\n", "utf8");
        await writeFile(join(directory, "run-record.json"), JSON.stringify(record, null, 2) + "\n", "utf8");
        const handle = new FileRunHandle(runId, directory, artifacts, record);
        await handle.appendEvent("run.created", "created", 0, "Durable run directory created.", { handoffId: handoff.id });
        return handle;
    }
    async listRuns() {
        try {
            const entries = await readdir(this.root, { withFileTypes: true });
            const result = [];
            for (const entry of entries) {
                if (!entry.isDirectory())
                    continue;
                const directory = join(this.root, entry.name);
                const recordPath = join(directory, "run-record.json");
                try {
                    const record = JSON.parse(await readFile(recordPath, "utf8"));
                    result.push({ runId: entry.name, directory, record, malformed: null });
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    result.push({ runId: entry.name, directory, record: null, malformed: message });
                }
            }
            return result.sort((left, right) => right.runId.localeCompare(left.runId));
        }
        catch (error) {
            if (error.code === "ENOENT")
                return [];
            throw error;
        }
    }
    async findRun(runId) {
        const listings = await this.listRuns();
        return listings.find((item) => item.runId === runId || item.runId.startsWith(runId)) ?? null;
    }
    async readEvents(runId) {
        const listing = await this.findRun(runId);
        if (!listing)
            throw new Error("Run '" + runId + "' was not found.");
        const text = await readFile(join(listing.directory, "events.jsonl"), "utf8");
        const events = [];
        for (const [index, line] of text.split(/\r?\n/).filter(Boolean).entries()) {
            try {
                events.push(JSON.parse(line));
            }
            catch {
                throw new Error("Run '" + listing.runId + "' has malformed event line " + String(index + 1) + ".");
            }
        }
        return events;
    }
    async readArtifact(runId, artifactName) {
        const listing = await this.findRun(runId);
        if (!listing || !listing.record)
            throw new Error("Run '" + runId + "' was not found or is malformed.");
        const path = listing.record.artifacts[artifactName];
        return JSON.parse(await readFile(path, "utf8"));
    }
    async readCriterionEvidence(runId) {
        const listing = await this.findRun(runId);
        if (!listing || !listing.record)
            throw new Error("Run '" + runId + "' was not found or is malformed.");
        const handoff = JSON.parse(await readFile(listing.record.artifacts.handoff, "utf8"));
        const text = await readFile(listing.record.artifacts.criterionEvidence, "utf8");
        const seen = new Set();
        return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
            let raw;
            try {
                raw = JSON.parse(line);
            }
            catch {
                throw new Error("Malformed criterion evidence line " + String(index + 1) + ".");
            }
            const checked = validateRelayCriterionEvidence(raw);
            if (!checked.ok || !checked.value)
                throw new Error("Invalid criterion evidence line " + String(index + 1) + ".");
            const item = checked.value;
            if (item.runId !== listing.runId || item.handoffId !== listing.record.handoffId || !handoff.acceptanceCriteria.some(({ id }) => id === item.criterionId) || seen.has(item.evidenceId))
                throw new Error("Criterion evidence binding or replay failure on line " + String(index + 1) + ".");
            seen.add(item.evidenceId);
            return item;
        });
    }
    async cancelRun(runId, terminate = async () => false) {
        const listing = await this.findRun(runId);
        if (!listing || !listing.record)
            throw new Error("Run '" + runId + "' was not found or is malformed.");
        const processPath = listing.record.artifacts.process;
        const metadata = JSON.parse(await readFile(processPath, "utf8"));
        const handle = new FileRunHandle(listing.runId, listing.directory, listing.record.artifacts, listing.record);
        const eventsText = await readFile(listing.record.artifacts.events, "utf8").catch(() => "");
        handle.restoreSequence(eventsText.split(/\r?\n/).filter(Boolean).length);
        await handle.requestCancellation("Explicit cancellation requested by the operator.");
        if (metadata.pid !== null && (metadata.state === "running" || metadata.state === "not-started")) {
            await terminate(metadata.pid);
            for (let attempt = 0; attempt < 100; attempt += 1) {
                const events = await handle.readEvents();
                if (events.some(({ type, payload }) => type === "test.exited" && payload?.pid === metadata.pid))
                    break;
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
        }
        return handle.persistCancellation("Explicit cancellation requested by the operator.");
    }
    async writeAcceptanceEvidence(runId, evidence) {
        const listing = await this.findRun(runId);
        if (!listing || !listing.record)
            throw new Error("Run '" + runId + "' was not found or is malformed.");
        await writeFile(join(listing.directory, "acceptance-evidence.json"), JSON.stringify(evidence, null, 2) + "\n", "utf8");
    }
}
export function resolveStateDirectory(runtimeRoot, stateDirectory) {
    return isAbsolute(stateDirectory) ? resolve(stateDirectory) : resolve(runtimeRoot, stateDirectory);
}

import { NodeProcessRunner } from "./process-runner.js";
import { evaluateSafetyGate } from "./safety-gate.js";
import { collectRelayCriterionEvidence } from "./relay-criterion-collector.js";
import { captureGitSnapshot, compareGitSnapshots } from "./git-audit.js";
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
export const DEFAULT_TEST_TIMEOUT_MS = 120_000;
export const DEFAULT_TEST_OUTPUT_BYTES = 1_000_000;
function redact(value) {
    return value
        .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
        .replace(/(?:sk|sess)-[A-Za-z0-9_-]{8,}/gi, "[REDACTED_TOKEN]")
        .replace(/\b(OPENAI_API_KEY|CODEX_API_KEY)\s*=\s*[^\s\"]+/gi, "$1=[REDACTED]");
}
function processStateFromExit(metadata) {
    if (metadata.cancelled)
        return "cancelled";
    if (metadata.timedOut)
        return "timed-out";
    if (metadata.exitCode === 0)
        return "exited";
    return "failed";
}
function terminalRunState(status) {
    if (status === "COMPLETED" || status === "SIMULATED_COMPLETED") {
        return { status: "completed", phase: "completed", processState: "exited" };
    }
    if (status === "MAX_ITERATIONS") {
        return { status: "max-iterations", phase: "failed", processState: "failed" };
    }
    return { status: "human-review", phase: "blocked", processState: "failed" };
}
export class Relay {
    executor;
    reviewer;
    processRunner;
    constructor(executor, reviewer, processRunner = new NodeProcessRunner()) {
        this.executor = executor;
        this.reviewer = reviewer;
        this.processRunner = processRunner;
    }
    async run(handoff, options) {
        const runHandle = options.runHandle;
        const preflightGate = evaluateSafetyGate(handoff, options.approvedGateIds);
        if (preflightGate.outcome !== "ALLOW") {
            if (runHandle) {
                await runHandle.appendEvent("gate.blocked", "blocked", 0, "Safety gate blocked execution.", { outcome: preflightGate.outcome });
                await runHandle.finalize("blocked", "blocked", 0, "not-started", "Safety gate blocked execution.");
            }
            return {
                handoffId: handoff.id,
                executor: this.executor.name,
                status: "BLOCKED",
                preflightGate,
                attempts: [],
                message: preflightGate.outcome === "DENY"
                    ? "Safety gate denied at least one operation. Edit the Handoff; approvals cannot override a denial."
                    : "Human approval is required. Re-run with the listed gate IDs after a person reviews the exact operations.",
            };
        }
        const attempts = [];
        const maxIterations = Math.max(1, Math.min(5, handoff.maxIterations, options.maxIterations));
        let revisionInstructions = [];
        const persistentCriterionEvidenceErrors = [];
        if (runHandle) {
            await runHandle.appendEvent("gate.allowed", "preflight", 0, "Safety gate allowed the declared operations.");
        }
        else if (handoff.acceptanceCriteria.some(({ verificationOwner }) => verificationOwner !== "executor")) {
            persistentCriterionEvidenceErrors.push("Relay-owned criteria require a current durable RunHandle.");
        }
        for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
            const criterionEvidenceErrors = [...persistentCriterionEvidenceErrors];
            let gitAudit = null;
            const shouldAuditGit = this.executor.name === "codex-exec" && handoff.requestedOperations.some(({ type }) => type !== "read");
            const gitBefore = shouldAuditGit ? await captureGitSnapshot(handoff.workspace.root) : null;
            if (runHandle && gitBefore) {
                await runHandle.writeGitBefore(gitBefore);
                await runHandle.appendEvent("git.before", "auditing", iteration, "Git/content baseline captured by Relay.", { isGit: gitBefore.isGit, pathCount: gitBefore.paths.length });
            }
            const observabilityWrites = [];
            let started = null;
            let heartbeatTimer = null;
            let detachObserver = null;
            let jsonlBuffer = "";
            let trustedCommands = [];
            const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
            const stopHeartbeat = () => {
                if (heartbeatTimer !== null)
                    clearInterval(heartbeatTimer);
                heartbeatTimer = null;
            };
            const persist = (operation) => {
                observabilityWrites.push(operation);
            };
            if (runHandle) {
                await runHandle.appendEvent("executor.starting", "executing", iteration, "Executor iteration is starting.");
            }
            const context = {
                iteration,
                revisionInstructions,
                onModelEvent: (type, value) => {
                    if (!runHandle)
                        return;
                    const safeValue = JSON.parse(redact(JSON.stringify(value)));
                    persist(runHandle.appendEvent(type, "preflight", iteration, "Model routing event recorded.", safeValue));
                },
                onProcessHandle: (handle) => {
                    detachObserver?.();
                    detachObserver = handle.observe(({ stream, chunk }) => {
                        if (!runHandle)
                            return;
                        jsonlBuffer += chunk;
                        const lines = jsonlBuffer.split(/\r?\n/);
                        jsonlBuffer = lines.pop() ?? "";
                        for (const line of lines.filter(Boolean)) {
                            let eventType = "text";
                            let summary = line.slice(0, 500);
                            try {
                                const parsed = JSON.parse(line);
                                eventType = typeof parsed.type === "string" ? parsed.type : "unknown";
                                summary = JSON.stringify(parsed).replace(/(?:sk|sess)-[A-Za-z0-9_-]{8,}/g, "[REDACTED_TOKEN]").slice(0, 500);
                            }
                            catch {
                                summary = summary.replace(/(?:sk|sess)-[A-Za-z0-9_-]{8,}/g, "[REDACTED_TOKEN]");
                            }
                            persist(runHandle.appendEvent("codex.event", "executing", iteration, "Incremental Codex JSONL event observed.", { stream, eventType, summary }));
                        }
                    });
                },
                onSandboxPreflight: (value) => {
                    if (!runHandle)
                        return;
                    persist(runHandle.writeSandboxPreflight(value));
                    const raw = value && typeof value === "object" ? value : {};
                    const payload = {};
                    if (typeof raw.ok === "boolean")
                        payload.ok = raw.ok;
                    if (typeof raw.effectiveSandbox === "string")
                        payload.effectiveSandbox = raw.effectiveSandbox;
                    if (typeof raw.requiresHumanReview === "boolean")
                        payload.requiresHumanReview = raw.requiresHumanReview;
                    persist(runHandle.appendEvent("sandbox.preflight", "preflight", iteration, "Sandbox and runtime provenance preflight completed.", payload));
                },
                onProcessStart: (metadata) => {
                    started = metadata;
                    if (!runHandle)
                        return;
                    const value = {
                        state: "running",
                        pid: metadata.pid,
                        command: metadata.command,
                        args: metadata.args,
                        cwd: metadata.cwd,
                        startedAt: metadata.startedAt,
                        endedAt: null,
                        exitCode: null,
                        signal: null,
                        cancelled: false,
                        timedOut: false,
                        outputLimitExceeded: false,
                    };
                    persist(runHandle.writeProcessMetadata(value));
                    persist(runHandle.appendEvent("process.started", "executing", iteration, "Codex CLI process started.", { pid: metadata.pid }));
                    heartbeatTimer = setInterval(() => {
                        if (!runHandle || started === null)
                            return;
                        persist(runHandle.appendHeartbeat(iteration, {
                            iteration,
                            pid: metadata.pid,
                            elapsedMs: Math.max(0, Date.now() - Date.parse(metadata.startedAt)),
                        }));
                    }, heartbeatIntervalMs);
                    heartbeatTimer.unref?.();
                },
                onProcessExit: (metadata) => {
                    stopHeartbeat();
                    if (!runHandle)
                        return;
                    const value = {
                        state: processStateFromExit(metadata),
                        pid: metadata.pid,
                        command: started?.command ?? null,
                        args: started?.args ?? [],
                        cwd: started?.cwd ?? null,
                        startedAt: started?.startedAt ?? null,
                        endedAt: metadata.endedAt,
                        exitCode: metadata.exitCode,
                        signal: metadata.signal,
                        cancelled: metadata.cancelled,
                        timedOut: metadata.timedOut,
                        outputLimitExceeded: metadata.outputLimitExceeded,
                    };
                    persist(runHandle.writeProcessMetadata(value));
                    persist(runHandle.appendEvent("process.exited", "executing", iteration, "Codex CLI process exited.", {
                        exitCode: metadata.exitCode,
                        state: value.state,
                    }));
                },
            };
            let execution;
            try {
                execution = await this.executor.execute(handoff, context);
            }
            catch (error) {
                stopHeartbeat();
                await Promise.all(observabilityWrites);
                throw error;
            }
            finally {
                stopHeartbeat();
                detachObserver?.();
            }
            await Promise.all(observabilityWrites);
            if (this.executor.name === "codex-exec" && handoff.testPlan.length > 0 && runHandle) {
                for (const command of handoff.testPlan) {
                    if (await runHandle.isCancelled()) {
                        return { handoffId: handoff.id, executor: this.executor.name, status: "BLOCKED", preflightGate, attempts, message: "Run was cancelled; Relay stopped before further tests or review." };
                    }
                    const startedAt = new Date().toISOString();
                    const shell = process.platform === "win32"
                        ? `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
                        : "/bin/sh";
                    const args = process.platform === "win32" ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command] : ["-c", command];
                    const handle = this.processRunner.start?.({ command: shell, args, cwd: handoff.workspace.root, stdin: "", timeoutMs: DEFAULT_TEST_TIMEOUT_MS, maxOutputBytes: DEFAULT_TEST_OUTPUT_BYTES });
                    if (!handle) {
                        const endedAt = new Date().toISOString();
                        trustedCommands.push({ version: "1.0", source: "relay", runId: runHandle.runId, handoffId: handoff.id, iteration, command, exitCode: null, startedAt, endedAt, timedOut: false, cancelled: false, outputLimitExceeded: false, spawnError: "ProcessRunner does not expose an observable ProcessHandle.", stdout: "", stderr: "", recordedAt: endedAt });
                        continue;
                    }
                    const metadata = { state: "running", pid: handle.pid, command: shell, args, cwd: handoff.workspace.root, startedAt, endedAt: null, exitCode: null, signal: null, cancelled: false, timedOut: false, outputLimitExceeded: false };
                    await runHandle.writeProcessMetadata(metadata);
                    await runHandle.appendEvent("test.started", "executing", iteration, "Relay parent test started.", { command, pid: handle.pid });
                    const testHeartbeat = setInterval(() => { void runHandle.appendEvent("test.heartbeat", "executing", iteration, "Relay parent test is still running.", { command, pid: handle.pid, elapsedMs: Date.now() - Date.parse(startedAt) }).catch(() => undefined); }, heartbeatIntervalMs);
                    testHeartbeat.unref?.();
                    const result = await handle.result;
                    clearInterval(testHeartbeat);
                    const endedAt = new Date().toISOString();
                    await runHandle.appendEvent("test.exited", "executing", iteration, "Relay parent test exited.", { command, pid: handle.pid, exitCode: result.exitCode, timedOut: result.timedOut, cancelled: result.cancelled === true, outputLimitExceeded: result.outputLimitExceeded, spawnError: result.spawnError });
                    if (await runHandle.isCancelled()) {
                        return { handoffId: handoff.id, executor: this.executor.name, status: "BLOCKED", preflightGate, attempts, message: "Run was cancelled during a parent-owned test; Relay stopped before further tests or review." };
                    }
                    await runHandle.writeProcessMetadata({ ...metadata, state: processStateFromExit({ pid: handle.pid, exitCode: result.exitCode, signal: result.signal, endedAt, cancelled: result.cancelled === true, timedOut: result.timedOut, outputLimitExceeded: result.outputLimitExceeded }), endedAt, exitCode: result.exitCode, signal: result.signal, cancelled: result.cancelled === true, timedOut: result.timedOut, outputLimitExceeded: result.outputLimitExceeded });
                    trustedCommands.push({ version: "1.0", source: "relay", runId: runHandle.runId, handoffId: handoff.id, iteration, command, exitCode: result.exitCode, startedAt, endedAt, timedOut: result.timedOut, cancelled: result.cancelled === true, outputLimitExceeded: result.outputLimitExceeded, spawnError: result.spawnError, stdout: redact(result.stdout), stderr: redact(result.stderr), recordedAt: endedAt });
                }
                await runHandle.writeTestEvidence(iteration, trustedCommands);
                trustedCommands = await runHandle.readTestEvidence(iteration);
                await runHandle.appendEvent("tests.persisted", "reviewing", iteration, "Parent-owned test evidence persisted.", { count: trustedCommands.length });
            }
            if (gitBefore) {
                const gitAfter = await captureGitSnapshot(handoff.workspace.root);
                gitAudit = compareGitSnapshots(gitBefore, gitAfter, handoff.workspace.allowedPaths);
                if (runHandle) {
                    await runHandle.writeGitAfter(gitAfter);
                    await runHandle.writeGitAudit(gitAudit);
                    await runHandle.appendEvent("git.after", "auditing", iteration, "Git/content audit completed by Relay.", { status: gitAudit.status, outOfScopePaths: gitAudit.outOfScopePaths, requiresHumanReview: gitAudit.requiresHumanReview });
                }
            }
            if (runHandle) {
                await runHandle.writeExecutorResult(execution, iteration);
                await runHandle.appendEvent("executor.completed", "reviewing", iteration, "Executor returned structured evidence.", { status: execution.status });
            }
            let postExecutionGate;
            if (execution.proposedOperations.length > 0) {
                postExecutionGate = evaluateSafetyGate({ ...handoff, id: `${handoff.id}-iteration-${iteration}`, requestedOperations: execution.proposedOperations }, options.approvedGateIds);
            }
            let persistedEvidence = [];
            if (runHandle) {
                try {
                    const collected = await collectRelayCriterionEvidence(handoff, runHandle, iteration);
                    for (const evidence of collected)
                        await runHandle.appendCriterionEvidence(evidence);
                    persistedEvidence = (await runHandle.readCriterionEvidence()).filter((item) => item.iteration === iteration);
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    criterionEvidenceErrors.push(message);
                    await runHandle.appendEvent("criterion-evidence.invalid", "reviewing", iteration, message);
                }
            }
            let review = await this.reviewer.review(handoff, execution, iteration, persistedEvidence, this.executor.name === "codex-exec" ? trustedCommands : undefined);
            if (gitAudit?.requiresHumanReview) {
                review = {
                    ...review,
                    verdict: "HUMAN_REVIEW",
                    summary: "HUMAN_REVIEW: Relay Git/content audit is ambiguous or out of scope.",
                    findings: [...review.findings, { severity: "blocker", message: gitAudit.reason }],
                    revisionInstructions: [...review.revisionInstructions, "Resolve the Relay-owned Git/content audit finding before retrying."],
                };
            }
            if (criterionEvidenceErrors.length > 0) {
                const details = [...new Set(criterionEvidenceErrors)].join("; ");
                review = {
                    ...review,
                    verdict: review.verdict === "PASS" ? "REVISE" : review.verdict,
                    summary: review.verdict === "PASS" ? "REVISE: Relay criterion evidence failed closed." : review.summary,
                    findings: [
                        ...review.findings,
                        { severity: "blocker", message: `Relay criterion evidence failed validation: ${details}` },
                    ],
                    revisionInstructions: [
                        ...review.revisionInstructions,
                        "Repair or remove invalid Relay criterion evidence; do not infer a passing criterion from it.",
                    ],
                };
            }
            if (runHandle) {
                await runHandle.writeReview(review, iteration);
                await runHandle.appendEvent("review.completed", "reviewing", iteration, "Reviewer completed the iteration.", { verdict: review.verdict });
            }
            const attempt = { iteration, execution, review };
            if (postExecutionGate)
                attempt.postExecutionGate = postExecutionGate;
            attempts.push(attempt);
            if (postExecutionGate && postExecutionGate.outcome !== "ALLOW") {
                if (runHandle) {
                    const terminal = terminalRunState("BLOCKED");
                    await runHandle.finalize(terminal.status, terminal.phase, iteration, terminal.processState, "Executor proposed undeclared operations.");
                }
                return {
                    handoffId: handoff.id,
                    executor: this.executor.name,
                    status: "BLOCKED",
                    preflightGate,
                    attempts,
                    message: "Executor proposed undeclared operations. Relay stopped for a new safety decision.",
                };
            }
            if (review.verdict === "PASS") {
                const status = execution.simulated ? "SIMULATED_COMPLETED" : "COMPLETED";
                if (runHandle) {
                    const terminal = terminalRunState(status);
                    await runHandle.finalize(terminal.status, terminal.phase, iteration, terminal.processState, "Reviewer passed all required evidence.");
                }
                return {
                    handoffId: handoff.id,
                    executor: this.executor.name,
                    status,
                    preflightGate,
                    attempts,
                    message: execution.simulated
                        ? "Workflow loop completed with mock evidence only; no real task was executed."
                        : "Executor result passed all deterministic review rules.",
                };
            }
            if (review.verdict === "HUMAN_REVIEW") {
                if (runHandle) {
                    const terminal = terminalRunState("BLOCKED");
                    await runHandle.finalize(terminal.status, terminal.phase, iteration, terminal.processState, "Reviewer requested human review.");
                }
                return {
                    handoffId: handoff.id,
                    executor: this.executor.name,
                    status: "BLOCKED",
                    preflightGate,
                    attempts,
                    message: "Reviewer requested human review.",
                };
            }
            revisionInstructions = review.revisionInstructions;
        }
        if (runHandle) {
            const terminal = terminalRunState("MAX_ITERATIONS");
            await runHandle.finalize(terminal.status, terminal.phase, maxIterations, terminal.processState, `Stopped after ${maxIterations} iteration(s) without PASS.`);
        }
        return {
            handoffId: handoff.id,
            executor: this.executor.name,
            status: "MAX_ITERATIONS",
            preflightGate,
            attempts,
            message: `Stopped after ${maxIterations} iteration(s) without PASS.`,
        };
    }
}

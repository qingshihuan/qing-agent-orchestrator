import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { NodeProcessRunner } from "../process-runner.js";
import { validateExecutionResult } from "../validation.js";
import { evaluateSandboxPreflight } from "../sandbox-preflight.js";
import { inspectCodexRuntimeProvenance, resolveCompleteWindowsRuntime, } from "../codex-runtime.js";
import { resolveSafeWorkspace } from "../workspace.js";
import { modelSelectionArgs } from "../model-health.js";
import { continueModelFallbackAfterRejection, ModelFallbackRequiresGateError, NoHealthyModelCandidateError, } from "../model-router.js";
function failedResult(summary, modelFallbackAudit = null) {
    return {
        status: "failed",
        summary,
        artifacts: [],
        criteriaEvidence: [],
        tests: [],
        proposedOperations: [],
        simulated: false,
        executionOwner: "Codex",
        modelFallbackAudit,
    };
}
export function redactSensitiveText(value) {
    return value
        .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
        .replace(/\b(?:sk|sess)-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_TOKEN]")
        .replace(/\b(OPENAI_API_KEY|CODEX_API_KEY)\s*=\s*[^\s]+/gi, "$1=[REDACTED]")
        .replace(/("(?:api[_-]?key|access[_-]?token)"\s*:\s*")[^"]+("?)/gi, "$1[REDACTED]$2");
}
function boundedHeadAndTail(value, limit = 1_600) {
    const normalized = value.trim();
    if (normalized.length <= limit)
        return normalized;
    const marker = `\n...[truncated ${normalized.length - limit} chars; tail preserved]...\n`;
    const available = Math.max(0, limit - marker.length);
    const headLength = Math.floor(available * 0.4);
    const tailLength = available - headLength;
    return normalized.slice(0, headLength) + marker + normalized.slice(-tailLength);
}
export function formatProcessDiagnostic(result, limit = 1_600) {
    const status = [
        `exit=${result.exitCode === null ? "null" : result.exitCode}`,
        `signal=${result.signal ?? "none"}`,
        `timedOut=${result.timedOut}`,
        `cancelled=${result.cancelled ?? false}`,
        `outputLimitExceeded=${result.outputLimitExceeded}`,
    ].join(" ");
    const rawStreams = [];
    if (result.spawnError)
        rawStreams.push(["spawnError", result.spawnError]);
    if (result.stderr)
        rawStreams.push(["stderr", result.stderr]);
    if (result.stdout)
        rawStreams.push(["stdout", result.stdout]);
    const streamLimit = Math.max(256, Math.floor(limit / Math.max(1, rawStreams.length)) - 24);
    const streams = rawStreams.map(([name, value]) => `[${name}]\n${boundedHeadAndTail(redactSensitiveText(value), streamLimit)}`).join("\n");
    return `${status}${streams ? `\n${streams}` : ""}`;
}
function processFailure(prefix, result) {
    const condition = result.timedOut
        ? "process timed out"
        : result.cancelled
            ? "process was explicitly cancelled"
            : result.outputLimitExceeded
                ? "process output exceeded the configured limit"
                : "process failed";
    return `${prefix}: ${condition}. ${formatProcessDiagnostic(result)}`;
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function modelRejectionReason(result, selection) {
    if (result.exitCode === 0 || result.spawnError || result.timedOut || result.cancelled || result.outputLimitExceeded)
        return null;
    const text = redactSensitiveText(`${result.stderr}\n${result.stdout}`).trim();
    if (!text)
        return null;
    if (/\b(?:authentication|not logged in|unauthorized|forbidden|credential|api[_ -]?key|permission denied|401|403)\b/i.test(text))
        return null;
    const forbiddenFailure = /\b(?:output\s+schema|response\s+schema|schema\s+(?:validation|parse|unsupported|invalid)|protocol|(?:worker\s+)?process\s+(?:crash(?:ed)?|fail(?:ed|ure)?|error|exit(?:ed)?|spawn)|spawn(?:ed|ing)?|timed?\s*out|timeout|cancel(?:led|ed)|output\s+(?:limit|size)|ordinary\s+task\s+error|generated\s+documentation)\b/i;
    if (forbiddenFailure.test(text))
        return null;
    const escapedModel = escapeRegExp(selection.model);
    const selectedModel = `(?<![A-Za-z0-9._-])${escapedModel}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9_-])`;
    if (!new RegExp(selectedModel, "i").test(text))
        return null;
    const selectedModelToken = `["'\u0060]?${selectedModel}["'\u0060]?`;
    const prefix = `(?:error:\\s*)?`;
    const suffix = `[.!]?`;
    const modelFailurePatterns = [
        new RegExp(`^${prefix}(?:unknown|invalid)\\s+model\\s+${selectedModelToken}${suffix}$`, "i"),
        new RegExp(`^${prefix}(?:the\\s+)?(?:(?:requested|selected|specified)\\s+)?model\\s+${selectedModelToken}\\s+(?:is\\s+|was\\s+)?(?:unavailable|not available|unknown|not found|does not exist)(?:\\s+for\\s+this\\s+(?:invocation|request))?${suffix}$`, "i"),
        new RegExp(`^${prefix}model\\s+metadata\\s+for\\s+${selectedModelToken}\\s+(?:is\\s+|was\\s+)?not found${suffix}$`, "i"),
        new RegExp(`^${prefix}model\\s+metadata\\s+(?:is\\s+|was\\s+)?not found\\s+for\\s+${selectedModelToken}${suffix}$`, "i"),
        new RegExp(`^${prefix}(?:you\\s+)?(?:do not have access|are not allowed to use|not allowed to use)\\s+(?:the\\s+)?(?:model\\s+)?${selectedModelToken}${suffix}$`, "i"),
        new RegExp(`^${prefix}(?:the\\s+)?model\\s+${selectedModelToken}\\s+(?:is\\s+|was\\s+)?not supported\\s+(?:with|by|for)\\s+(?:your\\s+)?(?:chatgpt\\s+)?(?:account|plan|entitlement|subscription|workspace)${suffix}$`, "i"),
    ];
    const modelFailure = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .some((line) => modelFailurePatterns.some((pattern) => pattern.test(line)));
    return modelFailure ? `Runtime model rejection/unavailability: ${boundedHeadAndTail(text, 600)}` : null;
}
function modelSelectionPayload(selection) {
    return {
        executionOwner: "Codex",
        candidateId: selection.candidateId,
        backend: selection.backend,
        model: selection.model,
        profile: selection.profile,
        reasoningEffort: selection.reasoningEffort,
        availability: selection.availability,
        role: selection.role,
        complexityBand: selection.complexityBand,
        reason: selection.reason,
        cacheState: selection.cacheState,
        fallbackFrom: selection.fallbackFrom,
        fallbackPlan: selection.fallbackPlan,
        fallbackAudit: selection.fallbackAudit,
    };
}
const verifiedRuntimeScope = {
    operationsUnchanged: true,
    allowedPathsUnchanged: true,
    sandboxUnchanged: true,
    permissionsUnchanged: true,
    effectsUnchanged: true,
};
function pathIsInside(base, target) {
    const relation = relative(base, target);
    return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}
const mutatingOperationTypes = new Set([
    "write",
    "delete",
    "install_dependency",
    "network_access",
    "use_secret",
    "external_message",
    "git_commit",
    "git_push",
    "production_deploy",
    "database_migration",
]);
function operationIsReadOnly(operation) {
    if (operation.type === "read")
        return true;
    if (mutatingOperationTypes.has(operation.type))
        return false;
    if (operation.type === "execute_tests") {
        return /\bread[- ]only\b|只读/i.test(`${operation.target} ${operation.reason}`);
    }
    return false;
}
export function isStrictReadOnlyDiagnostic(handoff, sandbox) {
    const constraintText = handoff.constraints.join("\n");
    const explicitlyReadOnly = /\bread[- ]only\b|只读/i.test(constraintText)
        || (/只允许读取/.test(constraintText) && /不得修改|不得创建|不得删除/.test(constraintText));
    return handoff.category === "analysis"
        && sandbox === "read-only"
        && explicitlyReadOnly
        && handoff.requestedOperations.length > 0
        && handoff.requestedOperations.every(operationIsReadOnly);
}
function validateJsonl(stdout) {
    const lines = stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0)
        return "codex exec returned no JSONL events";
    for (const [index, line] of lines.entries()) {
        try {
            const event = JSON.parse(line);
            if (typeof event !== "object" || event === null || typeof event.type !== "string") {
                return `JSONL event ${index + 1} has no string type`;
            }
        }
        catch {
            return `stdout line ${index + 1} is not valid JSONL`;
        }
    }
    return null;
}
export function buildCodexPrompt(handoff, context) {
    return [
        "You are the Executor in the Qing Agent Orchestrator workflow.",
        "Perform only operations declared in the Handoff and only inside its workspace/allowedPaths.",
        "If another operation is required, do not perform it. Return it in proposedOperations for a new human gate.",
        "Return the final response as JSON matching the provided Executor Result schema.",
        "Do not invent artifacts, tests, evidence, credentials, or completion. Set simulated=false for this real run.",
        "On every iteration, return a complete current snapshot for all acceptance criteria, required tests, and deliverables, including items completed in earlier iterations; do not return only the latest delta.",
        "",
        `Iteration: ${context.iteration}`,
        `Revision instructions: ${JSON.stringify(context.revisionInstructions)}`,
        "Handoff:",
        JSON.stringify(handoff),
    ].join("\n");
}
export class CodexExecExecutor {
    options;
    runner;
    inspectRuntime;
    name = "codex-exec";
    probePromise;
    activeModelSelection;
    constructor(options, runner = new NodeProcessRunner(), inspectRuntime = inspectCodexRuntimeProvenance) {
        this.options = options;
        this.runner = runner;
        this.inspectRuntime = inspectRuntime;
        this.activeModelSelection = options.modelSelection;
    }
    get finalModelSelection() {
        return this.activeModelSelection;
    }
    doctor(force = false) {
        if (force || !this.probePromise)
            this.probePromise = this.runDoctor();
        return this.probePromise;
    }
    async runDoctor() {
        const errors = [];
        const versionResult = await this.runner.run(this.probeRequest(["--version"]));
        if (versionResult.exitCode !== 0 || versionResult.spawnError || versionResult.timedOut) {
            errors.push(processFailure("Codex CLI unavailable", versionResult));
            return { available: false, authenticated: false, command: this.options.command, version: null, errors };
        }
        const version = redactSensitiveText(versionResult.stdout || versionResult.stderr).trim().split(/\r?\n/)[0] || null;
        const loginResult = await this.runner.run(this.probeRequest(["login", "status"]));
        const authenticated = loginResult.exitCode === 0 && !loginResult.spawnError && !loginResult.timedOut;
        if (!authenticated)
            errors.push(processFailure("Codex CLI authentication unavailable", loginResult));
        return { available: true, authenticated, command: this.options.command, version, errors };
    }
    probeRequest(args) {
        return {
            command: this.options.command,
            args,
            cwd: this.options.runtimeRoot,
            stdin: "",
            timeoutMs: this.options.probeTimeoutMs,
            maxOutputBytes: Math.min(this.options.maxOutputBytes, 64 * 1024),
        };
    }
    async execute(handoff, context) {
        try {
            if (this.activeModelSelection) {
                modelSelectionArgs(this.activeModelSelection);
                for (const candidate of this.activeModelSelection.fallbackPlan.orderedCandidates) {
                    modelSelectionArgs(candidate);
                    if (candidate.backend !== this.activeModelSelection.backend) {
                        throw new ModelFallbackRequiresGateError("Codex runtime fallback cannot cross model backends without a fresh gate.");
                    }
                    if (candidate.profile !== this.activeModelSelection.profile) {
                        throw new ModelFallbackRequiresGateError("Codex runtime fallback cannot change CLI profiles while claiming sandbox and permissions are unchanged.");
                    }
                }
            }
        }
        catch (error) {
            return failedResult(`Codex model selection was rejected before process creation: ${error instanceof Error ? error.message : String(error)}`, this.activeModelSelection?.fallbackAudit ?? null);
        }
        for (const record of this.options.modelHealth ?? []) {
            context.onModelEvent?.("model.preflight", {
                candidateId: record.candidateId,
                state: record.state,
                cacheState: record.cacheState,
                failure: record.failure,
                reason: redactSensitiveText(record.reason),
            });
        }
        if (this.activeModelSelection)
            context.onModelEvent?.("model.selected", modelSelectionPayload(this.activeModelSelection));
        let base;
        let workspace;
        let schemaPath;
        try {
            base = await realpath(resolve(this.options.runtimeRoot));
            [workspace, schemaPath] = await Promise.all([
                resolveSafeWorkspace(base, handoff.workspace.root),
                realpath(resolve(base, this.options.outputSchemaPath)),
            ]);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return failedResult(`Codex executor path preflight failed: ${redactSensitiveText(message)}`);
        }
        if (!pathIsInside(base, schemaPath)) {
            return failedResult("Codex executor refused an output schema outside the Relay working directory.");
        }
        const platform = this.options.platform ?? process.platform;
        let selectedCommand = this.options.command;
        let childEnvironment = this.options.environment ?? process.env;
        if (platform === "win32" && this.inspectRuntime === inspectCodexRuntimeProvenance) {
            try {
                const selected = await resolveCompleteWindowsRuntime(selectedCommand, childEnvironment);
                selectedCommand = selected.command;
                childEnvironment = selected.environment;
            }
            catch (error) {
                return failedResult(`Codex runtime selection failed: ${redactSensitiveText(error instanceof Error ? error.message : String(error))}`);
            }
        }
        const doctor = selectedCommand === this.options.command
            ? await this.doctor()
            : await this.runDoctorFor(selectedCommand, childEnvironment);
        if (!doctor.available || !doctor.authenticated) {
            return failedResult(`Codex executor preflight failed: ${doctor.errors.join(" ")}`);
        }
        const sandbox = handoff.category === "advice" || handoff.category === "analysis" ? "read-only" : this.options.sandbox;
        let runtimeProvenance;
        try {
            runtimeProvenance = await this.inspectRuntime({
                command: selectedCommand,
                version: doctor.version,
                platform,
                environment: childEnvironment,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            runtimeProvenance = {
                platform,
                configuredCommand: this.options.command,
                resolvedExecutable: null,
                version: doctor.version,
                installKind: "unknown",
                packageRoot: null,
                packageExecutable: null,
                resourcesDirectory: null,
                sandboxHelperPath: null,
                sandboxHelperExists: false,
                consistent: false,
                reason: `Runtime provenance inspection failed: ${redactSensitiveText(message)}`,
            };
        }
        const sandboxPreflight = evaluateSandboxPreflight({
            requestedSandbox: sandbox,
            ignoreUserConfig: this.options.ignoreUserConfig,
            platform,
            runtimeProvenance,
            windowsSandbox: this.options.windowsSandbox,
            ...(this.options.effectiveSandbox !== undefined ? { effectiveSandbox: this.options.effectiveSandbox } : {}),
            ...(this.options.configuredSandbox !== undefined ? { configuredSandbox: this.options.configuredSandbox } : {}),
        });
        try {
            context.onSandboxPreflight?.(sandboxPreflight);
        }
        catch {
            // Observability callbacks must not alter execution.
        }
        if (!sandboxPreflight.ok) {
            return failedResult("Codex sandbox preflight failed: " + sandboxPreflight.reason);
        }
        const temporaryDirectory = await mkdtemp(join(tmpdir(), "qing-relay-"));
        const outputPath = join(temporaryDirectory, "executor-result.json");
        try {
            const prompt = buildCodexPrompt(handoff, context);
            let attemptNumber = 0;
            while (true) {
                attemptNumber += 1;
                const args = [
                    "exec",
                    "--json",
                    "--sandbox",
                    sandbox,
                    "--output-schema",
                    schemaPath,
                    "--output-last-message",
                    outputPath,
                ];
                if (this.activeModelSelection)
                    args.push(...modelSelectionArgs(this.activeModelSelection));
                if (this.options.ephemeral)
                    args.push("--ephemeral");
                if (this.options.ignoreUserConfig)
                    args.push("--ignore-user-config");
                if (platform === "win32" && this.options.windowsSandbox) {
                    args.push("-c", `windows.sandbox=\"${this.options.windowsSandbox}\"`);
                }
                if (isStrictReadOnlyDiagnostic(handoff, sandbox))
                    args.push("--skip-git-repo-check");
                args.push("-");
                if (this.activeModelSelection) {
                    context.onModelEvent?.("model.attempt", {
                        ...modelSelectionPayload(this.activeModelSelection),
                        attemptNumber,
                    });
                }
                const request = {
                    command: selectedCommand,
                    args,
                    cwd: workspace,
                    stdin: prompt,
                    timeoutMs: this.options.timeoutMs,
                    maxOutputBytes: this.options.maxOutputBytes,
                    environment: childEnvironment,
                    ...(context.onProcessStart ? { onStart: context.onProcessStart } : {}),
                    ...(context.onProcessExit ? { onExit: context.onProcessExit } : {}),
                    ...(context.onProcessHandle ? { onHandle: context.onProcessHandle } : {}),
                };
                const result = this.runner.start
                    ? await (() => {
                        const handle = this.runner.start(request);
                        try {
                            context.onProcessHandle?.(handle);
                        }
                        catch {
                            // Relay observability must not affect execution.
                        }
                        return handle.result;
                    })()
                    : await this.runner.run(request);
                if (result.exitCode !== 0 || result.spawnError || result.timedOut || result.outputLimitExceeded) {
                    const rejectionReason = this.activeModelSelection ? modelRejectionReason(result, this.activeModelSelection) : null;
                    if (!rejectionReason || !this.activeModelSelection) {
                        return failedResult(processFailure("codex exec failed", result), this.activeModelSelection?.fallbackAudit ?? null);
                    }
                    const rejected = this.activeModelSelection;
                    try {
                        const replacement = continueModelFallbackAfterRejection(rejected, rejected.candidateId, rejectionReason, verifiedRuntimeScope);
                        context.onModelEvent?.("model.rejected", {
                            executionOwner: "Codex",
                            rejectedPair: rejected.fallbackAudit.actualPair,
                            reason: rejectionReason,
                            fallbackAudit: replacement.fallbackAudit,
                        });
                        this.activeModelSelection = replacement;
                        context.onModelEvent?.("model.fallback", modelSelectionPayload(replacement));
                        context.onModelEvent?.("model.selected", modelSelectionPayload(replacement));
                        continue;
                    }
                    catch (error) {
                        if (error instanceof ModelFallbackRequiresGateError || error instanceof NoHealthyModelCandidateError) {
                            if (error.fallbackAudit) {
                                this.activeModelSelection = { ...rejected, fallbackAudit: error.fallbackAudit };
                            }
                            context.onModelEvent?.("model.rejected", {
                                executionOwner: "Codex",
                                rejectedPair: rejected.fallbackAudit.actualPair,
                                reason: rejectionReason,
                                fallbackAudit: error.fallbackAudit ?? rejected.fallbackAudit,
                            });
                            return failedResult(`${error.message} ${processFailure("codex exec rejected the model pair", result)}`, error.fallbackAudit ?? rejected.fallbackAudit);
                        }
                        throw error;
                    }
                }
                const jsonlError = validateJsonl(result.stdout);
                if (jsonlError)
                    return failedResult(`codex exec protocol error: ${jsonlError}`, this.activeModelSelection?.fallbackAudit ?? null);
                let parsed;
                try {
                    parsed = JSON.parse(await readFile(outputPath, "utf8"));
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    return failedResult(`codex exec final output was missing or invalid JSON: ${redactSensitiveText(message)}`, this.activeModelSelection?.fallbackAudit ?? null);
                }
                const validation = validateExecutionResult(parsed);
                if (!validation.ok || !validation.value) {
                    return failedResult(`codex exec final output failed validation: ${validation.errors.join("; ")}`, this.activeModelSelection?.fallbackAudit ?? null);
                }
                return {
                    ...validation.value,
                    executionOwner: "Codex",
                    modelFallbackAudit: this.activeModelSelection?.fallbackAudit ?? null,
                };
            }
        }
        finally {
            await rm(temporaryDirectory, { recursive: true, force: true });
        }
    }
    async runDoctorFor(command, environment) {
        const run = (args) => this.runner.run({
            command,
            args,
            cwd: this.options.runtimeRoot,
            stdin: "",
            timeoutMs: this.options.probeTimeoutMs,
            maxOutputBytes: Math.min(this.options.maxOutputBytes, 64 * 1024),
            environment,
        });
        const versionResult = await run(["--version"]);
        if (versionResult.exitCode !== 0 || versionResult.spawnError || versionResult.timedOut) {
            return { available: false, authenticated: false, command, version: null, errors: [processFailure("Codex CLI unavailable", versionResult)] };
        }
        const version = redactSensitiveText(versionResult.stdout || versionResult.stderr).trim().split(/\r?\n/)[0] || null;
        const loginResult = await run(["login", "status"]);
        const authenticated = loginResult.exitCode === 0 && !loginResult.spawnError && !loginResult.timedOut;
        return { available: true, authenticated, command, version, errors: authenticated ? [] : [processFailure("Codex CLI authentication unavailable", loginResult)] };
    }
}

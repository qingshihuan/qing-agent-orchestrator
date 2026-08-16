import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { NodeProcessRunner } from "../process-runner.js";
import { validateExecutionResult } from "../validation.js";
import { evaluateSandboxPreflight } from "../sandbox-preflight.js";
import { inspectCodexRuntimeProvenance, resolveCompleteWindowsRuntime, } from "../codex-runtime.js";
import { resolveSafeWorkspace } from "../workspace.js";
import { modelSelectionArgs } from "../model-health.js";
function failedResult(summary) {
    return {
        status: "failed",
        summary,
        artifacts: [],
        criteriaEvidence: [],
        tests: [],
        proposedOperations: [],
        simulated: false,
    };
}
export function redactSensitiveText(value) {
    return value
        .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
        .replace(/\b(?:sk|sess)-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_TOKEN]")
        .replace(/\b(OPENAI_API_KEY|CODEX_API_KEY)\s*=\s*[^\s]+/gi, "$1=[REDACTED]")
        .replace(/("(?:api[_-]?key|access[_-]?token)"\s*:\s*")[^"]+("?)/gi, "$1[REDACTED]$2");
}
function processFailure(prefix, result) {
    const detail = redactSensitiveText(result.spawnError || result.stderr || result.stdout).trim().slice(0, 800);
    if (result.timedOut)
        return `${prefix}: process timed out.`;
    if (result.cancelled)
        return `${prefix}: process was explicitly cancelled.`;
    if (result.outputLimitExceeded)
        return `${prefix}: process output exceeded the configured limit.`;
    return `${prefix}: ${detail || `exit code ${String(result.exitCode)}`}`;
}
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
        JSON.stringify(handoff, null, 2),
    ].join("\n");
}
export class CodexExecExecutor {
    options;
    runner;
    inspectRuntime;
    name = "codex-exec";
    probePromise;
    constructor(options, runner = new NodeProcessRunner(), inspectRuntime = inspectCodexRuntimeProvenance) {
        this.options = options;
        this.runner = runner;
        this.inspectRuntime = inspectRuntime;
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
        let selectedModelArgs = [];
        try {
            if (this.options.modelSelection)
                selectedModelArgs = modelSelectionArgs(this.options.modelSelection);
        }
        catch (error) {
            return failedResult(`Codex model selection was rejected before process creation: ${error instanceof Error ? error.message : String(error)}`);
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
        if (this.options.modelSelection) {
            context.onModelEvent?.("model.selected", {
                candidateId: this.options.modelSelection.candidateId,
                model: this.options.modelSelection.model,
                profile: this.options.modelSelection.profile,
                reasoningEffort: this.options.modelSelection.reasoningEffort,
                role: this.options.modelSelection.role,
                reason: this.options.modelSelection.reason,
                cacheState: this.options.modelSelection.cacheState,
                fallbackFrom: this.options.modelSelection.fallbackFrom,
            });
        }
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
        args.push(...selectedModelArgs);
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
        try {
            const request = {
                command: selectedCommand,
                args,
                cwd: workspace,
                stdin: buildCodexPrompt(handoff, context),
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
                return failedResult(processFailure("codex exec failed", result));
            }
            const jsonlError = validateJsonl(result.stdout);
            if (jsonlError)
                return failedResult(`codex exec protocol error: ${jsonlError}`);
            let parsed;
            try {
                parsed = JSON.parse(await readFile(outputPath, "utf8"));
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return failedResult(`codex exec final output was missing or invalid JSON: ${redactSensitiveText(message)}`);
            }
            const validation = validateExecutionResult(parsed);
            if (!validation.ok || !validation.value) {
                return failedResult(`codex exec final output failed validation: ${validation.errors.join("; ")}`);
            }
            return validation.value;
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

#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyTask } from "./classifier.js";
import { logPageOptions, optionalFlag, selectEventPage } from "./output-efficiency.js";
import { loadConfig } from "./config.js";
import { DryRunExecutor } from "./executors/dry-run-executor.js";
import { CodexExecExecutor } from "./executors/codex-exec-executor.js";
import { MockExecutor } from "./executors/mock-executor.js";
import { CodexHandoffPlanner, planLocally, saveHandoff } from "./planner.js";
import { Relay } from "./relay.js";
import { RuleBasedReviewer } from "./reviewer.js";
import { RunStore, resolveStateDirectory } from "./run-store.js";
import { terminateProcessTree } from "./process-runner.js";
import { evaluateSafetyGate } from "./safety-gate.js";
import { ModelHealthChecker } from "./model-health.js";
import { selectModelCandidate } from "./model-router.js";
import { TaskModelScheduler } from "./model-scheduler.js";
import { analyzeTaskComplexity } from "./task-analyzer.js";
import { createPendingDispatchHandoff, routeTask } from "./task-router.js";
import { respondToCliRecommendation } from "./execution-mode-router.js";
import { bindHandoffOrchestration, legacyV07HandoffFingerprint, resolveExecutableOrchestrationLimits } from "./orchestration-policy.js";
import { validateExecutionResult, validateHandoff } from "./validation.js";
import { resolveSafeWorkspace } from "./workspace.js";
const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
import { nativeFullControl, nativePermissionHandling } from "./native-permissions.js";
let compactMode = false;
function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function compactModel(value) {
    const candidate = record(value);
    if (!candidate || typeof candidate.model !== "string")
        return null;
    return {
        candidateId: candidate.candidateId ?? null,
        backend: candidate.backend ?? null,
        profile: candidate.profile ?? null,
        model: candidate.model,
        reasoningEffort: candidate.reasoningEffort ?? null,
        role: candidate.role ?? null,
        fallbackFrom: candidate.fallbackFrom ?? null,
    };
}
function compactControlPlane(value) {
    if (!compactMode)
        return value;
    const source = record(value);
    if (!source || typeof source.status !== "string")
        return value;
    const supported = new Set([
        "DIRECT_EXECUTION_REQUIRED",
        "LITE_EXECUTION_REQUIRED",
        "FULL_EXECUTION_READY",
        "AWAITING_APPROVAL",
        "DENIED",
        "CLI_RECOMMENDATION_REQUIRED",
        "CLI_SETUP_REQUIRED",
        "CLI_DEPENDENCY_CHECK_REQUIRED",
        "HOST_PERMISSION_CHECK_REQUIRED",
    ]);
    if (!supported.has(source.status))
        return value;
    const orchestration = record(source.orchestration);
    const execution = record(source.execution);
    const gate = record(source.safetyGate);
    const decisions = Array.isArray(gate?.decisions) ? gate.decisions : [];
    const gateIds = decisions.flatMap((item) => {
        const decision = record(item);
        return decision?.decision === "REQUIRE_APPROVAL" && typeof decision.gateId === "string" ? [decision.gateId] : [];
    });
    return {
        status: source.status,
        permissionHandling: source.permissionHandling ?? null,
        executionMode: execution?.mode ?? null,
        cliRecommendation: execution?.recommendation ?? null,
        executionOwner: source.executionOwner ?? execution?.executionOwner ?? null,
        route: source.route ?? null,
        category: source.category ?? null,
        tier: orchestration?.tier ?? null,
        budget: orchestration ? {
            children: orchestration.childAgentBudget ?? 0,
            revisions: orchestration.maxRevisions ?? 0,
            independentReviewer: orchestration.independentReviewer ?? false,
        } : null,
        model: compactModel(source.modelSelection),
        reviewerModel: compactModel(source.reviewerModelSelection),
        handoffId: source.handoffId ?? null,
        handoffPath: source.handoffPath ?? null,
        plannerSource: source.plannerSource ?? null,
        plannerWarning: source.plannerWarning ?? null,
        approval: gate ? { outcome: gate.outcome ?? null, gateIds, decisions: decisions.filter((item) => record(item)?.decision !== "ALLOW") } : { outcome: "ALLOW", gateIds: [], decisions: [] },
        modelProbe: source.modelProbe ?? null,
        nextStep: source.nextStep ?? null,
    };
}
function print(value) {
    process.stdout.write(`${JSON.stringify(compactControlPlane(value), null, compactMode ? 0 : 2)}
`);
}
function flagValue(args, name) {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
}
function flagValues(args, name) {
    return args.flatMap((arg, index) => (arg === name && args[index + 1] ? [args[index + 1]] : []));
}
function configPath(args) {
    return flagValue(args, "--relay-config") ?? flagValue(args, "--config");
}
function editionValue(args) {
    const value = flagValue(args, "--edition") ?? "full";
    if (value !== "standard" && value !== "full")
        throw new Error("--edition must be standard or full");
    return value;
}
async function readJson(path) {
    return JSON.parse(await readFile(resolve(path), "utf8"));
}
async function readHandoff(path) {
    const result = validateHandoff(await readJson(path));
    if (!result.ok || !result.value)
        throw new Error(`Invalid Handoff:\n- ${result.errors.join("\n- ")}`);
    return result.value;
}
function codexOptions(config, bundle) {
    return { ...config.executor.codexExec, runtimeRoot, ...(bundle ? { modelSelection: bundle.selection, modelHealth: bundle.health, prepareModelFallback: (selection, reason) => taskModelScheduler(config).prepareFallback(selection, reason) } : {}) };
}
function plannerOptions(config, bundle) {
    return {
        ...config.executor.codexExec,
        runtimeRoot,
        handoffSchemaPath: "schemas/planner-output.schema.json",
        ...(bundle ? { modelSelection: bundle.selection } : {}),
    };
}
const taskSchedulers = new WeakMap();
function taskModelScheduler(config) {
    let scheduler = taskSchedulers.get(config);
    if (!scheduler) {
        scheduler = new TaskModelScheduler(config.modelRouting.candidates, new ModelHealthChecker({
            command: config.executor.codexExec.command,
            cwd: runtimeRoot,
            schemaPath: resolve(runtimeRoot, "schemas/model-health.schema.json"),
            timeoutMs: config.modelRouting.probeTimeoutMs,
            ttlMs: config.modelRouting.healthTtlMs,
            ephemeral: config.executor.codexExec.ephemeral,
            ignoreUserConfig: config.executor.codexExec.ignoreUserConfig,
            cachePath: resolve(resolveStateDirectory(runtimeRoot, config.runtime.stateDirectory), "model-health-cache-v1.json"),
        }));
        taskSchedulers.set(config, scheduler);
    }
    return scheduler;
}
async function configuredModel(config, role, backend, task, decision) {
    if (config.modelRouting.mode === "inherit")
        return undefined;
    if (!decision.orchestration.modelSelectionRequired || decision.orchestration.childAgentBudget === 0)
        return undefined;
    if (role === "reviewer" && !decision.orchestration.independentReviewer)
        return undefined;
    if (decision.route === "chat")
        throw new Error("Chat routing cannot select a Codex model.");
    const analyzedComplexity = analyzeTaskComplexity({ text: task, category: decision.category, role, routeSignals: decision.signals });
    const complexityBand = decision.orchestration.tier === "lite" ? "normal" : analyzedComplexity.band;
    if (backend === "desktop-child") {
        return {
            selection: selectModelCandidate(config.modelRouting.candidates, new Map(), { backend, role, route: decision.route, category: decision.category, complexityBand }),
            health: [],
        };
    }
    return taskModelScheduler(config).select({ backend, role, route: decision.route, category: decision.category, complexityBand });
}
function desktopDelegationContract(selection) {
    return {
        executionOwner: "Codex",
        backend: "desktop-child",
        delegationTarget: "internal-child",
        parentModelUnchanged: true,
        modelSelectionScope: "delegated-task",
        permissionHandling: nativePermissionHandling,
        override: selection ? { model: selection.model, reasoningEffort: selection.reasoningEffort } : null,
        spawnAgent: selection ? { model: selection.model, reasoning_effort: selection.reasoningEffort } : null,
        fieldMapping: { router: "reasoningEffort", hostInvocation: "reasoning_effort" },
        inheritedDefaults: selection ? null : ["agents.default_subagent_model", "agents.default_subagent_reasoning_effort"],
        precedence: "explicit spawn model/reasoning overrides configured subagent defaults",
        fallbackPlan: selection?.fallbackPlan ?? null,
        retryProtocol: selection ? {
            trigger: "spawn-rejected",
            nextCandidateSource: "fallbackPlan.orderedCandidates",
            displayReplacementBeforeRetry: true,
            recordFallbackReason: true,
            reuseExistingGatesWhenScopeUnchanged: true,
            newGateRequiredFor: ["backend-change", "operations-change", "allowed-paths-change", "sandbox-change", "permissions-change", "effects-change"],
        } : null,
    };
}
function createExecutor(mode, config, args, bundle) {
    if (mode === "dry-run")
        return new DryRunExecutor();
    if (mode === "mock")
        return new MockExecutor();
    if (mode === "codex-exec") {
        if (!config.executor.codexExec.enabled) {
            throw new Error("codex-exec is disabled in config. Set executor.codexExec.enabled=true after reviewing the settings.");
        }
        if (!args.includes("--allow-real-execution")) {
            throw new Error("Real Codex execution requires the explicit --allow-real-execution flag.");
        }
        return new CodexExecExecutor(codexOptions(config, bundle));
    }
    throw new Error(`Executor '${mode}' is not available. Use dry-run, mock, or codex-exec.`);
}
function usage() {
    return [
        "Qing Agent Orchestrator Relay (phase 3)",
        "",
        "Commands:",
        "  doctor [--config <file>|--relay-config <file>]",
        "  dispatch --task <goal> --workspace <project> [--edition standard|full] [--cli-response auto|accept|decline] [--config <file>] [--no-model-probe] [--compact]",
        "       desktop is the default; Qing selects the route automatically; no-model-probe returns a side-effect-free inspection plan",
        "  models list|probe [--config <file>]",
        "  status [run-id] [--config <file>]",
        "  logs <run-id> [--config <file>]",
        "  cancel <run-id> [--config <file>]",
        "  start --task <natural-language goal> --workspace <project-directory> [--planner auto|codex|local] [--out <handoff.json>] [--config <file>]",
        "       creates and saves a read-only planned Handoff; it never executes the task",
        "  execute <handoff.json> --allow-real-execution [--approve-handoff <handoff-id>] [--approve <gate-id>]... [--config <file>]",
        "       safe declared work needs no plan approval; effect gates still require their exact IDs",
        "  validate <handoff.json>",
        "  legacy-fingerprint <handoff.json>",
        "       prints the deterministic ID + SHA-256 entry required to opt in one authentic v0.7 3/2 Handoff",
        "  classify <task text>",
        "  gate <handoff.json> [--approve <gate-id>]...",
        "  review <handoff.json> <executor-result.json>",
        "  run <handoff.json> [--executor dry-run|mock] [--config <file>|--relay-config <file>] [--approve <gate-id>]...",
        "       legacy convenience command; real codex-exec is refused (use execute)",
        "",
        "doctor only checks CLI availability/authentication. It does not submit a task.",
        "Use --compact for agent-facing output; full output remains the compatibility default.",
        "models probe [--candidate <id>] [--force]: cached by default; force refreshes health.",
        "logs <run-id> [--after <sequence>] [--limit <1..500>]: returns events/nextAfter/hasMore; no flags retains the full array.",
    ].join("\n");
}
async function main() {
    const args = process.argv.slice(2);
    compactMode = args.includes("--compact");
    const command = args[0];
    if (!command || command === "help" || command === "--help" || command === "-h") {
        process.stdout.write(`${usage()}\n`);
        return;
    }
    if (command === "classify") {
        const text = args.slice(1).join(" ").trim();
        if (!text)
            throw new Error("classify requires task text");
        print(classifyTask(text));
        return;
    }
    if (command === "models") {
        const action = args[1] ?? "list";
        if (action !== "list" && action !== "probe")
            throw new Error("models supports only list or probe");
        const config = await loadConfig(configPath(args));
        if (action === "list") {
            print({ mode: config.modelRouting.mode, healthTtlMs: config.modelRouting.healthTtlMs, candidates: config.modelRouting.candidates.map((candidate) => ({ ...candidate, health: candidate.enabled ? "unverified" : "disabled" })) });
            return;
        }
        const requestedCandidate = optionalFlag(args, "--candidate");
        if (requestedCandidate !== undefined && !config.modelRouting.candidates.some((item) => item.id === requestedCandidate && item.backend === "codex-cli")) {
            throw new Error("--candidate must name a configured Codex CLI candidate.");
        }
        const checker = new ModelHealthChecker({ command: config.executor.codexExec.command, cwd: runtimeRoot, schemaPath: resolve(runtimeRoot, "schemas/model-health.schema.json"), timeoutMs: config.modelRouting.probeTimeoutMs, ttlMs: config.modelRouting.healthTtlMs, ephemeral: config.executor.codexExec.ephemeral, ignoreUserConfig: config.executor.codexExec.ignoreUserConfig,
            cachePath: resolve(resolveStateDirectory(runtimeRoot, config.runtime.stateDirectory), "model-health-cache-v1.json"),
        });
        const cliCandidates = config.modelRouting.candidates.filter(({ id, backend }) => backend === "codex-cli" && (requestedCandidate === undefined || id === requestedCandidate));
        print({ mode: config.modelRouting.mode, backend: "codex-cli", results: await Promise.all(cliCandidates.map((candidate) => checker.check(candidate, args.includes("--force")))) });
        return;
    }
    if (command === "dispatch") {
        const task = flagValue(args, "--task");
        const requestedWorkspace = flagValue(args, "--workspace");
        if (!task)
            throw new Error("dispatch requires --task <natural-language goal>");
        if (!requestedWorkspace)
            throw new Error("dispatch requires --workspace <project-directory>");
        const config = await loadConfig(configPath(args));
        const decision = routeTask(task, { edition: editionValue(args), orchestration: config.orchestration });
        let execution = decision.execution;
        const cliResponse = flagValue(args, "--cli-response");
        if (cliResponse !== undefined && cliResponse !== "accept" && cliResponse !== "decline" && cliResponse !== "auto") {
            throw new Error("--cli-response must be auto, accept or decline");
        }
        if (decision.orchestration.tier === "direct") {
            print({ ...decision, execution, status: "DIRECT_EXECUTION_REQUIRED", permissionHandling: nativePermissionHandling, handoffId: null, handoffPath: null, modelSelection: null, reviewerModelSelection: null, delegationInvocation: null, modelProbe: "not-applicable", nextStep: "Proceed directly to relevant work and required tests; do not spend another turn confirming this route, running a planner or probing models. No child or CLI task was created." });
            return;
        }
        if (execution.mode === "cli-recommended") {
            if (cliResponse !== "decline" && args.includes("--no-model-probe")) {
                print({ ...decision, execution, permissionHandling: nativePermissionHandling, status: "CLI_DEPENDENCY_CHECK_REQUIRED", handoffId: null, handoffPath: null, modelSelection: null, modelProbe: "not-started", nextStep: "Qing selected the process route, not a user-choice prompt. The explicit no-model-probe flag prevents discovery and planning calls. Remove --no-model-probe to continue with host-permitted read-only checks using --cli-response auto when appropriate; do not ask the user to choose a routing tier or approve this plan. This is not authorization for installation or task execution." });
                return;
            }
            if (cliResponse === "decline") {
                execution = await respondToCliRecommendation(execution, "decline");
            }
            else {
                execution = await respondToCliRecommendation(execution, cliResponse ?? "auto", {
                    inspect: async () => {
                        const report = await new CodexExecExecutor(codexOptions(config)).doctor(true);
                        return !report.available ? "missing" : !report.authenticated ? "authentication-required" : "ready";
                    },
                });
                if (execution.mode === "cli-setup-required") {
                    print({ ...decision, execution, status: "CLI_SETUP_REQUIRED", handoffId: null, handoffPath: null, modelSelection: null, modelProbe: "dependency-check-only", nextStep: `See ${execution.recommendation?.installGuide}. Continue desktop-capable work when possible; check only the missing installation or authentication scope through the host. Reuse existing exact authorization rather than asking to approve a route. No installation, login or task was started.` });
                    return;
                }
            }
        }
        else if (cliResponse) {
            throw new Error("--cli-response is valid only when a full-edition CLI condition is pending.");
        }
        if (execution.mode === "desktop-native" || execution.mode === "desktop-fallback") {
            const bundle = await configuredModel(config, "executor", "desktop-child", task, decision);
            if (decision.orchestration.tier === "lite") {
                print({ ...decision, execution, status: "LITE_EXECUTION_REQUIRED", permissionHandling: nativePermissionHandling, handoffId: null, handoffPath: null, modelSelection: bundle?.selection ?? null, reviewerModelSelection: null, delegationInvocation: desktopDelegationContract(bundle?.selection ?? null), modelProbe: "not-applicable", nextStep: "Delegate one complete implementation-and-test unit with fixed interfaces. Do not duplicate child work or inspect live traces; collect its final result, independently verify integration once per unchanged snapshot, and allow at most one revision. No plan approval is required." });
                return;
            }
            const workspace = await resolveSafeWorkspace(runtimeRoot, requestedWorkspace);
            const handoff = createPendingDispatchHandoff(task, workspace, decision);
            const gate = evaluateSafetyGate(handoff);
            const reviewerBundle = await configuredModel(config, "reviewer", "desktop-child", task, decision);
            print({ ...decision, execution, ...nativeFullControl(gate.outcome), handoffId: handoff.id, handoffPath: null, handoff, safetyGate: gate, modelSelection: bundle?.selection ?? null, reviewerModelSelection: reviewerBundle?.selection ?? null, delegationInvocation: desktopDelegationContract(bundle?.selection ?? null), reviewerInvocation: desktopDelegationContract(reviewerBundle?.selection ?? null), modelProbe: "not-applicable" });
            if (gate.outcome === "DENY")
                process.exitCode = 2;
            return;
        }
        const workspace = await resolveSafeWorkspace(runtimeRoot, requestedWorkspace);
        let planned;
        let bundle;
        if (args.includes("--no-model-probe")) {
            planned = { handoff: createPendingDispatchHandoff(task, workspace, decision), workspace };
        }
        else {
            bundle = await configuredModel(config, "planner", "codex-cli", task, decision);
            planned = await new CodexHandoffPlanner(plannerOptions(config, bundle)).plan(task, workspace);
        }
        planned = { ...planned, handoff: bindHandoffOrchestration(planned.handoff, decision.orchestration) };
        const handoffPath = await saveHandoff(planned.handoff, runtimeRoot, config.runtime.stateDirectory, flagValue(args, "--out"));
        const gate = evaluateSafetyGate(planned.handoff);
        print({ ...decision, execution, status: gate.outcome === "ALLOW" ? "FULL_EXECUTION_READY" : gate.outcome === "DENY" ? "DENIED" : "AWAITING_APPROVAL", handoffId: planned.handoff.id, handoffPath, handoff: planned.handoff, safetyGate: gate, modelSelection: bundle?.selection ?? null, modelHealth: bundle?.health ?? [], modelProbe: args.includes("--no-model-probe") ? "skipped-by-explicit-flag" : "completed", nextStep: gate.outcome === "ALLOW" ? "The safe Handoff is ready without plan approval. Dispatch still never executes it." : gate.outcome === "DENY" ? "Revise the Handoff; denial cannot be overridden." : "Approve only the displayed effect gate IDs. Dispatch never executes the task." });
        if (gate.outcome === "DENY")
            process.exitCode = 2;
        return;
    }
    if (command === "doctor") {
        const config = await loadConfig(configPath(args));
        const report = await new CodexExecExecutor(codexOptions(config)).doctor(true);
        print(report);
        if (!report.available || !report.authenticated)
            process.exitCode = 5;
        return;
    }
    if (["status", "logs", "cancel"].includes(command)) {
        const config = await loadConfig(configPath(args));
        const store = new RunStore(resolveStateDirectory(runtimeRoot, config.runtime.stateDirectory));
        const runId = args[1];
        if (command === "status") {
            if (!runId) {
                print(await store.listRuns());
                return;
            }
            const listing = await store.findRun(runId);
            if (!listing)
                throw new Error(`Run '${runId}' was not found.`);
            print(listing);
            return;
        }
        if (!runId)
            throw new Error(`${command} requires a run ID`);
        if (command === "logs") {
            const page = logPageOptions(args);
            const events = await store.readEvents(runId);
            print(page ? selectEventPage(events, page) : events);
            return;
        }
        print(await store.cancelRun(runId, terminateProcessTree));
        return;
    }
    if (command === "start" || command === "prepare") {
        const task = flagValue(args, "--task");
        const workspace = flagValue(args, "--workspace");
        if (!task)
            throw new Error("start requires --task <natural-language goal>");
        if (!workspace)
            throw new Error("start requires --workspace <project-directory>");
        const config = await loadConfig(configPath(args));
        const plannerMode = flagValue(args, "--planner") ?? "auto";
        if (!["auto", "codex", "local"].includes(plannerMode)) {
            throw new Error("--planner must be auto, codex, or local");
        }
        const decision = routeTask(task, { edition: "full", orchestration: config.orchestration });
        if (decision.orchestration.tier === "direct") {
            print({ ...decision, status: "DIRECT_EXECUTION_REQUIRED", permissionHandling: nativePermissionHandling, handoffPath: null, plannerSource: null, modelSelection: null, modelProbe: "not-applicable", nextStep: "Complete this task directly. Start did not create a Handoff, allocate a model, probe the CLI, or invoke any Planner." });
            return;
        }
        if (decision.orchestration.tier === "lite") {
            const bundle = await configuredModel(config, "executor", "desktop-child", task, decision);
            print({ ...decision, status: "LITE_EXECUTION_REQUIRED", permissionHandling: nativePermissionHandling, handoffPath: null, plannerSource: null, modelSelection: bundle?.selection ?? null, delegationInvocation: desktopDelegationContract(bundle?.selection ?? null), modelProbe: "not-applicable", nextStep: "Use at most one desktop Executor child and parent verification. Start did not invoke the connected or local Handoff Planner." });
            return;
        }
        let planned;
        let plannerSource;
        let plannerWarning;
        let bundle;
        if (plannerMode === "local") {
            planned = await planLocally(task, workspace, runtimeRoot);
            plannerSource = "local-fallback";
            plannerWarning = "The conservative local Planner was selected explicitly; no model planning call was made.";
        }
        else {
            try {
                bundle = await configuredModel(config, "planner", "codex-cli", task, decision);
                planned = await new CodexHandoffPlanner(plannerOptions(config, bundle)).plan(task, workspace);
                plannerSource = "codex";
            }
            catch (error) {
                if (plannerMode === "codex")
                    throw error;
                planned = await planLocally(task, workspace, runtimeRoot);
                plannerSource = "local-fallback";
                const message = error instanceof Error ? error.message : String(error);
                plannerWarning = `Connected Codex Planner was unavailable. Used the conservative local fallback. ${message.slice(-500)}`;
            }
        }
        planned = { ...planned, handoff: bindHandoffOrchestration(planned.handoff, decision.orchestration) };
        const handoffPath = await saveHandoff(planned.handoff, runtimeRoot, config.runtime.stateDirectory, flagValue(args, "--out"));
        const gate = evaluateSafetyGate(planned.handoff);
        print({
            ...decision,
            status: gate.outcome === "DENY" ? "DENIED" : gate.outcome === "ALLOW" ? "FULL_EXECUTION_READY" : "AWAITING_APPROVAL",
            handoffPath,
            plannerSource,
            modelSelection: bundle?.selection ?? null,
            ...(plannerWarning ? { plannerWarning } : {}),
            handoff: planned.handoff,
            safetyGate: gate,
            nextStep: gate.outcome === "DENY"
                ? "Revise the Handoff. A denial cannot be overridden."
                : gate.outcome === "ALLOW"
                    ? "The declared safe work is ready for execute without a separate plan approval. Real execution still requires --allow-real-execution."
                    : "Approve only the displayed effect gate IDs, then pass those exact IDs with --approve. A separate plan approval is not required.",
        });
        if (gate.outcome === "DENY")
            process.exitCode = 2;
        return;
    }
    const handoffPath = args[1];
    if (!handoffPath)
        throw new Error(`${command} requires a Handoff JSON path`);
    if (command === "validate") {
        const validation = validateHandoff(await readJson(handoffPath));
        print(validation);
        if (!validation.ok)
            process.exitCode = 1;
        return;
    }
    const handoff = await readHandoff(handoffPath);
    if (command === "legacy-fingerprint") {
        print({
            handoffId: handoff.id,
            fingerprint: legacyV07HandoffFingerprint(handoff),
            configEntry: {
                id: handoff.id,
                fingerprint: legacyV07HandoffFingerprint(handoff),
            },
        });
        return;
    }
    if (command === "execute") {
        const approvedHandoff = flagValue(args, "--approve-handoff");
        if (approvedHandoff !== undefined && approvedHandoff !== handoff.id)
            throw new Error(`--approve-handoff, when supplied for legacy compatibility, must equal ${handoff.id}.`);
        const config = await loadConfig(configPath(args));
        const approvals = [...config.security.approvedGateIds, ...flagValues(args, "--approve")];
        const gate = evaluateSafetyGate(handoff, approvals);
        if (gate.outcome === "DENY")
            throw new Error("Execution denied by the safety gate; revise the Handoff.");
        if (gate.outcome === "REQUIRE_APPROVAL")
            throw new Error(`Execution requires the remaining effect gate IDs: ${gate.decisions.filter(({ decision: outcome }) => outcome === "REQUIRE_APPROVAL").map(({ gateId }) => gateId).join(", ")}`);
        const budgetDecision = routeTask(handoff.objective, { orchestration: config.orchestration });
        const limits = resolveExecutableOrchestrationLimits(handoff, budgetDecision.orchestration, config.orchestration, config.relay.maxIterations);
        const decision = routeTask(handoff.objective, { orchestration: { ...config.orchestration, mode: "full" } });
        if (decision.route === "chat")
            throw new Error("A chat-routed goal cannot start the Codex Executor.");
        const bundle = await configuredModel(config, "executor", "codex-cli", handoff.objective, decision);
        const executor = createExecutor("codex-exec", config, args, bundle);
        const relay = new Relay(executor, new RuleBasedReviewer());
        const runHandle = await new RunStore(resolveStateDirectory(runtimeRoot, config.runtime.stateDirectory)).createRun(handoff);
        const result = await relay.run(handoff, {
            maxIterations: limits.maxIterations,
            approvedGateIds: approvals,
            runHandle,
            orchestrationConfig: config.orchestration,
        });
        const finalModelSelection = executor instanceof CodexExecExecutor
            ? executor.finalModelSelection ?? bundle?.selection ?? null
            : bundle?.selection ?? null;
        print({ ...result, executionOwner: "Codex", modelSelection: finalModelSelection, orchestration: limits.contract, executionBudgetSource: limits.source, maxIterationsBudget: limits.maxIterations });
        if (result.status !== "COMPLETED")
            process.exitCode = 4;
        return;
    }
    if (command === "gate") {
        const report = evaluateSafetyGate(handoff, flagValues(args, "--approve"));
        print(report);
        if (report.outcome !== "ALLOW")
            process.exitCode = 2;
        return;
    }
    if (command === "review") {
        const executionPath = args[2];
        if (!executionPath)
            throw new Error("review requires an executor-result JSON path");
        const executionValidation = validateExecutionResult(await readJson(executionPath));
        if (!executionValidation.ok || !executionValidation.value) {
            throw new Error(`Invalid executor result:\n- ${executionValidation.errors.join("\n- ")}`);
        }
        const review = await new RuleBasedReviewer().review(handoff, executionValidation.value, 1);
        print(review);
        if (review.verdict !== "PASS")
            process.exitCode = 3;
        return;
    }
    if (command === "run") {
        const config = await loadConfig(configPath(args));
        const mode = flagValue(args, "--executor") ?? config.executor.mode;
        if (mode === "codex-exec")
            throw new Error("Legacy run cannot start real codex-exec. Use execute with --allow-real-execution and any required effect gate IDs.");
        const approvals = [...config.security.approvedGateIds, ...flagValues(args, "--approve")];
        const decision = routeTask(handoff.objective, { orchestration: config.orchestration });
        const limits = resolveExecutableOrchestrationLimits(handoff, decision.orchestration, config.orchestration, config.relay.maxIterations);
        const relay = new Relay(createExecutor(mode, config, args), new RuleBasedReviewer());
        const runHandle = await new RunStore(resolveStateDirectory(runtimeRoot, config.runtime.stateDirectory)).createRun(handoff);
        const result = await relay.run(handoff, {
            maxIterations: limits.maxIterations,
            approvedGateIds: approvals,
            runHandle,
            orchestrationConfig: config.orchestration,
        });
        print({ ...result, orchestration: limits.contract, executionBudgetSource: limits.source, maxIterationsBudget: limits.maxIterations });
        if (!["COMPLETED", "SIMULATED_COMPLETED"].includes(result.status))
            process.exitCode = 4;
        return;
    }
    throw new Error(`Unknown command '${command}'.\n\n${usage()}`);
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    process.exitCode = 1;
});

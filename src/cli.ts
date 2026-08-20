#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyTask } from "./classifier.js";
import { loadConfig } from "./config.js";
import { DryRunExecutor } from "./executors/dry-run-executor.js";
import { CodexExecExecutor, type CodexExecOptions } from "./executors/codex-exec-executor.js";
import type { Executor } from "./executors/executor.js";
import { MockExecutor } from "./executors/mock-executor.js";
import { CodexHandoffPlanner, planLocally, saveHandoff, type PlannedHandoff } from "./planner.js";
import { Relay } from "./relay.js";
import { RuleBasedReviewer } from "./reviewer.js";
import { RunStore, resolveStateDirectory } from "./run-store.js";
import { terminateProcessTree } from "./process-runner.js";
import { evaluateSafetyGate } from "./safety-gate.js";
import { ModelHealthChecker, type ModelHealthRecord } from "./model-health.js";
import { selectModelCandidate } from "./model-router.js";
import { analyzeTaskComplexity } from "./task-analyzer.js";
import { createPendingDispatchHandoff, routeTask, type TaskRouteDecision } from "./task-router.js";
import { respondToCliRecommendation } from "./execution-mode-router.js";
import type { ExecutionResult, Handoff, ModelBackend, ModelRole, ModelSelection, OrchestratorEdition, RelayConfig } from "./types.js";
import { validateExecutionResult, validateHandoff } from "./validation.js";
import { resolveSafeWorkspace } from "./workspace.js";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function flagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function flagValues(args: string[], name: string): string[] {
  return args.flatMap((arg, index) => (arg === name && args[index + 1] ? [args[index + 1] as string] : []));
}

function configPath(args: string[]): string | undefined {
  return flagValue(args, "--relay-config") ?? flagValue(args, "--config");
}

function editionValue(args: string[]): OrchestratorEdition {
  const value = flagValue(args, "--edition") ?? "full";
  if (value !== "standard" && value !== "full") throw new Error("--edition must be standard or full");
  return value;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function readHandoff(path: string): Promise<Handoff> {
  const result = validateHandoff(await readJson(path));
  if (!result.ok || !result.value) throw new Error(`Invalid Handoff:\n- ${result.errors.join("\n- ")}`);
  return result.value;
}

interface SelectedModelBundle {
  selection: ModelSelection;
  health: ModelHealthRecord[];
}

function codexOptions(config: RelayConfig, bundle?: SelectedModelBundle): CodexExecOptions {
  return { ...config.executor.codexExec, runtimeRoot, ...(bundle ? { modelSelection: bundle.selection, modelHealth: bundle.health } : {}) };
}

function plannerOptions(config: RelayConfig, bundle?: SelectedModelBundle) {
  return {
    ...config.executor.codexExec,
    runtimeRoot,
    handoffSchemaPath: "schemas/planner-output.schema.json",
    ...(bundle ? { modelSelection: bundle.selection } : {}),
  };
}

async function configuredModel(config: RelayConfig, role: ModelRole, backend: ModelBackend, task: string, decision: TaskRouteDecision): Promise<SelectedModelBundle | undefined> {
  if (config.modelRouting.mode === "inherit") return undefined;
  if (decision.route === "chat") throw new Error("Chat routing cannot select a Codex model.");
  const complexity = analyzeTaskComplexity({ text: task, category: decision.category, role, routeSignals: decision.signals });
  if (backend === "desktop-child") {
    return {
      selection: selectModelCandidate(config.modelRouting.candidates, new Map(), { backend, role, route: decision.route, category: decision.category, complexityBand: complexity.band }),
      health: [],
    };
  }
  const checker = new ModelHealthChecker({
    command: config.executor.codexExec.command,
    cwd: runtimeRoot,
    schemaPath: resolve(runtimeRoot, "schemas/model-health.schema.json"),
    timeoutMs: config.modelRouting.probeTimeoutMs,
    ttlMs: config.modelRouting.healthTtlMs,
    ephemeral: config.executor.codexExec.ephemeral,
    ignoreUserConfig: config.executor.codexExec.ignoreUserConfig,
  });
  const relevant = config.modelRouting.candidates.filter((candidate) => candidate.enabled && candidate.backend === "codex-cli" && candidate.roles.includes(role));
  const health = await Promise.all(relevant.map((candidate) => checker.check(candidate)));
  const byId = new Map(health.map((record) => [record.candidateId, record]));
  return { selection: selectModelCandidate(config.modelRouting.candidates, byId, { backend, role, route: decision.route, category: decision.category, complexityBand: complexity.band }), health };
}

function desktopDelegationContract(selection: ModelSelection | null) {
  return {
    executionOwner: "Codex",
    backend: "desktop-child",
    delegationTarget: "internal-child",
    parentModelUnchanged: true,
    modelSelectionScope: "delegated-task",
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

function createExecutor(mode: string, config: RelayConfig, args: string[], bundle?: SelectedModelBundle): Executor {
  if (mode === "dry-run") return new DryRunExecutor();
  if (mode === "mock") return new MockExecutor();
  if (mode === "codex-exec") {
    if (!config.executor.codexExec.enabled) {
      throw new Error("codex-exec is disabled in config. Set executor.codexExec.enabled=true after reviewing the settings.");
    }
    if (!args.includes("--allow-real-execution")) {
      throw new Error("Real Codex execution requires the explicit --allow-real-execution flag.");
    }
    return new CodexExecExecutor(codexOptions(config, bundle));
  }
  throw new Error(
    `Executor '${mode}' is not available. Use dry-run, mock, or codex-exec.`,
  );
}

function usage(): string {
  return [
    "Qing Agent Orchestrator Relay (phase 3)",
    "",
    "Commands:",
    "  doctor [--config <file>|--relay-config <file>]",
    "  dispatch --task <goal> --workspace <project> [--edition standard|full] [--cli-response accept|decline] [--config <file>] [--no-model-probe]",
    "       desktop is the default; a full-edition CLI condition first returns a recommendation and waits for a user choice",
    "  models list|probe [--config <file>]",
    "  status [run-id] [--config <file>]",
    "  logs <run-id> [--config <file>]",
    "  cancel <run-id> [--config <file>]",
    "  start --task <natural-language goal> --workspace <project-directory> [--planner auto|codex|local] [--out <handoff.json>] [--config <file>]",
    "       creates and saves a read-only planned Handoff; it never executes the task",
    "  execute <handoff.json> --approve-handoff <handoff-id> --allow-real-execution [--approve <gate-id>]... [--config <file>]",
    "       executes only the exact approved Handoff and any separately approved safety gates",
    "  validate <handoff.json>",
    "  classify <task text>",
    "  gate <handoff.json> [--approve <gate-id>]...",
    "  review <handoff.json> <executor-result.json>",
    "  run <handoff.json> [--executor dry-run|mock] [--config <file>|--relay-config <file>] [--approve <gate-id>]...",
    "       legacy convenience command; real codex-exec is refused (use execute)",
    "",
    "doctor only checks CLI availability/authentication. It does not submit a task.",
  ].join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (command === "classify") {
    const text = args.slice(1).join(" ").trim();
    if (!text) throw new Error("classify requires task text");
    print(classifyTask(text));
    return;
  }

  if (command === "models") {
    const action = args[1] ?? "list";
    if (action !== "list" && action !== "probe") throw new Error("models supports only list or probe");
    const config = await loadConfig(configPath(args));
    if (action === "list") {
      print({ mode: config.modelRouting.mode, healthTtlMs: config.modelRouting.healthTtlMs, candidates: config.modelRouting.candidates.map((candidate) => ({ ...candidate, health: candidate.enabled ? "unverified" : "disabled" })) });
      return;
    }
    const checker = new ModelHealthChecker({ command: config.executor.codexExec.command, cwd: runtimeRoot, schemaPath: resolve(runtimeRoot, "schemas/model-health.schema.json"), timeoutMs: config.modelRouting.probeTimeoutMs, ttlMs: config.modelRouting.healthTtlMs, ephemeral: config.executor.codexExec.ephemeral, ignoreUserConfig: config.executor.codexExec.ignoreUserConfig });
    const cliCandidates = config.modelRouting.candidates.filter(({ backend }) => backend === "codex-cli");
    print({ mode: config.modelRouting.mode, backend: "codex-cli", results: await Promise.all(cliCandidates.map((candidate) => checker.check(candidate))) });
    return;
  }

  if (command === "dispatch") {
    const task = flagValue(args, "--task");
    const requestedWorkspace = flagValue(args, "--workspace");
    if (!task) throw new Error("dispatch requires --task <natural-language goal>");
    if (!requestedWorkspace) throw new Error("dispatch requires --workspace <project-directory>");
    const decision = routeTask(task, { edition: editionValue(args) });
    let execution = decision.execution;
    const cliResponse = flagValue(args, "--cli-response");
    if (cliResponse !== undefined && cliResponse !== "accept" && cliResponse !== "decline") {
      throw new Error("--cli-response must be accept or decline");
    }
    if (execution.mode === "cli-recommended") {
      if (!cliResponse) {
        print({ ...decision, status: "CLI_RECOMMENDATION_REQUIRED", handoffId: null, handoffPath: null, modelSelection: null, modelProbe: "not-started", nextStep: `${execution.recommendation?.message}: ${execution.recommendation?.benefit} Ask the user to accept or decline. No CLI dependency check or task was started.` });
        return;
      }
      if (cliResponse === "decline") {
        execution = await respondToCliRecommendation(execution, "decline");
        const config = await loadConfig(configPath(args));
        const bundle = await configuredModel(config, "executor", "desktop-child", task, decision);
        print({ ...decision, execution, status: "DESKTOP_EXECUTION_REQUIRED", handoffId: null, handoffPath: null, modelSelection: bundle?.selection ?? null, delegationInvocation: desktopDelegationContract(bundle?.selection ?? null), modelProbe: "not-applicable", nextStep: "Continue in the desktop parent/internal-child workflow. If a real spawn rejects the selected pair, display the next explicit same-backend replacement and record the reason before retrying. Do not prompt for or invoke CLI again for this task." });
        return;
      }
      const config = await loadConfig(configPath(args));
      execution = await respondToCliRecommendation(execution, "accept", {
        inspect: async () => {
          const report = await new CodexExecExecutor(codexOptions(config)).doctor(true);
          return !report.available ? "missing" : !report.authenticated ? "authentication-required" : "ready";
        },
      });
      if (execution.mode === "cli-setup-required") {
        print({ ...decision, execution, status: "CLI_SETUP_REQUIRED", handoffId: null, handoffPath: null, modelSelection: null, modelProbe: "dependency-check-only", nextStep: `Follow ${execution.recommendation?.installGuide}; any installation or configuration change needs its own approval. No task was started.` });
        return;
      }
    } else if (cliResponse) {
      throw new Error("--cli-response is valid only when a full-edition CLI condition is pending.");
    }
    if (decision.route === "chat") {
      print({ ...decision, execution, status: "CHAT_RESPONSE_REQUIRED", handoffId: null, handoffPath: null, modelSelection: null, modelProbe: "not-applicable", nextStep: "The outer ChatGPT/Codex session must answer directly. No execution child or CLI task was created." });
      return;
    }
    if (execution.mode === "desktop-native") {
      const config = await loadConfig(configPath(args));
      const bundle = await configuredModel(config, "executor", "desktop-child", task, decision);
      print({ ...decision, execution, status: "DESKTOP_EXECUTION_REQUIRED", handoffId: null, handoffPath: null, modelSelection: bundle?.selection ?? null, delegationInvocation: desktopDelegationContract(bundle?.selection ?? null), modelProbe: "not-applicable", nextStep: "Create an internal desktop child task with the displayed explicit override (or configured defaults in inherit mode). If a real spawn rejects the pair, display the next explicit same-backend replacement and record the reason before retrying. Return the result to the unchanged parent; no CLI task was created." });
      return;
    }
    const config = await loadConfig(configPath(args));
    const workspace = await resolveSafeWorkspace(runtimeRoot, requestedWorkspace);
    let planned: PlannedHandoff;
    let bundle: SelectedModelBundle | undefined;
    if (args.includes("--no-model-probe")) {
      planned = { handoff: createPendingDispatchHandoff(task, workspace, decision), workspace };
    } else {
      bundle = await configuredModel(config, "planner", "codex-cli", task, decision);
      planned = await new CodexHandoffPlanner(plannerOptions(config, bundle)).plan(task, workspace);
    }
    const handoffPath = await saveHandoff(planned.handoff, runtimeRoot, config.runtime.stateDirectory, flagValue(args, "--out"));
    const gate = evaluateSafetyGate(planned.handoff);
    print({ ...decision, execution, status: "AWAITING_APPROVAL", handoffId: planned.handoff.id, handoffPath, handoff: planned.handoff, safetyGate: gate, modelSelection: bundle?.selection ?? null, modelHealth: bundle?.health ?? [], modelProbe: args.includes("--no-model-probe") ? "skipped-by-explicit-flag" : "completed", nextStep: `Review this exact Handoff, then approve ID ${planned.handoff.id}. Dispatch never executes it.` });
    return;
  }

  if (command === "doctor") {
    const config = await loadConfig(configPath(args));
    const report = await new CodexExecExecutor(codexOptions(config)).doctor(true);
    print(report);
    if (!report.available || !report.authenticated) process.exitCode = 5;
    return;
  }

  if (["status", "logs", "cancel"].includes(command)) {
    const config = await loadConfig(configPath(args));
    const store = new RunStore(resolveStateDirectory(runtimeRoot, config.runtime.stateDirectory));
    const runId = args[1];
    if (command === "status") {
      if (!runId) { print(await store.listRuns()); return; }
      const listing = await store.findRun(runId);
      if (!listing) throw new Error(`Run '${runId}' was not found.`);
      print(listing);
      return;
    }
    if (!runId) throw new Error(`${command} requires a run ID`);
    if (command === "logs") { print(await store.readEvents(runId)); return; }
    print(await store.cancelRun(runId, terminateProcessTree));
    return;
  }

  if (command === "start" || command === "prepare") {
    const task = flagValue(args, "--task");
    const workspace = flagValue(args, "--workspace");
    if (!task) throw new Error("start requires --task <natural-language goal>");
    if (!workspace) throw new Error("start requires --workspace <project-directory>");
    const config = await loadConfig(configPath(args));
    const plannerMode = flagValue(args, "--planner") ?? "auto";
    if (!["auto", "codex", "local"].includes(plannerMode)) {
      throw new Error("--planner must be auto, codex, or local");
    }
    let planned: PlannedHandoff;
    let plannerSource: "codex" | "local-fallback";
    let plannerWarning: string | undefined;
    if (plannerMode === "local") {
      planned = await planLocally(task, workspace, runtimeRoot);
      plannerSource = "local-fallback";
      plannerWarning = "The conservative local Planner was selected explicitly; no model planning call was made.";
    } else {
      try {
        const decision = routeTask(task);
        const bundle = decision.route === "chat" ? undefined : await configuredModel(config, "planner", "codex-cli", task, decision);
        planned = await new CodexHandoffPlanner(plannerOptions(config, bundle)).plan(task, workspace);
        plannerSource = "codex";
      } catch (error) {
        if (plannerMode === "codex") throw error;
        planned = await planLocally(task, workspace, runtimeRoot);
        plannerSource = "local-fallback";
        const message = error instanceof Error ? error.message : String(error);
        plannerWarning = `Connected Codex Planner was unavailable. Used the conservative local fallback. ${message.slice(-500)}`;
      }
    }
    const handoffPath = await saveHandoff(
      planned.handoff,
      runtimeRoot,
      config.runtime.stateDirectory,
      flagValue(args, "--out"),
    );
    const gate = evaluateSafetyGate(planned.handoff);
    print({
      status: gate.outcome === "DENY" ? "DENIED" : "AWAITING_APPROVAL",
      handoffPath,
      plannerSource,
      ...(plannerWarning ? { plannerWarning } : {}),
      handoff: planned.handoff,
      safetyGate: gate,
      nextStep:
        gate.outcome === "DENY"
          ? "Revise the Handoff. A denial cannot be overridden."
          : `After a person approves this exact plan, run execute with --approve-handoff ${planned.handoff.id}. Add only the gate IDs that person explicitly approved.`,
    });
    if (gate.outcome === "DENY") process.exitCode = 2;
    return;
  }

  const handoffPath = args[1];
  if (!handoffPath) throw new Error(`${command} requires a Handoff JSON path`);

  if (command === "validate") {
    const validation = validateHandoff(await readJson(handoffPath));
    print(validation);
    if (!validation.ok) process.exitCode = 1;
    return;
  }

  const handoff = await readHandoff(handoffPath);

  if (command === "execute") {
    const approvedHandoff = flagValue(args, "--approve-handoff");
    if (approvedHandoff !== handoff.id) {
      throw new Error(`Execution requires --approve-handoff ${handoff.id} after a person reviews this exact Handoff.`);
    }
    const config = await loadConfig(configPath(args));
    const decision = routeTask(handoff.objective);
    if (decision.route === "chat") throw new Error("A chat-routed goal cannot start the Codex Executor.");
    const bundle = await configuredModel(config, "executor", "codex-cli", handoff.objective, decision);
    const approvals = [...config.security.approvedGateIds, ...flagValues(args, "--approve")];
    const executor = createExecutor("codex-exec", config, args, bundle);
    const relay = new Relay(executor, new RuleBasedReviewer());
    const runHandle = await new RunStore(resolveStateDirectory(runtimeRoot, config.runtime.stateDirectory)).createRun(handoff);
    const result = await relay.run(handoff, {
      maxIterations: config.relay.maxIterations,
      approvedGateIds: approvals,
      runHandle,
    });
    const finalModelSelection = executor instanceof CodexExecExecutor
      ? executor.finalModelSelection ?? bundle?.selection ?? null
      : bundle?.selection ?? null;
    print({ ...result, executionOwner: "Codex", modelSelection: finalModelSelection });
    if (result.status !== "COMPLETED") process.exitCode = 4;
    return;
  }

  if (command === "gate") {
    const report = evaluateSafetyGate(handoff, flagValues(args, "--approve"));
    print(report);
    if (report.outcome !== "ALLOW") process.exitCode = 2;
    return;
  }

  if (command === "review") {
    const executionPath = args[2];
    if (!executionPath) throw new Error("review requires an executor-result JSON path");
    const executionValidation = validateExecutionResult(await readJson(executionPath));
    if (!executionValidation.ok || !executionValidation.value) {
      throw new Error(`Invalid executor result:\n- ${executionValidation.errors.join("\n- ")}`);
    }
    const review = await new RuleBasedReviewer().review(handoff, executionValidation.value as ExecutionResult, 1);
    print(review);
    if (review.verdict !== "PASS") process.exitCode = 3;
    return;
  }

  if (command === "run") {
    const config = await loadConfig(configPath(args));
    const mode = flagValue(args, "--executor") ?? config.executor.mode;
    if (mode === "codex-exec") throw new Error("Legacy run cannot start real codex-exec. Use execute with the exact --approve-handoff ID.");
    const approvals = [...config.security.approvedGateIds, ...flagValues(args, "--approve")];
    const relay = new Relay(createExecutor(mode, config, args), new RuleBasedReviewer());
    const runHandle = await new RunStore(resolveStateDirectory(runtimeRoot, config.runtime.stateDirectory)).createRun(handoff);
    const result = await relay.run(handoff, {
      maxIterations: config.relay.maxIterations,
      approvedGateIds: approvals,
      runHandle,
    });
    print(result);
    if (!["COMPLETED", "SIMULATED_COMPLETED"].includes(result.status)) process.exitCode = 4;
    return;
  }

  throw new Error(`Unknown command '${command}'.\n\n${usage()}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});

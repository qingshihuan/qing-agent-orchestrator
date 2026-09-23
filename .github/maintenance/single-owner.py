from pathlib import Path
import json, re, subprocess, textwrap

BASE = '1f15789a3a789a4a3833127e0538d6535f9793f1'
subprocess.run(['git', 'merge-base', '--is-ancestor', BASE, 'HEAD'], check=True)

def read(path):
    return Path(path).read_text(encoding='utf-8')
def put(path, content):
    p = Path(path); p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(textwrap.dedent(content).lstrip('\n').encode('utf-8'))
def change(path, old, new):
    s = read(path)
    assert s.count(old) == 1, f'Unexpected source in {path}: {old[:100]}'
    put(path, s.replace(old, new, 1))
def append(path, content):
    put(path, read(path).rstrip() + '\n\n' + textwrap.dedent(content).strip() + '\n')

# Separate the legacy tier projection from actual execution topology. Parallel
# capability, scope width and transport are not independent-review obligations.
p = 'src/orchestration-policy.ts'
s = read(p)
s = re.sub(r'const explicitFull = .*;\n', r'const explicitFull = /(?:启动|使用|采用|进入).{0,10}(?:Level\\s*3|完整(?:版)?\\s*Qing|完整编排|全量编排)|(?:独立|单独)\\s*(?:Reviewer|审查(?:者|代理))|full(?:\\s+qing|\\s+orchestration)|independent\\s+reviewer/i;\n', s, count=1)
s = s.replace(' || input.signals.includes("cli-backend-condition")', '')
s = s.replace('  const decomposable = genuinelyParallel.test(text);', '  const decomposable = false; // Parallel execution is not enabled by a text hint.')
s = re.sub(r'const genuinelyParallel = .*;\n', '', s, count=1)
s = s.replace('  const crossSystem = input.complexity.scope === "cross-system";\n', '')
s = s.replace('input.route === "chat" && !forcedFull && !decomposable', 'input.route === "chat" && !forcedFull && !riskyEffect')
s = s.replace('forcedFull || riskyEffect || crossSystem || decomposable', 'forcedFull || riskyEffect')
s = s.replace('      ...(crossSystem ? ["cross-system-scope"] : []),\n', '')
s = s.replace('      ...(decomposable ? ["genuinely-parallel-work"] : []),\n', '')
s = s.replace('const needsLite = requestedDelegation || delegation.worthwhile;', 'const needsLite = requestedDelegation || delegation.worthwhile || input.signals.includes("cli-backend-condition");')
put(p, s)

put('src/execution-plan.ts', '''
import { assessDelegationBenefit, delegationDeclined, type DelegationEvidence } from "./delegation-benefit.js";
import type { OrchestrationDecision } from "./types.js";

/** Orthogonal topology, verification and authority; this is not a permission grant. */
export function executionPlan(text: string, decision: OrchestrationDecision, signals: readonly string[], evidence?: DelegationEvidence) {
  const explicitWorker = /(?:委派|创建子|使用子|delegate|spawn|Qing\\s*Lite)/i.test(text) && !delegationDeclined(text);
  const transfer = decision.tier === "lite" || signals.includes("cli-backend-condition")
    || (decision.tier === "full" && (explicitWorker || assessDelegationBenefit(text, evidence).worthwhile));
  return {
    version: "single-owner-v1" as const,
    implementationOwner: transfer ? "single-worker" as const : "current-parent" as const,
    verification: decision.independentReviewer ? "independent-review" as const : "acceptance" as const,
    maxActiveImplementationOwners: 1 as const,
    parallelExecutionEnabled: false as const,
    managerModelRequired: false as const,
    nativeManagerRequestLimit: null,
    authority: "host-effective-session" as const,
    grantsPermissions: false as const,
  };
}
''')
change('src/task-router.ts', 'import { randomUUID } from "node:crypto";', 'import { randomUUID } from "node:crypto";\nimport { executionPlan } from "./execution-plan.js";')
change('src/task-router.ts', '  orchestration: OrchestrationDecision;', '  orchestration: OrchestrationDecision;\n  executionPlan: ReturnType<typeof executionPlan>;')
change('src/task-router.ts', '    complexity,\n    orchestration,', '    complexity,\n    orchestration,\n    executionPlan: executionPlan(task, orchestration, signals, options.delegationEvidence),')
change('src/task-router.ts', '目标含高风险、跨系统、真正并行或显式完整编排信号，使用独立 Reviewer 的完整流程。', '真实风险或明确审查要求需要独立验证；执行仍保持单一负责人，不因可并行而增加团队。')

put('src/single-owner-policy.ts', '''
import { routeTask } from "./task-router.js";
import type { Handoff, OrchestrationConfig } from "./types.js";

/** Contract/effect declarations are authoritative even if prose says "offline". */
export function independentReviewReasons(handoff: Handoff, config?: OrchestrationConfig): string[] {
  const reasons: string[] = [];
  if (handoff.orchestration?.independentReviewer) reasons.push("contract-requires-independent-review");
  if (routeTask(handoff.objective, config ? { orchestration: config } : {}).orchestration.independentReviewer) reasons.push("risk-or-explicit-review-requirement");
  for (const op of handoff.requestedOperations) {
    if (op.risk === "high" || op.risk === "critical" || !["read", "write", "execute_tests"].includes(op.type)) {
      reasons.push("operation-requires-independent-review:" + op.type);
    }
  }
  return [...new Set(reasons)];
}
''')

put('src/codex-usage.ts', '''
/** Parse documented exec JSONL turn totals, not private rollout files or bills.
 * A completed turn may contain several model requests. Never label turns as requests.
 */
export function parseCodexUsage(stdout: string) {
  let completedTurns = 0;
  let inputTokens = 0, cachedInputTokens = 0, outputTokens = 0;
  const problems: string[] = [];
  const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  for (const line of stdout.split(/\\r?\\n/).filter(s => s.trim())) {
    let value: any;
    try { value = JSON.parse(line); } catch { problems.push("invalid-jsonl"); continue; }
    if (value?.type === "turn.failed" || value?.type === "error") problems.push("failed-turn-may-have-unreported-usage");
    if (value?.type !== "turn.completed") continue;
    const u = value.usage;
    if (!u || !integer(u.input_tokens) || !integer(u.cached_input_tokens) || !integer(u.output_tokens)
        || u.cached_input_tokens > u.input_tokens
        || (u.reasoning_output_tokens !== undefined && (!integer(u.reasoning_output_tokens) || u.reasoning_output_tokens > u.output_tokens))) {
      problems.push("missing-or-invalid-turn-usage"); continue;
    }
    if (![inputTokens + u.input_tokens, cachedInputTokens + u.cached_input_tokens, outputTokens + u.output_tokens,
          inputTokens + u.input_tokens + outputTokens + u.output_tokens].every(integer)) {
      problems.push("usage-overflow"); continue;
    }
    completedTurns++;
    inputTokens += u.input_tokens; cachedInputTokens += u.cached_input_tokens; outputTokens += u.output_tokens;
  }
  if (!completedTurns) problems.push("no-observed-usage");
  return {
    source: "codex-exec-turn.completed" as const, completedTurns,
    totals: completedTurns ? { inputTokens, cachedInputTokens, outputTokens, totalTokens: inputTokens + outputTokens } : null,
    problems: [...new Set(problems)], modelRequestCount: null, costUsd: null,
    wholeTaskUsageComplete: false as const,
    excluded: ["outer-host-parent", "model-health-preflight", "unreported-failed-requests"],
  };
}
export type CodexUsage = ReturnType<typeof parseCodexUsage>;
''')

# Restrict only this execution invocation; no user config or security widening.
change('src/executors/executor.ts', 'export interface ExecutionContext {', 'export interface ExecutionContext {\n  singleOwner?: boolean;\n  onUsageSnapshot?: (usage: import("../codex-usage.js").CodexUsage) => void;')
change('src/executors/codex-exec-executor.ts', 'import { mkdtemp, readFile, realpath, rm }', 'import { parseCodexUsage } from "../codex-usage.js";\nimport { mkdtemp, readFile, realpath, rm }')
change('src/executors/codex-exec-executor.ts', '"You are the Executor in the Qing Agent Orchestrator workflow.",', 'context.singleOwner ? "You are the sole implementation owner. Complete the WHOLE task, debug it and run its tests. Do not delegate, spawn agents, re-enter Qing, or create a management workflow." : "You are the Executor in the Qing Agent Orchestrator workflow.",')
change('src/executors/codex-exec-executor.ts', '        args.push("-");', '        if (context.singleOwner) args.push("-c", "features.multi_agent=false");\n        args.push("-");')
change('src/executors/codex-exec-executor.ts', '        if (result.exitCode !== 0 || result.spawnError || result.timedOut || result.outputLimitExceeded || result.cancelled) {', '        context.onUsageSnapshot?.(parseCodexUsage(result.stdout));\n        if (result.exitCode !== 0 || result.spawnError || result.timedOut || result.outputLimitExceeded || result.cancelled) {\n          if (context.singleOwner) return failedResult(processFailure("Single-owner execution stopped; no automatic model ladder", result), this.activeModelSelection?.fallbackAudit ?? null);')

put('src/workspace-lease.ts', '''
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Cooperating single-owner runs share a machine/user lease, independent of RunStore.
 * This is NOT a filesystem sandbox. Never automatically reap a crash/stale lease.
 */
export async function acquireWorkspaceLease(workspace: string) {
  const canonical = await realpath(workspace);
  const uid = process.getuid?.();
  const root = join(tmpdir(), "qing-owner-leases-" + (uid ?? "user"));
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (uid !== undefined && rootStat.uid !== uid)) throw new Error("Unsafe workspace lease root.");
  const key = process.platform === "win32" ? canonical.toLowerCase() : canonical;
  const directory = join(root, createHash("sha256").update(key).digest("hex"));
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("WORKSPACE_BUSY: a single-owner run or unreconciled lease already exists. Confirm the old process tree stopped; do not steal its lease.");
    throw error;
  }
  const nonce = randomUUID();
  const file = join(directory, "owner.json");
  try { await writeFile(file, JSON.stringify({ nonce, pid: process.pid, workspace: canonical }), { flag: "wx", mode: 0o600 }); }
  catch (error) { await rmdir(directory).catch(() => undefined); throw error; }
  let released = false;
  return {
    directory,
    async release() {
      if (released) return;
      if (JSON.parse(await readFile(file, "utf8")).nonce !== nonce) throw new Error("Workspace lease ownership changed; refusing to remove it.");
      await unlink(file); await rmdir(directory); released = true;
    },
  };
}
''')

put('src/protected-inputs.ts', '''
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export async function protectedInputSnapshot(workspace: string, paths: readonly string[]) {
  if (!paths.length || new Set(paths).size !== paths.length) throw new Error("Provide unique --protect paths for the immutable specification and acceptance files.");
  const root = await realpath(workspace);
  const entries: Record<string, string> = {};
  for (const path of paths) {
    if (!path || isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.split(/[\\\\/]/).includes("..")) throw new Error("Protected inputs must be project-relative files.");
    const absolute = resolve(root, path);
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Protected input must be a regular file: " + path);
    const canonical = await realpath(absolute);
    const rel = relative(root, canonical);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Protected input escaped the workspace.");
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(canonical)) digest.update(chunk);
    entries[path] = digest.digest("hex");
  }
  return entries;
}
''')

# Reuse the tested Relay acceptance, cancellation, Git audit and evidence plumbing.
# Do not duplicate them in an unchecked new runner or call a model for verification.
change('src/relay.ts', 'import type { Executor }', 'import { independentReviewReasons } from "./single-owner-policy.js";\nimport type { Executor }')
change('src/relay.ts', '  orchestrationConfig?: OrchestrationConfig;\n}', '  orchestrationConfig?: OrchestrationConfig;\n  controllerMode?: "single-owner";\n  verifyImmutableInputs?: () => Promise<string[]>;\n}')
change('src/relay.ts', '    const phaseEnforcementEnabled = handoff.metadata?.orchestrationPolicyVersion === "0.8";', '''    const singleOwner = options.controllerMode === "single-owner";
    if (singleOwner && (!runHandle || independentReviewReasons(handoff, options.orchestrationConfig).length > 0)) {
      throw new Error("Single-owner deterministic acceptance cannot discharge independent review or run without durable evidence.");
    }
    const phaseEnforcementEnabled = !singleOwner && handoff.metadata?.orchestrationPolicyVersion === "0.8";''')
change('src/relay.ts', 'const maxIterations = Math.max(1, Math.min(5, handoff.maxIterations, options.maxIterations));', 'const maxIterations = singleOwner ? 1 : Math.max(1, Math.min(5, handoff.maxIterations, options.maxIterations));')
change('src/relay.ts', '      const executionPhase = await classifyRemainingPhase(', '      const executionPhase = await classifyRemainingPhase(') # structural guard
change('src/relay.ts', '      await Promise.all(observabilityWrites);\n      if (this.executor.name', '''      await Promise.all(observabilityWrites);
      if (runHandle && await runHandle.isCancelled()) {
        return { handoffId: handoff.id, executor: this.executor.name, status: "BLOCKED", preflightGate, attempts, phaseDecisions, message: "Cancelled; no acceptance or further execution was started." };
      }
      if (singleOwner && execution.status !== "succeeded") {
        if (runHandle) {
          await runHandle.writeExecutorResult(execution, iteration);
          await runHandle.finalize("blocked", "blocked", iteration, "failed", "Single owner failed; no retry or manager model was invoked.");
        }
        return { handoffId: handoff.id, executor: this.executor.name, status: "BLOCKED", preflightGate, attempts, phaseDecisions, message: "Single owner failed. Artifacts retained; no automatic retry, reviewer or model substitution." };
      }
      if (this.executor.name''')
change('src/relay.ts', '      if (gitAudit?.requiresHumanReview) {', '''      const immutableErrors = await options.verifyImmutableInputs?.() ?? [];
      if (immutableErrors.length) {
        review = { ...review, verdict: "HUMAN_REVIEW", summary: "Protected inputs changed or became unreadable.",
          findings: [...review.findings, ...immutableErrors.map(message => ({ severity: "blocker" as const, message }))] };
      }
      if (gitAudit?.requiresHumanReview) {''')
change('src/relay.ts', '      phaseState = recordIndependentReviewOutcome(phaseState, review.verdict);', '      if (!singleOwner) phaseState = recordIndependentReviewOutcome(phaseState, review.verdict);')
change('src/relay.ts', 'if (runHandle) await runHandle.appendEvent("orchestration.review.outcome"', 'if (runHandle && !singleOwner) await runHandle.appendEvent("orchestration.review.outcome"')
change('src/relay.ts', '        await runHandle.appendEvent("review.completed", "reviewing", iteration, "Reviewer completed the iteration.", { verdict: review.verdict });', '        await runHandle.appendEvent(singleOwner ? "acceptance.completed" : "review.completed", "reviewing", iteration, singleOwner ? "Deterministic acceptance completed; not an independent review." : "Reviewer completed the iteration.", { verdict: review.verdict });')

put('src/single-owner-controller.ts', '''
import { Relay, type RelayOptions } from "./relay.js";
import { RuleBasedReviewer } from "./reviewer.js";
import { validateHandoff } from "./validation.js";
import { independentReviewReasons } from "./single-owner-policy.js";
import { acquireWorkspaceLease } from "./workspace-lease.js";
import { protectedInputSnapshot } from "./protected-inputs.js";
import { legacyV07HandoffFingerprint } from "./orchestration-policy.js";
import type { Executor } from "./executors/executor.js";
import type { Handoff } from "./types.js";
import type { CodexUsage } from "./codex-usage.js";

export class SingleOwnerController {
  private consumed = false;
  constructor(private readonly executor: Executor) {}

  async run(handoff: Handoff, options: RelayOptions & { protectedPaths: string[] }) {
    if (this.consumed) throw new Error("SingleOwnerController cannot be restarted to reset its invocation budget.");
    this.consumed = true;
    const valid = validateHandoff(handoff);
    if (!valid.ok) throw new Error("Invalid single-owner Handoff: " + valid.errors.join("; "));
    if (!options.runHandle || this.executor.name !== "codex-exec") throw new Error("Single owner requires the audited Codex adapter and durable RunHandle.");
    if (independentReviewReasons(handoff, options.orchestrationConfig).length) throw new Error("INDEPENDENT_REVIEW_REQUIRED: deterministic tests do not replace the required source review.");
    if (!handoff.testPlan.length) throw new Error("Single-owner acceptance requires concrete testPlan commands.");
    if (handoff.testPlan.some(command => /Discover and run/.test(command))) throw new Error("Refine placeholder testPlan before execution.");
    const lease = await acquireWorkspaceLease(handoff.workspace.root);
    let live = false;
    let invocations = 0;
    let usage: CodexUsage | null = null;
    const run = options.runHandle;
    try {
      const before = await protectedInputSnapshot(handoff.workspace.root, options.protectedPaths);
      await run.appendEvent("controller.contract", "preflight", 0, "Single implementation owner; no manager model.", {
        fingerprint: legacyV07HandoffFingerprint(handoff), protectedInputs: before,
        node: process.version, platform: process.platform, managerModelCalls: 0, maxExecutorInvocations: 1,
      });
      const bounded: Executor = {
        name: this.executor.name,
        execute: async (value, context) => {
          if (++invocations > 1) throw new Error("Single-owner invocation budget exhausted.");
          return this.executor.execute(value, {
            ...context, singleOwner: true,
            onUsageSnapshot: value => { usage = value; },
            onProcessStart: metadata => { live = true; context.onProcessStart?.(metadata); },
            onProcessExit: metadata => { live = false; context.onProcessExit?.(metadata); },
          });
        },
      };
      const result = await new Relay(bounded, new RuleBasedReviewer()).run(handoff, {
        ...options, maxIterations: 1, controllerMode: "single-owner",
        verifyImmutableInputs: async () => {
          try {
            const after = await protectedInputSnapshot(handoff.workspace.root, options.protectedPaths);
            return Object.keys(before).filter(path => before[path] !== after[path]).map(path => "Protected input changed: " + path);
          } catch { return ["Protected inputs could not be verified."]; }
        },
      });
      const controller = {
        mode: "single-owner" as const, managerModelCalls: 0, executorInvocations: invocations,
        automaticRetries: 0, independentReviewPerformed: false, verification: "deterministic-acceptance",
        usage, wholeTaskCostUsd: null, wholeTaskModelRequestCount: null,
      };
      await run.appendEvent("controller.completed", result.status === "COMPLETED" ? "completed" : "blocked", invocations, "Single-owner controller terminated.", controller);
      return { ...result, controller };
    } finally {
      // A thrown/abandoned adapter with an unobserved exit must retain the lease.
      // A new process cannot claim ownership merely because the parent disappeared.
      if (!live) await lease.release();
    }
  }
}
''')

# Wire a real programmatic entry point. Do not manufacture a connected Planner
# or interpret a native permission record as a standalone process grant.
change('src/cli.ts', 'import { Relay }', 'import { SingleOwnerController } from "./single-owner-controller.js";\nimport { independentReviewReasons } from "./single-owner-policy.js";\nimport { Relay }')
change('src/cli.ts', '    permissionHandling: source.permissionHandling ?? null,', '    permissionHandling: source.permissionHandling ?? null,\n    executionPlan: source.executionPlan ?? null,')
change('src/cli.ts', '  if (backend === "desktop-child") {', '  if (backend === "desktop-child" && role === "executor" && decision.executionPlan.implementationOwner === "current-parent") return undefined;\n  if (backend === "desktop-child") {')
change('src/cli.ts', 'delegationInvocation: desktopDelegationContract(bundle?.selection ?? null), reviewerInvocation:', 'delegationInvocation: decision.executionPlan.implementationOwner === "current-parent" ? null : desktopDelegationContract(bundle?.selection ?? null), reviewerInvocation:')
change('src/cli.ts', 'const plannerMode = flagValue(args, "--planner") ?? "auto";', 'const plannerMode = flagValue(args, "--planner") ?? "local";')
# Replace the implicit connected planning block in process dispatch with a local scaffold.
old = '''    if (args.includes("--no-model-probe")) {
      planned = { handoff: createPendingDispatchHandoff(task, workspace, decision), workspace };
    } else {
      bundle = await configuredModel(config, "planner", "codex-cli", task, decision);
      planned = await new CodexHandoffPlanner(plannerOptions(config, bundle)).plan(task, workspace);
    }'''
change('src/cli.ts', old, '''    planned = { handoff: createPendingDispatchHandoff(task, workspace, decision), workspace };
    // This is a scaffold, not a runnable acceptance contract; no paid Planner.
''')
change('src/cli.ts', 'modelProbe: args.includes("--no-model-probe") ? "skipped-by-explicit-flag" : "completed", nextStep:', 'modelProbe: "not-started", contractStatus: "needs-concrete-acceptance", nextStep:')
change('src/cli.ts', '"The safe Handoff is ready without plan approval. Dispatch still never executes it."', '"Refine exact paths and concrete testPlan; this local scaffold does not prove completion. Use execute-single with protected inputs only when independent review is not required. No model Planner was invoked."')
change('src/cli.ts', '  if (command === "execute") {', '''  if (command === "execute-single") {
    const config = await loadConfig(configPath(args));
    const protectedPaths = flagValues(args, "--protect");
    if (!protectedPaths.length) throw new Error("execute-single requires --protect for immutable specification/acceptance inputs.");
    if (!config.executor.codexExec.enabled || !args.includes("--allow-real-execution")) throw new Error("Real Codex execution requires enabled config and --allow-real-execution.");
    const approvals = [...config.security.approvedGateIds, ...flagValues(args, "--approve")];
    const gate = evaluateSafetyGate(handoff, approvals);
    if (gate.outcome !== "ALLOW") throw new Error("Single-owner execution is blocked by the existing effect gate: " + gate.outcome);
    const reasons = independentReviewReasons(handoff, config.orchestration);
    if (reasons.length) {
      print({ status: "INDEPENDENT_REVIEW_REQUIRED", reasons, managerModelCalls: 0, executorInvocations: 0, grantsPermissions: false });
      process.exitCode = 4; return;
    }
    if (!handoff.testPlan.length || handoff.testPlan.some(c => /Discover and run/.test(c))) throw new Error("Concrete acceptance commands are required; a local planning scaffold is not executable.");
    const workspace = await resolveSafeWorkspace(runtimeRoot, handoff.workspace.root);
    handoff.workspace.root = workspace;
    const decision = routeTask(handoff.objective, { orchestration: config.orchestration });
    const limits = resolveExecutableOrchestrationLimits(handoff, decision.orchestration, config.orchestration, config.relay.maxIterations);
    // Selecting the explicitly requested standalone worker does not create a manager.
    const selectionDecision = { ...decision, route: decision.route === "chat" ? "codex" as const : decision.route,
      orchestration: { ...decision.orchestration, childAgentBudget: 1, modelSelectionRequired: true } };
    const bundle = await configuredModel(config, "executor", "codex-cli", handoff.objective, selectionDecision);
    const executor = createExecutor("codex-exec", config, args, bundle);
    const runHandle = await new RunStore(resolveStateDirectory(runtimeRoot, config.runtime.stateDirectory)).createRun(handoff);
    const result = await new SingleOwnerController(executor).run(handoff, {
      maxIterations: limits.maxIterations, approvedGateIds: approvals, runHandle,
      orchestrationConfig: config.orchestration, protectedPaths,
    });
    print({ ...result, executionOwner: "Codex", modelSelection: bundle?.selection ?? null });
    if (result.status !== "COMPLETED") process.exitCode = 4;
    return;
  }

  if (command === "execute") {''')
change('src/cli.ts', '    "  validate <handoff.json>",', '    "  execute-single <handoff.json> --protect <spec-file> --protect <acceptance-file> --allow-real-execution [--config <file>]",
    "       experimental: one complete worker, no manager model/retry ladder; deterministic acceptance is not independent review",
    "  validate <handoff.json>",')

# Native instruction adapter: this cannot hard-limit the host's own request loop.
for name in ['qing-agent-orchestrator', 'qing-agent-orchestrator-full']:
    prefix = 'runtime/' if name.endswith('-full') else ''
    skill = f'''---
name: {name}
description: Select one complete task owner without adding a management team; preserve acceptance and effective host authority.
---

# Qing — single owner (experimental)

Qing decides Direct/Lite/Full; these are compatibility labels, not a team template. Read the task and do useful work immediately. For Direct, do not preload references or schemas, call dispatch/start/doctor/models, or emit a routing-only reply. The existing capable parent stays the sole worker unless whole-task transfer has a demonstrated benefit. Multiple files, offline transaction/money logic, CLI transport, cross-module scope and possible parallelism alone never require Full or a Reviewer. Never run an estimator model to choose the route.

If transferring, hand the WHOLE implementation, debugging and required tests to one worker. Send the original objective, scoped inputs and immutable acceptance once. Do not keep half the implementation, spawn a manager, re-enter Qing, read live transcripts or poll unchanged progress. Wait for the terminal result or a real blocker; then verify once. Native parent calls still cost tokens; this skill cannot enforce a host request cap. See only [Single-owner execution](references/orchestrator-spec.md) when transferring.

Independent review is a separate obligation for actual consequential effects, explicit review requirements or pending independent-review obligations, not an agent-count tax. One implementation owner may be the parent plus a read-only independent Reviewer. Use [Handoff](references/handoff-protocol.md), [Reviewer](references/reviewer-rules.md), [Handoff schema]({prefix}schemas/handoff.schema.json) and [Review schema]({prefix}schemas/review.schema.json) only when required. Never skip required review or verification. Tests are not independent source review. Preserve the same unchanged inputs, commands and environment when reusing evidence; changed or untrusted evidence needs revalidation.

Use effective host permissions and exact scope, not a second Qing approval system. on-request uses the host; never means no new permission prompt, not unrestricted access. Denied/unknown access stops affected work; no forged grants, security changes or backend bypass. Read [safety-gates.md](references/safety-gates.md) for real consequential effects. Preserve unrelated work. Report actual results, verification, limits, executionOwner and actual model substitutions; never report a plan or mock as completion.
'''
    if name.endswith('-full'):
        skill += '\nOptional process execution: only for an actual process/CI/persistence requirement and existing authority. Use [process guide](references/codex-exec.md). execute-single runs one complete worker with programmatic acceptance; high-risk review needs stop separately. No API key, installation or config change is authorized by routing.\n'
    put('.agents/skills/'+name+'/SKILL.md', skill)
    put('.agents/skills/'+name+'/references/orchestrator-spec.md', '''
# Single-owner execution

Topology, verification and authority are independent decisions. Default: current capable parent does the complete work. Whole-task transfer is justified only by a fixed complete contract, acceptance and an established useful alternative; unknown economics stays with the current owner. Safe parallel/cross-system wording alone cannot create Full. Parallel implementation is disabled by default pending matched performance evidence.

For transfer, send one worker the original task, relevant paths, immutable specs/tests and exact commands. It owns implementation and debugging through terminal return. Parent does not implement another half or consume progress transcripts. No nested team. On terminal success, independently check the diff and required acceptance; do not repeat an unchanged full suite merely to produce another transcript. On a real defect choose one bounded repair/takeover only after the old owner stopped; do not overlap writes or walk a model ladder. Existing revision limits remain upper bounds, not mandatory rounds.

Model policy remains GPT-6-only: gpt-6-luna, gpt-6-sol, gpt-6-astra. Luna/medium can own well-bounded ordinary tasks; Sol/high or Astra/high may own demanding tasks. Use the actual host-advertised pair; keep current parent unchanged. Astra is reserved for demanding whole-task execution or a justified takeover, never a standing team manager. Do not infer a speed advantage from token price or lower high-risk review quality for cost.

Actual high-risk/external operations, explicit independent review and unresolved review obligations require independent source review. Local multi-file code, Decimal arithmetic and offline transaction simulations do not by themselves establish real production/financial effects. Declared consequential operations override reassuring prose. Keep pending independent-review obligations through any Direct/Lite repair phase. Do not claim tests or RuleBasedReviewer discharge an independent review.

Compatibility tiers: Direct=current owner+acceptance; Lite=one whole worker+acceptance; Full=required independent review, with only one implementation owner. Full defaults remain ceilings of two children and one revision. Legacy explicitly configured Full and schema contracts remain respected. Host grants and exact user authorization—not tiers—control side effects. Standalone Relay has no trusted native permission bridge.

Native execution only has instruction-level limits: target one transfer and one final collection, no progress wakes. There is no claimed hard three-request cap. The experimental execute-single adapter controls its own loop: one executor invocation, no manager model, no automatic retries, no independent-review substitution. Its workspace lease coordinates equal canonical workspaces, not arbitrary shells, overlapping subdirectories or machines. See the process guide in the full edition for limitations.
''')
    # Remove contradictory active guidance, but leave historical release notes intact.
    path='.agents/skills/'+name+'/references/reviewer-rules.md'
    text=read(path).replace('cross-system effects, material ambiguity, or genuinely independent workstreams', 'actual consequential effects or an explicit independent-review requirement')
    text=text.replace('Escalate to Full only if evidence reveals high risk, ', 'Escalate to Full only if evidence reveals high risk, ')
    put(path,text)
    path='.agents/skills/'+name+'/agents/openai.yaml'
    text=read(path).replace('桌面内自适应 Direct、Lite、Full，并只审批高风险效果','单执行者完成完整任务，审查与权限独立判断')
    put(path,text)
append('.agents/skills/qing-agent-orchestrator-full/references/codex-exec.md', '''
## Experimental single-owner path
`node runtime/dist/src/cli.js execute-single task.json --protect SPEC.md --protect test_acceptance.py --config runtime/config/relay.user.json --allow-real-execution`
Requires enabled configured Codex, existing effect grants, a concrete validated Handoff/testPlan and an auditable Git workspace. It does not run a Planner. One worker completes the entire task; multi-agent tools are disabled for that invocation via `-c features.multi_agent=false`. The controller waits without model callbacks, runs the existing trusted acceptance/Git audits, verifies immutable-input SHA-256 and returns once. No automatic invocation retry or runtime fallback ladder. Normal worker-internal debugging remains possible.
An independent-review obligation returns INDEPENDENT_REVIEW_REQUIRED before execution; RuleBasedReviewer is only deterministic acceptance. A lease prevents concurrent cooperating single-owner runs of the same canonical workspace; crash leases are NOT automatically stolen. Confirm all old processes stopped before manual recovery. Other native/legacy tools are outside that lock. Existing sandbox/permissions are never expanded.
Usage reports only observed exec turn totals, not model-request counts. Missing/failed/preflight/outer-parent usage is marked incomplete; cost stays null. This is not a hard total-token or spend cap. Native parent request limits remain advisory, and actual account/CLI integration and speed/cost benefits need connected verification. The stable release remains v0.13 until that gate passes.
''')

# Development version is intentionally not a new stable performance release.
version='0.14.0-dev.1'
package=json.loads(read('package.json')); package['version']=version
package['scripts']['test']+=' dist/tests/single-owner.test.js'
put('package.json',json.dumps(package,ensure_ascii=False,indent=2)+'\n')
lock=json.loads(read('package-lock.json')); lock['version']=lock['packages']['']['version']=version
put('package-lock.json',json.dumps(lock,ensure_ascii=False,indent=2)+'\n')

put('docs/single-owner.md', '''
# Single-owner architecture — experimental, not a measured optimization claim

The v0.13 controlled retest did not achieve the efficiency target. This change removes the topology/review coupling and adds actual program-controlled single-worker execution instead of only shortening instructions. No uploaded reports, task IDs, local paths, implementations or session traces are published here.

## Implemented boundaries
- Native default is one complete implementation owner. Parallel capability, cross-module scope and CLI transport alone no longer mandate Full/review. Real consequential effects and explicit/pending independent review remain mandatory.
- executionPlan exposes implementationOwner, verification and non-granting authority separately. For Full native work the existing parent may implement; only the Reviewer is delegated when whole-task transfer is not justified.
- execute-single uses a concrete Handoff directly. Existing opt-in, effect gate, model-catalog/health, sandbox and workspace checks still apply. No Planner/manager LLM, one worker invocation, no automatic retry/model ladder; worker collaboration tools disabled for that invocation. All waiting and acceptance run in program code.
- Acceptance reuses the existing Relay test evidence and Git audit, plus immutable input SHA-256. Tests do not stand in for source review: the new controller refuses independently reviewed work before starting, rather than inventing a reviewer.
- Same-workspace cooperating runs share an exclusive lease. Cancellation/unknown exit cannot grant ownership to a new process. A lease is not a sandbox, cannot constrain native/legacy tasks, and does not cover overlapping roots or another machine. Crash recovery is manual and fails closed.
- Observed exec turn usage is reported with explicit coverage gaps. A turn is not an API request; no exact bills, aggregate preflight/host usage or spend cap are invented. Native host manager limits are advisory, not enforced by SKILL.md.

## Rollout
Source version 0.14.0-dev.1 and regenerated repository ZIPs are a frozen experimental candidate. The stable v0.13 Release is not replaced. A new stable release requires a separate connected experiment using identical frozen tasks/acceptance and recorded models/efforts/cache conditions. Main CI proves software behavior, not token/time savings.

Compare solo Astra, single-owner Astra (routing tax), whole-task selected model and that same model solo; keep FIRST skill loading as a separate strict-compatibility track. Count all parent/worker/preflight/retry usage and failures; isolate controller costs. The proposed 20% speed/cost improvement and nonincreasing tokens are acceptance targets, not results. No automatic model downshift is justified by unverified unit prices.

Official adapter contracts checked 2026-09-23: https://learn.chatgpt.com/docs/non-interactive-mode and https://learn.chatgpt.com/docs/config-file/config-reference (JSONL turn.completed usage and features.multi_agent). Runtime support is checked by the existing CLI preflight; current-account integration is not established by mocked adapter tests.
''')
for path in ['README.md','README.en.md']:
    s=read(path)
    first,rest=s.split('\n',1)
    put(path,first+'\n\n## Experimental single-owner architecture (0.14.0-dev.1)\n\n单执行者完成完整任务；执行拓扑、独立审查、权限分别判断。新增程序化 execute-single，不增加常驻管理模型。源码与仓库 ZIP 是待实测候选，稳定 Release 保持 v0.13.0；没有已实现的速度/费用节省比例。 See [architecture and limits](docs/single-owner.md).\n\n'+rest)
for path in ['docs/architecture.md','docs/editions.md','docs/codex-integration.md']:
    put(path,'# Current experimental architecture\n\nThe single-owner rules in [single-owner.md](single-owner.md) supersede the historical topology/review coupling below. Parallel capability, cross-module scope and transport alone no longer mandate an independent Reviewer. Native instructions and execute-single have different enforcement boundaries; the latter is optional and requires existing authority. Stable Release remains v0.13.0 until connected verification.\n\n## Historical design below (superseded where noted)\n\n'+read(path))
append('CHANGELOG.md','''
## 0.14.0-dev.1 - 2026-09-23

Unreleased experimental architecture: separate execution topology, verification and authority; one complete task owner; code-controlled single worker and immutable acceptance, cooperative workspace leases and coverage-qualified usage. No new stable Release or measured speed/cost claim. See docs/single-owner.md.
''')

# Tests assert behavior, not merely the new wording. Reclassify expected topology
# cases while retaining real-effect/denial/review contract tests.
put('tests/single-owner.test.ts', '''
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { routeTask } from "../src/task-router.js";
import { independentReviewReasons } from "../src/single-owner-policy.js";
import { acquireWorkspaceLease } from "../src/workspace-lease.js";
import { protectedInputSnapshot } from "../src/protected-inputs.js";
import { parseCodexUsage } from "../src/codex-usage.js";
import { SingleOwnerController } from "../src/single-owner-controller.js";
import { RunStore } from "../src/run-store.js";
import type { Executor } from "../src/executors/executor.js";
import type { Handoff, ExecutionResult } from "../src/types.js";

async function fixture(run: (root: string, handoff: Handoff) => Promise<void>) {
  const root=await mkdtemp(join(tmpdir(),"qing-single-test-"));
  const workspace=join(root,"work"); await mkdir(workspace);
  await writeFile(join(workspace,"SPEC.md"),"Write result.txt with ok. No external effects.");
  await writeFile(join(workspace,"acceptance.cjs"),'require("node:assert/strict").equal(require("node:fs").readFileSync("result.txt","utf8"),"ok");');
  await writeFile(join(workspace,"result.txt"),"before");
  const git=(...args:string[])=>execFileSync("git",args,{cwd:workspace,stdio:"pipe"});
  git("init","-q"); git("add","."); git("-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","-qm","baseline");
  const handoff: Handoff={version:"1.0",id:"single-test",title:"Local fixture",objective:"实现本地结果文件并验证",category:"code_change",
    workspace:{root:workspace,allowedPaths:["result.txt"]},inputs:[],constraints:["Preserve SPEC.md and acceptance.cjs"],
    acceptanceCriteria:[{id:"ac",description:"result correct",verification:"node acceptance.cjs",verificationOwner:"executor"}],
    requestedOperations:[{type:"write",target:"result.txt",reason:"Produce declared file",risk:"low"},{type:"execute_tests",target:"node acceptance.cjs",reason:"Verify local file",risk:"low"}],
    deliverables:[{path:"result.txt",description:"result"}],testPlan:["node acceptance.cjs"],maxIterations:2};
  try { await run(root,handoff); } finally { await rm(root,{recursive:true,force:true}); }
}
function result(handoff:Handoff):ExecutionResult {
  return {status:"succeeded",summary:"Fixture only",artifacts:handoff.deliverables,criteriaEvidence:[{id:"ac",status:"pass",evidence:"fixture"}],tests:handoff.testPlan.map(command=>({command,status:"passed" as const,evidence:"fixture"})),proposedOperations:[],simulated:false};
}
const protectedPaths=["SPEC.md","acceptance.cjs"];

test("parallel/cross-module/transport hints never create an independent review obligation",()=>{
  for(const task of ["并行处理多个独立工作流","同时修改前后端和数据库服务","使用 CLI 实现本地工具","实现离线四模块事务与金额模拟器，不部署、不推送"]){
    const decision=routeTask(task);
    assert.notEqual(decision.orchestration.tier,"full",task);
    assert.equal(decision.executionPlan.verification,"acceptance");
    assert.equal(decision.executionPlan.parallelExecutionEnabled,false);
    assert.equal(decision.executionPlan.maxActiveImplementationOwners,1);
  }
});
test("real effects and explicit review still require independent verification, not another implementer",()=>{
  for(const task of ["部署到生产环境","推送到 origin/main","独立 Reviewer 审查修复","使用完整 Qing 实现功能"]){
    const d=routeTask(task); assert.equal(d.orchestration.independentReviewer,true,task);
    assert.equal(d.executionPlan.verification,"independent-review");
    assert.equal(d.executionPlan.implementationOwner,"current-parent");
    assert.equal(d.executionPlan.grantsPermissions,false);
  }
});
test("ordinary direct and explicitly transferred tasks retain a single task owner",()=>{
  assert.equal(routeTask("修复本地函数").executionPlan.implementationOwner,"current-parent");
  assert.equal(routeTask("使用 Qing Lite 实现完整模块").executionPlan.implementationOwner,"single-worker");
});
test("declared high-risk contract cannot be erased by offline prose",async()=>{
  await fixture(async(_root,h)=>{
    assert.deepEqual(independentReviewReasons(h),[]);
    assert.ok(independentReviewReasons({...h,orchestration:{tier:"full",childAgentBudget:2,independentReviewer:true,maxRevisions:1}}).length);
    assert.ok(independentReviewReasons({...h,requestedOperations:[{type:"production_deploy",target:"prod",reason:"test",risk:"high"}]}).length);
  });
});
test("workspace lease blocks concurrent acquisition and releases only its own ownership",async()=>{
  const root=await mkdtemp(join(tmpdir(),"qing-lease-test-"));
  try { const lease=await acquireWorkspaceLease(root); await assert.rejects(acquireWorkspaceLease(root),/WORKSPACE_BUSY/); await lease.release(); await lease.release(); const next=await acquireWorkspaceLease(root); await next.release(); }
  finally { await rm(root,{recursive:true,force:true}); }
});
test("workspace lease canonicalizes aliases without treating RunStore as the lock boundary",async()=>{
  const root=await mkdtemp(join(tmpdir(),"qing-lease-alias-"));
  try { await mkdir(join(root,"actual")); await symlink(join(root,"actual"),join(root,"alias"),process.platform==="win32"?"junction":"dir"); const lease=await acquireWorkspaceLease(join(root,"actual")); try { await assert.rejects(acquireWorkspaceLease(join(root,"alias")),/WORKSPACE_BUSY/); }finally{await lease.release();} }
  finally{await rm(root,{recursive:true,force:true});}
});
test("immutable inputs reject traversal, missing files and symlinks",async()=>{
  await fixture(async(_root,h)=>{
    const before=await protectedInputSnapshot(h.workspace.root,protectedPaths); assert.match(before["SPEC.md"]!,/^[0-9a-f]{64}$/);
    for(const paths of [[],["../outside"],["SPEC.md","SPEC.md"],["missing"]]) await assert.rejects(protectedInputSnapshot(h.workspace.root,paths));
  });
});
test("turn usage preserves subset arithmetic and never claims request counts or a complete bill",()=>{
  const u=parseCodexUsage(JSON.stringify({type:"turn.completed",usage:{input_tokens:100,cached_input_tokens:80,output_tokens:30,reasoning_output_tokens:20}}));
  assert.deepEqual(u.totals,{inputTokens:100,cachedInputTokens:80,outputTokens:30,totalTokens:130});
  assert.equal(u.modelRequestCount,null); assert.equal(u.costUsd,null); assert.equal(u.wholeTaskUsageComplete,false);
});
test("missing, malformed and failed usage remain explicitly unknown rather than zero",()=>{
  for(const stream of ["",'{"type":"turn.completed"}','bad-json',JSON.stringify({type:"turn.completed",usage:{input_tokens:10,cached_input_tokens:20,output_tokens:0}})]){const u=parseCodexUsage(stream);assert.equal(u.totals,null);assert.ok(u.problems.length);}
  const u=parseCodexUsage('{"type":"turn.failed"}');assert.ok(u.problems.includes("failed-turn-may-have-unreported-usage"));
});
test("single-owner controller runs one implementation and real acceptance without a manager",async()=>{
  await fixture(async(root,h)=>{
    let calls=0;
    const executor:Executor={name:"codex-exec",async execute(value,context){calls++; assert.equal(context.singleOwner,true); await writeFile(join(value.workspace.root,"result.txt"),"ok"); return result(value);}};
    const handle=await new RunStore(join(root,"state")).createRun(h);
    const controller=new SingleOwnerController(executor);
    const output=await controller.run(h,{maxIterations:2,approvedGateIds:[],runHandle:handle,protectedPaths});
    assert.equal(output.status,"COMPLETED",JSON.stringify(output)); assert.equal(calls,1);
    assert.equal(output.controller.managerModelCalls,0); assert.equal(output.controller.executorInvocations,1); assert.equal(output.controller.independentReviewPerformed,false);
    assert.equal((await handle.readTestEvidence(1)).length,1);
    await assert.rejects(controller.run(h,{maxIterations:2,approvedGateIds:[],runHandle:handle,protectedPaths}),/cannot be restarted/);
  });
});
test("changed protected acceptance never becomes success even if the worker self-reports pass",async()=>{
  await fixture(async(root,h)=>{
    const executor:Executor={name:"codex-exec",async execute(value){await writeFile(join(value.workspace.root,"result.txt"),"ok");await writeFile(join(value.workspace.root,"acceptance.cjs"),"// forged pass");return result(value);}};
    const handle=await new RunStore(join(root,"state")).createRun(h);
    const out=await new SingleOwnerController(executor).run(h,{maxIterations:2,approvedGateIds:[],runHandle:handle,protectedPaths});
    assert.equal(out.status,"BLOCKED"); assert.equal(out.attempts[0]?.review.verdict,"HUMAN_REVIEW");
  });
});
test("a failed real acceptance stops after one invocation, not an automatic agent ladder",async()=>{
  await fixture(async(root,h)=>{
    let calls=0; const executor:Executor={name:"codex-exec",async execute(value){calls++;return result(value);}};
    const handle=await new RunStore(join(root,"state")).createRun(h);
    const out=await new SingleOwnerController(executor).run(h,{maxIterations:5,approvedGateIds:[],runHandle:handle,protectedPaths});
    assert.notEqual(out.status,"COMPLETED"); assert.equal(calls,1); assert.equal(out.controller.automaticRetries,0);
  });
});
test("required review and cancellation cannot be disguised as single-owner success",async()=>{
  await fixture(async(root,h)=>{
    let calls=0; const executor:Executor={name:"codex-exec",async execute(value){calls++;return result(value);}};
    const handle=await new RunStore(join(root,"state")).createRun(h);
    const reviewed={...h,orchestration:{tier:"full" as const,childAgentBudget:2,independentReviewer:true,maxRevisions:1}};
    await assert.rejects(new SingleOwnerController(executor).run(reviewed,{maxIterations:1,approvedGateIds:[],runHandle:handle,protectedPaths}),/INDEPENDENT_REVIEW_REQUIRED/);assert.equal(calls,0);
  });
});
''')
# Adapter tests reuse the repository's real argument/JSON validation fixture.
append('tests/codex-exec-executor.test.ts', '''
test("single owner disables collaboration per invocation, carries whole-task context and never follows a rejection ladder", async () => {
  const handoff = await exampleHandoff();
  const fake = new FakeCodexRunner(handoff, true, false, [processResult({ exitCode: 1, stderr: "Requested model gpt-6-sol is unavailable for this invocation." })]);
  const execution = await new CodexExecExecutor({ ...options(), modelSelection: selectedModelWithFallback() }, fake).execute(handoff, { iteration: 1, revisionInstructions: [], singleOwner: true });
  assert.equal(execution.status, "failed");
  const requests = fake.requests.filter(r => r.args[0] === "exec");
  assert.equal(requests.length, 1);
  assert.ok(requests[0]!.args.includes("features.multi_agent=false"));
  assert.match(requests[0]!.stdin, /sole implementation owner/);
  assert.equal(requests[0]!.args[requests[0]!.args.indexOf("--sandbox") + 1], "workspace-write");
});
''')
print('Prepared single-owner source and tests; stable publication must remain blocked for dev versions.')

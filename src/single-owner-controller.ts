import { evaluateSafetyGate } from "./safety-gate.js";
import { captureGitSnapshot } from "./git-audit.js";
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
    const statistics = () => ({
      mode: "single-owner" as const, managerModelCalls: 0, executorInvocations: invocations,
      automaticRetries: 0, independentReviewPerformed: false, verification: "deterministic-acceptance",
      usage, wholeTaskCostUsd: null, wholeTaskModelRequestCount: null,
    });
    const cancelledResult = () => ({
      handoffId: handoff.id, executor: this.executor.name, status: "BLOCKED" as const,
      preflightGate: evaluateSafetyGate(handoff, options.approvedGateIds), attempts: [], phaseDecisions: [],
      message: "Run cancelled; no new acceptance or model invocation was started.", controller: statistics(),
    });
    try {
      if (await run.isCancelled()) return cancelledResult();
      if (!(await captureGitSnapshot(handoff.workspace.root)).isGit) throw new Error("An auditable Git workspace is required before starting the single owner.");
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
      if (await run.isCancelled()) return cancelledResult();
      const controller = statistics();
      await run.appendEvent("controller.completed", result.status === "COMPLETED" ? "completed" : "blocked", invocations, "Single-owner controller terminated.", controller);
      return { ...result, controller };
    } catch (error) {
      // RunStore correctly rejects writes after cancellation. Preserve that
      // terminal record instead of trying to finalize or append another event.
      if (await run.isCancelled()) return cancelledResult();
      throw error;
    } finally {
      // A thrown/abandoned adapter with an unobserved exit must retain the lease.
      // A new process cannot claim ownership merely because the parent disappeared.
      if (!live) await lease.release();
    }
  }
}

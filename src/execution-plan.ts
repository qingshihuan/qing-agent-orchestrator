import { assessDelegationBenefit, delegationDeclined, type DelegationEvidence } from "./delegation-benefit.js";
import type { OrchestrationDecision } from "./types.js";

/** Orthogonal topology, verification and authority; this is not a permission grant. */
export function executionPlan(text: string, decision: OrchestrationDecision, signals: readonly string[], evidence?: DelegationEvidence) {
  const explicitWorker = /(?:委派|创建子|使用子|delegate|spawn|Qing\s*Lite)/i.test(text) && !delegationDeclined(text);
  const transfer = decision.tier === "lite" || signals.includes("cli-backend-condition")
    || (decision.tier === "full" && (explicitWorker || assessDelegationBenefit(text, evidence).worthwhile));
  return {
    version: "single-owner-v1" as const,
    implementationMode: transfer ? "single-worker" as const : "current-parent" as const,
    verification: decision.independentReviewer ? "independent-review" as const : "acceptance" as const,
    maxActiveImplementationOwners: 1 as const,
    parallelExecutionEnabled: false as const,
    managerModelRequired: false as const,
    nativeManagerRequestLimit: null,
    authority: "host-effective-session" as const,
    grantsPermissions: false as const,
  };
}

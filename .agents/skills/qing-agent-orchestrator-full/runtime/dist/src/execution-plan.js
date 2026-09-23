import { assessDelegationBenefit, delegationDeclined } from "./delegation-benefit.js";
/** Orthogonal topology, verification and authority; this is not a permission grant. */
export function executionPlan(text, decision, signals, evidence) {
    const explicitWorker = /(?:委派|创建子|使用子|delegate|spawn|Qing\s*Lite)/i.test(text) && !delegationDeclined(text);
    const transfer = decision.tier === "lite" || signals.includes("cli-backend-condition")
        || (decision.tier === "full" && (explicitWorker || assessDelegationBenefit(text, evidence).worthwhile));
    return {
        version: "single-owner-v1",
        implementationMode: transfer ? "single-worker" : "current-parent",
        verification: decision.independentReviewer ? "independent-review" : "acceptance",
        maxActiveImplementationOwners: 1,
        parallelExecutionEnabled: false,
        managerModelRequired: false,
        nativeManagerRequestLimit: null,
        authority: "host-effective-session",
        grantsPermissions: false,
    };
}

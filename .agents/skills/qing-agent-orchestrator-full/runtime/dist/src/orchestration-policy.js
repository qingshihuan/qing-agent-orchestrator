import { createHash } from "node:crypto";
import { assessDelegationBenefit, delegationDeclined } from "./delegation-benefit.js";
export const defaultOrchestrationConfig = {
    mode: "adaptive",
    liteMaxChildren: 1,
    fullMaxChildren: 2,
    liteMaxRevisions: 1,
    fullMaxRevisions: 1,
    reviewerMode: "risk-based",
    fullBudgetSource: "default",
    legacyV07Compatibility: [],
};
const explicitFull = /(?:启动|使用|采用|进入).{0,10}(?:Level\s*3|完整(?:版)?\s*Qing|完整编排|全量编排)|(?:独立|单独)\s*(?:Reviewer|审查(?:者|代理))|full(?:\s+qing|\s+orchestration)|independent\s+reviewer/i;
const explicitDelegation = /(?:使用|创建|生成|启用).{0,10}(?:子(?:智能体|代理)|agent)|(?:delegate|spawn).{0,10}(?:agent|subagent)|Qing\s*Lite|轻量编排/i;
const highEffectSignals = new Set([
    "infrastructure",
    "external-action",
    "delete-action",
    "git-push-action",
    "purchase-action",
    "global-write-action",
    "secret-action",
    "private-network-action",
    "scope-expansion-action",
    "database-migration-action",
    "global-install-action",
]);
export function decideOrchestration(input) {
    const config = input.config ?? defaultOrchestrationConfig;
    const text = input.text.trim();
    const forcedFull = config.mode === "full" || explicitFull.test(text);
    const decomposable = false; // Parallel execution is not enabled by a text hint.
    const riskyEffect = input.signals.some((signal) => highEffectSignals.has(signal))
        || input.complexity.risk === "critical";
    if (input.route === "chat" && !forcedFull && !riskyEffect) {
        return {
            tier: "direct",
            childAgentBudget: 0,
            independentReviewer: false,
            maxRevisions: 0,
            parentVerification: false,
            modelSelectionRequired: false,
            approvalPolicy: "effects-only",
            decomposable: false,
            reasons: ["parent-answer"],
        };
    }
    if (forcedFull || riskyEffect) {
        const reasons = [
            ...(forcedFull ? [config.mode === "full" ? "configuration-forces-full" : input.signals.includes("cli-backend-condition") ? "explicit-cli-backend-workflow" : "explicit-full-request"] : []),
            ...(riskyEffect ? ["high-risk-or-external-effect"] : []),
        ];
        return {
            tier: "full",
            childAgentBudget: config.fullMaxChildren,
            independentReviewer: true,
            maxRevisions: config.fullMaxRevisions,
            parentVerification: false,
            modelSelectionRequired: true,
            approvalPolicy: "effects-only",
            decomposable,
            reasons,
        };
    }
    // Full safety/review requirements above always take precedence. Complexity
    // alone cannot justify paying for an extra parent/child conversation.
    const delegation = assessDelegationBenefit(text, input.delegationEvidence);
    const requestedDelegation = explicitDelegation.test(text) && !delegationDeclined(text);
    const needsLite = requestedDelegation || delegation.worthwhile || input.signals.includes("cli-backend-condition");
    if (needsLite) {
        return {
            tier: "lite",
            childAgentBudget: config.liteMaxChildren,
            independentReviewer: false,
            maxRevisions: config.liteMaxRevisions,
            parentVerification: true,
            modelSelectionRequired: true,
            approvalPolicy: "effects-only",
            decomposable: false,
            reasons: [requestedDelegation ? "explicit-delegation-request" : delegation.reason],
        };
    }
    return {
        tier: "direct",
        childAgentBudget: 0,
        independentReviewer: false,
        maxRevisions: 0,
        parentVerification: input.route !== "chat",
        modelSelectionRequired: false,
        approvalPolicy: "effects-only",
        decomposable: false,
        reasons: [input.route === "chat" ? "parent-answer" : "direct-retains-context", delegation.reason],
    };
}
/**
 * Classify only the work which remains at a user-turn or delegation boundary.
 * A pending review is not itself a reason to keep routine implementation Full;
 * it restores Full only when final acceptance is about to occur.
 */
export function reclassifyRemainingPhase(input) {
    const base = decideOrchestration(input);
    const mustRestoreReview = input.milestone === "before-review"
        && (input.state.pendingIndependentReview || input.state.unacceptedHighRiskArtifact);
    const decision = mustRestoreReview
        ? {
            tier: "full",
            childAgentBudget: (input.config ?? defaultOrchestrationConfig).fullMaxChildren,
            independentReviewer: true,
            maxRevisions: (input.config ?? defaultOrchestrationConfig).fullMaxRevisions,
            parentVerification: false,
            modelSelectionRequired: true,
            approvalPolicy: "effects-only",
            decomposable: false,
            reasons: [...base.reasons, "pending-independent-review-restored-for-final-acceptance"],
        }
        : base;
    const state = {
        previousTier: decision.tier,
        // Routing a Reviewer is not accepting an artifact. The obligation can be
        // cleared only after the actual independent review reports PASS.
        pendingIndependentReview: input.state.pendingIndependentReview,
        unacceptedHighRiskArtifact: input.state.unacceptedHighRiskArtifact,
    };
    return {
        milestone: input.milestone,
        decision,
        state,
        reclassified: input.state.previousTier !== decision.tier,
        restoredForIndependentReview: mustRestoreReview,
    };
}
/** Commit an observed independent-review outcome; only PASS resolves the obligation. */
export function recordIndependentReviewOutcome(state, verdict) {
    if (verdict !== "PASS")
        return { ...state };
    return {
        previousTier: state.previousTier,
        pendingIndependentReview: false,
        unacceptedHighRiskArtifact: false,
    };
}
/**
 * Event-driven desktop child coordination. The parent observes a milestone or
 * terminal result, rather than issuing repeated unchanged polls. A stalled
 * child gets exactly one takeover/replacement decision and never an
 * interrupt/reactivate loop while it remains live.
 */
function coordinationDecision(input, snapshot) {
    if (input.state === "not-started")
        return { action: "start", pollNow: false, maxUnchangedWaits: 1, reasons: ["child-not-started"] };
    if (input.state === "completed")
        return { action: "collect-result", pollNow: false, maxUnchangedWaits: 1, reasons: ["child-terminal-result"] };
    if (input.state === "running") {
        if (input.noProgressTimeoutReached && snapshot.takeoverDecisions < 1)
            return { action: "make-one-takeover-decision", pollNow: false, maxUnchangedWaits: 1, reasons: ["no-progress-timeout", "do-not-interrupt-live-child-solely-for-slowness"] };
        if (input.noProgressTimeoutReached)
            return { action: "wait-for-event", pollNow: false, maxUnchangedWaits: 1, reasons: ["takeover-decision-already-made", "await-terminal-or-new-milestone"] };
        return { action: "wait-for-event", pollNow: false, maxUnchangedWaits: 1, reasons: [input.observedNewEvent ? "new-milestone-observed" : "unchanged-state-await-event"] };
    }
    if (snapshot.recoveryAttempts >= 1)
        return { action: "do-not-reactivate", pollNow: false, maxUnchangedWaits: 1, reasons: ["recovery-budget-exhausted"] };
    return { action: "recover-once", pollNow: false, maxUnchangedWaits: 1, reasons: ["terminal-failure-needs-single-recovery-decision"] };
}
/**
 * State owner for desktop child coordination. The desktop parent retains one
 * tracker per child and passes consecutive observations to it. Relay's CLI
 * process path already has observable process handles and heartbeats, so it
 * never fabricates a desktop takeover decision.
 */
export class ChildCoordinationTracker {
    snapshotValue = { state: "not-started", recoveryAttempts: 0, takeoverDecisions: 0 };
    snapshot() {
        return { ...this.snapshotValue };
    }
    observe(input) {
        const decision = coordinationDecision(input, this.snapshotValue);
        this.snapshotValue = {
            state: input.state,
            recoveryAttempts: this.snapshotValue.recoveryAttempts + Number(decision.action === "recover-once"),
            takeoverDecisions: this.snapshotValue.takeoverDecisions + Number(decision.action === "make-one-takeover-decision"),
        };
        return decision;
    }
}
export function createHandoffOrchestrationContract(decision) {
    return {
        tier: decision.tier,
        childAgentBudget: decision.childAgentBudget,
        independentReviewer: decision.independentReviewer,
        maxRevisions: decision.maxRevisions,
    };
}
export function bindHandoffOrchestration(handoff, decision) {
    const orchestration = createHandoffOrchestrationContract(decision);
    return {
        ...handoff,
        maxIterations: Math.min(handoff.maxIterations, orchestration.maxRevisions + 1),
        orchestration,
        metadata: { ...handoff.metadata, orchestrationPolicyVersion: "0.8" },
    };
}
function stableJson(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(",")}]`;
    const object = value;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}
/**
 * A deterministic, content-bound compatibility fingerprint. Formatting and
 * object-key order are ignored; every behavior-relevant Handoff field is not.
 */
export function legacyV07HandoffFingerprint(handoff) {
    const canonical = {
        version: handoff.version,
        id: handoff.id,
        title: handoff.title,
        objective: handoff.objective,
        category: handoff.category,
        workspace: handoff.workspace,
        inputs: handoff.inputs,
        constraints: handoff.constraints,
        acceptanceCriteria: handoff.acceptanceCriteria,
        requestedOperations: handoff.requestedOperations,
        deliverables: handoff.deliverables,
        testPlan: handoff.testPlan,
        maxIterations: handoff.maxIterations,
        orchestration: handoff.orchestration ?? null,
        metadata: handoff.metadata ?? null,
    };
    return createHash("sha256").update(stableJson(canonical)).digest("hex");
}
function isExplicitV07CompatibilityContract(handoff, contract, config) {
    const fingerprint = legacyV07HandoffFingerprint(handoff);
    return config.fullBudgetSource === "default"
        && (config.legacyV07Compatibility ?? []).some((entry) => entry.id === handoff.id && entry.fingerprint === fingerprint)
        && handoff.metadata?.orchestrationPolicyVersion === undefined
        && contract.tier === "full"
        && contract.childAgentBudget === 3
        && contract.maxRevisions === 2
        && contract.independentReviewer === true
        // A user who explicitly configured Full budgets retains those limits.
        && config.fullMaxChildren === defaultOrchestrationConfig.fullMaxChildren
        && config.fullMaxRevisions === defaultOrchestrationConfig.fullMaxRevisions;
}
export function resolveExecutableOrchestrationLimits(handoff, decision, config, relayMaxIterations) {
    const contract = handoff.orchestration ?? createHandoffOrchestrationContract(decision);
    const configuredChildBudget = contract.tier === "direct" ? 0 : contract.tier === "lite" ? config.liteMaxChildren : config.fullMaxChildren;
    const configuredRevisionBudget = contract.tier === "direct" ? 0 : contract.tier === "lite" ? config.liteMaxRevisions : config.fullMaxRevisions;
    const legacyV07Contract = isExplicitV07CompatibilityContract(handoff, contract, config);
    if (contract.childAgentBudget > configuredChildBudget && !legacyV07Contract) {
        throw new Error(`Handoff childAgentBudget ${contract.childAgentBudget} exceeds the configured ${contract.tier} limit ${configuredChildBudget}.`);
    }
    if (contract.maxRevisions > configuredRevisionBudget && !legacyV07Contract) {
        throw new Error(`Handoff maxRevisions ${contract.maxRevisions} exceeds the configured ${contract.tier} limit ${configuredRevisionBudget}.`);
    }
    return {
        contract,
        maxIterations: Math.max(1, Math.min(relayMaxIterations, handoff.maxIterations, contract.maxRevisions + 1)),
        source: handoff.orchestration ? legacyV07Contract ? "legacy-v0.7-contract" : "handoff" : "derived-legacy",
    };
}

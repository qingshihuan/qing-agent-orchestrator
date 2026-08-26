import { createHash } from "node:crypto";
import type {
  Handoff,
  HandoffOrchestrationContract,
  OrchestrationConfig,
  OrchestrationDecision,
  OrchestrationMilestone,
  PhaseOrchestrationState,
  PhaseReclassificationDecision,
  ChildCoordinationInput,
  ChildCoordinationDecision,
  ChildCoordinationSnapshot,
  IndependentReviewVerdict,
  TaskCategory,
  TaskComplexityAnalysis,
  TaskRoute,
} from "./types.js";

export interface OrchestrationPolicyInput {
  text: string;
  route: TaskRoute;
  category: TaskCategory;
  complexity: TaskComplexityAnalysis;
  signals: string[];
  config?: OrchestrationConfig | undefined;
}

export const defaultOrchestrationConfig: OrchestrationConfig = {
  mode: "adaptive",
  liteMaxChildren: 1,
  fullMaxChildren: 2,
  liteMaxRevisions: 1,
  fullMaxRevisions: 1,
  reviewerMode: "risk-based",
  fullBudgetSource: "default",
  legacyV07Compatibility: [],
};

const explicitFull = /(?:启动|使用|采用|进入).{0,10}(?:Level\s*3|完整(?:版)?\s*Qing|完整编排|全量编排)|(?:独立|单独)\s*(?:Reviewer|审查(?:者|代理))|(?:使用|启用|启动|切换到?|改用)\s*(?:Codex\s*)?CLI|full(?:\s+qing|\s+orchestration)|independent\s+reviewer|(?:use|enable|start|switch\s+to)\s+(?:codex\s+)?cli/i;
const explicitDelegation = /(?:使用|创建|生成|启用).{0,10}(?:子(?:智能体|代理)|agent)|(?:delegate|spawn).{0,10}(?:agent|subagent)|Qing\s*Lite|轻量编排/i;
const genuinelyParallel = /多个(?:互相)?独立(?:任务|工作流|工作项)|并行(?:任务|工作流|实现|审查)|parallel\s+(?:tasks?|workstreams?)|independent\s+workstreams?/i;
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

export function decideOrchestration(input: OrchestrationPolicyInput): OrchestrationDecision {
  const config = input.config ?? defaultOrchestrationConfig;
  const text = input.text.trim();
  const forcedFull = config.mode === "full" || explicitFull.test(text) || input.signals.includes("cli-backend-condition");
  const decomposable = genuinelyParallel.test(text);
  const riskyEffect = input.signals.some((signal) => highEffectSignals.has(signal))
    || input.complexity.risk === "critical";
  const crossSystem = input.complexity.scope === "cross-system";

  if (input.route === "chat" && !forcedFull && !decomposable) {
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

  if (forcedFull || riskyEffect || crossSystem || decomposable) {
    const reasons = [
      ...(forcedFull ? [config.mode === "full" ? "configuration-forces-full" : input.signals.includes("cli-backend-condition") ? "explicit-cli-backend-workflow" : "explicit-full-request"] : []),
      ...(riskyEffect ? ["high-risk-or-external-effect"] : []),
      ...(crossSystem ? ["cross-system-scope"] : []),
      ...(decomposable ? ["genuinely-parallel-work"] : []),
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

  const needsLite = explicitDelegation.test(text)
    || input.complexity.band === "complex"
    || input.complexity.band === "high-risk"
    || input.complexity.scope === "multi-step"
    || input.category === "mixed";
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
      reasons: [explicitDelegation.test(text) ? "explicit-delegation-request" : "bounded-complexity"],
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
    reasons: [input.route === "chat" ? "parent-answer" : "safe-single-scope-work"],
  };
}

export interface PhaseReclassificationInput extends OrchestrationPolicyInput {
  milestone: OrchestrationMilestone;
  state: PhaseOrchestrationState;
}

/**
 * Classify only the work which remains at a user-turn or delegation boundary.
 * A pending review is not itself a reason to keep routine implementation Full;
 * it restores Full only when final acceptance is about to occur.
 */
export function reclassifyRemainingPhase(input: PhaseReclassificationInput): PhaseReclassificationDecision {
  const base = decideOrchestration(input);
  const mustRestoreReview = input.milestone === "before-review"
    && (input.state.pendingIndependentReview || input.state.unacceptedHighRiskArtifact);
  const decision = mustRestoreReview
    ? {
      tier: "full" as const,
      childAgentBudget: (input.config ?? defaultOrchestrationConfig).fullMaxChildren,
      independentReviewer: true,
      maxRevisions: (input.config ?? defaultOrchestrationConfig).fullMaxRevisions,
      parentVerification: false,
      modelSelectionRequired: true,
      approvalPolicy: "effects-only" as const,
      decomposable: false,
      reasons: [...base.reasons, "pending-independent-review-restored-for-final-acceptance"],
    }
    : base;
  const state: PhaseOrchestrationState = {
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
export function recordIndependentReviewOutcome(
  state: PhaseOrchestrationState,
  verdict: IndependentReviewVerdict,
): PhaseOrchestrationState {
  if (verdict !== "PASS") return { ...state };
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
function coordinationDecision(input: ChildCoordinationInput, snapshot: ChildCoordinationSnapshot): ChildCoordinationDecision {
  if (input.state === "not-started") return { action: "start", pollNow: false, maxUnchangedWaits: 1, reasons: ["child-not-started"] };
  if (input.state === "completed") return { action: "collect-result", pollNow: false, maxUnchangedWaits: 1, reasons: ["child-terminal-result"] };
  if (input.state === "running") {
    if (input.noProgressTimeoutReached && snapshot.takeoverDecisions < 1) return { action: "make-one-takeover-decision", pollNow: false, maxUnchangedWaits: 1, reasons: ["no-progress-timeout", "do-not-interrupt-live-child-solely-for-slowness"] };
    if (input.noProgressTimeoutReached) return { action: "wait-for-event", pollNow: false, maxUnchangedWaits: 1, reasons: ["takeover-decision-already-made", "await-terminal-or-new-milestone"] };
    return { action: "wait-for-event", pollNow: false, maxUnchangedWaits: 1, reasons: [input.observedNewEvent ? "new-milestone-observed" : "unchanged-state-await-event"] };
  }
  if (snapshot.recoveryAttempts >= 1) return { action: "do-not-reactivate", pollNow: false, maxUnchangedWaits: 1, reasons: ["recovery-budget-exhausted"] };
  return { action: "recover-once", pollNow: false, maxUnchangedWaits: 1, reasons: ["terminal-failure-needs-single-recovery-decision"] };
}

/**
 * State owner for desktop child coordination. The desktop parent retains one
 * tracker per child and passes consecutive observations to it. Relay's CLI
 * process path already has observable process handles and heartbeats, so it
 * never fabricates a desktop takeover decision.
 */
export class ChildCoordinationTracker {
  private snapshotValue: ChildCoordinationSnapshot = { state: "not-started", recoveryAttempts: 0, takeoverDecisions: 0 };

  snapshot(): ChildCoordinationSnapshot {
    return { ...this.snapshotValue };
  }

  observe(input: ChildCoordinationInput): ChildCoordinationDecision {
    const decision = coordinationDecision(input, this.snapshotValue);
    this.snapshotValue = {
      state: input.state,
      recoveryAttempts: this.snapshotValue.recoveryAttempts + Number(decision.action === "recover-once"),
      takeoverDecisions: this.snapshotValue.takeoverDecisions + Number(decision.action === "make-one-takeover-decision"),
    };
    return decision;
  }
}

export function createHandoffOrchestrationContract(decision: OrchestrationDecision): HandoffOrchestrationContract {
  return {
    tier: decision.tier,
    childAgentBudget: decision.childAgentBudget,
    independentReviewer: decision.independentReviewer,
    maxRevisions: decision.maxRevisions,
  };
}

export function bindHandoffOrchestration(handoff: Handoff, decision: OrchestrationDecision): Handoff {
  const orchestration = createHandoffOrchestrationContract(decision);
  return {
    ...handoff,
    maxIterations: Math.min(handoff.maxIterations, orchestration.maxRevisions + 1),
    orchestration,
    metadata: { ...handoff.metadata, orchestrationPolicyVersion: "0.8" },
  };
}

export interface ExecutableOrchestrationLimits {
  contract: HandoffOrchestrationContract;
  maxIterations: number;
  source: "handoff" | "derived-legacy" | "legacy-v0.7-contract";
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

/**
 * A deterministic, content-bound compatibility fingerprint. Formatting and
 * object-key order are ignored; every behavior-relevant Handoff field is not.
 */
export function legacyV07HandoffFingerprint(handoff: Handoff): string {
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

function isExplicitV07CompatibilityContract(handoff: Handoff, contract: HandoffOrchestrationContract, config: OrchestrationConfig): boolean {
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

export function resolveExecutableOrchestrationLimits(
  handoff: Handoff,
  decision: OrchestrationDecision,
  config: OrchestrationConfig,
  relayMaxIterations: number,
): ExecutableOrchestrationLimits {
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

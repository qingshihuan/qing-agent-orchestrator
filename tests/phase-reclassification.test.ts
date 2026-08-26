import assert from "node:assert/strict";
import test from "node:test";
import { ChildCoordinationTracker, legacyV07HandoffFingerprint, recordIndependentReviewOutcome, reclassifyRemainingPhase, resolveExecutableOrchestrationLimits } from "../src/orchestration-policy.js";
import type { OrchestrationPolicyInput, PhaseReclassificationInput } from "../src/orchestration-policy.js";

const fullPhase: OrchestrationPolicyInput = {
  text: "发布到外部平台",
  route: "codex",
  category: "external_action",
  complexity: { score: 80, band: "high-risk", category: "external_action", role: "planner", risk: "high", scope: "cross-system", signals: [], reasons: [] },
  signals: ["external-action"],
};

function phase(overrides: Partial<PhaseReclassificationInput>): PhaseReclassificationInput {
  return {
    ...fullPhase,
    milestone: "new-user-turn",
    state: { previousTier: "full", pendingIndependentReview: false, unacceptedHighRiskArtifact: false },
    ...overrides,
  };
}

test("each new user turn and delegation milestone classify only remaining work and can de-escalate", () => {
  const direct = reclassifyRemainingPhase(phase({
    text: "整理刚才的本地测试结果，不创建子代理",
    route: "chat",
    category: "analysis",
    complexity: { score: 10, band: "trivial", category: "analysis", role: "planner", risk: "low", scope: "single", signals: [], reasons: [] },
    signals: ["analysis"],
  }));
  assert.equal(direct.decision.tier, "direct");
  assert.equal(direct.reclassified, true);

  for (const milestone of ["before-child-creation", "before-child-reactivation", "before-revision"] as const) {
    const lite = reclassifyRemainingPhase(phase({
    milestone,
    text: "先规划接口，然后实现并测试剩余的本地修复",
    route: "hybrid",
    category: "mixed",
    complexity: { score: 45, band: "complex", category: "mixed", role: "planner", risk: "medium", scope: "multi-step", signals: [], reasons: [] },
    signals: ["plan-then-execute"],
    }));
    assert.equal(lite.decision.tier, "lite", milestone);
    assert.equal(lite.decision.childAgentBudget, 1, milestone);
    assert.equal(lite.decision.independentReviewer, false, milestone);
  }
});

test("a pending high-risk artifact keeps its review obligation through a Direct phase and restores Full only for acceptance", () => {
  const pending = { previousTier: "full" as const, pendingIndependentReview: true, unacceptedHighRiskArtifact: true };
  const interim = reclassifyRemainingPhase(phase({
    text: "汇总已冻结产物的校验哈希",
    route: "chat",
    category: "analysis",
    complexity: { score: 10, band: "trivial", category: "analysis", role: "planner", risk: "low", scope: "single", signals: [], reasons: [] },
    signals: ["analysis"],
    state: pending,
  }));
  assert.equal(interim.decision.tier, "direct");
  assert.equal(interim.state.pendingIndependentReview, true);
  assert.equal(interim.state.unacceptedHighRiskArtifact, true);

  const finalReview = reclassifyRemainingPhase(phase({
    milestone: "before-review",
    text: "验收已冻结产物",
    route: "chat",
    category: "analysis",
    complexity: { score: 10, band: "trivial", category: "analysis", role: "planner", risk: "low", scope: "single", signals: [], reasons: [] },
    signals: ["analysis"],
    state: interim.state,
  }));
  assert.equal(finalReview.decision.tier, "full");
  assert.equal(finalReview.decision.independentReviewer, true);
  assert.equal(finalReview.restoredForIndependentReview, true);
  assert.equal(finalReview.state.pendingIndependentReview, true);

  const afterRevise = recordIndependentReviewOutcome(finalReview.state, "REVISE");
  const secondReview = reclassifyRemainingPhase(phase({ milestone: "before-review", state: afterRevise }));
  assert.equal(secondReview.decision.tier, "full");
  assert.equal(secondReview.state.pendingIndependentReview, true);
  const afterPass = recordIndependentReviewOutcome(secondReview.state, "PASS");
  assert.equal(afterPass.pendingIndependentReview, false);
  assert.equal(afterPass.unacceptedHighRiskArtifact, false);

  const configured = reclassifyRemainingPhase(phase({
    milestone: "before-review",
    state: pending,
    config: { mode: "adaptive", liteMaxChildren: 1, liteMaxRevisions: 1, fullMaxChildren: 3, fullMaxRevisions: 2, reviewerMode: "risk-based" },
  }));
  assert.equal(configured.decision.childAgentBudget, 3);
  assert.equal(configured.decision.maxRevisions, 2);
});

test("coordination waits for events and allows a single recovery decision without live-child interrupt loops", () => {
  const tracker = new ChildCoordinationTracker();
  const unchanged = tracker.observe({ state: "running", observedNewEvent: false, noProgressTimeoutReached: false });
  assert.deepEqual(unchanged, { action: "wait-for-event", pollNow: false, maxUnchangedWaits: 1, reasons: ["unchanged-state-await-event"] });
  const stalled = tracker.observe({ state: "running", observedNewEvent: false, noProgressTimeoutReached: true });
  assert.equal(stalled.action, "make-one-takeover-decision");
  assert.equal(tracker.snapshot().takeoverDecisions, 1);
  const afterTakeover = tracker.observe({ state: "running", observedNewEvent: false, noProgressTimeoutReached: true });
  assert.equal(afterTakeover.action, "wait-for-event");
  const recover = tracker.observe({ state: "failed", observedNewEvent: true, noProgressTimeoutReached: true });
  assert.equal(recover.action, "recover-once");
  assert.equal(tracker.snapshot().recoveryAttempts, 1);
  const exhausted = tracker.observe({ state: "failed", observedNewEvent: true, noProgressTimeoutReached: true });
  assert.equal(exhausted.action, "do-not-reactivate");
});

test("only an explicit ID plus content fingerprint admits one exact v0.7 default Full contract", () => {
  const legacy = {
    version: "1.0" as const, id: "legacy-full", title: "legacy", objective: "使用完整 Qing 实现一个示例功能", category: "code_change" as const,
    workspace: { root: ".", allowedPaths: ["src/**"] }, inputs: [], constraints: [], acceptanceCriteria: [{ id: "ac", description: "x", verification: "x", verificationOwner: "executor" as const }], requestedOperations: [{ type: "write" as const, target: "src/**", reason: "legacy fixture", risk: "low" as const }], deliverables: [], testPlan: [], maxIterations: 3,
    orchestration: { tier: "full" as const, childAgentBudget: 3, independentReviewer: true, maxRevisions: 2 }, metadata: { source: "v0.7 fixture" },
  };
  const fingerprint = legacyV07HandoffFingerprint(legacy);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(legacyV07HandoffFingerprint(structuredClone(legacy)), fingerprint);
  const config = { mode: "adaptive" as const, liteMaxChildren: 1 as const, liteMaxRevisions: 1 as const, fullMaxChildren: 2, fullMaxRevisions: 1, reviewerMode: "risk-based" as const, fullBudgetSource: "default" as const, legacyV07Compatibility: [{ id: "legacy-full", fingerprint }] };
  const decision = { tier: "full" as const, childAgentBudget: 2, independentReviewer: true, maxRevisions: 1, parentVerification: false, modelSelectionRequired: true, approvalPolicy: "effects-only" as const, decomposable: false, reasons: [] };
  const accepted = resolveExecutableOrchestrationLimits(legacy, decision, config, 5);
  assert.equal(accepted.source, "legacy-v0.7-contract");
  assert.equal(accepted.maxIterations, 3);
  for (const changed of [
    { ...legacy, title: "replacement title" },
    { ...legacy, objective: "different objective" },
    { ...legacy, metadata: { source: "replacement source" } },
    { ...legacy, requestedOperations: [] },
  ]) {
    assert.equal(changed.id, legacy.id);
    assert.throws(() => resolveExecutableOrchestrationLimits(changed, decision, config, 5), /exceeds the configured full limit 2/);
  }
  assert.throws(() => resolveExecutableOrchestrationLimits(legacy, decision, { ...config, legacyV07Compatibility: [] }, 5), /exceeds the configured full limit 2/);
  assert.throws(() => resolveExecutableOrchestrationLimits(legacy, decision, { ...config, fullMaxChildren: 1, fullBudgetSource: "explicit" }, 5), /exceeds the configured full limit 1/);
  assert.throws(() => resolveExecutableOrchestrationLimits({ ...legacy, metadata: { ...legacy.metadata, orchestrationPolicyVersion: "0.8" as const } }, decision, config, 5), /exceeds the configured full limit 2/);
  assert.throws(() => resolveExecutableOrchestrationLimits({ ...legacy, orchestration: { ...legacy.orchestration, childAgentBudget: 4 } }, decision, config, 5), /exceeds the configured full limit 2/);
});

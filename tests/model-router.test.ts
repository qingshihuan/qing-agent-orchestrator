import assert from "node:assert/strict";
import test from "node:test";
import {
  assessModelFallbackGate,
  continueModelFallbackAfterRejection,
  ModelFallbackRequiresGateError,
  NoHealthyModelCandidateError,
  selectModelCandidate,
  supportedReasoningEfforts,
  validateModelCapability,
} from "../src/model-router.js";
import type { ModelHealthRecord } from "../src/model-health.js";
import type { ModelBackend, ModelCandidate } from "../src/types.js";

const candidate = (id: string, backend: ModelBackend, model: string, priority: number, fallbacks: string[] = []): ModelCandidate => ({
  id, backend, model, profile: null, reasoningEffort: id.includes("fast") ? "medium" : "high",
  availability: backend === "desktop-child" ? "host-advertised" : "entitlement-dependent",
  roles: ["planner", "executor", "reviewer"], routes: ["codex", "hybrid"], categories: ["code_change", "mixed"],
  complexityBands: id.includes("fast") ? ["trivial", "normal"] : ["complex", "high-risk"],
  tags: [], priority, enabled: true, fallbacks,
});

const health = (candidateId: string, state: ModelHealthRecord["state"]): ModelHealthRecord => ({
  candidateId, fingerprint: candidateId, cliVersion: "codex 1", state, cacheState: "cached",
  checkedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", failure: state === "healthy" ? null : "process", reason: state,
});

const unchangedScope = {
  operationsUnchanged: true,
  allowedPathsUnchanged: true,
  sandboxUnchanged: true,
  permissionsUnchanged: true,
  effectsUnchanged: true,
} as const;

test("desktop child selection uses host-advertised capability, role, band, and priority without a CLI health claim", () => {
  const candidates = [candidate("desktop-deep", "desktop-child", "gpt-5.6-terra", 10), candidate("desktop-sol", "desktop-child", "gpt-5.6-sol", 20)];
  const selected = selectModelCandidate(candidates, new Map(), { backend: "desktop-child", role: "planner", route: "codex", category: "code_change", complexityBand: "complex" });
  assert.equal(selected.candidateId, "desktop-sol");
  assert.equal(selected.backend, "desktop-child");
  assert.equal(selected.availability, "host-advertised");
});

test("CLI selection requires a healthy entitlement-dependent candidate and follows only explicit same-backend fallbacks", () => {
  const candidates = [candidate("cli-primary", "codex-cli", "gpt-5.6-sol", 100, ["cli-fallback"]), candidate("cli-fallback", "codex-cli", "gpt-5.6-terra", 1)];
  const statuses = new Map([["cli-primary", health("cli-primary", "unhealthy")], ["cli-fallback", health("cli-fallback", "healthy")]]);
  const selected = selectModelCandidate(candidates, statuses, { backend: "codex-cli", role: "executor", route: "hybrid", category: "mixed", complexityBand: "complex" });
  assert.equal(selected.candidateId, "cli-fallback");
  assert.equal(selected.executionOwner, "Codex");
  assert.equal(selected.fallbackFrom, "cli-primary");
  assert.deepEqual(selected.fallbackAudit.plannedPair, {
    candidateId: "cli-primary", backend: "codex-cli", model: "gpt-5.6-sol", profile: null, reasoningEffort: "high",
  });
  assert.deepEqual(selected.fallbackAudit.actualPair, {
    candidateId: "cli-fallback", backend: "codex-cli", model: "gpt-5.6-terra", profile: null, reasoningEffort: "high",
  });
  assert.deepEqual(selected.fallbackAudit.chain, ["cli-primary", "cli-fallback"]);
  assert.equal(selected.fallbackAudit.executionOwner, "Codex");
  assert.deepEqual(selected.fallbackAudit.attempts.map(({ outcome }) => outcome), ["unavailable", "selected"]);
  assert.equal(selected.fallbackAudit.gateAssessment.backendUnchanged, true);
  assert.equal(selected.fallbackAudit.gateAssessment.scopeProofComplete, true);
  assert.equal(selected.fallbackAudit.gateAssessment.securityScopeUnchanged, true);
  assert.equal(selected.fallbackAudit.gateAssessment.operationsUnchanged, true);
  assert.equal(selected.fallbackAudit.gateAssessment.requiresNewGate, false);
});

test("high-risk work may use an explicit healthy same-backend fallback without changing operation gates", () => {
  const candidates = [candidate("cli-primary", "codex-cli", "gpt-5.6-sol", 100, ["cli-fallback"]), candidate("cli-fallback", "codex-cli", "gpt-5.6-terra", 1)];
  const statuses = new Map([["cli-primary", health("cli-primary", "unhealthy")], ["cli-fallback", health("cli-fallback", "healthy")]]);
  const selected = selectModelCandidate(candidates, statuses, { backend: "codex-cli", role: "executor", route: "hybrid", category: "mixed", complexityBand: "high-risk" });
  assert.equal(selected.candidateId, "cli-fallback");
  assert.equal(selected.complexityBand, "high-risk");
  assert.equal(selected.fallbackAudit.gateAssessment.requiresNewGate, false);
  assert.deepEqual(selected.fallbackAudit.gateAssessment.reasons, []);
});

test("desktop delegation exposes an ordered plan and continues after a real spawn rejection", () => {
  const candidates = [candidate("desktop-primary", "desktop-child", "gpt-5.6-sol", 100, ["desktop-fallback"]), candidate("desktop-fallback", "desktop-child", "gpt-5.6-terra", 1)];
  const selected = selectModelCandidate(candidates, new Map(), { backend: "desktop-child", role: "executor", route: "codex", category: "code_change", complexityBand: "complex" });
  assert.deepEqual(selected.fallbackPlan.orderedCandidates.map(({ candidateId }) => candidateId), ["desktop-primary", "desktop-fallback"]);
  const continued = continueModelFallbackAfterRejection(selected, "desktop-primary", "host rejected the requested model/reasoning pair", unchangedScope);
  assert.equal(continued.candidateId, "desktop-fallback");
  assert.equal(continued.fallbackFrom, "desktop-primary");
  assert.equal(continued.fallbackAudit.fallbackReason, "desktop-primary: host rejected the requested model/reasoning pair");
  assert.deepEqual(continued.fallbackAudit.attempts.map(({ outcome }) => outcome), ["rejected", "selected"]);
  assert.equal(continued.fallbackAudit.gateAssessment.backendUnchanged, true);
  assert.equal(continued.fallbackAudit.gateAssessment.scopeProofComplete, true);
  assert.equal(continued.fallbackAudit.gateAssessment.securityScopeUnchanged, true);
  assert.equal(continued.fallbackAudit.gateAssessment.requiresNewGate, false);
});

test("post-rejection continuation requires a complete explicit scope proof", () => {
  const candidates = [candidate("desktop-primary", "desktop-child", "gpt-5.6-sol", 100, ["desktop-fallback"]), candidate("desktop-fallback", "desktop-child", "gpt-5.6-terra", 1)];
  const selected = selectModelCandidate(candidates, new Map(), { backend: "desktop-child", role: "executor", route: "codex", category: "code_change", complexityBand: "complex" });
  assert.throws(
    () => continueModelFallbackAfterRejection(selected, "desktop-primary", "spawn rejected"),
    (error: unknown) => error instanceof ModelFallbackRequiresGateError
      && error.fallbackAudit?.gateAssessment.scopeProofComplete === false
      && error.fallbackAudit.gateAssessment.requiresNewGate === true,
  );
  assert.throws(
    () => continueModelFallbackAfterRejection(selected, "desktop-primary", "spawn rejected", { operationsUnchanged: true }),
    (error: unknown) => error instanceof ModelFallbackRequiresGateError
      && error.fallbackAudit?.gateAssessment.reasons.includes("scope-proof-incomplete") === true,
  );
  const continued = continueModelFallbackAfterRejection(selected, "desktop-primary", "spawn rejected", unchangedScope);
  assert.equal(continued.fallbackAudit.gateAssessment.scopeProofComplete, true);
  assert.equal(continued.fallbackAudit.gateAssessment.requiresNewGate, false);
});

test("cross-backend or security-scope changes require a fresh gate and cannot be retried as substitution", () => {
  const desktop = { candidateId: "desktop", backend: "desktop-child" as const, model: "gpt-5.6-sol", profile: null, reasoningEffort: "high" as const };
  const cli = { candidateId: "cli", backend: "codex-cli" as const, model: "gpt-5.6-sol", profile: null, reasoningEffort: "high" as const };
  const crossBackend = assessModelFallbackGate(desktop, cli, unchangedScope);
  assert.equal(crossBackend.backendUnchanged, false);
  assert.equal(crossBackend.requiresNewGate, true);
  assert.deepEqual(crossBackend.reasons, ["backend-changed"]);

  const candidates = [candidate("desktop-primary", "desktop-child", "gpt-5.6-sol", 100, ["desktop-fallback"]), candidate("desktop-fallback", "desktop-child", "gpt-5.6-terra", 1)];
  const selected = selectModelCandidate(candidates, new Map(), { backend: "desktop-child", role: "executor", route: "codex", category: "code_change", complexityBand: "complex" });
  assert.throws(
    () => continueModelFallbackAfterRejection(selected, "desktop-primary", "spawn rejected", { operationsUnchanged: true, allowedPathsUnchanged: true, sandboxUnchanged: true, permissionsUnchanged: false, effectsUnchanged: true }),
    ModelFallbackRequiresGateError,
  );
});

test("a rejected model with no explicit healthy safe fallback fails closed", () => {
  const only = candidate("desktop-only", "desktop-child", "gpt-5.6-sol", 100);
  const selected = selectModelCandidate([only], new Map(), { backend: "desktop-child", role: "executor", route: "codex", category: "code_change", complexityBand: "complex" });
  assert.throws(
    () => continueModelFallbackAfterRejection(selected, "desktop-only", "host rejected the pair"),
    NoHealthyModelCandidateError,
  );
});

test("an unavailable priority winner does not implicitly fall through to an unlisted candidate", () => {
  const primary = candidate("cli-primary", "codex-cli", "gpt-5.6-sol", 100);
  const unrelated = candidate("cli-unrelated", "codex-cli", "gpt-5.6-terra", 50);
  const statuses = new Map([[primary.id, health(primary.id, "unhealthy")], [unrelated.id, health(unrelated.id, "healthy")]]);
  assert.throws(() => selectModelCandidate([primary, unrelated], statuses, { backend: "codex-cli", role: "executor", route: "codex", category: "code_change", complexityBand: "complex" }), /No available configured candidate/);
});

test("capability matrix validates exact backend/model/reasoning combinations", () => {
  assert.ok(supportedReasoningEfforts("desktop-child", "gpt-5.6-sol").includes("ultra"));
  assert.ok(!supportedReasoningEfforts("desktop-child", "gpt-5.6-luna").includes("ultra"));
  assert.ok(supportedReasoningEfforts("codex-cli", "gpt-5.6").includes("minimal"));
  assert.deepEqual(supportedReasoningEfforts("desktop-child", "gpt-5.3-codex-spark"), []);
  assert.deepEqual(supportedReasoningEfforts("desktop-child", "gpt-5.4-mini"), []);
  assert.ok(supportedReasoningEfforts("codex-cli", "gpt-5.3-codex-spark").includes("xhigh"));
  assert.ok(!supportedReasoningEfforts("codex-cli", "gpt-5.6-sol").includes("max"));
  assert.match(validateModelCapability({ backend: "codex-cli", model: "gpt-5.6-sol", profile: null, reasoningEffort: "max", availability: "entitlement-dependent" }) ?? "", /unsupported/);
});

test("disabled, expired, unverified, unsupported band, and wrong backend fail closed", () => {
  const item = candidate("cli-only", "codex-cli", "gpt-5.6-sol", 1);
  for (const state of ["expired", "unverified", "unhealthy"] as const) {
    assert.throws(() => selectModelCandidate([item], new Map([[item.id, health(item.id, state)]]), { backend: "codex-cli", role: "reviewer", route: "codex", category: "code_change", complexityBand: "complex" }), /No available configured candidate/);
  }
  assert.throws(() => selectModelCandidate([{ ...item, enabled: false }], new Map([[item.id, health(item.id, "healthy")]]), { backend: "codex-cli", role: "executor", route: "codex", category: "code_change", complexityBand: "complex" }), /No configured model candidate/);
  assert.throws(() => selectModelCandidate([item], new Map([[item.id, health(item.id, "healthy")]]), { backend: "desktop-child", role: "executor", route: "codex", category: "code_change", complexityBand: "complex" }), /No configured model candidate/);
  assert.throws(() => selectModelCandidate([item], new Map([[item.id, health(item.id, "healthy")]]), { backend: "codex-cli", role: "executor", route: "codex", category: "code_change", complexityBand: "normal" }), /No configured model candidate/);
});

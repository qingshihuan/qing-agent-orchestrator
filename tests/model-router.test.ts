import assert from "node:assert/strict";
import test from "node:test";
import { selectModelCandidate, supportedReasoningEfforts, validateModelCapability } from "../src/model-router.js";
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
  assert.equal(selected.fallbackFrom, "cli-primary");
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

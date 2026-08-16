import assert from "node:assert/strict";
import test from "node:test";
import { selectModelCandidate } from "../src/model-router.js";
import type { ModelHealthRecord } from "../src/model-health.js";
import type { ModelCandidate } from "../src/types.js";

const candidate = (id: string, priority: number, fallbacks: string[] = []): ModelCandidate => ({
  id, model: `model-${id}`, profile: null, reasoningEffort: id === "fast" ? "low" : "high",
  roles: ["planner", "executor", "reviewer"], routes: ["codex", "hybrid"], categories: ["code_change", "mixed"],
  tags: [], priority, enabled: true, fallbacks,
});

const health = (candidateId: string, state: ModelHealthRecord["state"]): ModelHealthRecord => ({
  candidateId, fingerprint: candidateId, cliVersion: "codex 1", state, cacheState: "cached",
  checkedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", failure: state === "healthy" ? null : "process", reason: state,
});

test("selection uses only healthy role/category candidates and priority", () => {
  const candidates = [candidate("fast", 10), candidate("deep", 20)];
  const statuses = new Map(candidates.map(({ id }) => [id, health(id, "healthy")]));
  const selected = selectModelCandidate(candidates, statuses, { role: "planner", route: "codex", category: "code_change" });
  assert.equal(selected.candidateId, "deep");
  assert.equal(selected.reasoningEffort, "high");
});

test("selection follows only explicit healthy fallback chains", () => {
  const candidates = [candidate("primary", 100, ["fallback"]), candidate("fallback", 1)];
  const statuses = new Map([["primary", health("primary", "unhealthy")], ["fallback", health("fallback", "healthy")]]);
  const selected = selectModelCandidate(candidates, statuses, { role: "executor", route: "hybrid", category: "mixed" });
  assert.equal(selected.candidateId, "fallback");
  assert.equal(selected.fallbackFrom, "primary");
});

test("selection prefers matching fast or complex labels before priority", () => {
  const general = candidate("general", 100);
  const fast = { ...candidate("fast", 1), tags: ["fast"] };
  const deep = { ...candidate("deep", 1), tags: ["complex"] };
  const statuses = new Map([general, fast, deep].map(({ id }) => [id, health(id, "healthy")]));
  assert.equal(selectModelCandidate([general, fast, deep], statuses, { role: "planner", route: "codex", category: "code_change", tags: ["fast"] }).candidateId, "fast");
  assert.equal(selectModelCandidate([general, fast, deep], statuses, { role: "executor", route: "hybrid", category: "mixed", tags: ["complex"] }).candidateId, "deep");
});

test("disabled, expired, unverified, unsupported, and absent candidates fail closed", () => {
  const item = candidate("only", 1);
  for (const state of ["expired", "unverified", "unhealthy"] as const) {
    assert.throws(() => selectModelCandidate([item], new Map([[item.id, health(item.id, state)]]), { role: "reviewer", route: "codex", category: "code_change" }), /No healthy configured candidate/);
  }
  assert.throws(() => selectModelCandidate([{ ...item, enabled: false }], new Map([[item.id, health(item.id, "healthy")]]), { role: "executor", route: "codex", category: "code_change" }), /No configured model candidate/);
  assert.throws(() => selectModelCandidate([item], new Map([[item.id, health(item.id, "healthy")]]), { role: "executor", route: "codex", category: "analysis" }), /No configured model candidate/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTaskComplexity } from "../src/task-analyzer.js";

test("analyzer assigns deterministic trivial, normal, complex, and high-risk bands with reasons", () => {
  const trivial = analyzeTaskComplexity({ text: "Explain the name", category: "advice", role: "planner", risk: "low" });
  assert.deepEqual([trivial.score, trivial.band, trivial.scope], [0, "trivial", "single"]);

  const normal = analyzeTaskComplexity({ text: "Implement one local formatter", category: "code_change", role: "planner", risk: "medium", routeSignals: ["code-change"] });
  assert.deepEqual([normal.score, normal.band], [5, "normal"]);

  const ordinaryExecutor = analyzeTaskComplexity({ text: "Implement one local formatter", category: "code_change", role: "executor", risk: "medium", routeSignals: ["code-change"] });
  assert.deepEqual([ordinaryExecutor.score, ordinaryExecutor.band], [6, "normal"]);

  const complex = analyzeTaskComplexity({ text: "Plan the change, then implement and test it", category: "code_change", role: "executor", risk: "medium", routeSignals: ["code-change", "plan-then-execute"] });
  assert.deepEqual([complex.score, complex.band, complex.scope], [9, "complex", "multi-step"]);

  const highRisk = analyzeTaskComplexity({ text: "Migrate production database and CI services", category: "infrastructure", role: "executor", risk: "high", routeSignals: ["infrastructure", "external-action", "plan-then-execute"] });
  assert.equal(highRisk.band, "high-risk");
  assert.ok(highRisk.score >= 11);
  assert.equal(highRisk.scope, "cross-system");
  assert.match(highRisk.reasons.join(" "), /category:infrastructure.*role:executor.*risk:high.*scope:cross-system/);
});

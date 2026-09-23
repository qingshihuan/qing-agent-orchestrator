import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assessDelegationBenefit, type DelegationEvidence } from "../src/delegation-benefit.js";
import { routeTask } from "../src/task-router.js";
import { decideOrchestration, reclassifyRemainingPhase, defaultOrchestrationConfig } from "../src/orchestration-policy.js";
import { NodeProcessRunner } from "../src/process-runner.js";
const evidence: DelegationEvidence = { boundary: "whole-task", contract: "fixed", acceptance: "ready", work: "substantial", parentWork: "integration-only" };
const sequential = "先规划接口，然后实现并测试";
const independent = "按固定接口独立实现完整模块并通过既定验收测试，父任务只做集成验收";

test("ordinary sequential work no longer buys an extra delegation by complexity alone", () => {
  for (const task of [sequential, "先重构认证接口，然后实现缓存并运行相关测试"]) {
    const decision = routeTask(task);
    assert.equal(decision.orchestration.tier, "direct");
    assert.equal(decision.orchestration.childAgentBudget, 0);
    assert.equal(decision.orchestration.modelSelectionRequired, false);
    assert.equal(decision.orchestration.parentVerification, true);
    assert.equal(decision.execution.delegationTarget, "outer-session");
  }
});
test("score and mixed category alone do not prove an economic benefit", () => {
  for (const band of ["normal", "complex", "high-risk"] as const) {
    const decision = decideOrchestration({ text: sequential, route: "hybrid", category: "mixed", signals: [], complexity: { score: 90, band, category: "mixed", role: "planner", risk: "medium", scope: "multi-step", signals: [], reasons: [] } });
    assert.equal(decision.tier, "direct");
  }
});
test("unknown evidence defaults Direct without requesting an estimator", () => {
  assert.equal(assessDelegationBenefit("实现复杂模块").worthwhile, false);
  assert.equal(assessDelegationBenefit("实现模块", {} as DelegationEvidence).worthwhile, false);
});
test("one substantial whole implementation can still use Lite automatically", () => {
  const decision = routeTask("实现模块", { delegationEvidence: evidence });
  assert.equal(decision.orchestration.tier, "lite");
  assert.equal(decision.orchestration.childAgentBudget, 1);
  assert.equal(decision.orchestration.maxRevisions, 1);
  assert.equal(decision.orchestration.parentVerification, true);
});
test("clear fixed-contract text supports automatic Lite without a user routing flag", () => {
  assert.equal(routeTask(independent).orchestration.tier, "lite");
});
test("missing acceptance, unknown contract and tiny slices remain Direct", () => {
  for (const overrides of [{ acceptance: "unknown" }, { contract: "unknown" }, { work: "small" }, { work: "unknown" }] as const) {
    assert.equal(routeTask("实现模块", { delegationEvidence: { ...evidence, ...overrides } }).orchestration.tier, "direct");
  }
});
test("blocked, duplicate or dominant parent work rejects a cheap-child-only argument", () => {
  for (const parentWork of ["blocked", "duplicate-work", "dominates", "unknown"] as const) {
    assert.equal(assessDelegationBenefit("实现模块", { ...evidence, parentWork }).worthwhile, false);
  }
});
test("a substantial slice does not bypass the single-owner whole-task policy", () => {
  assert.equal(assessDelegationBenefit("实现模块", { ...evidence, boundary: "independent-slice", parentWork: "independent-work" }).worthwhile, false);
  assert.equal(assessDelegationBenefit("实现模块", { ...evidence, boundary: "independent-slice" }).worthwhile, false);
  assert.equal(assessDelegationBenefit("实现模块", { ...evidence, boundary: "coupled" }).worthwhile, false);
});
test("explicit bounded delegation is respected but negated delegation is not forced", () => {
  assert.equal(routeTask("使用 Qing Lite："+sequential).orchestration.tier, "lite");
  assert.equal(routeTask("不要创建子智能体，"+sequential).orchestration.tier, "direct");
  assert.equal(assessDelegationBenefit("do not delegate; implement the task", evidence).worthwhile, false);
});
test("Actual risk and explicitly configured review always outrank savings", () => {
  for (const task of ["实现修复并部署到生产环境", "推送到 origin/main", "读取命名密钥", "同时修改前后端并部署到生产环境", "并行执行破坏性数据库迁移", "使用完整 Qing 并安排独立 Reviewer 实现功能", "使用 CLI 执行生产部署"]) {
    const decision = routeTask(task, { delegationEvidence: { ...evidence, work: "small" } });
    assert.equal(decision.orchestration.tier, "full", task);
    assert.equal(decision.orchestration.independentReviewer, true, task);
  }
  assert.equal(routeTask(sequential, { orchestration: { ...defaultOrchestrationConfig, mode: "full" } }).orchestration.tier, "full");
});
test("de-escalating costly delegation never erases pending independent review", () => {
  const decision = routeTask(sequential);
  const input = { text: sequential, route: decision.route, category: decision.category, complexity: decision.complexity, signals: decision.signals, state: { previousTier: "full" as const, pendingIndependentReview: true, unacceptedHighRiskArtifact: true } };
  const implementation = reclassifyRemainingPhase({ ...input, milestone: "before-child-creation" });
  assert.equal(implementation.decision.tier, "direct");
  assert.equal(implementation.state.pendingIndependentReview, true);
  const review = reclassifyRemainingPhase({ ...input, state: implementation.state, milestone: "before-review" });
  assert.equal(review.decision.independentReviewer, true);
  assert.equal(review.decision.tier, "full");
});
test("actual sequential dispatch/start never start a Planner, write a Handoff or probe a model", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-parent-cost-"));
  try {
    const config = join(directory, "config.json");
    const handoff = join(directory, "unexpected-handoff.json");
    await writeFile(config, JSON.stringify({ executor: { codexExec: { command: "qing-must-not-start-a-model" } } }));
    const runner = new NodeProcessRunner();
    for (const command of ["dispatch", "start"]) {
      const result = await runner.run({ command: process.execPath, args: ["dist/src/cli.js", command, "--task", sequential, "--workspace", directory, "--config", config, "--out", handoff, "--compact"], cwd: process.cwd(), stdin: "", timeoutMs: 20000, maxOutputBytes: 200000 });
      assert.equal(result.exitCode, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.status, "DIRECT_EXECUTION_REQUIRED");
      assert.equal(output.model, null);
      assert.equal(output.modelProbe, "not-applicable");
      assert.equal(output.handoffPath, null);
    }
    await assert.rejects(access(handoff));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("entry contracts keep Direct free of control-plane work and defer model policy", async () => {
  for (const name of ["qing-agent-orchestrator", "qing-agent-orchestrator-full"]) {
    const entry = await readFile(".agents/skills/"+name+"/SKILL.md", "utf8");
    assert.match(entry, /## Direct fast path/);
    assert.match(entry, /do not preload references or schemas, call dispatch\/start\/doctor\/models/);
    assert.match(entry, /not a separate model round/);
    assert.match(entry, /Unknown benefit defaults Direct/);
    assert.match(entry, /Never skip required review or verification/);
    assert.ok(Buffer.byteLength(entry) < (name.endsWith("-full") ? 3300 : 2900));
  }
});
test("Lite requires tested whole units, no duplicate implementation and independent parent acceptance", async () => {
  for (const name of ["qing-agent-orchestrator", "qing-agent-orchestrator-full"]) {
    const policy = await readFile(".agents/skills/"+name+"/references/orchestrator-spec.md", "utf8");
    assert.match(policy, /implements and runs the agreed checks before returning/);
    assert.match(policy, /Do not redo child implementation/);
    assert.match(policy, /parent's test is not replaced by child self-report/);
    assert.match(policy, /At most one revision brief/);
    assert.match(policy, /not enforcement of host token budgets/);
  }
});


test("English fixed-contract hints route automatically while costly or incomplete hints stay Direct", () => {
  const text = "self-contained implementation, fixed interface, existing acceptance tests, parent only verifies";
  assert.equal(assessDelegationBenefit(text).worthwhile, true);
  assert.equal(assessDelegationBenefit(text + "; tiny helper").worthwhile, false);
  assert.equal(assessDelegationBenefit(text.replace("existing acceptance tests", "unknown checks")).worthwhile, false);
});

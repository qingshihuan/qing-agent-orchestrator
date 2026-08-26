import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { NodeProcessRunner } from "../src/process-runner.js";
import { respondToCliRecommendation } from "../src/execution-mode-router.js";
import { evaluateSafetyGate } from "../src/safety-gate.js";
import { createPendingDispatchHandoff, routeTask } from "../src/task-router.js";

test("one-sentence router covers chat, codex, hybrid, and negated risk terms", () => {
  const chat = routeTask("解释这个项目的作用");
  assert.equal(chat.route, "chat");
  assert.equal(chat.executionOwner, "ChatGPT");
  assert.equal("responseOwner" in chat, false);
  assert.equal(chat.execution.mode, "desktop-native");
  assert.equal(chat.execution.delegationTarget, "outer-session");
  assert.equal(chat.orchestration.tier, "direct");
  assert.equal(chat.orchestration.childAgentBudget, 0);
  assert.equal(chat.orchestration.independentReviewer, false);
  assert.equal(routeTask("只读分析这段日志并告诉我原因").route, "chat");
  const codeRoute = routeTask("实现一个示例功能");
  assert.equal(codeRoute.route, "codex");
  assert.equal(codeRoute.execution.mode, "desktop-native");
  assert.equal(codeRoute.execution.delegationTarget, "outer-session");
  assert.equal(codeRoute.orchestration.tier, "direct");
  const lite = routeTask("先规划接口，然后实现并测试");
  assert.equal(lite.route, "hybrid");
  assert.equal(lite.orchestration.tier, "lite");
  assert.equal(lite.orchestration.childAgentBudget, 1);
  assert.equal(lite.orchestration.independentReviewer, false);
  assert.equal(lite.orchestration.maxRevisions, 1);
  const negated = routeTask("实现登录修复，但不要发布、部署或发送消息");
  assert.equal(negated.route, "codex");
  assert.equal(negated.signals.includes("infrastructure"), false);
  assert.equal(negated.signals.includes("external-action"), false);
  assert.equal(routeTask("实现修复并部署到生产环境").route, "hybrid");
});

test("adaptive orchestration reserves Full for high-risk, cross-system, parallel, or explicit full work", () => {
  for (const goal of [
    "实现修复并部署到生产环境",
    "同时修改前后端和数据库服务",
    "并行处理多个独立工作流",
    "使用完整 Qing 并安排独立 Reviewer 实现功能",
  ]) {
    const decision = routeTask(goal);
    assert.equal(decision.orchestration.tier, "full", goal);
    assert.ok(decision.orchestration.childAgentBudget >= 1, goal);
    assert.equal(decision.orchestration.independentReviewer, true, goal);
    assert.equal(decision.orchestration.modelSelectionRequired, true, goal);
  }
  const forced = routeTask("实现一个示例功能", { orchestration: { mode: "full", liteMaxChildren: 1, fullMaxChildren: 2, liteMaxRevisions: 1, fullMaxRevisions: 1, reviewerMode: "risk-based" } });
  assert.equal(forced.orchestration.tier, "full");
  assert.equal(forced.orchestration.childAgentBudget, 2);
});

test("chat cannot create a Handoff and executable routes create an exact pending ID", () => {
  const chat = routeTask("给我一些建议");
  assert.throws(() => createPendingDispatchHandoff("给我一些建议", process.cwd(), chat), /must not create a Handoff/);
  const decision = routeTask("实现一个示例功能");
  const handoff = createPendingDispatchHandoff("实现一个示例功能", process.cwd(), decision);
  assert.match(handoff.id, /^qing-dispatch-/);
  assert.equal(handoff.requestedOperations.some(({ type }) => type === "write"), true);
});

test("high-effect language declares the exact gated operation and negated effects stay absent", () => {
  const cases = [
    ["删除旧文件", "delete"],
    ["推送到 origin/main", "git_push"],
    ["购买付费服务", "purchase"],
    ["修改全局配置", "global_write"],
    ["更新系统级配置", "global_write"],
    ["读取命名密钥", "use_secret"],
    ["访问私有认证服务", "network_access"],
    ["扩大任务范围并实现新增模块", "scope_expansion"],
    ["执行破坏性数据库迁移", "database_migration"],
    ["全局安装构建工具", "install_dependency"],
  ] as const;
  for (const [goal, operation] of cases) {
    const decision = routeTask(goal);
    assert.equal(decision.orchestration.tier, "full", goal);
    const handoff = createPendingDispatchHandoff(goal, process.cwd(), decision);
    assert.equal(handoff.requestedOperations.some(({ type }) => type === operation), true, goal);
    assert.equal(evaluateSafetyGate(handoff).outcome, "REQUIRE_APPROVAL", goal);
  }

  const negated = routeTask("实现修复，但不要删除、不要推送、不要购买、不要读取密钥，也不要扩大范围");
  const handoff = createPendingDispatchHandoff("实现修复，但不要删除、不要推送、不要购买、不要读取密钥，也不要扩大范围", process.cwd(), negated);
  for (const operation of ["delete", "git_push", "purchase", "use_secret", "scope_expansion"]) {
    assert.equal(handoff.requestedOperations.some(({ type }) => type === operation), false, operation);
  }
});

test("actionable CLI conditions route to execution while conceptual mentions stay in desktop chat", async () => {
  const actionable = [
    "明确切换到 CLI 完成这个任务",
    "把它接入 GitHub Actions CI",
    "每天定时无人值守运行",
    "关闭桌面应用后继续运行",
    "给外部程序提供 status/logs/cancel 机器可读接口",
    "使用仅能在 CLI 中配置的模型",
    "放入独立进程和任务队列",
  ];
  for (const goal of actionable) {
    const full = routeTask(goal, { edition: "full" });
    assert.notEqual(full.route, "chat", goal);
    assert.equal(full.execution.mode, "cli-recommended", goal);
    assert.equal(full.execution.delegationTarget, "internal-child", goal);
    const standard = routeTask(goal, { edition: "standard" });
    assert.notEqual(standard.route, "chat", goal);
    assert.equal(standard.execution.mode, "desktop-native", goal);
    assert.deepEqual(standard.execution.reasonCodes, [], goal);
  }

  for (const goal of ["请解释 GitHub Actions CI 的工作原理", "只读分析定时脚本", "说明独立进程和任务队列的区别"]) {
    const decision = routeTask(goal, { edition: "full" });
    assert.equal(decision.route, "chat", goal);
    assert.equal(decision.execution.mode, "desktop-native", goal);
  }

  const ci = routeTask("把它接入 GitHub Actions CI", { edition: "full" });
  const accepted = await respondToCliRecommendation(ci.execution, "accept", { inspect: async () => "ready" });
  assert.equal(accepted.mode, "cli-full-planning");
  const pending = createPendingDispatchHandoff("把它接入 GitHub Actions CI", process.cwd(), ci);
  assert.match(pending.id, /^qing-dispatch-/);
  assert.equal(pending.category, "code_change");
});

test("start never invokes a Handoff Planner for Direct or Lite tiers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qing-start-tier-"));
  const runner = new NodeProcessRunner();
  const config = join(directory, "relay.json");
  const directOut = join(directory, "direct.json");
  const liteOut = join(directory, "lite.json");
  await writeFile(config, JSON.stringify({ executor: { codexExec: { command: "qing-planner-must-not-run" } } }), "utf8");
  const base = { command: process.execPath, cwd: process.cwd(), stdin: "", timeoutMs: 10_000, maxOutputBytes: 256_000 };
  try {
    const direct = await runner.run({ ...base, args: ["dist/src/cli.js", "start", "--task", "实现一个示例功能", "--workspace", directory, "--planner", "codex", "--out", directOut, "--config", config] });
    assert.equal(direct.exitCode, 0, direct.stderr);
    const directOutput = JSON.parse(direct.stdout) as Record<string, unknown>;
    assert.equal(directOutput.status, "DIRECT_EXECUTION_REQUIRED");
    assert.equal(directOutput.modelSelection, null);
    assert.equal(directOutput.plannerSource, null);

    const lite = await runner.run({ ...base, args: ["dist/src/cli.js", "start", "--task", "先规划接口，然后实现并测试", "--workspace", directory, "--planner", "codex", "--out", liteOut, "--config", config] });
    assert.equal(lite.exitCode, 0, lite.stderr);
    const liteOutput = JSON.parse(lite.stdout) as Record<string, unknown>;
    assert.equal(liteOutput.status, "LITE_EXECUTION_REQUIRED");
    assert.equal(liteOutput.plannerSource, null);
    assert.equal(liteOutput.modelProbe, "not-applicable");

    await assert.rejects(access(directOut));
    await assert.rejects(access(liteOut));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dispatch exposes Direct, Lite, Full-ready, and gated Full without silent execution", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "qing-dispatch-workspace-"));
  const runner = new NodeProcessRunner();
  const base = { command: process.execPath, cwd: process.cwd(), stdin: "", timeoutMs: 10_000, maxOutputBytes: 256_000 };
  try {
    const chat = await runner.run({ ...base, args: ["dist/src/cli.js", "dispatch", "--task", "解释这个项目的作用", "--workspace", workspace, "--config", "config/relay.example.json", "--no-model-probe"] });
    assert.equal(chat.exitCode, 0);
    const chatOutput = JSON.parse(chat.stdout) as Record<string, unknown>;
    assert.equal(chatOutput.status, "DIRECT_EXECUTION_REQUIRED");
    assert.equal(chatOutput.executionOwner, "ChatGPT");
    assert.doesNotMatch(chat.stdout, /responseOwner/);
    assert.equal(chatOutput.handoffId, null);
    assert.equal(chatOutput.modelSelection, null);

    const code = await runner.run({ ...base, args: ["dist/src/cli.js", "dispatch", "--task", "实现一个示例功能", "--workspace", workspace, "--config", "config/relay.example.json", "--no-model-probe"] });
    assert.equal(code.exitCode, 0, code.stderr);
    const codeOutput = JSON.parse(code.stdout) as Record<string, unknown>;
    assert.equal(codeOutput.status, "DIRECT_EXECUTION_REQUIRED");
    assert.equal(codeOutput.executionOwner, "ChatGPT");
    assert.doesNotMatch(code.stdout, /responseOwner/);
    assert.equal(codeOutput.handoffId, null);
    assert.equal(codeOutput.modelProbe, "not-applicable");
    assert.equal(codeOutput.modelSelection, null);
    assert.equal(codeOutput.delegationInvocation, null);

    const liteRun = await runner.run({ ...base, args: ["dist/src/cli.js", "dispatch", "--task", "先规划接口，然后实现并测试", "--workspace", workspace, "--config", "config/relay.example.json", "--no-model-probe"] });
    assert.equal(liteRun.exitCode, 0, liteRun.stderr);
    const liteOutput = JSON.parse(liteRun.stdout) as Record<string, unknown>;
    assert.equal(liteOutput.status, "LITE_EXECUTION_REQUIRED");
    const selected = liteOutput.modelSelection as Record<string, unknown>;
    assert.equal(selected.complexityBand, "normal");
    assert.equal(selected.model, "gpt-5.6-luna");
    assert.equal(selected.executionOwner, "Codex");
    assert.equal(liteOutput.reviewerModelSelection, null);
    const liteOrchestration = liteOutput.orchestration as { childAgentBudget: number; maxRevisions: number; parentVerification: boolean };
    assert.deepEqual(liteOrchestration, { ...(liteOutput.orchestration as object), childAgentBudget: 1, maxRevisions: 1, parentVerification: true });
    type DelegationInvocation = {
      executionOwner: string;
      spawnAgent: { model: string; reasoning_effort: string };
      parentModelUnchanged: boolean;
      fallbackPlan: { orderedCandidates: Array<{ candidateId: string }> };
      retryProtocol: { displayReplacementBeforeRetry: boolean; recordFallbackReason: boolean; reuseExistingGatesWhenScopeUnchanged: boolean };
    };
    const liteInvocation = liteOutput.delegationInvocation as DelegationInvocation;
    assert.deepEqual(liteInvocation.spawnAgent, { model: "gpt-5.6-luna", reasoning_effort: "medium" });
    assert.equal(liteInvocation.executionOwner, "Codex");
    assert.equal(liteInvocation.parentModelUnchanged, true);
    assert.deepEqual(liteInvocation.fallbackPlan.orderedCandidates.map(({ candidateId }) => candidateId), ["desktop-luna-normal", "desktop-terra-normal"]);
    assert.equal(liteInvocation.retryProtocol.displayReplacementBeforeRetry, true);
    assert.equal(liteInvocation.retryProtocol.recordFallbackReason, true);
    assert.equal(liteInvocation.retryProtocol.reuseExistingGatesWhenScopeUnchanged, true);

    const serializedOwnerKeys = (value: unknown): string[] => {
      if (Array.isArray(value)) return value.flatMap(serializedOwnerKeys);
      if (!value || typeof value !== "object") return [];
      return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => [
        ...(key.toLowerCase().endsWith("owner") ? [key] : []),
        ...serializedOwnerKeys(nested),
      ]);
    };
    for (const output of [chatOutput, codeOutput, liteOutput]) {
      const ownerKeys = serializedOwnerKeys(output);
      assert.ok(ownerKeys.length > 0);
      assert.equal(ownerKeys.every((key) => key === "executionOwner"), true, ownerKeys.join(","));
    }

    const inherited = await runner.run({ ...base, args: ["dist/src/cli.js", "dispatch", "--task", "先规划接口，然后实现并测试", "--workspace", workspace, "--config", "config/relay.user.example.json"] });
    assert.equal(inherited.exitCode, 0, inherited.stderr);
    const inheritedOutput = JSON.parse(inherited.stdout) as { modelSelection: unknown; delegationInvocation: { spawnAgent: unknown; inheritedDefaults: string[] } };
    assert.equal(inheritedOutput.modelSelection, null);
    assert.equal(inheritedOutput.delegationInvocation.spawnAgent, null);
    assert.deepEqual(inheritedOutput.delegationInvocation.inheritedDefaults, ["agents.default_subagent_model", "agents.default_subagent_reasoning_effort"]);

    const advice = await runner.run({ ...base, args: ["dist/src/cli.js", "dispatch", "--task", "请解释 GitHub Actions CI 的工作原理", "--workspace", workspace, "--config", "config/relay.example.json", "--no-model-probe"] });
    assert.equal(advice.exitCode, 0, advice.stderr);
    const adviceOutput = JSON.parse(advice.stdout) as Record<string, unknown>;
    assert.equal(adviceOutput.status, "DIRECT_EXECUTION_REQUIRED");
    assert.doesNotMatch(JSON.stringify(adviceOutput), /建议切换 CLI 模式/);

    const recommendation = await runner.run({ ...base, args: ["dist/src/cli.js", "dispatch", "--task", "把它接入 GitHub Actions CI", "--workspace", workspace, "--config", "config/relay.example.json", "--no-model-probe"] });
    assert.equal(recommendation.exitCode, 0, recommendation.stderr);
    const pending = JSON.parse(recommendation.stdout) as Record<string, unknown>;
    assert.equal(pending.status, "CLI_RECOMMENDATION_REQUIRED");
    assert.equal(pending.handoffId, null);
    assert.match(JSON.stringify(pending), /建议切换 CLI 模式/);

    const declined = await runner.run({ ...base, args: ["dist/src/cli.js", "dispatch", "--task", "把它接入 GitHub Actions CI", "--workspace", workspace, "--config", "config/relay.example.json", "--cli-response", "decline"] });
    assert.equal(declined.exitCode, 0, declined.stderr);
    const fallback = JSON.parse(declined.stdout) as Record<string, unknown>;
    assert.equal(fallback.status, "FULL_EXECUTION_READY");
    assert.match(JSON.stringify(fallback), /desktop-fallback/);
    assert.match(String(fallback.handoffId), /^qing-dispatch-/);
    assert.match(JSON.stringify(fallback), /internal-child/);

    const gated = await runner.run({ ...base, args: ["dist/src/cli.js", "dispatch", "--task", "实现修复并部署到生产环境", "--workspace", workspace, "--config", "config/relay.example.json", "--no-model-probe"] });
    assert.equal(gated.exitCode, 0, gated.stderr);
    const gatedOutput = JSON.parse(gated.stdout) as { status: string; safetyGate: { outcome: string }; orchestration: { independentReviewer: boolean }; reviewerModelSelection: { role: string } };
    assert.equal(gatedOutput.status, "AWAITING_APPROVAL");
    assert.equal(gatedOutput.safetyGate.outcome, "REQUIRE_APPROVAL");
    assert.equal(gatedOutput.orchestration.independentReviewer, true);
    assert.equal(gatedOutput.reviewerModelSelection.role, "reviewer");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

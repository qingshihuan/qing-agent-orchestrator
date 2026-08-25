import assert from "node:assert/strict";
import test from "node:test";
import { detectCliReasonCodes, respondToCliRecommendation, routeExecutionMode } from "../src/execution-mode-router.js";

test("standard and ordinary full tasks stay desktop-native", () => {
  for (const edition of ["standard", "full"] as const) {
    for (const goal of [
      "解释这个项目",
      "实现登录功能并运行测试",
      "先设计架构然后完成复杂重构",
      "这个工作可能需要运行几个小时",
    ]) {
      const route = goal.startsWith("解释") ? "chat" : goal.includes("先") ? "hybrid" : "codex";
      const decision = routeExecutionMode(goal, edition, route);
      assert.equal(decision.mode, "desktop-native", `${edition}: ${goal}`);
      assert.equal(decision.recommendation, null);
      assert.equal(decision.currentParentModelUnchanged, true);
      assert.equal(decision.modelSelectionScope, "delegated-task");
      assert.equal(decision.executionOwner, route === "chat" ? "ChatGPT" : "Codex");
    }
  }
});

test("desktop delegation defaults internal, direct chat stays parent, and explicit visible tasks stay separate", () => {
  const delegated = routeExecutionMode("实现功能", "full", "codex");
  assert.equal(delegated.delegationTarget, "internal-child");
  assert.equal(delegated.executionOwner, "Codex");
  const chat = routeExecutionMode("解释概念", "full", "chat");
  assert.equal(chat.delegationTarget, "outer-session");
  assert.equal(chat.executionOwner, "ChatGPT");
  const visible = routeExecutionMode("新开任务实现功能", "full", "codex");
  assert.equal(visible.delegationTarget, "visible-task");
  assert.equal(visible.returnsToParent, false);
  assert.equal(visible.executionOwner, "Codex");
});

test("only bounded full-edition conditions recommend CLI", () => {
  const cases = new Map([
    ["明确切换到 CLI 完成这个任务", "explicit-cli-request"],
    ["把它接入 GitHub Actions CI", "script-or-ci"],
    ["每天定时无人值守运行", "scheduled-batch-unattended"],
    ["关闭桌面应用后继续运行", "app-close-persistence"],
    ["给外部程序提供 status/logs/cancel 机器可读接口", "machine-readable-control-plane"],
    ["使用仅能在 CLI 中配置的模型", "cli-only-model-or-environment"],
    ["放入独立进程和任务队列", "process-isolation-or-queue"],
  ] as const);
  for (const [goal, reason] of cases) {
    const full = routeExecutionMode(goal, "full", "codex");
    assert.equal(full.mode, "cli-recommended", goal);
    assert.equal(full.recommendation?.message, "建议切换 CLI 模式");
    assert.equal(full.reasonCodes.includes(reason), true, goal);
    assert.equal(full.recommendation?.requiresUserChoice, true);
    const standard = routeExecutionMode(goal, "standard", "codex");
    assert.equal(standard.mode, "desktop-native", goal);
    assert.deepEqual(standard.reasonCodes, []);
  }
});

test("negated and near-match language does not recommend CLI", () => {
  for (const goal of ["不要使用 CLI，继续桌面完成", "不需要 CI，只写代码", "脚本的故事情节很精彩", "这是一个长期复杂任务"]) {
    assert.deepEqual(detectCliReasonCodes(goal), [], goal);
    assert.equal(routeExecutionMode(goal, "full", "codex").mode, "desktop-native");
  }
});

test("advice and analysis can mention CLI-related concepts without recommending a process backend", () => {
  for (const goal of [
    "请解释 GitHub Actions CI 的工作原理",
    "只读分析这个定时脚本为什么失败",
    "说明独立进程和任务队列的区别",
    "explain CLI mode without executing anything",
  ]) {
    const decision = routeExecutionMode(goal, "full", "chat");
    assert.equal(decision.mode, "desktop-native", goal);
    assert.deepEqual(decision.reasonCodes, [], goal);
    assert.equal(decision.recommendation, null, goal);
  }
});

test("declining never inspects dependencies and deterministically falls back to desktop", async () => {
  const pending = routeExecutionMode("关闭桌面应用后继续运行", "full", "codex");
  let calls = 0;
  const declined = await respondToCliRecommendation(pending, "decline", { inspect: async () => { calls += 1; return "ready"; } });
  assert.equal(calls, 0);
  assert.equal(declined.mode, "desktop-fallback");
  assert.equal(declined.executionOwner, "Codex");
  assert.equal(declined.recommendation?.response, "declined");
  assert.equal(declined.suppressCliPromptForTask, true);
  assert.equal(declined.limitations.length, 1);
});

test("declining discloses every backend-exclusive limitation but keeps desktop-capable CI work available", async () => {
  const backendExclusive = [
    "每天定时无人值守运行",
    "关闭桌面应用后继续运行",
    "给外部程序提供 status/logs/cancel 机器可读接口",
    "使用仅能在 CLI 中配置的模型",
    "放入独立进程和任务队列",
  ];
  for (const goal of backendExclusive) {
    const declined = await respondToCliRecommendation(routeExecutionMode(goal, "full", "codex"), "decline");
    assert.equal(declined.mode, "desktop-fallback", goal);
    assert.equal(declined.suppressCliPromptForTask, true, goal);
    assert.equal(declined.limitations.length, 1, goal);
  }
  const isolated = await respondToCliRecommendation(routeExecutionMode("放入独立进程和任务队列", "full", "codex"), "decline");
  assert.match(isolated.limitations[0] ?? "", /独立进程.*任务队列.*进程隔离/);
  const ci = await respondToCliRecommendation(routeExecutionMode("把它接入 GitHub Actions CI", "full", "codex"), "decline");
  assert.deepEqual(ci.limitations, []);
});

test("accepting checks the conditional dependency once but still cannot start a task", async () => {
  for (const [status, mode] of [["missing", "cli-setup-required"], ["authentication-required", "cli-setup-required"], ["ready", "cli-full-planning"]] as const) {
    const pending = routeExecutionMode("使用 CLI 完成任务", "full", "codex");
    let calls = 0;
    const accepted = await respondToCliRecommendation(pending, "accept", { inspect: async () => { calls += 1; return status; } });
    assert.equal(calls, 1);
    assert.equal(accepted.mode, mode);
    assert.equal(accepted.recommendation?.response, "accepted");
    assert.equal(accepted.recommendation?.dependencyStatus, status);
    assert.equal(accepted.recommendation?.installGuide, "https://learn.chatgpt.com/docs/codex/cli");
  }
});

test("responses fail closed without a pending full-edition recommendation", async () => {
  const desktop = routeExecutionMode("实现功能", "full", "codex");
  await assert.rejects(respondToCliRecommendation(desktop, "decline"), /no pending/i);
  const pending = routeExecutionMode("使用 CLI", "full", "codex");
  await assert.rejects(respondToCliRecommendation(pending, "accept"), /dependency inspector/i);
});

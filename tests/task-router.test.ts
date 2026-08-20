import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { NodeProcessRunner } from "../src/process-runner.js";
import { respondToCliRecommendation } from "../src/execution-mode-router.js";
import { createPendingDispatchHandoff, routeTask } from "../src/task-router.js";

test("one-sentence router covers chat, codex, hybrid, and negated risk terms", () => {
  const chat = routeTask("解释这个项目的作用");
  assert.equal(chat.route, "chat");
  assert.equal(chat.executionOwner, "ChatGPT");
  assert.equal("responseOwner" in chat, false);
  assert.equal(chat.execution.mode, "desktop-native");
  assert.equal(chat.execution.delegationTarget, "outer-session");
  assert.equal(routeTask("只读分析这段日志并告诉我原因").route, "chat");
  const codeRoute = routeTask("实现一个示例功能");
  assert.equal(codeRoute.route, "codex");
  assert.equal(codeRoute.execution.mode, "desktop-native");
  assert.equal(codeRoute.execution.delegationTarget, "internal-child");
  assert.equal(routeTask("先规划接口，然后实现并测试").route, "hybrid");
  const negated = routeTask("实现登录修复，但不要发布、部署或发送消息");
  assert.equal(negated.route, "codex");
  assert.equal(negated.signals.includes("infrastructure"), false);
  assert.equal(negated.signals.includes("external-action"), false);
  assert.equal(routeTask("实现修复并部署到生产环境").route, "hybrid");
});

test("chat cannot create a Handoff and executable routes create an exact pending ID", () => {
  const chat = routeTask("给我一些建议");
  assert.throws(() => createPendingDispatchHandoff("给我一些建议", process.cwd(), chat), /must not create a Handoff/);
  const decision = routeTask("实现一个示例功能");
  const handoff = createPendingDispatchHandoff("实现一个示例功能", process.cwd(), decision);
  assert.match(handoff.id, /^qing-dispatch-/);
  assert.equal(handoff.requestedOperations.some(({ type }) => type === "write"), true);
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
  assert.equal(accepted.mode, "cli-awaiting-handoff-approval");
  const pending = createPendingDispatchHandoff("把它接入 GitHub Actions CI", process.cwd(), ci);
  assert.match(pending.id, /^qing-dispatch-/);
  assert.equal(pending.category, "code_change");
});

test("dispatch keeps chat child-free, returns desktop execution for code, and never silently enters CLI", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "qing-dispatch-workspace-"));
  const runner = new NodeProcessRunner();
  const base = { command: process.execPath, cwd: process.cwd(), stdin: "", timeoutMs: 10_000, maxOutputBytes: 256_000 };
  try {
    const chat = await runner.run({ ...base, args: ["dist/src/cli.js", "dispatch", "--task", "解释这个项目的作用", "--workspace", workspace, "--config", "config/relay.example.json", "--no-model-probe"] });
    assert.equal(chat.exitCode, 0);
    const chatOutput = JSON.parse(chat.stdout) as Record<string, unknown>;
    assert.equal(chatOutput.status, "CHAT_RESPONSE_REQUIRED");
    assert.equal(chatOutput.executionOwner, "ChatGPT");
    assert.doesNotMatch(chat.stdout, /responseOwner/);
    assert.equal(chatOutput.handoffId, null);
    assert.equal(chatOutput.modelSelection, null);

    const code = await runner.run({ ...base, args: ["dist/src/cli.js", "dispatch", "--task", "实现一个示例功能", "--workspace", workspace, "--config", "config/relay.example.json", "--no-model-probe"] });
    assert.equal(code.exitCode, 0, code.stderr);
    const codeOutput = JSON.parse(code.stdout) as Record<string, unknown>;
    assert.equal(codeOutput.status, "DESKTOP_EXECUTION_REQUIRED");
    assert.equal(codeOutput.executionOwner, "Codex");
    assert.doesNotMatch(code.stdout, /responseOwner/);
    assert.equal(codeOutput.handoffId, null);
    assert.equal(codeOutput.modelProbe, "not-applicable");
    const selected = codeOutput.modelSelection as Record<string, unknown>;
    assert.equal(selected.complexityBand, "normal");
    assert.equal(selected.model, "gpt-5.6-luna");
    assert.equal(selected.executionOwner, "Codex");
    const invocation = codeOutput.delegationInvocation as {
      executionOwner: string;
      spawnAgent: { model: string; reasoning_effort: string };
      parentModelUnchanged: boolean;
      fallbackPlan: { orderedCandidates: Array<{ candidateId: string }> };
      retryProtocol: { displayReplacementBeforeRetry: boolean; recordFallbackReason: boolean; reuseExistingGatesWhenScopeUnchanged: boolean };
    };
    assert.deepEqual(invocation.spawnAgent, { model: "gpt-5.6-luna", reasoning_effort: "medium" });
    assert.equal(invocation.executionOwner, "Codex");
    assert.equal(invocation.parentModelUnchanged, true);
    assert.deepEqual(invocation.fallbackPlan.orderedCandidates.map(({ candidateId }) => candidateId), ["desktop-luna-normal", "desktop-terra-normal"]);
    assert.equal(invocation.retryProtocol.displayReplacementBeforeRetry, true);
    assert.equal(invocation.retryProtocol.recordFallbackReason, true);
    assert.equal(invocation.retryProtocol.reuseExistingGatesWhenScopeUnchanged, true);

    const serializedOwnerKeys = (value: unknown): string[] => {
      if (Array.isArray(value)) return value.flatMap(serializedOwnerKeys);
      if (!value || typeof value !== "object") return [];
      return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => [
        ...(key.toLowerCase().endsWith("owner") ? [key] : []),
        ...serializedOwnerKeys(nested),
      ]);
    };
    for (const output of [chatOutput, codeOutput]) {
      const ownerKeys = serializedOwnerKeys(output);
      assert.ok(ownerKeys.length > 0);
      assert.equal(ownerKeys.every((key) => key === "executionOwner"), true, ownerKeys.join(","));
    }

    const inherited = await runner.run({ ...base, args: ["dist/src/cli.js", "dispatch", "--task", "实现一个示例功能", "--workspace", workspace, "--config", "config/relay.user.example.json"] });
    assert.equal(inherited.exitCode, 0, inherited.stderr);
    const inheritedOutput = JSON.parse(inherited.stdout) as { modelSelection: unknown; delegationInvocation: { spawnAgent: unknown; inheritedDefaults: string[] } };
    assert.equal(inheritedOutput.modelSelection, null);
    assert.equal(inheritedOutput.delegationInvocation.spawnAgent, null);
    assert.deepEqual(inheritedOutput.delegationInvocation.inheritedDefaults, ["agents.default_subagent_model", "agents.default_subagent_reasoning_effort"]);

    const advice = await runner.run({ ...base, args: ["dist/src/cli.js", "dispatch", "--task", "请解释 GitHub Actions CI 的工作原理", "--workspace", workspace, "--config", "config/relay.example.json", "--no-model-probe"] });
    assert.equal(advice.exitCode, 0, advice.stderr);
    const adviceOutput = JSON.parse(advice.stdout) as Record<string, unknown>;
    assert.equal(adviceOutput.status, "CHAT_RESPONSE_REQUIRED");
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
    assert.equal(fallback.status, "DESKTOP_EXECUTION_REQUIRED");
    assert.match(JSON.stringify(fallback), /desktop-fallback/);
    assert.equal(fallback.handoffId, null);
    assert.match(JSON.stringify(fallback), /internal-child/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

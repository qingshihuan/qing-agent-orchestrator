import assert from "node:assert/strict";
import test from "node:test";
import { NodeProcessRunner } from "../src/process-runner.js";
import { routeTask } from "../src/task-router.js";

const shortTask = "删除 src/index.js 中未使用的 console.log，并运行相关测试";
const mediumTask = "先重构认证接口，然后实现缓存并运行相关测试";
const longTask = "在同一个 TypeScript 仓库内完成一个范围明确的功能更新：调整路由器对文档、代码符号和路径的语义识别，同步更新相关单元测试和说明，保持公共 API 不变，不访问网络、不发布、不部署、不推送，并执行现有本地测试验证所有改动。所有修改必须留在当前仓库内，保留无关文件和用户已有改动。";

test("v0.7 routes short and long coupled work Direct and keeps medium work Lite", () => {
  const short = routeTask(shortTask);
  assert.equal(short.orchestration.tier, "direct");
  assert.equal(short.signals.includes("delete-action"), false);
  const medium = routeTask(mediumTask);
  assert.equal(medium.orchestration.tier, "lite");
  assert.equal(medium.orchestration.childAgentBudget, 1);
  const long = routeTask(longTask);
  assert.equal(long.orchestration.tier, "direct");
  assert.equal(long.orchestration.childAgentBudget, 0);
});

test("v0.7 compact dispatch preserves control facts while reducing output", async () => {
  const runner = new NodeProcessRunner();
  const base = { command: process.execPath, cwd: process.cwd(), stdin: "", timeoutMs: 20_000, maxOutputBytes: 2_000_000 };
  for (const taskText of [shortTask, mediumTask, longTask]) {
    const args = ["dist/src/cli.js", "dispatch", "--task", taskText, "--workspace", process.cwd(), "--config", "config/relay.example.json", "--no-model-probe"];
    const full = await runner.run({ ...base, args });
    const compact = await runner.run({ ...base, args: [...args, "--compact"] });
    assert.equal(full.exitCode, 0, full.stderr);
    assert.equal(compact.exitCode, 0, compact.stderr);
    const fullValue = JSON.parse(full.stdout) as Record<string, unknown>;
    const compactValue = JSON.parse(compact.stdout) as Record<string, unknown>;
    assert.equal(compactValue.status, fullValue.status);
    assert.ok(Buffer.byteLength(compact.stdout) < Buffer.byteLength(full.stdout) * 0.75, taskText);
  }
  const medium = await runner.run({ ...base, args: ["dist/src/cli.js", "dispatch", "--task", mediumTask, "--workspace", process.cwd(), "--config", "config/relay.example.json", "--no-model-probe", "--compact"] });
  const output = JSON.parse(medium.stdout) as { tier: string; model: { model: string; reasoningEffort: string } };
  assert.equal(output.tier, "lite");
  assert.equal(output.model.model, "gpt-5.6-luna");
  assert.equal(output.model.reasoningEffort, "medium");
});

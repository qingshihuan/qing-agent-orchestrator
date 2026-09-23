import assert from "node:assert/strict";
import test from "node:test";
import { routeTask } from "../src/task-router.js";

test("semantic routing keeps conceptual and code-edit language out of Full", () => {
  const cases = [
    ["修改 README 文档中的安装说明", "direct"],
    ["移除未使用的 import", "direct"],
    ["写一份版本发布说明", "direct"],
    ["修复用户认证逻辑", "direct"],
    ["实现一个私有辅助方法", "direct"],
    ["分析生产环境部署方案，不实际部署", "direct"],
    ["设计数据库迁移方案", "direct"],
  ] as const;

  for (const [prompt, tier] of cases) {
    const decision = routeTask(prompt);
    assert.equal(decision.orchestration.tier, tier, prompt);
    assert.equal(decision.orchestration.childAgentBudget, 0, prompt);
    assert.equal(decision.orchestration.independentReviewer, false, prompt);
    assert.equal(decision.orchestration.modelSelectionRequired, false, prompt);
  }
});

test("semantic routing still protects concrete consequential effects", () => {
  const cases = [
    ["删除 docs/legacy.md", "delete-action"],
    ["实现修复并部署到生产环境", "infrastructure"],
    ["发布到外部平台", "external-action"],
    ["访问私有认证服务", "private-network-action"],
    ["执行破坏性数据库迁移", "database-migration-action"],
    ["推送到 origin/main", "git-push-action"],
  ] as const;

  for (const [prompt, signal] of cases) {
    const decision = routeTask(prompt);
    assert.equal(decision.orchestration.tier, "full", prompt);
    assert.equal(decision.signals.includes(signal), true, prompt);
    assert.equal(decision.orchestration.independentReviewer, true, prompt);
  }
});

test("the routing benchmark restores the intended Direct Lite Full budget", () => {
  const cases = [
    ["解释这个项目的作用", "direct"],
    ["实现一个示例功能", "direct"],
    ["先规划接口，然后实现并测试", "direct"],
    ["按固定接口独立实现完整模块并通过既定验收测试，父任务只做集成验收", "lite"],
    ["重构 src/config.ts 并运行相关测试", "direct"],
    ["修改 README 文档中的安装说明", "direct"],
    ["移除未使用的 import", "direct"],
    ["写一份版本发布说明", "direct"],
    ["修复用户认证逻辑", "direct"],
    ["实现一个私有辅助方法", "direct"],
    ["分析生产环境部署方案，不实际部署", "direct"],
    ["删除 docs/legacy.md", "full"],
    ["实现修复并部署到生产环境", "full"],
    ["把项目接入 GitHub Actions CI", "lite"],
    ["同时修改前后端和数据库服务", "direct"],
    ["并行处理多个独立工作流", "direct"],
  ] as const;

  const counts = { direct: 0, lite: 0, full: 0 };
  let childBudget = 0;
  let reviewerCount = 0;
  let modelSelectionCount = 0;

  for (const [prompt, tier] of cases) {
    const decision = routeTask(prompt);
    assert.equal(decision.orchestration.tier, tier, prompt);
    counts[decision.orchestration.tier] += 1;
    childBudget += decision.orchestration.childAgentBudget;
    reviewerCount += Number(decision.orchestration.independentReviewer);
    modelSelectionCount += Number(decision.orchestration.modelSelectionRequired);
  }

  assert.deepEqual(counts, { direct: 12, lite: 2, full: 2 });
  assert.equal(childBudget, 6);
  assert.equal(reviewerCount, 2);
  assert.equal(modelSelectionCount, 4);
});

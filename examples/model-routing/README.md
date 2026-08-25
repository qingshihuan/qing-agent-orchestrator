# 自适应编排与模型路由示例

`config/relay.example.json` 使用当前桌面能力快照；实际 host/entitlement 可能漂移。

```powershell
# Direct：父任务处理，不分配子模型
node dist/src/cli.js dispatch --task "实现一个示例功能" --workspace . --config config/relay.example.json --no-model-probe
# status: DIRECT_EXECUTION_REQUIRED
# orchestration.childAgentBudget: 0
# modelSelection: null

# Lite：最多一个 Executor，由父任务验证
node dist/src/cli.js dispatch --task "先规划接口，然后实现并测试" --workspace . --config config/relay.example.json --no-model-probe
# status: LITE_EXECUTION_REQUIRED
# childAgentBudget: 1; independentReviewer: false; maxRevisions: 1
# delegated model: gpt-5.6-sol / xhigh (current example snapshot)

# Full ready：安全的完整合同不等待计划批准
node dist/src/cli.js dispatch --task "把它接入 GitHub Actions CI" --workspace . --config config/relay.example.json --cli-response decline
# status: FULL_EXECUTION_READY

# Full gated：生产效果只暂停对应 gate
node dist/src/cli.js dispatch --task "实现修复并部署到生产环境" --workspace . --config config/relay.example.json --no-model-probe
# status: AWAITING_APPROVAL
```

Task Analyzer 按 category、role、risk、scope 和 signals 产生 `trivial|normal|complex|high-risk`。Orchestration Router 先决定是否需要委派；只有 Lite/Full 才匹配 backend、role、route、category、complexity band 和 model/reasoning 候选。

桌面候选使用 host-advertised 快照。完整版本的进程候选还必须通过本机 bundled catalog 与受限只读 entitlement 探针。Fallback 只能沿显式同后端链，在展示替换 pair 和原因后继续；跨后端或安全范围变化重新进入 gate。

安全 Handoff 不要求 `--approve-handoff`。真实进程仍要求 `--allow-real-execution`，而删除、全局/系统修改、密钥、认证网络、外部写入、push、部署、购买、破坏性迁移或重大范围扩展继续要求精确 `--approve <gate-id>`。执行归属只报告 `ChatGPT` 或 `Codex`，不建立工具账本。

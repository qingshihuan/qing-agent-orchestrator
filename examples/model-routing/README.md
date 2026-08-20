# 一句话任务与模型路由示例

这些示例展示源码协议。`config/relay.example.json` 使用当前真实模型 ID，但 availability 仍是时间相关的 host/entitlement 快照，不保证任意安装或账户可用。

```powershell
# chat：不创建 run，不启动 Codex Executor；外层主会话负责回答
node dist/src/cli.js dispatch --task "解释这个项目的作用" --workspace . --config config/relay.example.json --no-model-probe
# status: CHAT_RESPONSE_REQUIRED, executionOwner: ChatGPT

# codex：桌面 dispatch 返回模型选择和 internal-child 调用数据；父会话必须随后创建并展示 Handoff
node dist/src/cli.js dispatch --task "实现一个示例功能" --workspace . --config config/relay.example.json --no-model-probe
# status: DESKTOP_EXECUTION_REQUIRED
# executionOwner: Codex
# complexity.band: normal
# modelSelection: desktop-child / gpt-5.6-luna / medium
# delegated model/reasoning: gpt-5.6-luna / medium
# delegationInvocation.fallbackPlan: desktop-luna-normal -> desktop-terra-normal
# retryProtocol: show replacement + record reason before retry; unchanged same-backend scope reuses gates
# parent model: unchanged

# hybrid：桌面 dispatch 同样不创建 Handoff；仅已接受的 CLI 分支会创建 pending Handoff
node dist/src/cli.js dispatch --task "先规划接口，然后实现并测试" --workspace . --config config/relay.example.json --no-model-probe
```

Task Analyzer 按 category、role、risk、scope、signals 产生 0 起始的分数与 `trivial|normal|complex|high-risk`。候选必须同时匹配 backend、role、route、category、complexity band 和精确 model/reasoning 能力。

桌面候选使用当前 host-advertised 列表，不调用 CLI 探针。只有在完整版本 CLI 建议已接受后，去掉 `--no-model-probe` 才会对启用且支持 Planner 的 `codex-cli` 候选执行只读、ephemeral、结构化预检。只有健康且未过期的显式 CLI 候选可被选择。最高优先级候选失败时，Relay 只沿同后端 `fallbacks` 清单寻找同样健康且支持当前条件的候选；无候选时 fail closed。`fallbackAudit` 显示 `executionOwner: Codex`、planned/actual pair、原因、链、attempts 和带 `scopeProofComplete` 的 gateAssessment。桌面真实 spawn 拒绝后，父会话先展示替换 pair 与原因，再用计划中的下一项重试；缺失或不完整 scope 证明先返回 gate。

```text
cli-sol-complex (priority 100, unhealthy)
  -> cli-terra-complex (priority 50, healthy)
  -> selected; plannedPair=cli-sol-complex; actualPair=cli-terra-complex
  -> gateAssessment: scopeProofComplete=true; backend/security/operation scope unchanged; requiresNewGate=false
```

CLI 真实执行仍需用户先审阅完整 Handoff，再提供 `--approve-handoff <exact-id>`；高风险 gate 还需单独批准。Gate 约束操作效果而非模型身份：同后端替换只有在完整证明 operations/allowedPaths/sandbox/permissions/effects 不变时无需新增 gate，证明缺失/不完整、跨后端或范围变化必须重新审批。真实运行时只有在错误明确点名当前所选 model ID 且描述 unknown、account/entitlement 不支持、metadata not found 或 unavailable 时才沿显式链有限重试；model output schema、protocol、认证、进程、超时、取消、输出上限或其他普通失败只执行一次。执行归属只报告 `ChatGPT` 或 `Codex`，模型和推理强度仍明确披露，不建立工具账本。

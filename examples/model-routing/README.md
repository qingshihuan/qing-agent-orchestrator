# 一句话任务与模型路由示例

这些示例展示源码协议。`config/relay.example.json` 使用当前真实模型 ID，但 availability 仍是时间相关的 host/entitlement 快照，不保证任意安装或账户可用。

```powershell
# chat：不创建 run，不启动 Codex Executor；外层主会话负责回答
node dist/src/cli.js dispatch --task "解释这个项目的作用" --workspace . --config config/relay.example.json --no-model-probe
# status: CHAT_RESPONSE_REQUIRED, responseOwner: outer-session

# codex：桌面 dispatch 返回模型选择和 internal-child 调用数据；父会话必须随后创建并展示 Handoff
node dist/src/cli.js dispatch --task "实现一个示例功能" --workspace . --config config/relay.example.json --no-model-probe
# status: DESKTOP_EXECUTION_REQUIRED
# complexity.band: normal
# modelSelection: desktop-child / gpt-5.6-luna / medium
# delegationInvocation.spawnAgent: { model: "gpt-5.6-luna", reasoning_effort: "medium" }
# parent model: unchanged

# hybrid：桌面 dispatch 同样不创建 Handoff；仅已接受的 CLI 分支会创建 pending Handoff
node dist/src/cli.js dispatch --task "先规划接口，然后实现并测试" --workspace . --config config/relay.example.json --no-model-probe
```

Task Analyzer 按 category、role、risk、scope、signals 产生 0 起始的分数与 `trivial|normal|complex|high-risk`。候选必须同时匹配 backend、role、route、category、complexity band 和精确 model/reasoning 能力。

桌面候选使用当前 host-advertised 列表，不调用 CLI 探针。只有在完整版本 CLI 建议已接受后，去掉 `--no-model-probe` 才会对启用且支持 Planner 的 `codex-cli` 候选执行只读、ephemeral、结构化预检。只有健康且未过期的显式 CLI 候选可被选择。最高优先级候选失败时，Relay 只沿同后端 `fallbacks` 清单寻找同样健康且支持当前条件的候选；无候选时 fail closed。

```text
cli-sol-complex (priority 100, unhealthy)
  -> cli-terra-complex (priority 50, healthy)
  -> selected; fallbackFrom=cli-sol-complex
```

CLI 真实执行仍需用户先审阅完整 Handoff，再提供 `--approve-handoff <exact-id>`；高风险 gate 还需单独批准。`models list` 只显示非敏感候选字段，`models probe` 只探测 `codex-cli` 候选并会提交真实最小模型调用，因此不属于本次源码验收命令。桌面显式 override 使用 host `spawnAgent` 的 `model` 与 `reasoning_effort`；CLI 使用 `-m` 与 `model_reasoning_effort`。当前 CLI 不发送 `max/ultra`。

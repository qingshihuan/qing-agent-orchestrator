# 一句话任务与模型路由示例

这些示例只展示源码协议；示例模型 ID 和 profile 是占位符，不表示本机已经配置或通过真实预检。

```powershell
# chat：不创建 run，不启动 Codex Executor；外层主会话负责回答
node dist/src/cli.js dispatch --task "解释这个项目的作用" --workspace . --config config/relay.example.json --no-model-probe
# status: CHAT_RESPONSE_REQUIRED, responseOwner: outer-session

# codex：只生成 Handoff，等待精确 ID 批准
node dist/src/cli.js dispatch --task "实现一个示例功能" --workspace . --config config/relay.example.json --no-model-probe
# status: AWAITING_APPROVAL, handoffId: qing-dispatch-...

# hybrid：规划后执行或代码加部署等多阶段目标，仍只生成待批准 Handoff
node dist/src/cli.js dispatch --task "先规划接口，然后实现并测试" --workspace . --config config/relay.example.json --no-model-probe
```

去掉 `--no-model-probe` 后，`modelRouting.mode=explicit` 会先对启用且支持 Planner 的候选执行只读、ephemeral、结构化预检。只有健康且未过期的显式候选可被选择。最高优先级候选失败时，Relay 只沿其 `fallbacks` 清单寻找同样健康且支持当前 role/route/category 的候选；无候选时 fail closed。

```text
primary (priority 100, unhealthy)
  -> fallback (priority 50, healthy)
  -> selected; fallbackFrom=primary
```

真实执行仍需用户先审阅完整 Handoff，再提供 `--approve-handoff <exact-id>`；高风险 gate 还需单独批准。`models list` 只显示非敏感候选字段与未验证状态，`models probe` 才会提交真实最小模型预检，因此不属于本次源码验收命令。

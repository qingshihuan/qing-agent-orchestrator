# 架构与边界

## 三个独立路由

1. Task Router：判断 chat、codex 或 hybrid，决定父任务直接回答还是需要结构化执行合同。
2. Execution Mode Router：判断 desktop-native、cli-recommended、cli-setup-required、cli-awaiting-handoff-approval 或 desktop-fallback。
3. Model Router：先由 Task Analyzer 按 category、role、risk、scope、signals 计算分数与四档 band，再只为委派角色选择所选后端能力表允许的 model/profile/reasoning 组合，并发布 completion-first 显式有序回退计划。

写代码不会自动命中 CLI。父任务模型永不因子任务路由而切换。

所有 route/dispatch/delegation/fallback 审计只暴露高层 `executionOwner`：外层父任务直接回答为 `ChatGPT`，Relay、内部子任务或 CLI 执行为 `Codex`。该字段不枚举具体工具，也不要求逐工具账本。

## 两个版本

桌面标准版只包含技能指令、Handoff、安全闸门和 Reviewer 规则。它使用桌面专用、非进程型 Handoff/Review schema，没有 scripts、runtime、进程启动器或外部执行依赖。完整版 runtime 继续使用独立的 Relay 进程 schema。

完整版包含相同桌面能力和可选 Relay。通常仍用父任务与内部子任务；仅命中稳定 reason code 时提出 CLI 建议。拒绝后回退桌面，接受后才检查依赖和创建新的 CLI Handoff。

## 数据流

    User goal
      → Task Router
      → Execution Mode Router
         → desktop parent/internal child
         → optional recommendation → accept/decline
      → Planner Handoff
      → exact approval + operation gates
      → Executor
      → RunStore events/test/Git evidence
      → RuleBased Reviewer
      → PASS | REVISE | HUMAN_REVIEW

内部子任务默认把结果返回父任务。用户明确要求或需要独立观察/隔离时才创建可见任务。

桌面内部子任务调用合同是 `spawnAgent: { model, reasoning_effort }`，其中 router 字段 `reasoningEffort` 明确映射到 host 参数 `reasoning_effort`；显式 spawn 参数优先于两个 `agents.default_subagent_*` 默认值。可选进程后端合同是 `-m <model>` 加 `model_reasoning_effort`。两者都不会改变 outer parent。

模型选择同时生成 `fallbackPlan` 与 `fallbackAudit`。计划只包含能力有效的显式同后端链；审计保存 `executionOwner: Codex`、planned/actual pair、原因、整条链、每次 unavailable/rejected/selected 尝试，以及带 `scopeProofComplete` 的 backend、operations、allowedPaths、sandbox、permissions、effects 布尔证明。桌面真实 spawn 拒绝后，父任务必须先展示下一 pair 和原因再重试/重新激活；真实 CLI 调用只有在错误明确点名当前所选 model ID 且描述其标识、account entitlement、metadata 或 availability 被拒绝时才有限回退，并保持 prompt、workspace、sandbox、permissions、output schema、timeout 和 output limit 不变。高风险任务仍可按同一规则替换，因为 gate 约束操作效果而不是模型名称；证明缺失/不完整、跨后端或范围变化必须重新 gate。

当前桌面 host capability snapshot：

| model | reasoning effort |
| --- | --- |
| `gpt-5.6-sol`, `gpt-5.6-terra` | low, medium, high, xhigh, max, ultra |
| `gpt-5.6-luna` | low, medium, high, xhigh, max |
| `gpt-5.5`, `gpt-5.4` | low, medium, high, xhigh |

该表严格对应当前 `collaboration.spawn_agent` 接口，不从 API catalog 推导桌面 entitlement。OpenAI 通用模型指导中的 `gpt-5.6` alias 指向 `gpt-5.6-sol`，API reasoning 支持 none、low、medium、high、xhigh、max；这是文档证据，不是本项目的 API 接口。本项目没有 API adapter，也不会把订阅可用性当成 Responses API entitlement。`gpt-5.3-codex-spark` 只存在于 CLI capability 表，并继续要求健康预检。

## 关键不变量

- 规划、执行和审查证据分离。
- route/recommendation 不启动进程。
- 拒绝 CLI 后继续桌面并禁止当前任务重复提示。
- 接受建议只进入依赖检查，不等于安装或任务批准。
- 精确 Handoff 审批与 operation gate 分离。
- 同后端模型替换只有在完整显式 scope 证明确认 operations/allowedPaths/sandbox/permissions/effects 不变时复用 gate；缺失/不完整证明或任一变化都重新审批。
- 显式 fallback 链耗尽后失败关闭，不隐式落到无关候选；认证和非模型进程/协议失败不进入回退链。
- mock/dry-run、heartbeat、活跃进程都不是完成证据。
- Reviewer 只基于当前 run/iteration 的受信任证据，并要求最终 fallback 披露。
- 新目标、路径、依赖或权限返回闸门。
- standard archive 不含 CLI 材料；full archive 不含 codex.exe。

## 组件状态

| 组件 | 状态 | 证据边界 |
| --- | --- | --- |
| 双版本技能源码 | 已实现 | 需要 Skill 校验和档案内容检查 |
| Task/Execution/Model Router | 已实现 | TypeScript 回归测试 |
| Handoff/Review/Executor Schema | 已实现 | 运行时与 Schema 测试 |
| Safety Gate | 已实现 | operation/allowedPaths 测试 |
| Relay/Reviewer/RunStore | 已实现 | mock、source regression 和历史 connected evidence 分开 |
| heartbeat/status/logs/cancel | 已实现 | 进程与 CLI 控制面测试 |
| 真实 CLI 适配器 | 已实现、默认关闭 | 当前双版本 Handoff不运行 connected E2E |
| Codex SDK | 未实现 | 不能声称接通 |
| 原生审批 UI/跨进程服务队列 | 未实现 | 后续范围 |

## 信任边界

工作区 sandbox 不等于 allowedPaths 子目录沙箱。Relay 还需要安全闸门、提示合同、Git 快照和 Reviewer 审计。非 Git 或审计不确定状态不能被自动判 PASS。

heartbeat 仅表达 Relay 尚未观察到退出。测试真值来自 Relay 父进程按 Handoff testPlan 执行并绑定的证据，不来自 Executor 自述或 JSONL 命令日志。

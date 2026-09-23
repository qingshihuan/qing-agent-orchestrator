# Current experimental architecture

The single-owner rules in [single-owner.md](single-owner.md) supersede the historical topology/review coupling below. Parallel capability, cross-module scope and transport alone no longer mandate an independent Reviewer. Native instructions and execute-single have different enforcement boundaries; the latter is optional and requires existing authority. Stable Release remains v0.13.0 until connected verification.

## Historical design below (superseded where noted)

# 架构与边界

## 三个独立路由

1. Task / Orchestration Router：判断 chat、codex 或 hybrid，再按风险、效果、scope、可分解性和显式请求选择 Direct、Lite 或 Full。
2. Execution Mode Router：判断 desktop-native、cli-recommended、cli-setup-required、cli-full-planning 或 desktop-fallback。
3. Model Router：只在编排层已经授予 child budget 后，按 delegated role 的 band 选择 model/profile/reasoning 组合并发布 completion-first 显式回退计划。Direct 不进入模型选择。

写代码不会自动命中 CLI。父任务模型永不因子任务路由而切换。

所有 route/dispatch/delegation/fallback 审计只暴露高层 `executionOwner`：外层父任务直接回答为 `ChatGPT`，Relay、内部子任务或 CLI 执行为 `Codex`。该字段不枚举具体工具，也不要求逐工具账本。

## 两个版本

桌面标准版只包含技能指令、Handoff、安全闸门和 Reviewer 规则。它使用桌面专用、非进程型 Handoff/Review schema，没有 scripts、runtime、进程启动器或外部执行依赖。完整版 runtime 继续使用独立的 Relay 进程 schema。

完整版包含相同桌面能力和可选 Relay。通常仍用父任务与内部子任务；仅命中稳定 reason code 时自动选择可选进程路线。明确拒绝后回退桌面；只读检查和规划在宿主授权范围内进行，不增加路由选择确认。

## 数据流

    User goal
      → Task Router
      → Orchestration Router
         → Direct: parent, 0 child
         → Lite: 1 Executor → parent verification
         → Full: Handoff → effect gates → Executor → independent Reviewer
      → optional process route → host-permitted read-only checks

Direct 默认把安全单一范围工作留在父任务。Lite/Full 子任务仍把结果返回父任务；只有明确要求或需要独立观察/隔离时才创建可见任务。

桌面内部子任务调用合同是 `spawnAgent: { model, reasoning_effort }`，其中 router 字段 `reasoningEffort` 明确映射到 host 参数 `reasoning_effort`；显式 spawn 参数优先于两个 `agents.default_subagent_*` 默认值。可选进程后端合同是 `-m <model>` 加 `model_reasoning_effort`。两者都不会改变 outer parent。

模型选择同时生成内部 `fallbackPlan` 与 `fallbackAudit`。计划只包含能力有效的显式同后端链；审计保存 `executionOwner: Codex`、planned/actual pair、原因、整条链、每次 unavailable/rejected/selected 尝试，以及带 `scopeProofComplete` 的 backend、operations、allowedPaths、sandbox、permissions、effects 布尔证明。创建子任务前不展示备用模型，也不重复“父任务模型不变”；桌面真实 spawn 拒绝且替换 pair 实际使用后，父任务才在后续进度或最终结果中披露被拒绝 pair、原因和实际替换 pair。真实 CLI 调用只有在错误明确点名当前所选 model ID 且描述其标识、account entitlement、metadata 或 availability 被拒绝时才有限回退，并保持 prompt、workspace、sandbox、permissions、output schema、timeout 和 output limit 不变。高风险任务仍可按同一规则替换，因为 gate 约束操作效果而不是模型名称；证明缺失/不完整、跨后端或范围变化必须重新 gate。

## 当前模型策略（v0.10）

显式任务候选仅允许 gpt-6-luna、gpt-6-sol、gpt-6-astra。桌面识别 low/medium/high/xhigh/max，但必须由实时 host 确认 pair。CLI 的档位与最低版本以本机目录为准，并需要账户预检；不把 API 文档当作桌面或订阅授权。

Luna 处理 trivial/normal；Sol 负责复杂规划、执行与独立审查；Astra 是复杂任务的显式后备。任务内共享健康检查器，预检与最终选择使用同一条有序回退链。安全默认 modelRouting=inherit 不改父任务选择；三模型限制作用于显式子任务候选。详见 release-notes-v0.10.0.md。

## 关键不变量

- 规划、执行和审查证据分离。
- route/recommendation 不启动进程。
- 拒绝 CLI 后继续桌面并禁止当前任务重复提示。
- 自动进程路由只进入只读依赖检查，不等于安装或真实任务启动；--no-model-probe 完全阻止检查。
- Handoff 本身不是审批点；原生路径由宿主处理真实效果授权，已授权范围不重复提示。独立 Relay 继续对 delete/global/system/secrets/private/authenticated network/external write/push/deploy/purchase/destructive migration/scope expansion 等效果执行原有 gate。
- 独立 Relay 同步 gate 不用 URL 语法猜测 DNS/主机是否公开。`network_read` 仅对 README 列出的精确审查主机自动允许，并拒绝免批 userinfo、敏感 query、fragment、IP literal 与本地/私有名称；其他 HTTPS 进入审批，旧 `network_access` 保持 gated 兼容语义。
- 新 Handoff 固化 tier、childAgentBudget、independentReviewer 和 maxRevisions。`execute` 与旧 `run` 在启动 Relay 前校验该合同没有超过当前配置，并把迭代数限制为 relay 配置、Handoff `maxIterations` 和 `maxRevisions + 1` 的最小值；旧 Handoff 没有该字段时从当前自适应路由派生预算。
- 同后端模型替换只有在完整显式 scope 证明确认 operations/allowedPaths/sandbox/permissions/effects 不变时复用 gate；缺失/不完整证明或任一变化都重新审批。
- 显式 fallback 链耗尽后失败关闭，不隐式落到无关候选；认证和非模型进程/协议失败不进入回退链。
- mock/dry-run、heartbeat、活跃进程都不是完成证据。
- Reviewer 只基于当前 run/iteration 的受信任证据；仅在实际发生模型替换时要求最终 fallback 披露。
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


## v0.11 宿主权限归属

原生控制输出保留不可授权的 permissionHandling 元数据；桌面 REQUIRE_APPROVAL 映射为 HOST_PERMISSION_CHECK_REQUIRED，DENY 仍拒绝。完整效果报告不丢失；只有宿主的当前有效权限和实际任务范围决定是否需要提示。元数据不是授权令牌，独立 CLI 无权复用它绕过自己的 gate。参见 host-permissions.md。

## v0.13 delegation economics
Before ordinary Lite promotion, the pure orchestration policy evaluates a fixed contract, acceptance, substantial work and nonduplicating parent activity. Complexity/multi-step/mixed alone no longer promotes Lite. Unknown evidence stays Direct without a new estimator call. Explicit bounded delegation and existing Full risk/review conditions still take precedence. Optional routeTask delegationEvidence is an internal observed-work hint, not permission or a prediction. See parent-overhead.md. Native skill Direct execution requires no control-plane command; CLI dispatch remains available to machine callers.

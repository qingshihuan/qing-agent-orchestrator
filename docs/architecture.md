# 架构与边界

## 三个独立路由

1. Task Router：判断 chat、codex 或 hybrid，决定父任务直接回答还是需要结构化执行合同。
2. Execution Mode Router：判断 desktop-native、cli-recommended、cli-setup-required、cli-awaiting-handoff-approval 或 desktop-fallback。
3. Model Router：只为委派角色选择所选后端实际可用的模型、profile 和推理强度。

写代码不会自动命中 CLI。父任务模型永不因子任务路由而切换。

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

## 关键不变量

- 规划、执行和审查证据分离。
- route/recommendation 不启动进程。
- 拒绝 CLI 后继续桌面并禁止当前任务重复提示。
- 接受建议只进入依赖检查，不等于安装或任务批准。
- 精确 Handoff 审批与 operation gate 分离。
- mock/dry-run、heartbeat、活跃进程都不是完成证据。
- Reviewer 只基于当前 run/iteration 的受信任证据。
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

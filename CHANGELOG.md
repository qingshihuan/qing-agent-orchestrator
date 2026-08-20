# Changelog

本项目采用语义化版本编号。当前发布候选版本为 `v0.4.0`；`v0.3.0` 的历史记录与本地标签语义保持不变。

## 0.4.0 - 2026-08-20

### Added

- 基于实际后端能力表、角色、复杂度和推理强度的 real model routing，并把选择结果传入桌面内部子任务或可选 CLI。
- `executionOwner` 成为唯一高层执行归属字段，取值严格限定为 `ChatGPT | Codex`。
- completion-first 显式同后端 fallback 计划、逐次尝试记录、planned/actual pair 和替换原因审计。

### Changed

- 普通任务与高风险任务都可以沿显式、能力有效的同后端候选链完成模型替换；不会隐式落到无关候选。
- 高风险任务只在完整证明 operations、allowedPaths、sandbox、permissions 与 effects 均未变化时复用原 operation gate。
- 桌面真实 spawn 拒绝后由父任务先展示替换 pair 与原因；CLI runtime 只在明确的 selected-model 标识、entitlement、metadata 或 availability 拒绝时有限重试。

### Safety

- 跨后端替换、缺失或不完整 scope 证明、以及任何新增权限或效果都要求新 gate。
- 认证、进程、超时、取消、输出上限、协议、output schema 与普通任务错误全部失败关闭，不触发模型回退。
- selected model ID 使用严格 token 边界与真实 CRLF/LF 分行；其他 ID、扩展后缀及混合错误不会误触发重试。

### Evidence boundary

- 已连接桌面委派使用 `gpt-5.6-luna / medium` 成功完成；这是桌面后端证据。
- 已连接 CLI 尝试使用 `gpt-5.6 / medium`，但被当前账户/entitlement 拒绝；这不是 CLI 成功证据。
- 最新 completion-first runtime fallback 由受控 `CodexExecExecutor` fake-runner 测试验证，不声称为新的 connected CLI 成功。
- 源码测试、Skill 校验、ZIP 内容/哈希验证、Git 提交、标签和远端 Release 继续作为独立证据层报告。

## 0.3.0 - 2026-08-17

### Added

- 桌面标准版 `qing-agent-orchestrator`。
- 桌面优先、可选 CLI 的完整版 `qing-agent-orchestrator-full`。
- Task、Execution Mode 与 Model Router。
- 结构化 Handoff、Executor Result、Review 与证据 Schema。
- 精确 Handoff 审批、operation safety gate 与 allowedPaths 边界。
- Relay、RunStore、状态、日志、heartbeat 与取消控制面。
- Relay 独立测试证据、Git 前后快照和有限 Reviewer 修订循环。
- 默认关闭的真实 `codex exec` 适配器。

### Safety

- 普通编码、复杂任务和长时间运行不再自动触发 CLI 建议。
- 拒绝 CLI 后返回桌面并禁止当前任务重复提示。
- 标准版不包含 CLI 启动器、runtime 或 CLI 标记。
- 完整版不包含 `codex.exe`，默认配置为 `dry-run` 且真实执行关闭。

### Evidence boundary

- 源码测试、Skill 校验、打包验证、安装验证、connected E2E、Git提交和远端发布分别报告。
- OpenAI API / Codex SDK适配器、原生审批 UI、常驻服务队列和真实 CLI写入 E2E不属于本版本已完成能力。

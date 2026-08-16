# Changelog

本项目采用语义化版本编号。当前首个公开候选版本为 `v0.3.0`。

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

# 青-Agent-Orchestrator v0.4.0

发布日期：2026-08-20

v0.4.0 在桌面优先、精确 Handoff 和 operation gate 边界之上，加入可落地的 real model routing 与 completion-first 显式同后端 fallback。父任务模型保持不变；委派模型选择、实际替换和证据边界均可审计。

## 发布重点

- Model Router 按 backend、role、complexity band 和 reasoning effort 选择能力有效的明确 pair，并把选择传入桌面内部子任务或可选 CLI。
- 路由、委派、执行和最终报告只使用一个高层归属字段：`executionOwner`，值严格为 `ChatGPT | Codex`。
- 普通和高风险任务都可沿显式、能力有效的同后端候选链完成模型替换；不会隐式选择未声明候选。
- fallback 审计记录 planned/actual pair、原因、有序链、每次尝试和完整 scope 证明。
- 高风险任务仅在 backend、operations、allowedPaths、sandbox、permissions 与 effects 均明确未变化时复用原 gate；跨后端、证明缺失或范围变化必须重新审批。
- runtime 错误分类失败关闭：认证、进程、超时、取消、输出上限、协议、output schema 和普通任务错误均不重试。只有明确点名 selected model ID 的标识、账户 entitlement、metadata 或 availability 拒绝可以触发有限回退。

## 证据边界

以下三项必须分别理解：

1. **已连接桌面成功：** 桌面内部委派使用 `gpt-5.6-luna / medium` 成功完成。这证明该次桌面后端调用，而不是 CLI entitlement。
2. **已连接 CLI 拒绝：** CLI 使用 `gpt-5.6 / medium` 的连接尝试被当前账户/entitlement 拒绝。因此本版本不声称新的 connected CLI 成功。
3. **最新 fallback 验证：** completion-first runtime fallback、链耗尽和失败分类由受控 `CodexExecExecutor` fake-runner 测试覆盖。这是确定性的 Executor 测试证据，不是新的 connected CLI 执行。

源码测试、Skill 校验、ZIP 内容和 SHA-256 验证、Git 提交、标签及远端 Release 仍是独立证据层。本文件描述发布候选内容，不代表已经创建标签或发布远端 Release。

## 发布资产

发布附件名保持为：

- `qing-agent-orchestrator-standard.zip`
- `qing-agent-orchestrator-full.zip`
- `SHA256SUMS.txt`

标准版不包含 CLI runtime。完整版包含默认关闭、需要显式审批的可选 Relay runtime，但不包含或冒充 `codex.exe`。

## 版本历史

`v0.3.0` 的本地标签与历史记录保持原有语义，未被移动或重写。参见 [v0.3.0 发布说明](release-notes-v0.3.0.md)。

---

## English

Release date: 2026-08-20

v0.4.0 adds real delegated model routing and completion-first explicit same-backend fallback while preserving the desktop-first workflow, exact Handoffs, operation gates, and the unchanged parent model.

### Highlights

- The Model Router selects a capability-valid pair from backend, role, complexity band, and reasoning effort, then passes it to the desktop child or optional CLI backend.
- Routing, delegation, execution, and final reports expose one high-level owner field only: `executionOwner`, exactly `ChatGPT | Codex`.
- Ordinary and high-risk work can substitute only through an explicit, capability-valid, same-backend chain. No unrelated candidate is selected implicitly.
- Fallback audit data records the planned and actual pairs, reason, ordered chain, attempts, and complete scope proof.
- High-risk work reuses an existing gate only when backend, operations, allowed paths, sandbox, permissions, and effects are explicitly unchanged. A backend change, incomplete proof, or scope change requires a new gate.
- Runtime classification fails closed. Authentication, process, timeout, cancellation, output-limit, protocol, output-schema, and ordinary failures do not retry. Only a rejection that explicitly names the selected model ID and identifies its identifier, account entitlement, metadata, or availability can trigger bounded fallback.

### Evidence boundary

These are separate claims:

1. **Connected desktop success:** an internal desktop delegation completed successfully with `gpt-5.6-luna / medium`. This proves that desktop invocation, not CLI entitlement.
2. **Connected CLI rejection:** a connected CLI attempt with `gpt-5.6 / medium` was rejected by the current account/entitlement. This release therefore does not claim a new connected CLI success.
3. **Latest fallback validation:** completion-first runtime fallback, chain exhaustion, and failure classification are covered by controlled `CodexExecExecutor` fake-runner tests. This is deterministic Executor test evidence, not a new connected CLI execution.

Source tests, Skill validation, ZIP content and SHA-256 verification, Git commits, tags, and a remote Release remain separate evidence layers. These notes describe a release candidate and do not claim that a tag or remote Release was created.

### Assets

- `qing-agent-orchestrator-standard.zip`
- `qing-agent-orchestrator-full.zip`
- `SHA256SUMS.txt`

The Standard edition contains no CLI runtime. The Full edition contains an optional, disabled-by-default Relay runtime, but never bundles or impersonates `codex.exe`.

### History

The local `v0.3.0` tag and its historical meaning remain unchanged. See the [v0.3.0 release notes](release-notes-v0.3.0.md).

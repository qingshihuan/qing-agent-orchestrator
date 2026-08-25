# Changelog

本项目采用语义化版本编号。当前稳定版本为 `v0.6.0`；既有版本的历史记录与标签语义保持不变。

## 0.6.0 - 2026-08-25

### Added

- `Direct | Lite | Full` 确定性编排决策和可配置的 child/reviewer/revision 预算。
- `network_read` 公开 HTTPS 只读语义，以及 `global_write`、`purchase`、`scope_expansion` 明确效果类型。
- `DIRECT_EXECUTION_REQUIRED`、`LITE_EXECUTION_REQUIRED`、`FULL_EXECUTION_READY`、`AWAITING_APPROVAL` 和 `DENIED` 状态。

### Changed

- 普通安全的项目内读写、构建和测试由用户目标直接授权，不再等待 Handoff 批准。
- Lite 最多一个 Executor、父任务验证和一次修订；只有高风险、跨系统、真正并行、发布/部署/全局或显式 Full 才使用独立 Reviewer。
- 只有 child budget 大于零时才进行模型和推理强度选择；父任务模型保持不变，同后端 completion-first 回退继续披露。
- 子任务创建前只展示实际选择的归属、角色、任务、模型和推理强度；不重复展示父任务不变，也不预告备用模型。只有实际发生替换后才披露回退原因和真实替代模型。
- 安全 CLI Handoff 可直接进入 ready；`--approve-handoff` 仅保留兼容校验，高风险效果继续使用精确 gate ID。
- `start`/`prepare` 先执行自适应路由；Direct/Lite 不再构造或调用 Handoff Planner，只有 Full 可进入 connected/local planning。
- 新 Handoff 固化 tier/child/revision 合同；`execute` 与旧 `run` 共用合同、配置、Handoff 的最小迭代上限。
- 技能安装包按序写入条目并固定 ZIP 时间戳和属性，使本地与 CI 对相同内容生成一致的 SHA-256。

### Safety

- 删除、全局/系统修改、密钥/私有或认证访问、外部写入、push、部署、购买、破坏性迁移和重大范围扩展仍需明确批准。
- 旧 `network_access` 保持 gated；`network_read` 仅自动放行审查清单内的精确文档主机。任意其他 HTTPS、IP literal、本地/私有名称、userinfo、敏感 query 或 fragment 都失败关闭到人工 gate。

### Evidence boundary

- 自动测试验证路由预算、Direct 无模型分配、Lite 单 Executor、Full Reviewer、效果 gate、升级和旧配置兼容。
- 本版本不声明固定 token 节省比例；源码测试和打包验证也不等于新的 connected CLI E2E。

## 0.5.0 - 2026-08-24

### Added

- 运行时解析当前安装的 `codex debug models --bundled` 输出，以真实模型 slug、`supported_reasoning_levels` 和 `minimal_client_version` 作为 CLI 能力来源。
- Windows / Ubuntu、Node.js 18 / 22 的四平台 CI 矩阵，以及独立的 Skill 打包、解压内容和 SHA-256 验证门禁。
- 可复用的 ZIP 语义比较脚本：按解压后的精确文件集合和逐文件哈希判断产物一致性，不受 ZIP 时间戳影响。
- 自动化 GitHub Release 工作流：从同步版本号、Changelog 和发布说明构建、复验并发布标准版、完整版和校验清单。

### Changed

- CLI 配置层允许表达 `minimal|low|medium|high|xhigh|max|ultra`；某个组合是否可用由当前 Codex 目录和账户健康探针共同决定，不再由仓库静态模型表决定。
- CLI 候选在进入健康状态前必须依次通过目录能力验证和受限、只读、结构化 entitlement 探针。
- 完整版编译 runtime、两个可安装 ZIP 与 `SHA256SUMS.txt` 纳入持续漂移检查。

### Fixed

- 修复 Windows GitHub Runner 的 8.3 短路径别名导致同一临时目录被当作不同路径的问题。
- 修复 wildcard `allowedPaths` 可让另一平台格式的绝对路径或 UNC 路径绕过边界检查的问题。
- 修复源码已更新但完整 Skill runtime、ZIP 或校验清单仍停留在旧实现的发布风险。

### Safety

- POSIX 绝对路径、Windows 盘符路径、UNC 路径和父目录穿越均在 wildcard 匹配前失败关闭。
- 缺失目录、目录格式异常、模型不存在、推理强度不支持、最低客户端版本不满足或账户探针失败时，真实 `codex exec` 不会启动。
- 跨后端或安全范围变化仍要求新的 gate；本版本没有放宽既有审批边界。

### Evidence boundary

- 源码、四平台测试、Skill 打包、归档内容和哈希由 CI 与 Release 工作流独立复验。
- 发布流程不会把受控 fake-runner 或目录解析结果表述为某个账户的 connected CLI 成功；目标安装仍须通过实际 entitlement 探针。

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

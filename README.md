# 青-Agent-Orchestrator

[English](README.en.md) · [v0.6.0 发布说明](docs/release-notes-v0.6.0.md) · [版本选择](docs/editions.md) · [架构与边界](docs/architecture.md) · [路线图](docs/roadmap.md)

**让擅长理解、规划和沟通的模型先把事情想清楚，让擅长代码与工程执行的 Codex 完成实现与验证。**

青-Agent-Orchestrator 把 ChatGPT/Codex 桌面客户端里的规划、委派、模型选择、审批、执行和审查组织成一条可控工作流。它面向已经在桌面客户端中使用 OpenAI 订阅能力的用户：默认不要求 OpenAI API Key，也不会因为任务复杂、需要写代码或耗时较长就把你赶到命令行。

## 它解决什么问题

- **来回切换很累：** 理解需求、制定方案、写代码、跑测试和复核结果往往散落在不同任务里，背景信息容易丢失。
- **模型选择靠猜：** 简单任务用重模型浪费时间，困难任务推理不足又容易返工。
- **授权边界模糊：** 一句“继续”不应该自动变成安装软件、覆盖文件、推送代码或对外发帖的许可。
- **结果看起来完成，却缺少证据：** 模型自述、心跳、mock 或进程仍在运行都不能证明测试通过。
- **CLI 被过度使用：** 普通桌面任务不需要额外运行时、后台进程或新的使用门槛。

青通过三个彼此独立的路由来处理这些问题：

1. **任务/编排路由**先选择 Direct、Lite 或 Full，并为子任务和审查设置明确预算。
2. **执行方式路由**默认留在桌面；只有 CI、定时/批量、应用关闭后继续、机器可读控制或明确进程隔离等场景才建议 CLI。
3. **模型路由**按角色、任务类型和复杂度，为委派任务选择实际可用的模型与推理强度，不改变父任务模型。

路由和最终报告只使用一个高层执行归属字段：父任务直接回答为 `executionOwner: ChatGPT`，Relay、内部子任务或 CLI 执行为 `executionOwner: Codex`。它不要求展示具体工具名称，也不建立逐工具账本。

复杂度分析不是“快/慢”二选一：它按 category、role、risk、single/multi-step/cross-system scope 和 signals 计算可解释分数。复杂度只帮助判断是否值得委派；高风险/外部效果、跨系统、真正并行或显式 Full 请求才进入完整编排。

模型候选明确绑定 `desktop-child` 或 `codex-cli`。桌面候选继续以宿主公布的能力快照为准，内部子任务实际接收 `{ model, reasoning_effort }`，显式值只作用于委派后端，不改变父任务模型。CLI 路径实际接收 `-m` 和 `model_reasoning_effort`；配置层可以表达 `minimal|low|medium|high|xhigh|max|ultra`，但当前安装的 `codex debug models --bundled` 目录才是模型、推理强度和最低客户端版本的权威来源。CLI 候选还必须通过受限、只读、结构化的账户 entitlement 探针，目录有效但账户不可用的组合不会进入健康状态。

这些可用性是当前 host/运行时快照，可能随版本、账户和 entitlement 漂移。普通与高风险任务都采用 completion-first 策略：CLI 候选必须通过现有健康预检，桌面真实 spawn 被拒绝时，只能沿内部显式、能力有效、同后端 fallback 链继续；链耗尽即失败关闭，绝不隐式选择无关候选。备用 pair 不提前展示，只有替换实际使用后才输出 `executionOwner: Codex`、被拒绝/实际 pair、原因、链与尝试，以及完整 scope 证明。CLI 真实调用只有在错误明确点名当前所选 model ID，并说明该模型 unknown、account/entitlement 不支持、metadata not found 或 unavailable 时才有限回退；认证、进程、超时、取消、输出上限、协议、model output schema 或其他普通错误不重试。缺失或不完整的 scope 证明要求新 gate。ChatGPT/Codex 订阅访问不等于 Responses API entitlement；本项目没有 provider URL、token 或 API adapter。

## v0.6.0 发布重点

- **三档自适应编排：** Direct 不创建子任务，Lite 最多一个 Executor，Full 才使用独立 Reviewer。
- **先判断委派、后选择模型：** Direct 不分配子模型；Lite/Full 创建前只展示实际选择的模型和推理强度，只有真的发生替换后才披露回退详情。
- **按效果审批：** 项目内安全读写、构建、测试和审查清单内的 HTTPS 文档读取无需计划审批；仅暂停真正高风险或无法静态证明的效果。
- **显式消耗预算：** Lite 固定一个子任务和一次修订，Full 子任务/修订预算可配置；新 Handoff 携带预算合同，`execute` 与旧 `run` 都按合同、当前配置和 Handoff 三者的最小上限执行。
- **清晰运行状态：** `DIRECT_EXECUTION_REQUIRED`、`LITE_EXECUTION_REQUIRED`、`FULL_EXECUTION_READY` 与 `AWAITING_APPROVAL` 区分“可直接做”和“确实需要批准”。

## 工作流

```text
用户目标
  → Direct：父任务直接完成（0 子任务）
  → Lite：1 个 Executor → 父任务验证
  → Full：Handoff → 必要的效果 gate → Executor → 独立 Reviewer
  → 结果返回父任务
```

Handoff 只用于 Full 或需要精确效果合同的任务。安全 Handoff 不需要单独批准；新路径、新权限、重大范围变化或外部效果仍须重新进入 gate。

## 先选版本

| 版本 | 适合谁 | 默认方式 | CLI |
| --- | --- | --- | --- |
| **桌面标准版** `qing-agent-orchestrator` | 大多数桌面客户端用户 | 父任务或内部子任务 | 完全不包含启动器、runtime 或 CLI 依赖 |
| **完整版** `qing-agent-orchestrator-full` | 还需要 CI、定时、批量、进程隔离或机器可读控制的用户 | 仍然是桌面优先 | 只有命中明确条件且用户接受后才按需启用 |

不知道选哪个时，安装**桌面标准版**。

## 安装

从 Release 下载一个 ZIP：

- `qing-agent-orchestrator-standard.zip`
- `qing-agent-orchestrator-full.zip`

解压到用户技能目录，并保证最终目录名与技能名一致：

```text
%USERPROFILE%\.agents\skills\qing-agent-orchestrator\
```

或：

```text
%USERPROFILE%\.agents\skills\qing-agent-orchestrator-full\
```

也可以安装到项目自己的 `.agents/skills/`。安装后新建一个桌面任务并调用对应技能。

完整性校验见 [`artifacts/SHA256SUMS.txt`](artifacts/SHA256SUMS.txt)。标准包不含脚本或 runtime；完整包包含可选 Relay，但不包含或冒充 `codex.exe`。

## 快速开始

桌面标准版：

```text
$qing-agent-orchestrator
目标：检查当前项目的登录流程，提出方案，获批后实现并运行测试。
```

完整版：

```text
$qing-agent-orchestrator-full
目标：把仓库检查接入 CI，并提供机器可读状态。
```

普通、安全、单一范围的桌面任务由父任务直接完成。只有有界复杂工作才创建一个内部 Executor；高风险、跨系统或真正可并行的工作才进入 Full。

## CLI 什么时候才会出现

完整版只有命中以下明确条件时才能显示“建议切换 CLI 模式”：

- 用户明确要求 CLI；
- 脚本或 CI；
- 定时、批量或无人值守；
- 桌面应用关闭后仍需继续；
- 需要机器可读 `status/logs/cancel` 或 JSONL；
- 需要 CLI 独占模型、profile 或环境；
- 需要独立进程、任务队列或进程隔离。

写代码、任务复杂或运行时间长本身不会触发 CLI。拒绝后继续桌面端能够完成的部分。接受后只做只读依赖检查；安装/配置及真实高风险效果仍保持审批边界，安全任务不再额外批准 Handoff。

完整版本地命令及安全前提见[可选 Codex CLI 接入](docs/codex-integration.md)。

## 安全与证据

- 用户目标直接授权范围内可逆的项目读写、构建和测试；Handoff 本身不再构成审批点。
- `network_read` 只自动放行精确主机 `developers.openai.com`、`docs.github.com`、`github.com`、`help.openai.com`、`learn.chatgpt.com`、`openai.com`、`platform.openai.com`、`raw.githubusercontent.com`、`www.openai.com` 的无凭据、无敏感查询、无片段 HTTPS 读取。任意其他主机、所有 IP literal、内网/本地主机、userinfo、敏感 query 或 fragment 都需要效果批准；旧 `network_access` 始终 gated。
- Gate 约束操作效果而非模型身份：同后端替换只有在完整显式证明 operations/allowedPaths/sandbox/permissions/effects 全部不变时无需新 gate；证明缺失/不完整、跨后端或任何权限/效果变化都必须重新审批。
- 删除、全局/系统写入、密钥/私有数据、外部消息、push、部署、购买、破坏性迁移和重大范围扩展需要一次明确效果批准。
- `allowedPaths`、Git 前后快照和未申报变化接受审计。
- 测试由 Relay 父进程按声明命令独立执行并绑定当前 run、Handoff 和 iteration。
- `mock`、`dry-run`、heartbeat 或进程存活都不能冒充真实完成。
- Reviewer 只基于当前迭代的受信任证据给出结论；最终报告仅以 `ChatGPT`/`Codex` 标注执行归属，并披露实际模型替换或明确说明没有发生替换。
- 当前配置不接受 provider URL、token 或 secret。

## 当前能力边界

`v0.6.0` 包含：

- 桌面标准版与桌面优先完整版；
- Direct / Lite / Full 自适应编排、Execution Mode Router，以及仅为实际委派落地的 Model Router；
- 基于当前 Codex bundled catalog 的 CLI 模型、推理强度和最低客户端版本验证；
- 目录验证之后的受限只读 entitlement 健康探针；
- 唯一的 `executionOwner: ChatGPT | Codex` 高层归属合同；
- completion-first 显式同后端模型回退、高风险同范围 gate 复用和失败关闭分类；
- 跨平台绝对路径、UNC 路径和父目录穿越防护；
- Handoff、Executor Result、Review 和证据 Schema；
- Safety Gate、Relay、RunStore、规则 Reviewer 与 `status/logs/cancel` 控制面；
- 默认关闭的真实 `codex exec` 适配器；
- 四平台 CI、完整 runtime 漂移检测和经过逐文件内容验证的两个可安装 ZIP；
- 自动构建、复验、打标签并上传三个发布附件的 GitHub Release 流程。

不包含或尚未证明：

- OpenAI API / Codex SDK 程序级双 Agent 适配器；
- 原生审批按钮；
- 常驻跨进程服务队列；
- 用户可见的独立模型选择器；
- 真实 CLI 写入 E2E；
- 对任意账户的具体模型 entitlement 保证。

SDK/API 集成会作为后续可选分支，不改变面向大多数订阅用户的桌面优先主线。详见[路线图](docs/roadmap.md)。

本版本优化的是审批轮次与编排消耗；没有声称一个固定 token 节省比例，也没有把静态测试当成新的 connected CLI 成功。详见 [v0.6.0 发布说明](docs/release-notes-v0.6.0.md)。历史说明继续保留在 [v0.5.0](docs/release-notes-v0.5.0.md)、[v0.4.0](docs/release-notes-v0.4.0.md) 与 [v0.3.0](docs/release-notes-v0.3.0.md)。

## 开发与验证

需要 Node.js 18 或更新版本：

```powershell
npm install
npm run typecheck
npm test
python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py" .agents/skills/qing-agent-orchestrator
python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py" .agents/skills/qing-agent-orchestrator-full
powershell -NoProfile -File scripts/package-skill-editions.ps1 -Validate
```

打包脚本先写入最终 ZIP，再生成 `artifacts/SHA256SUMS.txt`。`-Validate` 要求 manifest 恰好包含两个归档并复算哈希，同时把完整版本的精确文件清单和每个文件 SHA-256 与声明的技能源码、`dist/src`、schemas、runtime 配置/package 逐项比较；它不再用文件数量代替内容验证。

架构、证据边界和信任模型见[架构与边界](docs/architecture.md)。版本变化见 [CHANGELOG](CHANGELOG.md)，贡献方式见 [CONTRIBUTING](CONTRIBUTING.md)，安全问题请阅读 [SECURITY](SECURITY.md)。

## 许可证

[MIT](LICENSE) © Qing-Agent-Orchestrator contributors

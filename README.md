# 青-Agent-Orchestrator

[English](README.en.md) · [版本选择](docs/editions.md) · [架构与边界](docs/architecture.md) · [路线图](docs/roadmap.md)

**让擅长理解、规划和沟通的模型先把事情想清楚，让擅长代码与工程执行的 Codex 完成实现与验证。**

青-Agent-Orchestrator 把 ChatGPT/Codex 桌面客户端里的规划、委派、模型选择、审批、执行和审查组织成一条可控工作流。它面向已经在桌面客户端中使用 OpenAI 订阅能力的用户：默认不要求 OpenAI API Key，也不会因为任务复杂、需要写代码或耗时较长就把你赶到命令行。

## 它解决什么问题

- **来回切换很累：** 理解需求、制定方案、写代码、跑测试和复核结果往往散落在不同任务里，背景信息容易丢失。
- **模型选择靠猜：** 简单任务用重模型浪费时间，困难任务推理不足又容易返工。
- **授权边界模糊：** 一句“继续”不应该自动变成安装软件、覆盖文件、推送代码或对外发帖的许可。
- **结果看起来完成，却缺少证据：** 模型自述、心跳、mock 或进程仍在运行都不能证明测试通过。
- **CLI 被过度使用：** 普通桌面任务不需要额外运行时、后台进程或新的使用门槛。

青通过三个彼此独立的路由来处理这些问题：

1. **任务路由**判断父任务直接回答、内部子任务执行，还是需要结构化工程流程。
2. **执行方式路由**默认留在桌面；只有 CI、定时/批量、应用关闭后继续、机器可读控制或明确进程隔离等场景才建议 CLI。
3. **模型路由**按角色、任务类型和复杂度，为委派任务选择实际可用的模型与推理强度，不改变父任务模型。

## 工作流

```text
用户目标
  → Planner：理解目标并生成精确 Handoff
  → Approval：用户批准这份合同和必要 gate
  → Executor：只执行获批范围
  → Evidence：保存测试、文件、Git 和运行状态证据
  → Reviewer：给出 PASS / REVISE / HUMAN_REVIEW
  → 结果返回父任务
```

Handoff 会声明目标、工作区、允许路径、操作、交付物、验收标准和测试计划。新路径、新依赖、新权限或新的外部动作必须重新进入 gate，不能从模糊同意中推导授权。

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

正常桌面任务会留在父任务中。执行性工作默认使用内部子任务，结果返回父任务；只有用户明确要求可见任务，或确实需要独立观察/隔离时，才新建可见任务。

## CLI 什么时候才会出现

完整版只有命中以下明确条件时才能显示“建议切换 CLI 模式”：

- 用户明确要求 CLI；
- 脚本或 CI；
- 定时、批量或无人值守；
- 桌面应用关闭后仍需继续；
- 需要机器可读 `status/logs/cancel` 或 JSONL；
- 需要 CLI 独占模型、profile 或环境；
- 需要独立进程、任务队列或进程隔离。

写代码、任务复杂或运行时间长本身不会触发 CLI。拒绝后会继续完成桌面端能够完成的部分，并且当前任务不重复提示。接受也只会先进入依赖检查；安装、配置和真实任务仍有各自的审批边界。

完整版本地命令及安全前提见[可选 Codex CLI 接入](docs/codex-integration.md)。

## 安全与证据

- 精确 Handoff 批准与操作 gate 分离。
- 删除、全局安装、密钥、外部消息、push、部署和破坏性迁移需要独立批准。
- `allowedPaths`、Git 前后快照和未申报变化接受审计。
- 测试由 Relay 父进程按声明命令独立执行并绑定当前 run、Handoff 和 iteration。
- `mock`、`dry-run`、heartbeat 或进程存活都不能冒充真实完成。
- Reviewer 只基于当前迭代的受信任证据给出结论。
- 当前配置不接受 provider URL、token 或 secret。

## 当前能力边界

`v0.3.0` 包含：

- 桌面标准版与桌面优先完整版；
- Task / Execution Mode / Model Router；
- Handoff、Executor Result、Review 和证据 Schema；
- Safety Gate、Relay、RunStore 与规则 Reviewer；
- 可观测的 `status/logs/cancel` 控制面；
- 默认关闭的真实 `codex exec` 适配器；
- 经过内容边界检查的两个可安装 ZIP。

不包含或尚未证明：

- OpenAI API / Codex SDK 程序级双 Agent 适配器；
- 原生审批按钮；
- 常驻跨进程服务队列；
- 用户可见的独立模型选择器；
- 真实 CLI 写入 E2E。

SDK/API 集成会作为后续可选分支，不改变面向大多数订阅用户的桌面优先主线。详见[路线图](docs/roadmap.md)。

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

架构、证据边界和信任模型见[架构与边界](docs/architecture.md)。版本变化见 [CHANGELOG](CHANGELOG.md)，贡献方式见 [CONTRIBUTING](CONTRIBUTING.md)，安全问题请阅读 [SECURITY](SECURITY.md)。

## 许可证

[MIT](LICENSE) © Qing-Agent-Orchestrator contributors

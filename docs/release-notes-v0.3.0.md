# 青-Agent-Orchestrator v0.3.0

青-Agent-Orchestrator 把 ChatGPT/Codex桌面客户端中的规划、模型选择、委派、审批、工程执行和结果审查组织成一条可控工作流。

它解决的核心问题是：不同模型擅长的事情不同，但用户不应该不断复制上下文、猜选哪个模型，也不应该在一句模糊的“继续”之后失去对文件、命令和外部操作的控制。

## 本版本包含

- 面向大多数桌面用户的标准版；
- 桌面优先、仅按明确条件建议 CLI 的完整版；
- 按任务、执行方式和委派角色分离的智能路由；
- 精确 Handoff、安全 gate、证据化 Reviewer和有限返工；
- 完整版的 RunStore、状态、日志、取消、Git审计与可选 `codex exec`适配器；
- 两个经过内容边界检查的可安装 ZIP。

## 选择版本

- `qing-agent-orchestrator-standard.zip`：推荐给大多数 ChatGPT/Codex桌面用户，不含脚本、runtime 或 CLI依赖。
- `qing-agent-orchestrator-full.zip`：还需要 CI、定时、无人值守、机器可读控制或进程隔离时选择；默认仍为桌面执行。

## 安全默认值

完整版不打包 `codex.exe`。内置配置为 `dry-run`、`codexExec.enabled=false`、无预批准 gate。CLI建议、依赖检查、安装/配置和真实执行分别审批。

## 未包含

OpenAI API / Codex SDK双 Agent适配器、原生审批 UI、常驻服务队列、独立可见模型选择器和真实 CLI写入 E2E不属于本版本已完成能力。

## 发布候选验证

- TypeScript类型检查通过；
- 完整回归测试 `104/104`；
- 两个 Skill均通过 Skill Creator校验；
- 标准 ZIP为 8 个文件，无 scripts、runtime 或 CLI标记；
- 完整 ZIP为 43 个文件，不含 `codex.exe`；
- 完整版内置配置为 `dry-run`、`codexExec.enabled=false`、`modelRouting.mode=inherit`、零预批准 gate；
- 本地用户配置、源码测试、安装 E2E、connected E2E、Git提交和远端发布仍作为独立证据层报告。

## SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `qing-agent-orchestrator-standard.zip` | `FC2362BCDA166EDA1219D07E195B578925A1469275D421C1B131AC5F8AABA0A9` |
| `qing-agent-orchestrator-full.zip` | `B3A80C7340B3CBEA710ADE96ECE1AAD059955DA1CB75CC29F97084D6E0DDA7B3` |

发布资产同时提供 `SHA256SUMS.txt`。

---

Qing-Agent-Orchestrator turns planning, model selection, delegation, approval, engineering execution, and evidence-based review in the ChatGPT/Codex desktop workflow into one controlled process.

Version 0.3.0 ships a dependency-free Desktop Standard edition and a desktop-first Full edition with an optional, explicitly gated CLI backend. OpenAI API and Codex SDK integration are planned as a later optional branch and are not claimed by this release.

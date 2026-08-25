# 版本与执行模式

## 选择哪个版本

默认推荐桌面标准版。它覆盖 Direct/Lite/Full、自适应委派、效果 gate、桌面模型选择和分层验证，安装内容更少。

当你希望保留 CI、定时任务、应用关闭后持续运行、机器可读控制或 CLI 专属模型/环境时，选择完整版。完整版仍以桌面为默认，因此即使 CLI 未安装也能正常工作。

## 路由真值表

| 请求特征 | 标准版 | 完整版 |
| --- | --- | --- |
| 解释、建议、分析 | 父任务直接完成 | 父任务直接完成 |
| 安全、单一范围代码或内容交付 | Direct 父任务 | Direct 父任务 |
| 有界复杂或多步骤工作 | Lite：1 个 Executor | Lite：1 个 Executor |
| 高风险、跨系统、真正并行或显式 Full | Full + 独立 Reviewer | Full + 独立 Reviewer |
| 明确要求新开可见任务 | 可见任务 | 可见任务 |
| 明确要求 CLI | 继续桌面 | 建议切换 |
| 脚本或 CI | 继续桌面 | 建议切换 |
| 定时、批量、无人值守 | 继续桌面 | 建议切换 |
| 关闭应用后继续 | 桌面并说明限制 | 建议切换 |
| 机器可读 status/logs/cancel | 桌面并说明限制 | 建议切换 |
| CLI 独占模型或环境 | 使用桌面候选 | 建议切换 |
| 独立进程或任务队列 | 桌面 | 建议切换 |

## 完整版交互状态

1. desktop-native：正常桌面工作，不检查依赖。
2. cli-recommended：显示“建议切换 CLI 模式”、收益和原因代码；不启动进程。
3. 用户拒绝：
   - desktop-fallback-selected；
   - 当前任务不再提示；
   - 继续桌面端可完成部分；
   - 无法提供的无人值守或独占能力列为限制。
4. 用户接受：
   - 执行 doctor 依赖检查；
   - missing/authentication-required → cli-setup-required；
   - ready → 创建 Full Handoff 并评估效果。
5. 全部为安全操作时进入 `FULL_EXECUTION_READY`；只有明确高风险效果进入 `AWAITING_APPROVAL`。

## 安装

把所选 ZIP 解压为同名技能目录并放入用户或项目的 .agents/skills。标准 ZIP 没有 scripts 或 runtime，并携带 Handoff 与 Review 的两个桌面专用、非进程型 JSON Schema；它们不复用完整版的进程事件合同。完整 ZIP 含 Relay runtime 和安全默认配置，但不含 Codex CLI 可执行文件。

选择完整版不要求预装 CLI。只有接受切换建议后才检查本机状态；按照[官方 Codex CLI 文档](https://learn.chatgpt.com/docs/codex/cli)进行全局安装或配置修改仍需效果批准。安全任务不再额外批准 Handoff。

本项目的打包步骤不会自动部署到用户技能目录。

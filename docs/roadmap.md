# 路线图

路线图按用户需求分层，不承诺未完成能力的发布日期。

## 主线：Desktop First

面向已经在 ChatGPT/Codex桌面客户端中使用 OpenAI订阅能力的大多数用户：

- 保持标准版无 CLI、无 runtime、无外部执行依赖；
- 完善桌面内部子任务的模型与推理强度选择体验；
- 增强 Handoff、Reviewer、证据展示和安装指引；
- 继续把普通代码和长时间交互任务留在桌面端。

## 完整版：Optional CLI

只为明确需要自动化或独立进程的用户继续增强：

- CI、定时、批量和无人值守模板；
- 应用关闭后持续运行；
- 机器可读 status、logs、cancel 和 JSONL；
- 任务队列与进程隔离；
- 真实 CLI写入 E2E和更完整的故障恢复验证。

CLI仍不会因为代码量、复杂度或运行时间自动启用。

## 后续可选分支：SDK/API Integration

该分支面向开发者平台与企业集成，不替代桌面优先主线：

- OpenAI Agents SDK / Responses API Planner；
- Codex SDK Executor；
- 规则 Reviewer 与 OpenAI语义 Reviewer双层审查；
- API会话 ID、Codex thread ID与 RunStore恢复；
- ChatGPT插件、MCP或 Workspace Agent入口。

在真实 connected E2E完成前，项目不会宣称已经接入 OpenAI API或Codex SDK，也不会把普通消费者 ChatGPT界面会话与 API会话混为一谈。

## 仍需独立验证

- 用户可见的桌面子任务模型选择界面；
- 原生审批按钮；
- 常驻跨进程服务队列；
- SDK/API只读与写入 E2E；
- 各平台安装、升级和回滚体验。

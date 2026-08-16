# Contributing

感谢你帮助改进青-Agent-Orchestrator。

## 开始之前

- 先阅读 `README.md`、`docs/architecture.md`、`docs/editions.md` 和 `docs/codex-integration.md`。
- 不要把 mock、dry-run、旧产物或历史 connected 结果描述为当前真实完成。
- 保持桌面优先：写代码、任务复杂或耗时较长本身不能触发 CLI 建议。
- 不要让模型选择覆盖 sandbox、审批、allowedPaths、network、schema 或审计设置。

## 提交改动

1. 为问题或功能说明用户场景、预期行为和证据边界。
2. 保持改动聚焦；不要顺手重写无关文件。
3. 为行为变化增加或更新测试。
4. 运行：

   ```powershell
   npm run typecheck
   npm test
   python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py" .agents/skills/qing-agent-orchestrator
   python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py" .agents/skills/qing-agent-orchestrator-full
   powershell -NoProfile -File scripts/package-skill-editions.ps1 -Validate
   ```

5. 在 Pull Request 中写明：改了什么、为什么、验证了什么，以及仍未验证什么。

## 安全相关改动

涉及删除、密钥、外部消息、push、部署、数据库迁移、全局安装或真实执行时，必须保留独立审批边界。不要在 issue、日志、Handoff 或测试夹具中提交真实密钥。

安全漏洞请按 `SECURITY.md` 的私密报告流程处理。

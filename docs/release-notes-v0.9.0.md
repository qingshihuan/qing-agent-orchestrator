# v0.9.0 — Astra 按需适配与上下文降耗

## 新增与改进
- 识别 `gpt-6-astra`；示例配置为桌面与进程后端各加入一个默认关闭的 demanding 候选，启用后使用 high 并保留显式同后端回退。普通任务不自动升级至 Astra。
- Astra 最低 Codex CLI 0.153.0 在健康缓存命中前也会校验；实际模型目录可要求更高版本，仍需目录与账户健康预检。桌面配置表仅表示识别的参数，不代表已验证当前 host/账户可用。
- Executor Handoff 使用无损紧凑 JSON；不删除目标、路径、约束、验收条件、测试或任何字符串内容。
- 两版技能按阶段加载参考文档，禁止重复探索与整段聊天转交；保留效果审批、独立审查和最终验证。
- `models probe --candidate <id>` 支持定向检查并默认复用持久缓存；`--force` 显式刷新健康结果。
- `logs <id> --after <sequence> --limit <1..500>` 返回增量页、nextAfter 与 hasMore；完整日志和旧的无参数数组格式保留。底层仍读取现有日志，不声称降低磁盘扫描复杂度。
- `--compact` 补回 Handoff 路径、规划警告、候选身份和需要批准/拒绝的完整决策。技能优先使用精简模式，命令的默认格式保持兼容。

## 升级
下载 standard/full ZIP 与 SHA256SUMS.txt。本版本两版指令均有更新。升级前备份定制配置，尤其 runtime/config/relay.user.json。默认仍为 dry-run、inherit、真实执行关闭；不替换用户配置或自动启用 Astra。

## 证据边界
字节数与探针次数是确定性代理指标，不是服务端计费 token、真实模型成功率或端到端加速比例。模型账户权限与桌面实际模型/档位需要运行环境验证。安全 gate、required testPlan、独立审查义务和编排预算没有放宽。

官方核对（2026-09-08）：https://developers.openai.com/api/docs/models/gpt-6-astra 与 https://help.openai.com/en/articles/20001275 。公开模型参数不等于桌面或账户授权；CLI 目录与健康预检继续决定实际可用性。

English: opt-in Astra support, lossless compact Executor context, conditional skill loading, cached targeted health probes and cursor-based log pages. Full evidence and legacy command shapes remain available. No measured connected-model speed or token-saving claim is made.

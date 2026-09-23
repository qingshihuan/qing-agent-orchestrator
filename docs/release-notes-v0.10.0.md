# v0.10.0 — GPT-6 三模型与按需调度

仅保留 `gpt-6-luna`、`gpt-6-sol`、`gpt-6-astra` 作为显式任务模型。旧模型及其他模型在配置解析和创建 CLI 参数时均被拒绝，不能通过回退链重新使用。历史版本、标签、历史测量与旧模型拒绝测试保留，不改写历史。

## 调度与消耗

| 委派工作 | 首选 | 显式回退 |
| --- | --- | --- |
| trivial | Luna / low | Sol / low |
| normal | Luna / medium | Sol / medium |
| complex / high-risk 规划 | Sol / medium | Astra / medium |
| complex / high-risk 执行与审查 | Sol / high | Astra / high |

Direct 仍不创建子任务、不分配子任务模型。不因为 Full、发布或多步骤就给所有角色使用 xhigh/max。任务或测试失败仍按有界修订处理，不能伪装为模型不可用来尝试所有模型。模型名称和档位的支持不代表当前账户已授权。

- CLI 预检与最终选择共用同一条有序显式链，修复深度/广度遍历不一致。
- 同一次命令按配置实例共享健康检查器，减少重复版本、目录发现；不跨账户共享运行时实例。
- 主模型预检成功时不提前探测备用模型。只有实际调用明确拒绝当前模型时，才按原链检查后继候选，再执行已有完整 scope/gate 校验。
- 对实际模型拒绝写入至多 60 秒的负缓存，避免下一任务立即重复失败；允许 `--force` 刷新，不新增后台重试。
- 较短的新配置 TTL 不再被旧缓存更长有效期绕过。
- 显式取消即使伴随 exit=0，也不能被执行器当作成功。

## 升级与边界

两版技能 ZIP、预编译 runtime、校验清单同步。旧的显式模型配置需要备份后迁移到 `config/relay.example.json` 的三模型配置；不自动覆盖用户的路径、权限或密钥设置。多个 candidate profile 是同一模型的角色/档位配置，不是增加模型种类。

安全安装包仍为 dry-run、真实执行关闭、modelRouting=inherit；继承父任务/宿主选择不等于已保证其使用 GPT-6。要强制这三款用于 CLI 子任务，应启用经本机目录和账户验证的显式三模型配置。父任务模型不被修改。

Astra 保留已核实的 0.153.0 最低 CLI 检查。Sol、Luna 不编造最低版本：使用本机目录的 model/effort/minimal_client_version，加真实有界健康预检。公开 API 档位不能直接作为桌面授权证明。

可复现调度计数见 `docs/gpt6-scheduling-measurements.json`。模拟进程计数不是实际模型 Token、端到端时延、成功率或订阅额度节省比例；没有调用用户真实账户进行 A/B。

官方核对日期：2026-09-23。Sol、Luna 于 2026-09-22 发布。来源：
- https://developers.openai.com/api/docs/changelog
- https://developers.openai.com/api/docs/models/gpt-6-sol
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/guides/latest-model
- https://help.openai.com/en/articles/20001275

English: GPT-6-only explicit candidates, role-specific efforts, invocation-scoped shared checks, identical selection/probe order and lazy runtime fallback. Permission gates, bounded revisions, complete evidence and account checks remain intact. Old explicit model configurations require migration; inherited parent defaults are not silently rewritten.

完整版 ZIP 额外附带 `runtime/config/relay.gpt6.json` 三模型预设，默认关闭真实执行；这是独立可选配置，不覆盖 `relay.user.json`。

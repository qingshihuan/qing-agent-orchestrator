# v0.8.1 发布说明 / Release notes

本版本将已合并的 PR #12 运行时修复正式提供为可安装技能包，不改变 v0.8.0 的 Direct/Lite/Full 策略、模型候选、预算和效果审批边界。

## 核心修复

- 模型健康检查：并发首次检查共享磁盘缓存读取；等价候选共享探测，同时保留各自审计身份。
- 健康状态与容错：配置变更或禁用后不沿用旧健康证明；缓存写入串行化，使用唯一临时文件；损坏缓存与写入失败不篡改实际预检结果。
- 发现失败恢复：后续显式检查可以重新发现版本或目录，保留失败缓存 TTL，不增加自动重试循环；取消、超时、截断不能冒充成功。
- 输出与进程：stdout/stderr 独立增量解码 UTF-8，修复中文和 emoji 跨块乱码；重复取消共享终止流程，任务完成后释放原始缓冲和观察者引用。
- 验证可靠性：新增 16 项回归测试，套件共 158 项；既有心跳测试改为等待持久化事件，保留全部原断言并在清理前等待任务结束。

## 下载与升级

| 附件 | 用途 |
| --- | --- |
| `qing-agent-orchestrator-standard.zip` | 桌面标准版，不包含 CLI runtime；内容与 v0.8.0 相同。 |
| `qing-agent-orchestrator-full.zip` | 完整版，内含 v0.8.1 预编译运行时和本次修复。 |
| `SHA256SUMS.txt` | 两个 ZIP 的 SHA-256 校验清单。 |

已使用完整版的用户应更新完整版 ZIP。升级前备份自行修改的配置，尤其是 `runtime/config/relay.user.json`，不要直接覆盖本地定制配置。技能目录名保持不变。默认仍为 dry-run，真实执行默认关闭；高风险效果仍需原有批准。

## 验证边界

发布沿用 Windows/Linux × Node 18/22 的类型检查和完整测试，以及 PowerShell Core 7.6.x 的确定性打包、安装验证和源码/运行时/ZIP 一致性检查。健康缓存测试使用模拟 ProcessRunner，进程测试使用 Node 子进程；这些证据不代表真实账户模型 entitlement 或 connected 模型端到端验收，不提供整体速度或 Token 节省比例承诺。

磁盘缓存仍是 best-effort、跨进程最后写入者生效的优化缓存，不是事务性证据数据库。既有 v0.8.0 标签和发布附件保持不变。

## English summary

Patch release for PR #12: deduplicate concurrent health-cache reads and probes, bind status to the current candidate fingerprint, tolerate cache write failures, recover failed discovery on later explicit checks, preserve streaming UTF-8, share cancellation, and release completed buffers. The suite grows from 142 to 158 tests. Only the full edition's runtime changes; the standard ZIP is unchanged. Back up customized configuration before upgrading. Model choices, budgets, sandbox permissions and effect gates remain unchanged; no connected-model performance claim is made.

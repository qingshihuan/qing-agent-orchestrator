# v0.7.0：效率优先编排

v0.7.0 的重点不是增加更多 Agent，而是在不降低验收质量和安全边界的前提下，减少不必要的模型升级、子任务、审查、健康探测、控制面输出与仓库 I/O。

## 核心变化

- **Direct / Lite / Full 更精确**：短任务和高度耦合的单范围长任务保持 Direct；中等顺序任务使用一个有界 Lite Executor；Full 继续保留给高风险、跨系统、真正并行、发布部署或显式完整编排。
- **Lite 成本受控**：Lite 首次模型选择固定在 normal 档位，不再仅因文本复杂度直接升级到 Sol/xhigh。
- **紧凑控制面**：新增 `--compact`，只保留状态、执行归属、路由、档位、预算、真实模型、审批结果和下一步。
- **健康探测复用**：模型健康结果可跨进程持久化复用；只探测当前主候选，fallback 在真实需要时沿显式链懒探测。
- **仓库与状态存储优化**：Git 审计只读取并哈希 dirty、untracked 和 deleted 内容；RunStore 追加事件不再反复解析完整 JSONL 历史。
- **修订证据隔离**：单轮 criterion evidence 错误不会继续污染后续修订轮次。

## 路由语义修正

删除判断现在区分“删除文件”和“删除文件内部代码”。例如删除 `index.js` 内未使用代码仍是普通项目内编辑，不会被误判为文件删除或高风险 Full；真实删除、push、外部消息、生产部署、全局写入、密钥访问、购买和破坏性迁移仍保留精确效果 gate。

## 兼容性与安全

- 现有 adaptive orchestration 配置和旧 Handoff 兼容路径保持有效。
- 父任务模型保持不变；模型选择只作用于确实创建的委派任务。
- 同后端 fallback 仍必须显式声明、能力有效，并保持 operations、allowed paths、sandbox、permissions 与 effects 不变。
- 本版本没有放宽任何既有高风险审批边界。

## 验证

发布前执行并通过：

- Ubuntu 与 Windows、Node.js 18 与 22 的 TypeScript typecheck 和完整测试矩阵；
- 136 项测试，包括 v0.7 路由、紧凑输出、持久模型健康缓存和证据隔离回归；
- 短、中、长三档确定性效率基准；
- Standard / Full 技能包确定性重建、解压内容校验、运行时漂移检查和 SHA-256 一致性验证。

## 发布资产

- `qing-agent-orchestrator-standard.zip`
- `qing-agent-orchestrator-full.zip`
- `SHA256SUMS.txt`

## 证据边界

确定性基准测量路由档位、子任务与 Reviewer 预算、委派模型档位、控制面字节数和本地路由耗时。控制面字节数是上下文与 token 压力的代理，不等同于服务端计费 token。真实模型 token、一次完成率和端到端墙钟收益仍需在相同模型、相同仓库快照和相同验收条件下进行 connected A/B。

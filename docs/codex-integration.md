# 可选 Codex CLI 接入

CLI 是完整版的条件能力，不是完整版的启动依赖。标准版没有启动器或 runtime。

`start`/`prepare` 先经过自适应编排：Direct 直接返回父任务状态且不分配模型、不探测 CLI、不调用 Planner；Lite 只返回桌面单 Executor 合同；只有 Full 才能进入 local 或 connected Handoff 规划。配置 `orchestration.mode=full` 是显式强制 Full 的兼容入口。

## 自动选择和只读检查

Qing 仅在明确 CLI/CI、持久运行、机器控制或隔离等需求下选择进程方式。普通复杂工程保持原生子智能体。选择方式不再额外询问接受/拒绝；dispatch 自动只读检查，审计为 auto-selected。--no-model-probe 阻止发现和模型调用并返回 CLI_DEPENDENCY_CHECK_REQUIRED，--cli-response auto 可由宿主驱动继续；accept/decline 仍兼容，拒绝不再提示。

检查不会安装、登录、变更配置或执行任务。缺少能力只要求处理真正的缺口。安装、账户访问或新外部效果需要实际任务/宿主授权；同一授权不重复询问。

## 独立进程授权边界

原生父任务/子智能体直接使用宿主的当前有效权限。单独运行的 Relay 不具备可信的父会话权限桥接，不能从单个 config.toml、截图或生成的 Handoff 取得授权。现有 sandbox、allowedPaths、网络、证据和模型参数边界不变。

真实进程执行仍要求 executor.codexExec.enabled=true、--allow-real-execution 和精确效果 gate。已有明确授权可由调用宿主传递为机器参数，无需让用户重复手工输入；模型不得伪造授权。--approve-handoff 仅为旧兼容字段，安全计划本身不是审批点。不要为免提示强制设置 never/full-access 或换后端规避拒绝。

## 模型和推理强度

CLI 只能使用本机已配置并通过模型目录校验与最小健康检查的候选。Planner 和 Executor 以独立参数获得最终 ModelSelection。sandbox、审批、workspace、network、schema、ephemeral、Windows runtime 和审计设置不能由候选覆盖。

配置接受 backend、model、可选 CLI profile、精确 reasoningEffort、availability、roles、routes、categories、complexityBands、tags、priority、enabled、fallbacks。配置阶段只验证字段、token 边界、后端约束和显式 fallback 图；它不会用仓库内的永久静态表猜测某个未来或已更新的 Codex CLI 是否支持指定 pair。

每个 CLI 候选在真实选择前依次经过两层检查：

1. Relay 调用本机 `codex debug models --bundled`，解析当前二进制自带的模型目录，并核对 model slug、`supported_reasoning_levels` 与 `minimal_client_version`。
2. 目录匹配后，再运行现有的 read-only、structured、bounded health probe，确认当前账户/entitlement 能真实调用该 pair，并确认配置角色。

因此 `minimal|low|medium|high|xhigh|max|ultra` 都可以作为安全配置 token 表达，但只有本机目录明确公布且客户端版本满足要求的 model/reasoning pair 才可能成为 healthy；目录命令缺失、JSON 异常、模型不存在、档位不支持或客户端过旧都会在任务进程创建前失败关闭。`none` 不是可发送的 CLI 推理档位。配置继续拒绝跨后端 fallback、provider URL、token、secret 和未知字段。

健康检查失败，或真实调用错误明确点名当前所选 model ID 并说明 unknown、account/entitlement 不支持、metadata not found 或 unavailable 时，只能沿配置的显式同后端链继续；无健康安全候选则失败关闭。选择事件保存 `executionOwner: Codex`、planned/actual pair、fallback reason、链和尝试，并用 `scopeProofComplete` 证明操作、安全与权限范围是否未变。同后端且完整证明 operations、allowedPaths、sandbox、permissions、effects 均不变时不新增 gate；证明缺失/不完整、跨后端或任一范围变化必须停止并重新审批。此规则同样适用于 high-risk band，不会削弱 Handoff 或操作 gate。

是否实际可用取决于本机 Codex 版本、账户和 entitlement；只有目录校验和最小预检都健康的候选能被选择。当前订阅访问不应被解释为 Responses API entitlement，本实现也没有 API adapter。

## 进程协议

适配器使用参数数组且 shell=false，通过 stdin 发送提示，要求 JSONL 和严格最终 Schema。仅允许 read-only 或 workspace-write，设置时间/输出上限并脱敏错误。真实执行回退按显式计划长度有界；每次尝试保持 prompt、workspace、sandbox、environment/permissions、output schema、timeout 和 output limit 完全一致，只改变已审计的 model/reasoning pair。同一 CLI profile 才能自动复用 gate。认证、spawn/进程、超时、取消、输出上限、协议、schema、跨后端或范围变化错误不重试。

真实进程开始后 RunStore 记录 started、heartbeat、exited、phase、iteration、pid 和 elapsedMs。status、logs 和 cancel 从持久化状态工作。取消终态不得被后续退出事件覆盖。

新 Handoff 保存 tier/child/revision 预算。`execute` 和旧 `run` 共用同一运行时上限解析：合同不得超过当前配置，实际迭代数取 relay 配置、Handoff `maxIterations`、`maxRevisions + 1` 的最小值；没有预算字段的旧 Handoff 从当前自适应路由派生，以保持可读取兼容但不保留无界循环。

Executor 返回后，声明的 testPlan 由 Relay 父进程独立执行并绑定 runId、handoffId、iteration 与命令。Git 前后快照检查工作区内未上报变化；审计不确定时进入人工复核。

## Windows runtime

完整版不硬编码 WindowsApps 版本、用户名、AppData 哈希或包版本。它解析实际命令，并验证同目录应用布局或版本匹配的 standalone 包、入口、resources 和 sandbox helper。workspace-write 来源不一致时在长任务前失败关闭；read-only 只保留诊断通道。

## 打包与默认安全

完整 ZIP 包含 Relay dist/src、schemas、package.json 和安全配置：

- mode=dry-run；
- codexExec.enabled=false；
- modelRouting.mode=inherit；
- approvedGateIds=[]。

它不包含 codex.exe。调用方完成依赖检查并在授权范围内显式提供 `--allow-real-execution` 前，包内能力不会执行真实任务；高风险效果还必须通过对应 gate。

## 未实现或未在本轮证明

- Codex SDK 适配器；
- 原生批准 UI；
- 常驻跨进程服务/队列；
- 双版本安装后的 connected read/write E2E；
- GitHub 发布。

旧适配器的历史 connected 结果不能替代当前产物的部署和 E2E。

## v0.9 low-overhead operation
Prefer `--compact` for agent-facing dispatch/start. Use `models probe --candidate cli-astra-demanding` only after enabling/configuring that candidate; health checks reuse the shared persistent cache. `--force` refreshes health explicitly, not on every task. Astra requires CLI 0.153.0 or newer, a matching local catalog and successful account preflight. No installation or login is performed automatically.
`logs <run-id> --after 0 --limit 20 --compact` returns `{events,nextAfter,hasMore}`. Continue with nextAfter only when more evidence is needed; never mistake a partial page for the full journal. Without page flags the legacy full array remains available. Both ZIPs have updated instruction contracts; back up customized configuration before installing.

## v0.10 GPT-6-only scheduling

Explicit candidates must use gpt-6-luna, gpt-6-sol or gpt-6-astra; unknown and retired models fail before submission. Migrate old saved configurations rather than silently renaming their model IDs. The runtime's safe inherit default does not control the parent's model.

The CLI now shares one task scheduler per loaded configuration instance. It uses the exact selector chain, performs no speculative backup probes, and only preflights remaining fallbacks after an explicit selected-model runtime rejection. Authentication, task, cancellation, protocol, schema and timeout errors are not model-fallback triggers. Rejected-model health is invalidated for at most 60 seconds; explicit force refresh remains possible. Permission/profile/scope checks still apply. Sol/Luna minimum versions come from the installed catalog, not an invented fixed floor. See release-notes-v0.10.0.md.

# 可选 Codex CLI 接入

CLI 是完整版的条件能力，不是完整版的启动依赖。标准版没有启动器或 runtime。

## 何时建议

仅允许稳定 reason code：

- explicit-cli-request
- script-or-ci
- scheduled-batch-unattended
- app-close-persistence
- machine-readable-control-plane
- cli-only-model-or-environment
- process-isolation-or-queue

普通代码、复杂任务和长时间交互工作保持 desktop-native。

## 接受前

初始建议只显示“建议切换 CLI 模式”、收益和接受/拒绝选项。不得调用 doctor、models probe、安装、登录、创建任务或执行 Handoff。

拒绝后进入 desktop-fallback-selected，继续桌面工作并禁止当前任务重复提示。

## 接受后

1. scripts/qing.ps1 doctor 检查可用性和认证，不提交任务。
2. 缺失或未登录时，参考[官方 Codex CLI 文档](https://learn.chatgpt.com/docs/codex/cli)。
3. 全局安装或配置修改需要独立 Handoff/gate。
4. CLI 就绪后创建新的任务 Handoff。
5. 真实执行要求：
   - executor.codexExec.enabled=true；
   - --approve-handoff exact-id；
   - --allow-real-execution；
   - 所有 REQUIRE_APPROVAL gate 已批准。

## 模型和推理强度

CLI 只能使用本机已配置并通过最小健康检查的候选。Planner 和 Executor 以独立参数获得最终 ModelSelection。sandbox、审批、workspace、network、schema、ephemeral、Windows runtime 和审计设置不能由候选覆盖。

配置接受 backend、model、可选 CLI profile、精确 reasoningEffort、availability、roles、routes、categories、complexityBands、tags、priority、enabled、fallbacks。CLI 文档当前确认 `minimal|low|medium|high|xhigh`，因此即使桌面主机对部分模型公布 `max/ultra`，Relay 也不会把它们发送给 CLI。配置按 model/backend 精确校验，拒绝跨后端 fallback、provider URL、token、secret 和未知字段。

健康检查失败，或真实调用错误明确点名当前所选 model ID 并说明 unknown、account/entitlement 不支持、metadata not found 或 unavailable 时，只能沿配置的显式同后端链继续；无健康安全候选则失败关闭。选择事件保存 `executionOwner: Codex`、planned/actual pair、fallback reason、链和尝试，并用 `scopeProofComplete` 证明操作、安全与权限范围是否未变。同后端且完整证明 operations、allowedPaths、sandbox、permissions、effects 均不变时不新增 gate；证明缺失/不完整、跨后端或任一范围变化必须停止并重新审批。此规则同样适用于 high-risk band，不会削弱 Handoff 或操作 gate。

CLI 可配置 `gpt-5.6`（通用模型指导中该 alias 指向 `gpt-5.6-sol`），推荐候选 ID 为 `gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna` 和 `gpt-5.3-codex-spark`。是否实际可用取决于本机版本、账户和 entitlement；只有最小预检健康的候选能被选择。当前订阅访问不应被解释为 Responses API entitlement，本实现也没有 API adapter。

## 进程协议

适配器使用参数数组且 shell=false，通过 stdin 发送提示，要求 JSONL 和严格最终 Schema。仅允许 read-only 或 workspace-write，设置时间/输出上限并脱敏错误。真实执行回退按显式计划长度有界；每次尝试保持 prompt、workspace、sandbox、environment/permissions、output schema、timeout 和 output limit 完全一致，只改变已审计的 model/reasoning pair。同一 CLI profile 才能自动复用 gate。认证、spawn/进程、超时、取消、输出上限、协议、schema、跨后端或范围变化错误不重试。

真实进程开始后 RunStore 记录 started、heartbeat、exited、phase、iteration、pid 和 elapsedMs。status、logs 和 cancel 从持久化状态工作。取消终态不得被后续退出事件覆盖。

Executor 返回后，声明的 testPlan 由 Relay 父进程独立执行并绑定 runId、handoffId、iteration 与命令。Git 前后快照检查工作区内未上报变化；审计不确定时进入人工复核。

## Windows runtime

完整版不硬编码 WindowsApps 版本、用户名、AppData 哈希或包版本。它解析实际命令，并验证同目录应用布局或版本匹配的 standalone 包、入口、resources 和 sandbox helper。workspace-write 来源不一致时在长任务前失败关闭；read-only 只保留诊断通道。

## 打包与默认安全

完整 ZIP 包含 Relay dist/src、schemas、package.json 和安全配置：

- mode=dry-run；
- codexExec.enabled=false；
- modelRouting.mode=inherit；
- approvedGateIds=[]。

它不包含 codex.exe。用户接受建议、完成依赖检查并批准新的 Handoff 前，包内能力不会执行真实任务。

## 未实现或未在本轮证明

- Codex SDK 适配器；
- 原生批准 UI；
- 常驻跨进程服务/队列；
- 双版本安装后的 connected read/write E2E；
- GitHub 发布。

旧适配器的历史 connected 结果不能替代当前产物的部署和 E2E。

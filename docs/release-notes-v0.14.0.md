# v0.14.0 — 单执行者架构发布

本次按维护者要求发布已合并的单执行者架构，提供正式版本标签和可下载技能包。`execute-single` 仍为实验性、显式启用的运行路径；发行版本号不是性能或真实账户端到端验证的证明。

## 主要变化（相对 v0.13.0）
- 默认只有一个完整实现负责人：当前父任务直接完成，或把整项实现、调试与约定测试转交一个执行器。关闭自动切片后父任务继续做大部分实现的路径。
- 执行拓扑、独立审查、权限分开；多文件、跨模块、可并行或 CLI 传输本身不再强制 Full/Reviewer。真实高风险、明确要求和待决独立审查继续保留。
- 新增 `execute-single` / `SingleOwnerController`。程序负责等待、固定验收与 Git 审计；控制器不调用管理模型，只启动一次 worker 适配器，不自动重试或运行时轮换模型。一次 worker 启动内部仍可能发生多次模型请求。
- 在当前单执行器调用中关闭原生多智能体工具，不修改用户全局配置。原生技能只能约束调用行为，不能硬性限制宿主请求数。
- 受保护规格和验收文件在测试前、测试之间和最终验收核对哈希；取消、篡改、未声明效果或失败不能报成功。同规范化工作区的合作式租约限制重复接管，不是 OS 沙箱。
- `start` 默认生成本地任务合同骨架，不隐式调用付费 Planner；骨架须补具体验收命令后才可执行。已有显式接口保留。
- 用量报告仅包含实际观察到的执行器 turn.completed 用量；turn 不等于模型 request。父任务、预检或失败用量不完整时，总费用与总请求数保持未知。

## 验证边界
发布前及发布工作流执行完整 240 项自动化测试，并核对 Windows/Linux × Node.js 22/24/26、技能包内容、预编译运行时和解压 CLI。具体成功状态以该标签提交的 Actions 为准。
自动化测试中的模型执行器为注入的模拟适配器；固定验收子进程、Git、租约和 CLI 控制路径实际运行。尚未完成用户账户的真实单执行器端到端验证，也未重跑六组模型性能基准。
**没有已证实的整体提速、总 Token 或费用下降比例。** v0.13 的历史实验结论不被本次发布覆盖；同条件模型复验仍是后续效率结论的依据。

## 下载与升级
- `qing-agent-orchestrator-standard.zip`：原生桌面技能，无 Node.js 依赖。
- `qing-agent-orchestrator-full.zip`：相同原生能力及可选 Relay，运行时要求 Node.js 22 或更新版本；本次测试系列为 22/24/26，构建使用 24。
- `SHA256SUMS.txt`：两个 ZIP 的 SHA-256。

从 v0.13 升级时，两版技能都需要更新。备份定制配置，尤其是 `runtime/config/relay.user.json`；不要直接覆盖自定义设置。安装后新建会话加载技能。仓库发布不会更新本机安装。
默认仍为 dry-run、inherit、真实执行关闭；GPT-6 Luna/Sol/Astra 配置、有效宿主权限和独立 Relay 的操作 gate 不变。`execute-single` 需要具体 Handoff、受保护的规格/验收输入、可审计 Git 工作区与既有真实执行授权；有独立审查义务时应使用保留的审查流程。

详见 [单执行者架构及限制](single-owner.md)。v0.13.0 标签和附件不修改。

English: this release distributes the single-owner architecture already merged in PR #19. The opt-in execute-single controller remains experimental. Software/package verification is not a connected-model speed, token or cost benchmark. Existing permissions, model defaults and prior releases are preserved.

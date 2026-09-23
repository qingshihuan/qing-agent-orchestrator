# Current experimental architecture

The single-owner rules in [single-owner.md](single-owner.md) supersede the historical topology/review coupling below. Parallel capability, cross-module scope and transport alone no longer mandate an independent Reviewer. Native instructions and execute-single have different enforcement boundaries; the latter is optional and requires existing authority. Stable Release remains v0.13.0 until connected verification.

## Historical design below (superseded where noted)

# 版本与执行方式（v0.11）

默认桌面标准版：Direct/Lite/Full、原生委派、宿主权限与分层验证；无运行时、启动器或 CLI 依赖。完整版增加可选进程能力，普通任务仍桌面优先。两版都由 Qing 决定任务是否值得委派，用户无需选择档位。

原生操作复用宿主实际生效的配置和精确任务授权，不额外批准 Handoff/子智能体/模型或已授权效果。高风险操作的范围检查仍存在，只有缺少真正授权时才由宿主处理。详见 [宿主权限](host-permissions.md)。

完整版遇到明确 CLI、CI、无人值守、应用关闭后继续、机器可读控制或进程隔离需求时可自动选择进程路线；复杂/长任务本身不是理由。路由函数无 I/O，dispatch 可做只读依赖检查，不再要求固定接受/拒绝。显式拒绝有效且不重复提示。--no-model-probe 返回 CLI_DEPENDENCY_CHECK_REQUIRED，不发起依赖/模型调用。

缺少依赖或认证返回 CLI_SETUP_REQUIRED，不会安装、登录或提交任务。单独的 Relay 保留安全默认、精确效果授权和 --allow-real-execution；它没有可信的桌面权限继承通道，不可把 full-access 截图当作授权。

把对应 ZIP 解压到用户或项目的 .agents/skills；本项目打包不会自动部署到用户电脑。标准版有桌面专用 Handoff/Review schema；完整版有独立进程 schema 与安全默认配置，不携带 codex.exe。更新前备份自定义配置。

## v0.13 speed/cost policy
两版均使用 Direct 快速路径和委派收益检查；普通工作不会只因“多步骤”就新建子任务。默认父任务保留上下文，只有可独立验收且能转移实质工作的委派才进入 Lite。安全、Full 审查及宿主权限规则不变。详见 parent-overhead.md。

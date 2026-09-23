# Qing 决策，宿主授权（v0.11）

用户给目标，Qing 自动选择 Direct/Lite/Full、模型与执行方式。不要把这些选择交回用户，也不要为了使用技能而必须创建子任务。上下文高度耦合、交接可能增加返工时优先 Direct；有可独立验收的工作再委派。未变化的工具调用不重新跑一遍规划。

## 原生父任务和子智能体

以 ChatGPT/Codex 当前会话实际生效的权限为准，复用同一操作、目标、数据与范围内仍有效的授权。config.toml 有用户、项目、profile 等层；会话覆盖和管理员限制也参与生效配置。Qing 不重新解析一个文件就宣布 full-access，不读取完整配置或复制凭据，不修改 approval_policy/sandbox/网络白名单，不制造 gate ID。

- 已在用户任务范围内、宿主允许的动作：直接继续，不另弹 Qing 确认。
- on-request：只在宿主实际要求时走原生审批，不先问一次再触发宿主审批。
- never：不产生新的权限请求，不等于扩大 sandbox；受限操作失败后停止受影响动作。
- 缺少明确的业务授权、目标/数据不确定、越界或宿主拒绝：澄清新增部分或停止，不换工具/后端绕过。
- 高风险审查、禁止目标、测试与证据不因“少确认”而删除。

`nativePermissionHandling` 只是不可授权的控制合同。桌面 Full 的效果报告保留；原 REQUIRE_APPROVAL 映射为 `HOST_PERMISSION_CHECK_REQUIRED`，表示交给宿主与父任务核对已有范围/权限，不表示允许执行。DENY 仍是 DENIED，绝不把未知权限转换为 ALLOW。完整和 --compact 输出都保留该合同与未满足的效果报告。

## 可选 CLI 路由

选择进程后端不再固定询问接受/拒绝。正常 dispatch 可自动进行只读 doctor 检查；自动决策标为 auto-selected，不伪装为用户接受。`--no-model-probe` 同时阻止依赖/模型检查，返回 `CLI_DEPENDENCY_CHECK_REQUIRED`；宿主驱动可直接用 `--cli-response auto` 继续。accept/decline 兼容保留，明确拒绝仍被尊重。路由函数本身无 I/O。

缺失依赖或未登录只返回 setup 状态；不会自动安装、登录或修改配置。独立 Relay 不等于原生子智能体：当前没有可信的跨进程宿主权限传递接口。其默认禁用真实执行、--allow-real-execution、sandbox、精确效果 gate 均不变。宿主可传递已经明确授权的机器参数，但生成的 Handoff 或仓库文件不能自己给自己批准。普通工作优先原生后端，真正继承当前宿主权限，而非另外启动忽略配置的进程冒充继承。

## 验证边界

测试覆盖路由、只读依赖检查、完整/精简控制输出、拒绝与未知态以及不可信配置注入。没有在用户桌面验证原生授权弹窗或其真实 config.toml；不声称实现了一个可以读取桌面实时权限的远程接口。减少的是 Qing 自己的重复确认环节，不承诺宿主永远不询问，也没有真实任务 Token/时延 A/B 数值。

截图类告警中的 `session-flags: features.thread_tools is ignored` 表示当前会话传入了不识别的设置。它与 Qing 重复审批分开排查，不能只凭告警认定该键一定写在用户 config.toml，不能建议借机关闭所有安全控制。

官方核对（2026-09-23）：
- https://developers.openai.com/codex/config-basic
- https://developers.openai.com/codex/subagents
- https://developers.openai.com/codex/agent-approvals-security

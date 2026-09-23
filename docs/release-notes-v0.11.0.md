# v0.11.0 — 自动决策与宿主权限复用

Qing 自动决定 Direct/Lite/Full 和子任务模型；用户不需要先选择“单用 Astra 还是委派”。原生父任务/子智能体沿用宿主当前有效权限和已有任务授权，不新增计划、模型、委派或已授权效果的 Qing 确认。

桌面 Full 保留效果与独立审查要求；REQUIRE_APPROVAL 现在返回 HOST_PERMISSION_CHECK_REQUIRED，由宿主处理真实权限缺口，绝非自动 ALLOW。DENY、未知权限、越界及宿主拒绝不被绕过；never 不代表无限权限。

CLI 路由不再固定要求接受/拒绝，自动只读检查以 auto-selected 审计。--no-model-probe 仍无发现或模型调用，返回 CLI_DEPENDENCY_CHECK_REQUIRED。用户拒绝继续有效。不会自动安装、登录或开启真实执行；独立 Relay 仍保留精确效果 gate 和执行 opt-in，不根据截图/不可信文件推断父会话权限。

两版技能、预编译运行时、ZIP 和校验文件一起更新。保留 GPT-6 Luna/Sol/Astra、原模型预算及证据检查。升级前备份定制配置；本次不修改用户的 config.toml。

详见 docs/host-permissions.md。新增控制状态可能需要外部调用者更新；不再将 HOST_PERMISSION_CHECK_REQUIRED 当成要求用户输入 Qing gate ID 的指令。原始效果报告与 --compact 中的决定均保留。

验证基于单元/CLI/打包测试，未验证用户桌面实际弹窗、真实模型账户或端到端 Token 节省；无可信跨进程权限继承桥接。删掉重复确认不等于绕过宿主、管理员或连接器审批。

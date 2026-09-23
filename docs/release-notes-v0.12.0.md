# v0.12.0 — Node.js 22 / 24 / 26 兼容性

## 变化

- CI 从 Windows/Linux × Node 18/22 改为 Node 22/24/26，共六种环境；每组运行完整类型检查、回归测试及发布 ZIP 的离线启动检查，不只是安装成功。
- `.node-version` 固定主要构建系列为 24 LTS；打包和 Release 工作流共同读取，`check-latest` 获取该主版本下的最新补丁。Node 26 Current 也作为正式必过测试，不使用 continue-on-error。
- 每组直接解压已提交的两版 ZIP，检查 SHA-256、版本/引擎声明、安全默认值，并运行完整版 CLI help、三模型配置读取和 Direct dispatch。测试不调用模型、Codex、登录或修改用户配置。
- Node.js 运行时最低声明由 18 提升到 22；Node 18/20 不再属于维护范围，所以使用次版本 0.12.0。`>=22` 是最低版本声明，不代表对未来所有主版本的兼容保证；本次验证范围明确为 22、24、26 的测试时最新补丁版本。
- 保持 Node 22 类型定义作为最低 API 基线，不升级 npm 依赖，不修改三模型调度、宿主权限继承、沙箱或真实执行开关。

## 使用与升级

推荐 Node.js 24 LTS；已使用 Node.js 26 的用户无需为 Qing 降级。只需安装一个版本。Node 22 仍受测试支持。标准版和完整版的原生桌面用法不需要 Node.js；只有可选 Relay 运行时和源码开发需要它。

标准版技能内容不变，其 ZIP 保持字节一致；完整版的运行时元数据与使用说明更新并重新打包。升级前备份自定义 relay.user.json。本发布不会自动修改系统 Node.js、用户技能安装目录或 config.toml。

具体执行版本与结论以本发布对应的六组 CI 和 Release 日志为准。单元测试和离线产物检查不等于用户账户真实模型 E2E 或性能基准。

官方生命周期核对：2026-09-23，https://nodejs.org/en/about/previous-releases 。Node 22/24 为 LTS，26 为 Current；18/20 为 EOL。

English: test the shipped packages and complete source suite on Node 22/24/26 for both Windows and Linux, build on Node 24 LTS, and retire the EOL Node 18/20 support baseline. No model routing, permission or dependency upgrades.

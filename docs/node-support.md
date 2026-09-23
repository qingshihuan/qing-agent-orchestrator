# Node.js 支持范围

当前主动测试的主版本：**22、24、26**。推荐 **24 LTS**；26 Current 也需要通过全部兼容测试。安装一个版本即可，不要求同时安装多个版本。`.node-version` 表示发布构建所用的 24 系列，不限制用户必须使用 24。

最低运行时声明是 `>=22`，当前兼容证据限于 Windows/Linux 上 22/24/26 测试时的最新补丁版本，不把最低声明当成所有未来版本已通过的证明。Node 18/20 已退出本项目维护范围；历史发行物及历史测试记录不改写。

CI 每个主版本都运行类型检查和完整回归测试，还通过 `python scripts/smoke-release-packages.py --expected-node <22|24|26>` 校验并解压发布 ZIP，运行真正的预编译 CLI 的 help、模型配置读取和 Direct 分派。Python 只供 CI/开发使用，不是用户运行技能的新增依赖。发布打包与 Release 使用同一个 `.node-version`，同时保留逐文件内容、ZIP 字节及 SHA-256 一致性检查。

本仓库继续使用 Node 22 类型定义，以避免意外依赖高版本专有 API。GitHub Actions 自身的 action runtime 与被测试软件的 Node.js 版本是两个概念；测试程序的实际版本在 CI 日志中记录。

标准版没有 runtime；完整版仅在使用独立 Relay 时需要 Node.js。普通原生父任务和子智能体不因技能安装而新增 Node.js 依赖。

本次没有运行真实模型账户、修改系统 Node.js 或用户 config.toml。升级前备份定制配置。

官方生命周期：https://nodejs.org/en/about/previous-releases （核对：2026-09-23）。

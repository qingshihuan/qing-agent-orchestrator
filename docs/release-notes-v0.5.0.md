# 青-Agent-Orchestrator v0.5.0

发布日期：2026-08-24

v0.5.0 把 CLI 模型路由从仓库静态能力表升级为“当前安装目录 + 最低客户端版本 + 账户健康探针”的运行时验证，并补齐跨平台路径安全、四平台 CI、完整 Skill runtime 漂移检查和可复验的 GitHub Release 链路。

## 发布重点

- **运行时 Codex 目录：** 调用 `codex debug models --bundled`，读取真实模型 slug、`supported_reasoning_levels` 和 `minimal_client_version`。
- **双层健康验证：** 目录能力通过后，再执行受限、只读、结构化的 entitlement 探针；任一层失败都不会进入真实 `codex exec`。
- **未来推理档位可表达：** 配置允许 `minimal|low|medium|high|xhigh|max|ultra`，但只接受当前目录明确支持的 model/effort 组合。
- **路径边界加固：** POSIX 绝对路径、Windows 盘符路径、UNC 路径和父目录穿越在 wildcard 匹配之前即被拒绝。
- **跨平台 CI：** Ubuntu 与 Windows、Node.js 18 与 22 的四个组合均执行 typecheck 和完整测试。
- **发布产物防漂移：** 完整版 runtime、标准版/完整版 ZIP、解压文件集合、逐文件 SHA-256 和 manifest 均被复验。
- **自动正式发布：** 合并版本提交后，Release 工作流重新测试、打包、验证，创建 `v0.5.0` 标签并上传三个附件。

## 安全与兼容性

- 本版本没有放宽 Handoff、operation gate、same-backend fallback 或高风险 scope proof 的要求。
- 目录缺失、输出格式错误、模型不存在、推理档位不支持、最低客户端版本不足或账户预检失败时均失败关闭。
- Windows 8.3 短路径别名不再使同一临时目录产生错误的路径身份。
- ZIP 比较按解压内容进行，因此不会把归档时间戳差异误报为功能漂移。

## 验证与证据边界

正式 Release 只有在以下步骤全部成功后才发布：

1. `npm ci --ignore-scripts`；
2. TypeScript typecheck；
3. 完整测试套件；
4. Standard / Full Skill 打包与内部结构验证；
5. 已提交归档与新构建归档的逐文件内容比较；
6. `SHA256SUMS.txt` 复算；
7. 完整版 runtime 语义漂移检查。

这些证据证明代码、打包和发布链路。它们不保证任意账户拥有某个具体 CLI 模型；目标安装仍须通过真实目录和 entitlement 探针。本版本不声称新的 connected CLI 写入 E2E。

## 升级

从 Release 下载并覆盖对应技能目录：

- `qing-agent-orchestrator-standard.zip`
- `qing-agent-orchestrator-full.zip`

覆盖前保留你的用户配置；完整版的真实 CLI 执行仍默认关闭，并继续需要明确审批。

## 发布附件

- `qing-agent-orchestrator-standard.zip`
- `qing-agent-orchestrator-full.zip`
- `SHA256SUMS.txt`

---

## English

Release date: 2026-08-24

v0.5.0 replaces the permanent repository-side CLI capability table with runtime validation against the installed Codex catalog, minimum client versions, and a bounded account health probe. It also completes cross-platform path hardening, four-platform CI, generated Full-runtime drift checks, and a reproducible GitHub Release pipeline.

### Highlights

- **Installed Codex catalog:** read real model slugs, `supported_reasoning_levels`, and `minimal_client_version` from `codex debug models --bundled`.
- **Two-layer health validation:** a catalog-valid pair must also pass a bounded, read-only, structured entitlement probe before real `codex exec` may start.
- **Future-safe effort tokens:** configuration can express `minimal|low|medium|high|xhigh|max|ultra`, while the installed catalog remains authoritative for each pair.
- **Path boundary hardening:** POSIX absolute paths, Windows drive paths, UNC paths, and parent traversal fail before wildcard matching.
- **Cross-platform CI:** Ubuntu and Windows on Node.js 18 and 22 all run typechecking and the complete test suite.
- **Artifact drift prevention:** the Full runtime, Standard/Full ZIPs, extracted file inventories, per-file SHA-256 values, and manifests are verified.
- **Automated publication:** after the version commit reaches `main`, the Release workflow retests, rebuilds, validates, creates tag `v0.5.0`, and uploads all three assets.

### Safety and compatibility

- This release does not relax Handoff approval, operation gates, same-backend fallback, or high-risk scope proof.
- A missing or malformed catalog, absent model, unsupported effort, insufficient client version, or failed account probe fails closed.
- Windows 8.3 path aliases no longer give the same temporary directory conflicting identities.
- ZIP comparison uses extracted content, so archive timestamps are not mistaken for semantic drift.

### Validation and evidence boundary

A published Release must pass dependency installation, TypeScript typechecking, the full test suite, both Skill package validations, committed-versus-generated extracted-content comparison, checksum recomputation, and Full-runtime semantic drift detection.

Those checks prove the source, packaging, and publication chain. They do not guarantee that a particular account is entitled to a specific CLI model; the target installation must still pass its real catalog and entitlement probe. This release does not claim a new connected CLI write E2E.

### Upgrade

Download the matching archive and replace the corresponding skill directory while preserving user configuration. Real CLI execution in the Full edition remains disabled by default and still requires explicit approval.

### Assets

- `qing-agent-orchestrator-standard.zip`
- `qing-agent-orchestrator-full.zip`
- `SHA256SUMS.txt`

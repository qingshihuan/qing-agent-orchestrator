# Security Policy

## Supported version

安全修复目前面向最新发布版本和 `main` 分支。

## Reporting a vulnerability

请优先使用 GitHub 仓库的 **Private vulnerability reporting** 或 Security Advisory 私密报告，不要在公开 issue 中披露可利用细节、真实密钥、用户路径或未修复的绕过方法。

如果私密报告入口暂不可用，可以创建一个不含漏洞细节的公开 issue，请求维护者提供私密联系方式。

报告应尽量包含：

- 受影响版本与组件；
- 最小复现条件；
- 预期与实际行为；
- 可能影响；
- 已知缓解方式；
- 不含真实凭据的日志或样例。

## Security boundaries

特别关注以下边界：

- Handoff ID 或 operation gate 被绕过；
- allowedPaths、workspace 或 sandbox 逃逸；
- 命令参数注入或意外启用 shell；
- 日志、Schema、错误信息或 RunStore 泄露密钥；
- mock、dry-run 或不完整证据被错误判为 PASS；
- 取消后仍继续执行或覆盖终态；
- 标准版意外包含 CLI、runtime 或外部执行材料。

请勿在未获授权的第三方系统、生产环境或他人仓库中进行测试。

# 效率基准

`npm run benchmark:efficiency` 使用短、中、长三个确定性任务，比较完整控制面与 `--compact` 输出，并记录：

- Direct / Lite / Full 档位；
- child 和 Reviewer 预算；
- 实际选择的 delegated model / reasoning effort；
- 完整与紧凑 JSON 字节数；
- 以 4 bytes/token 计算的上下文压力代理；
- 大样本本地路由耗时。

该基准不调用生成模型，因此不能替代真实服务端 token、成功率和端到端时间 A/B。真实比较必须固定模型、仓库快照、任务文本、验收标准和测试命令。

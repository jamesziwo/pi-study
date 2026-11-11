> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`packages/coding-agent/examples/extensions/subagent/prompts/implement.md` · [英文原文](../../../../../../../../packages/coding-agent/examples/extensions/subagent/prompts/implement.md) · [阅读索引](../../../../../../README.md)
> 对应提交：`eff3c1c1612f2f4f4d4e187a15d4060c12a27fc9` · 原文 SHA-256：`65462de33c97ac1372cfed270dad9af164605b05028c069dd4c013ff9792675b`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

原始元数据（仅供对照）：

```yaml
---
description: Full implementation workflow - scout gathers context, planner creates plan, worker implements
---
```

使用 subagent 工具的 chain 参数执行以下工作流：

1. 先让 "scout" 找出与以下任务相关的全部代码：$@
2. 再让 "planner" 根据上一步上下文为 "$@" 制定实施计划，使用 {previous} 占位符。
3. 最后让 "worker" 实施上一步计划，使用 {previous} 占位符。

以 chain 执行，通过 {previous} 在步骤间传递输出。

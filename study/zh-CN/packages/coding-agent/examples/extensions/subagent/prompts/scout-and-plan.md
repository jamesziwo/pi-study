> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`packages/coding-agent/examples/extensions/subagent/prompts/scout-and-plan.md` · [英文原文](../../../../../../../../packages/coding-agent/examples/extensions/subagent/prompts/scout-and-plan.md) · [阅读索引](../../../../../../README.md)
> 对应提交：`eff3c1c1612f2f4f4d4e187a15d4060c12a27fc9` · 原文 SHA-256：`9506399391e0d2c71826c45f26cc332175dd964465f99a8bb880e109f8ed89f4`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

原始元数据（仅供对照）：

```yaml
---
description: Scout gathers context, planner creates implementation plan (no implementation)
---
```

使用 subagent 工具的 chain 参数执行以下工作流：

1. 先让 "scout" 找出与以下任务相关的全部代码：$@
2. 再让 "planner" 根据上一步上下文为 "$@" 制定实施计划，使用 {previous} 占位符。

以 chain 执行，通过 {previous} 传递输出。不要实现，只返回计划。

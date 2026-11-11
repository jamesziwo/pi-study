> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`packages/coding-agent/examples/extensions/subagent/prompts/implement-and-review.md` · [英文原文](../../../../../../../../packages/coding-agent/examples/extensions/subagent/prompts/implement-and-review.md) · [阅读索引](../../../../../../README.md)
> 对应提交：`eff3c1c1612f2f4f4d4e187a15d4060c12a27fc9` · 原文 SHA-256：`019ba4bf42d596ea03fc4564be5b2cc55a06227c95db19a4d5a5bb96697a75f9`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

原始元数据（仅供对照）：

```yaml
---
description: Worker implements, reviewer reviews, worker applies feedback
---
```

使用 subagent 工具的 chain 参数执行以下工作流：

1. 先让 "worker" 实现：$@
2. 再让 "reviewer" 审查上一步实现，使用 {previous} 占位符。
3. 最后让 "worker" 应用评审反馈，使用 {previous} 占位符。

以 chain 执行，通过 {previous} 在步骤间传递输出。

> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.pi/prompts/is.md` · [英文原文](../../../../.pi/prompts/is.md) · [阅读索引](../../README.md)
> 对应提交：`eff3c1c1612f2f4f4d4e187a15d4060c12a27fc9` · 原文 SHA-256：`9bc500efde0bcd1285e1103492077d732c24242719d230a109b13c7bcad7b7d4`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

原始元数据（仅供对照）：

```yaml
---
description: Analyze GitHub issues (bugs or feature requests)
argument-hint: "<issue>"
---
```

分析 GitHub issue：$ARGUMENTS

对每个 issue：

1. 在 CI 中运行（`CI=true`）时不添加 `inprogress` 标签，也不指派 issue；否则分析前通过 GitHub CLI 添加标签，并指派给本地 `gh` 用户。任一步失败都应明确报告并继续。
2. 完整阅读 issue，包括所有评论和关联 issue／PR。使用 GitHub CLI 支持的字段，例如：
   ```sh
   gh issue view <issue> --json title,body,comments,labels,assignees,state,url,author,createdAt,updatedAt,closedByPullRequestsReferences
   ```
3. 不直接相信 issue 中的分析；独立核验行为，从代码和执行路径形成自己的结论。

4. **缺陷类 issue：**
   - 忽略 issue 中的根因推断，因为它很可能错误。
   - 完整读取所有相关代码文件，不截断。
   - 追踪代码路径，找出实际根因。
   - 提出修复方案。

5. **功能请求：**
   - 未核验前不相信 issue 中的实现方案。
   - 完整读取所有相关代码文件，不截断。
   - 提出最简洁的实现方式。
   - 列出受影响文件和所需修改。

没有明确要求时不得实现，只做分析和建议。

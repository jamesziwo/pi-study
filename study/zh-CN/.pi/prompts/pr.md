> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.pi/prompts/pr.md` · [英文原文](../../../../.pi/prompts/pr.md) · [阅读索引](../../README.md)
> 对应提交：`eff3c1c1612f2f4f4d4e187a15d4060c12a27fc9` · 原文 SHA-256：`1ba8e6cba91354e27bc4976d237c291691e9a064cee2132cef7656e3ceb46e20`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

原始元数据（仅供对照）：

```yaml
---
description: Review PRs from URLs with structured issue and code analysis
argument-hint: "<PR-URL>"
---
```

给定一个或多个 GitHub PR URL：$@

对每个 PR URL，依次执行：
1. 分析前通过 GitHub CLI 给 PR 添加 `inprogress` 标签；失败时明确报告并继续。
2. 完整阅读 PR 页面，包括描述、全部评论、提交及变更文件。
3. 找出正文、评论、提交信息或交叉链接中关联的 issue，完整阅读每个 issue 及其评论。
4. 不检出或切换 PR 分支，直接分析差异。使用 `gh pr diff`、`gh pr view`、`gh api` 和本地主分支文件；需要 PR 文件时使用已获取引用的 `git show <ref>:<path>` 或临时文件。完整阅读相关文件并对照差异；只有主分支缺少文件或差异上下文不足时才获取 PR 文件对象。也要阅读验证行为所需、但未包含在差异中的相关路径。
5. 不检查变更日志条目。按 CONTRIBUTING.md，贡献者 PR 不应编辑 `CHANGELOG.md`，由维护者合并时添加。
6. 检查 packages/coding-agent/README.md、packages/coding-agent/docs/*.md、packages/coding-agent/examples/**/*.md 是否需要更新；已有功能变化或新增功能通常需要。
7. 按以下章节给出结构化评审：
   - What it does：一段简短说明，描述变更和意图。
   - Good：可靠的设计选择或改进。
   - Bad：具体问题、回归、测试缺失或风险。
   - Ugly：隐蔽或影响重大的问题。
   - Tests：覆盖内容、缺口及已有测试是否足够。
   - Open questions for you：仅列出阻碍合并判断、需要用户回答的问题；没有则省略此节。

每个 PR 的输出格式：
PR: <url>
What it does（变更说明）：
- ...
Good（优点）：
- ...
Bad（问题）：
- ...
Ugly（隐蔽或重大问题）：
- ...
Tests（测试）：
- ...
Open questions for you（待确认问题）：
- ...

没有发现问题时，在 Bad 和 Ugly 下明确写明。

> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.pi/prompts/cl.md` · [英文原文](../../../../.pi/prompts/cl.md) · [阅读索引](../../README.md)
> 对应提交：`eff3c1c1612f2f4f4d4e187a15d4060c12a27fc9` · 原文 SHA-256：`e86103ed3476ac5760526496f9d4a5a63ae6e3a8a9597db103cfd023ddbf9684`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

原始元数据（仅供对照）：

```yaml
---
description: Audit changelog entries before release
---
```

审计自上次发布以来所有提交的变更日志条目。

<a id="process"></a>
## 流程

1. **找到最近的发布标签：**
   ```bash
   git tag --sort=-version:refname | head -1
   ```

2. **列出该标签之后的全部提交：**
   ```bash
   git log <tag>..HEAD --oneline
   ```

3. **阅读各包的 [Unreleased] 部分：**
   - packages/ai/CHANGELOG.md
   - packages/tui/CHANGELOG.md
   - packages/coding-agent/CHANGELOG.md

4. **逐个提交检查：**
   - 跳过变更日志更新、纯文档修改和发布整理。
   - 跳过生成的模型目录变更（如 `packages/ai/src/models.generated.ts`），除非同时包含非生成源码或文档中的有意产品行为变更。
   - 确定影响哪些包，使用 `git show <hash> --stat`。
   - 确认受影响包有对应变更日志条目。
   - 外部 PR 贡献须核对格式：`Description ([#N](url) by [@user](url))`。

5. **跨包重复记录规则：**
   `ai`、`agent` 或 `tui` 中影响最终用户的变化，还应写入 `coding-agent` 的变更日志，因为它是依赖这些包的用户侧产品。

6. **修正日志后添加 New Features 部分：**
   - 在 `packages/coding-agent/CHANGELOG.md` 的 `## [Unreleased]` 开头插入 `### New Features`。
   - 写入前先向用户提出主要新功能，等待确认。
   - 尽可能链接相关文档及章节。

7. **报告：**
   - 列出缺少日志条目的提交。
   - 列出需要跨包重复记录的条目。
   - 直接补充缺失条目。

<a id="changelog-format-reference"></a>
## 变更日志格式参考

章节顺序：
- `### Breaking Changes`：需要迁移的 API 变更。
- `### Added`：新增功能。
- `### Changed`：已有功能的变化。
- `### Fixed`：缺陷修复。
- `### Removed`：移除功能。

署名格式：
- 内部贡献：`Fixed foo ([#123](https://github.com/earendil-works/pi/issues/123))`
- 外部贡献：`Added bar ([#456](https://github.com/earendil-works/pi/pull/456) by [@user](https://github.com/user))`

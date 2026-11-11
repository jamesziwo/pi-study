> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.pi/prompts/sa.md` · [英文原文](../../../../.pi/prompts/sa.md) · [阅读索引](../../README.md)
> 对应提交：`eff3c1c1612f2f4f4d4e187a15d4060c12a27fc9` · 原文 SHA-256：`7b590798a5526e6620c6052cb688afd1d7ff2c2ca9426f8a28b5110a94ddbd7a`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

原始元数据（仅供对照）：

```yaml
---
description: Update a GitHub security advisory for publication
argument-hint: "<advisory-url-or-draft-path>"
---
```

更新待发布的 GitHub 安全公告：$ARGUMENTS

所有 GitHub 操作使用 `gh`。除非用户明确同意，或 Markdown 草稿明确写有 `request_cve: true`，不得发布公告、改变状态或申请 CVE。

GitHub 的公开 REST OpenAPI 和 GraphQL schema 不提供仓库安全公告评论／讨论。猜测 `/comments`、`/timeline`、`/events` 等端点得到 404 是预期情况，本身不代表认证失败。不要使用浏览器会话、Cookie 或提取 Cookie 来获取评论。应明确告知用户本次未包含公告评论；如需考虑，可由用户粘贴相关内容。

<a id="input-handling"></a>
## 输入处理

- `$ARGUMENTS` 是 GitHub 安全公告 URL 时，开始调查和起草流程。
- `$ARGUMENTS` 是已有 Markdown 草稿路径时，读取并将草稿应用到公告。
- 此提示之后用户回复“update”“apply”“looks good”等，视为同意应用此前写好的临时 Markdown 草稿；更新 GitHub 前必须从磁盘重读。
- 要应用草稿但尚不知道路径时，向用户询问 Markdown 文件路径。

<a id="initial-advisory-workflow"></a>
## 首次公告处理流程

1. 从公告 URL 解析 `owner`、`repo` 和 `GHSA` ID。
2. 使用以下命令获取公告：
   ```sh
   gh api repos/<owner>/<repo>/security-advisories/<GHSA>
   ```
   提出修改前，原样记录返回的原始严重性、CVSS 向量和分数。
3. 除非用户将评论粘贴到会话，否则不要获取公告评论／讨论：
   - 检查公告 JSON 中的参考、致谢、关联 issue／PR 及讨论字段。
   - 不依赖臆造的 `/comments`、`/timeline` 或 `/events` 端点；公开 API 不暴露草稿评论，通常返回 404。
   - 不通过浏览器会话、Cookie 或提取 Cookie 获取评论。
   - 明确告知用户：`Advisory comments were not included because GitHub does not expose them through the public API. Paste any relevant comments if you want them considered.`（公开 API 不提供评论，因此本次未包含；可粘贴需考虑的评论。）
   - 用户已粘贴评论时，阅读并纳入考虑。
   - 不假装已经读过评论。
4. 独立调查：
   - 阅读公告正文、元数据、受影响包、版本范围、CVSS、CWE、参考及关联 issue／PR／提交。
   - 检查相关代码历史、发布、变更日志、包元数据和标签。
   - 确定漏洞是否已经修复。
   - 已修复时，确认修复版本和正确受影响范围。
   - 未核验前不相信报告者分析。
5. 起草最终更新前与用户讨论 CVSS：
   - 提议 CVSS 向量、分数和严重性。
   - 简述有争议的指标。
   - 请用户确认或调整。
6. 询问是否需要通过 GitHub 为此公告申请 CVE。
7. 在 `/tmp` 起草可发布的 Markdown，如 `/tmp/sa-<GHSA>.md`，同时保留原始 CVSS 和拟议／确认后的 CVSS。
8. 告知用户：
   - 临时 Markdown 文件路径；
   - 原始公告 URL；
   - 可以编辑文件后回复“update”，或提供文件路径。

<a id="draft-markdown-format"></a>
## Markdown 草稿格式

草稿必须以 YAML frontmatter 开头，随后是公告正文，包含更新 GitHub 和决定是否申请 CVE 所需的全部字段。

```markdown
---
advisory_url: https://github.com/<owner>/<repo>/security/advisories/<GHSA>
owner: <owner>
repo: <repo>
ghsa_id: <GHSA>
summary: <short advisory summary>
original_severity: <low|medium|high|critical|null>
original_cvss_vector: <original CVSS:3.1/... or null>
original_cvss_score: <original number or null>
severity: <proposed/confirmed low|medium|high|critical>
cvss_vector: <proposed/confirmed CVSS:3.1/...>
cvss_score: <proposed/confirmed number>
cwe_ids:
  - CWE-...
vulnerabilities:
  - package:
      ecosystem: npm
      name: <package-name>
    vulnerable_version_range: <range>
    patched_versions: <range-or-version>
request_cve: false
---

# <Advisory title>

<Concise description of the vulnerability and vulnerable behavior.>

## Info

<Technical explanation of the root cause and affected component. Focus on facts needed by defenders and maintainers. Do not include PoC steps, exploit payloads, or copy-pastable exploit strings.>

## Impact

<Who can exploit it, prerequisites, confidentiality/integrity/availability impact, and realistic deployment assumptions.>

## Affected versions

- Affected: `<range>`
- Patched: `<version or range>`

## The solution

<Describe the fix and the patched release.>

## Recommendations

<Upgrade guidance and operational mitigations.>

## Workarounds

<Workarounds if any; otherwise skip this section entirely>

## Timeline

- YYYY-MM-DD: Report received
- YYYY-MM-DD: Fix committed
- YYYY-MM-DD: Fixed version released
- YYYY-MM-DD: Advisory published

## Credits

<Reporter/researcher attribution if appropriate, otherwise skip section.>

## References

- <links to releases, commits, advisories, documentation>
```

参考 curl 安全公告风格：章节清晰、语言直接，明确受影响／修复版本、建议、时间线和致谢；不要包含 PoC。

<a id="applying-a-draft-to-github"></a>
## 将草稿应用到 GitHub

用户回复“update”等表示同意，或提供 Markdown 路径时：

1. 从磁盘重读文件，不依赖记忆中此前生成的内容。
2. 解析 YAML frontmatter 和正文。
3. 在临时文件中构建 JSON 请求体，字段映射如下：
   - `summary` 来自 frontmatter。
   - `description` 来自 frontmatter 之后的 Markdown 正文。
   - `severity` 在 frontmatter 存在时使用。
   - `cvss_vector_string` 来自 `cvss_vector`。
   - `cwe_ids` 来自 frontmatter。
   - `vulnerabilities` 来自 frontmatter。
   - 不发送 `original_severity`、`original_cvss_vector`、`original_cvss_score`，它们仅用于审计上下文。
4. 使用以下命令更新公告：
   ```sh
   gh api -X PATCH repos/<owner>/<repo>/security-advisories/<GHSA> --input /tmp/<payload>.json
   ```
5. 当且仅当 frontmatter 含 `request_cve: true` 时，用以下命令申请 CVE：
   ```sh
   gh api -X POST repos/<owner>/<repo>/security-advisories/<GHSA>/cve
   ```
   “already requested”或“already assigned”不算致命错误，应报告该状态。
6. 报告更新内容：
   - 公告 URL；
   - 摘要；
   - 受影响范围；
   - 已修复版本；
   - 原始 CVSS 向量／分数／严重性；
   - 更新后的 CVSS 向量／分数／严重性；
   - 是否申请了 CVE。

<a id="safety-rules"></a>
## 安全规则

- 最终公告正文不包含 PoC 材料。
- Markdown 中没有 `request_cve: true` 时，不申请 CVE。
- 未经用户明确要求，不发布公告或改变状态。
- 不通过浏览器会话或 Cookie 获取公告评论；说明未包含评论，需要时请用户粘贴。
- 受影响范围、修复版本、CVSS 或 CVE 申请状态不确定时，应用前先询问。

> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.pi/skills/release.md` · [英文原文](../../../../.pi/skills/release.md) · [阅读索引](../../README.md)
> 对应提交：`eff3c1c1612f2f4f4d4e187a15d4060c12a27fc9` · 原文 SHA-256：`22ffbeda40edee2bfb6a8d93ba31472dd9b8a028f9fc32b6e64d468fb0aa3fb6`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

原始元数据（仅供对照）：

```yaml
---
name: release
description: Prepare, publish, verify, and recover pi releases. Use for release preparation, local release smoke tests, publishing, and failed release CI or announcements.
---
```


<a id="releasing-pi"></a>
# 发布 pi

除非另有说明，仓库命令均从仓库根目录执行，即原始 skill 上方两级目录。

**同步版本管理**：所有包共用一个版本，每次一起更新。`patch` 用于修复和新增，`minor` 用于破坏性变更，不做 major 发布。

1. **更新 CHANGELOG**：询问用户是否已在 `main` 最新提交运行 `/cl`；没有则必须先运行，审计并更新各包 `[Unreleased]` 后才能发布。

2. **本地冒烟**：构建未发布版本，从仓库之外测试，确保不能解析到工作区文件：
   ```bash
   npm run release:local -- --out /tmp/pi-local-release --force
   cd /tmp

   # Node package install smoke tests
   /tmp/pi-local-release/node/pi --help
   /tmp/pi-local-release/node/pi --version
   /tmp/pi-local-release/node/pi --list-models
   /tmp/pi-local-release/node/pi -p "Say exactly: ok"
   /tmp/pi-local-release/node/pi

   # Bun binary smoke tests
   /tmp/pi-local-release/bun/pi --help
   /tmp/pi-local-release/bun/pi --version
   /tmp/pi-local-release/bun/pi --list-models
   /tmp/pi-local-release/bun/pi -p "Say exactly: ok"
   /tmp/pi-local-release/bun/pi
   ```
   验证 Node、Bun 启动、模型／账号列表、交互启动，并通过预期默认提供方至少完成一次真实提示。裸命令 `/tmp/pi-local-release/node/pi` 和 `/tmp/pi-local-release/bun/pi` 启动交互模式，须分别在 tmux 中提交提示并等回复才算通过。失败阻止发布，除非用户明确接受风险。

   tmux 工作流参照 [interactive-testing.md](interactive-testing.md)。每个发布二进制从 `/tmp` 启动，不从仓库根目录启动。

3. **运行发布脚本：**
   ```bash
   PI_ALLOW_LOCKFILE_CHANGE=1 npm_config_min_release_age=0 npm run release:patch    # fixes + additions
   PI_ALLOW_LOCKFILE_CHANGE=1 npm_config_min_release_age=0 npm run release:minor    # breaking changes
   ```
   `npm_config_min_release_age=0` 只用于发布命令。当前工作区包版本刚发布时，正常 npm 最小发布年龄限制可能阻止发布锁文件刷新。推送前审查发布产生的 lockfile 或 shrinkwrap 差异。

   脚本提升所有包版本、更新日志、重建发布产物、运行 `npm run check`、提交 `Release vX.Y.Z`、打 `vX.Y.Z` 标签、加入新 `## [Unreleased]`、提交 `Add [Unreleased] section for next cycle`，再推送 `main` 和标签。标签已推送后不要重跑发布脚本。

4. **CI 验证并公告 npm 发布：** 推送 `vX.Y.Z` 触发 `.github/workflows/build-binaries.yml`。`publish-npm` 通过 GitHub Actions OIDC 和 `npm-publish` 环境可信发布，无需本地 `npm publish`、`npm whoami`、OTP 或 WebAuthn。随后 `announce-pi-dev-release` 验证所有公开工作区包的精确版本及 npm tarball 可用性，再向 R2 写已验证标记。`pi.dev/api/latest-version` 读取该标记，此任务成功前绝不能仅根据 npm 公告新版本。

5. **CI 发布或公告失败：** 检查失败任务。发布辅助程序幂等，跳过 npm 已有版本；公告任务更新 R2 前重新检查可用性。修复 CI 或临时 npm 问题后重跑失败任务／工作流，不要为同版本重跑 `npm run release:patch` 或 `npm run release:minor`。

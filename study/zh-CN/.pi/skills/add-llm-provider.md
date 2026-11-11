> 中文阅读版，不作为运行入口；以下为原文件的译文，不代表执行其中操作。
> 原文路径：`.pi/skills/add-llm-provider.md` · [英文原文](../../../../.pi/skills/add-llm-provider.md) · [阅读索引](../../README.md)
> 对应提交：`eff3c1c1612f2f4f4d4e187a15d4060c12a27fc9` · 原文 SHA-256：`684ffea93aee90c2f13a21c5c696a4a303264d412ea8f9f789b6c9065718132d`
> 文中的仓库根目录、命令工作目录及未链接的相对路径均按原项目解释；代码示例和原始元数据保留原文。

原始元数据（仅供对照）：

```yaml
---
name: add-llm-provider
description: Checklist for adding a new LLM provider to packages/ai. Covers core types, provider implementation, lazy registration, model generation, the full test matrix, coding-agent wiring, and docs.
---
```


<a id="adding-a-new-llm-provider-packagesai"></a>
# 添加新的模型提供方（packages/ai）

新提供方涉及多个文件，请按顺序完成以下步骤。

<a id="1-core-types-packagesaisrctypests"></a>
## 1. 核心类型（`packages/ai/src/types.ts`）

- 在 `Api` 联合类型加入 API 标识，如 `"bedrock-converse-stream"`。
- 创建继承 `StreamOptions` 的选项接口。
- 在 `ApiOptionsMap` 添加映射。
- 在 `KnownProvider` 联合类型加入提供方名称。

<a id="2-provider-implementation-packagesaisrcproviders"></a>
## 2. 提供方实现（`packages/ai/src/providers/`）

创建提供方文件，导出：

- 返回 `AssistantMessageEventStream` 的 `stream<Provider>()`。
- 映射 `SimpleStreamOptions` 的 `streamSimple<Provider>()`。
- 提供方专属选项接口。
- 消息／工具转换函数。
- 响应解析逻辑，发出标准化事件：`text`、`tool_call`、`thinking`、`usage`、`stop`。

<a id="3-provider-exports-and-lazy-registration"></a>
## 3. 导出与惰性注册

- 在 `packages/ai/package.json` 添加指向 `./dist/providers/<provider>.js` 的包子路径导出。
- 在 `packages/ai/src/index.ts` 为根入口仍应提供的选项类型添加 `export type` 重导出。
- 在 `packages/ai/src/providers/register-builtins.ts` 通过惰性加载包装器注册；不要静态导入实现模块。
- 在 `packages/ai/src/env-api-keys.ts` 添加凭据检测。

<a id="4-model-generation-packagesaiscriptsgenerate-modelsts"></a>
## 4. 模型生成（`packages/ai/scripts/generate-models.ts`）

- 添加从提供方来源获取／解析模型的逻辑。
- 映射为标准 `Model` 接口。

<a id="5-tests-packagesaitest"></a>
## 5. 测试（`packages/ai/test/`）

- 始终在 `stream.test.ts` 至少加入一个代表模型，即使复用 `openai-completions` 等已有 API 实现。
- 适用时扩展测试矩阵：`tokens.test.ts`、`abort.test.ts`、`empty.test.ts`、`context-overflow.test.ts`、`unicode-surrogate.test.ts`、`tool-call-without-result.test.ts`、`image-tool-result.test.ts`、`total-tokens.test.ts`、`cross-provider-handoff.test.ts`。
- 在 `cross-provider-handoff.test.ts` 至少加入一组提供方／模型；有 GPT、Claude 等多个系列时，每个系列至少一组。
- 非标准认证需创建带凭据检测的辅助文件，如 `bedrock-utils.ts`。

<a id="6-coding-agent-packagescoding-agent"></a>
## 6. Coding Agent（`packages/coding-agent/`）

- `src/core/model-resolver.ts`：给 `defaultModelPerProvider` 添加默认模型 ID。
- `src/core/provider-display-names.ts`：添加 API-key 登录显示名称，使 `/login` 等界面显示内置 API-key 提供方。
- `src/cli/args.ts`：补充环境变量说明。
- `README.md`：添加提供方配置说明。
- `docs/providers.md`：添加配置步骤、环境变量和 `auth.json` 键。

<a id="7-documentation"></a>
## 7. 文档

- `packages/ai/README.md`：补充提供方表、选项／认证和环境变量。
- `packages/ai/CHANGELOG.md`：在 `## [Unreleased]` 下添加条目。

# Pi 双语源码学习记录

本地学习分支：`study/zh-comments`。

上游：<https://github.com/earendil-works/pi>。
学习基线：`71dca871bc80b6bc97be37f0ca3189399d651fff`。
学习计划位于独立仓库 `jamesziwo/learn_agent`。

## 学习计划注释范围

- `packages/agent/src/agent-loop.ts`：循环、消息注入、模型流式响应和工具执行。
- `packages/agent/src/agent.ts`：Agent 状态、消息队列、取消及事件生命周期。
- `packages/agent/src/types.ts`：消息、工具、事件与回调契约。
- `packages/coding-agent/src/core/agent-session.ts`、`session-manager.ts`、`resource-loader.ts`、`compaction/compaction.ts`：会话协调、持久化、项目上下文及压缩。
- `packages/coding-agent/src/core/extensions/runner.ts`：扩展事件与运行边界。
- `packages/coding-agent/examples/extensions/` 下的 `permission-gate.ts`、`plan-mode/index.ts`、`plan-mode/utils.ts`、`custom-compaction.ts`、`subagent/index.ts`、`subagent/agents.ts`、`hello.ts`、`todo.ts`：计划指定的扩展、编排及选读示例。

保留所有原始英文注释，在相邻位置补充中文。Core 三个文件沿用块内或后置译文；其他文件使用前置中文行注释，保留原 JSDoc 及检查指令。示例代码、模型提示词和运行时字符串不改写。中文用于辅助阅读，不纠正或扩展上游注释的行为承诺；具体行为仍以实现为准。

阅读顺序：`types.ts` → `agent.ts` → `agent-loop.ts` → 会话与压缩 → 扩展与编排。按符号定位，不依赖原始行号；新增注释会移动行号。完整清单与其他两个项目的范围见学习仓库 `docs/source-translations.md`。

## 本地环境

`.nvmrc` 固定 Node.js 24.22.2。使用 nvm 时在项目根目录执行：

```sh
nvm use
npm ci --ignore-scripts
```

安装依赖可提供 IDEA 所需的 TypeScript 和 Node 类型声明。跳过安装脚本的工作区不代表所有原生模块已经具备运行条件。

## 本次验证

- 已覆盖上述 16 个源码文件；本轮为 13 个文件的 502 组英文注释补充译文，原三个 Core 文件保持已完成状态。
- 对比修改前快照：原文件的每一行均按原顺序保留，新增内容均为注释。
- 使用 TypeScript 解析器和移除注释的打印器对比：可执行语法一致。
- 核对翻译覆盖和检查指令与其目标代码的相对位置。
- `git diff --check` 通过。
- 仅修改注释与学习配置，未执行模型请求、完整构建或测试套件。

## 备份约定

私有备份仓库为 `jamesziwo/pi-study`，使用 `study` 远端推送学习分支；`origin` 仍指向上游，上游历史与 LICENSE 保留。
远端是否已成功推送，以实际 Git 推送结果和远端 SHA 核验为准。
不要把依赖目录、凭据、运行日志或截图附件加入学习提交。

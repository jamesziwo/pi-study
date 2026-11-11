# Pi 双语源码学习记录

本地学习分支：`study/zh-comments`。

上游：<https://github.com/earendil-works/pi>。
学习基线：`71dca871bc80b6bc97be37f0ca3189399d651fff`。
学习计划位于独立仓库 `jamesziwo/learn_agent`。

## W1 / W2 注释范围

- `packages/agent/src/agent-loop.ts`：循环、消息注入、模型流式响应和工具执行。
- `packages/agent/src/agent.ts`：Agent 状态、消息队列、取消及事件生命周期。
- `packages/agent/src/types.ts`：消息、工具、事件与回调契约。

保留所有原始英文注释，在相邻位置追加中文。多行说明在原注释块内追加中文；单行文档注释后使用中文行注释。示例中的英文注释同样保留并补充翻译。中文用于辅助阅读，未修改执行逻辑，也未纠正或扩展上游注释的行为承诺；具体行为仍以实现为准。

阅读顺序：`types.ts` → `agent.ts` → `agent-loop.ts`。按符号定位，不依赖原始行号；新增注释会移动行号。

## 本地环境

`.nvmrc` 固定 Node.js 24.22.2。使用 nvm 时在项目根目录执行：

```sh
nvm use
npm ci --ignore-scripts
```

安装依赖可提供 IDEA 所需的 TypeScript 和 Node 类型声明。跳过安装脚本的工作区不代表所有原生模块已经具备运行条件。

## 本次验证

- 对比基线与当前三个文件：原文件的每一行均按原顺序保留。
- 使用 TypeScript 解析器和移除注释的打印器对比：三份文件的可执行语法一致。
- 检查所有现有注释：均已配有中文翻译。
- `git diff --check` 通过。
- 仅修改注释与学习配置，未执行模型请求、完整构建或测试套件。

## 备份约定

计划备份到私有仓库 `jamesziwo/pi-study`，仅推送学习分支；上游历史与 LICENSE 保留。
远端是否已成功推送，以实际 Git 推送结果和远端 SHA 核验为准。
不要把依赖目录、凭据、运行日志或截图附件加入学习提交。

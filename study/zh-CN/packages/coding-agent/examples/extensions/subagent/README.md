> 中文阅读版；原文路径：`packages/coding-agent/examples/extensions/subagent/README.md` · [英文原文](../../../../../../../packages/coding-agent/examples/extensions/subagent/README.md) · [阅读索引](../../../../../README.md)
> 对应提交：`b2688a3cecd01abb46d1ba9edb506f8658e5f98c` · 原文 SHA-256：`6a888330bf974657751e09f5d375a9039872d59d6606fc217c5105c7eca51b1a`
> 正文译为中文，代码示例及其中注释保留英文；安装命令、相对路径和工作目录按原项目解释。本页仅供阅读，不代表执行其中操作。

<a id="subagent-example"></a>
# Subagent 示例

将任务委派给具有独立上下文窗口的专用子智能体。

<a id="features"></a>
## 功能

- **隔离上下文**：每个子智能体在独立的 `pi` 进程中运行
- **流式输出**：实时查看工具调用和进度
- **并行流式输出**：所有并行任务同时推送更新
- **Markdown 渲染**：最终输出以正确格式渲染（展开视图）
- **用量跟踪**：显示各智能体的轮次、token、费用和上下文用量
- **支持中止**：Ctrl+C 会向下传递，终止子智能体进程

<a id="structure"></a>
## 结构

```
subagent/
├── README.md            # This file
├── index.ts             # The extension (entry point)
├── agents.ts            # Agent discovery logic
├── agents/              # Sample agent definitions
│   ├── scout.md         # Fast recon, returns compressed context
│   ├── planner.md       # Creates implementation plans
│   ├── reviewer.md      # Code review
│   └── worker.md        # General-purpose (full capabilities)
└── prompts/             # Workflow presets (prompt templates)
    ├── implement.md     # scout -> planner -> worker
    ├── scout-and-plan.md    # scout -> planner (no implementation)
    └── implement-and-review.md  # worker -> reviewer -> worker
```

<a id="installation"></a>
## 安装

从仓库根目录为文件创建符号链接：

```bash
# Symlink the extension (must be in a subdirectory with index.ts)
mkdir -p ~/.pi/agent/extensions/subagent
ln -sf "$(pwd)/packages/coding-agent/examples/extensions/subagent/index.ts" ~/.pi/agent/extensions/subagent/index.ts
ln -sf "$(pwd)/packages/coding-agent/examples/extensions/subagent/agents.ts" ~/.pi/agent/extensions/subagent/agents.ts

# Symlink agents
mkdir -p ~/.pi/agent/agents
for f in packages/coding-agent/examples/extensions/subagent/agents/*.md; do
  ln -sf "$(pwd)/$f" ~/.pi/agent/agents/$(basename "$f")
done

# Symlink workflow prompts
mkdir -p ~/.pi/agent/prompts
for f in packages/coding-agent/examples/extensions/subagent/prompts/*.md; do
  ln -sf "$(pwd)/$f" ~/.pi/agent/prompts/$(basename "$f")
done
```

<a id="security-model"></a>
## 安全模型

该工具启动独立的 `pi` 子进程，使用委派的系统提示词以及工具和模型配置。

**项目级智能体**（`.pi/agents/*.md`）是由仓库控制的提示词，可以指示模型读取文件、运行 bash 命令等。

**默认行为：** 只从 `~/.pi/agent/agents` 加载**用户级智能体**。

启用项目级智能体需传入 `agentScope: "both"`（或 `"project"`）。仅对你信任的仓库这样做。

交互运行时，在不受信任的项目中执行项目级智能体之前，工具会请求确认。受信任项目跳过额外确认。设置 `confirmProjectAgents: false` 可关闭确认。

<a id="usage"></a>
## 用法

<a id="single-agent"></a>
### 单个智能体
```
Use scout to find all authentication code
```

<a id="parallel-execution"></a>
### 并行执行
```
Run 2 scouts in parallel: one to find models, one to find providers
```

<a id="chained-workflow"></a>
### 链式工作流
```
Use a chain: first have scout find the read tool, then have planner suggest improvements
```

<a id="workflow-prompts"></a>
### 工作流提示词
```
/implement add Redis caching to the session store
/scout-and-plan refactor auth to support OAuth
/implement-and-review add input validation to API endpoints
```

<a id="tool-modes"></a>
## 工具模式

| 模式 | 参数 | 说明 |
|------|-----------|-------------|
| 单个 | `{ agent, task }` | 一个智能体执行一个任务 |
| 并行 | `{ tasks: [...] }` | 多个智能体并发运行（最多 8 个任务，并发数为 4） |
| 链式 | `{ chain: [...] }` | 顺序执行，使用 `{previous}` 占位符 |

<a id="output-display"></a>
## 输出显示

**折叠视图**（默认）：
- 状态图标（✓/✗/⏳）及智能体名称
- 最近 5–10 项内容（工具调用和文本）
- 用量统计：`3 turns ↑input ↓output RcacheRead WcacheWrite $cost ctx:contextTokens model`

**展开视图**（Ctrl+O）：
- 完整任务文本
- 所有工具调用及格式化后的参数
- 最终输出以 Markdown 渲染
- 各任务用量（链式或并行模式）

**并行模式的流式输出**：
- 显示所有任务的实时状态（⏳ 运行中、✓ 已完成、✗ 失败）
- 每个任务取得进展时更新
- 显示“2/3 done, 1 running”（3 个任务中 2 个完成、1 个运行中）状态
- 向父模型返回各已完成任务的最终输出，每个任务上限为 50 KB
- 子进程在产生输出前退出时，返回 stderr 或错误消息中的失败诊断

**工具调用格式**（仿照内置工具）：
- bash 使用 `$ command`
- read 使用 `read ~/path:1-10`
- grep 使用 `grep /pattern/ in ~/path`
- 其他类似

<a id="agent-definitions"></a>
## 智能体定义

智能体使用带有 YAML frontmatter 的 Markdown 文件定义：

```markdown
---
name: my-agent
description: What this agent does
tools: read, grep, find, ls
model: claude-haiku-4-5
---

System prompt for the agent goes here.
```

省略 `model` 时，子智能体继承派发会话当前使用的模型和思考级别。

**位置：**
- `~/.pi/agent/agents/*.md`：用户级（始终加载）
- `.pi/agents/*.md`：项目级（仅在 `agentScope: "project"` 或 `"both"` 时加载）

当 `agentScope: "both"` 时，项目级智能体覆盖同名用户级智能体。

<a id="sample-agents"></a>
## 示例智能体

| 智能体 | 用途 | 模型 | 工具 |
|-------|---------|-------|-------|
| `scout` | 快速侦察代码库 | Haiku | read, grep, find, ls, bash |
| `planner` | 制定实施计划 | Sonnet | read, grep, find, ls |
| `reviewer` | 代码评审 | Sonnet | read, grep, find, ls, bash |
| `worker` | 通用任务 | Sonnet | 全部默认工具 |

<a id="workflow-prompts"></a>
## 工作流提示词

| 提示词 | 流程 |
|--------|------|
| `/implement <query>` | scout → planner → worker |
| `/scout-and-plan <query>` | scout → planner |
| `/implement-and-review <query>` | worker → reviewer → worker |

<a id="error-handling"></a>
## 错误处理

- **退出码 != 0**：工具返回错误，附带 stderr 或输出
- **stopReason "error"**：传播 LLM 错误及错误消息
- **stopReason "aborted"**：用户中止（Ctrl+C）会终止子进程并抛出错误
- **链式模式**：遇到第一个失败步骤即停止，并报告失败步骤

<a id="limitations"></a>
## 限制

- 折叠视图仅显示最后 10 项输出（展开后可查看全部）
- 并行模式下，每个任务对模型可见的输出上限为 50 KB；完整结果保留在工具详情中
- 每次调用都重新发现智能体（允许会话中途编辑定义）
- 并行模式最多 8 个任务，并发数为 4

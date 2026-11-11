> 中文阅读版；原文路径：`packages/agent/README.md` · [英文原文](../../../../packages/agent/README.md) · [阅读索引](../../README.md)
> 对应提交：`b2688a3cecd01abb46d1ba9edb506f8658e5f98c` · 原文 SHA-256：`04e44bb21db2894ed77b13c0fb63a5e9f619df633abd1b8f9fe4a04472040c3b`
> 正文译为中文，代码示例及其中注释保留英文；安装命令、相对路径和工作目录按原项目解释。本页仅供阅读，不代表执行其中操作。

<a id="earendil-workspi-agent-core"></a>
# @earendil-works/pi-agent-core

支持工具执行和事件流的有状态智能体，基于 `@earendil-works/pi-ai` 构建。

<a id="installation"></a>
## 安装

```bash
npm install @earendil-works/pi-agent-core
```

<a id="sqlite-session-backends"></a>
### SQLite 会话后端

SQLite 会话后端及 `node:sqlite` 适配器放在独立包 `@earendil-works/pi-session-backend-sqlite-node` 中，因此核心包默认不会引入运行时内置模块或原生 SQLite 依赖。后端接受特定运行时的 SQLite 工厂，未来其他会话后端也可作为独立包发布。

<a id="quick-start"></a>
## 快速开始

```typescript
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";

const models = createModels();
models.setProvider(anthropicProvider());
const model = models.getModel("anthropic", "claude-sonnet-4-6");
if (!model) throw new Error("Model not found");

const agent = new Agent({
  initialState: {
    systemPrompt: "You are a helpful assistant.",
    model,
  },
  streamFn: models.streamSimple.bind(models),
});

agent.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    // Stream just the new text chunk
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await agent.prompt("Hello!");
```

<a id="experimental-facet-services"></a>
## 实验性 facet 服务

与传输方式无关的 facet 服务基础组件位于 `@earendil-works/chord` 中。智能体核心包不导出服务运行时。

<a id="core-concepts"></a>
## 核心概念

<a id="agentmessage-vs-llm-message"></a>
### AgentMessage 与 LLM Message

智能体使用 `AgentMessage`，这是一种灵活的类型，可包含：
- 标准 LLM 消息（`user`、`assistant`、`toolResult`）
- 通过声明合并加入的应用自定义消息类型

LLM 只理解 `user`、`assistant` 和 `toolResult`。`convertToLlm` 函数在每次 LLM 调用前过滤并转换消息，衔接这两种消息表示。

<a id="message-flow"></a>
### 消息流

```
AgentMessage[] → transformContext() → AgentMessage[] → convertToLlm() → Message[] → LLM
                    (optional)                           (required)
```

1. **transformContext**：裁剪旧消息，注入外部上下文
2. **convertToLlm**：过滤仅供 UI 使用的消息，将自定义类型转换为 LLM 格式

<a id="event-flow"></a>
## 事件流

智能体发出事件以更新 UI。理解事件顺序有助于构建响应及时的界面。

<a id="prompt-event-sequence"></a>
### prompt() 的事件顺序

调用 `prompt("Hello")` 时：

```
prompt("Hello")
├─ agent_start
├─ turn_start
├─ message_start   { message: userMessage }      // Your prompt
├─ message_end     { message: userMessage }
├─ message_start   { message: assistantMessage } // LLM starts responding
├─ message_update  { message: partial... }       // Streaming chunks
├─ message_update  { message: partial... }
├─ message_end     { message: assistantMessage } // Complete response
├─ turn_end        { message, toolResults: [] }
└─ agent_end       { messages: [...] }
```

<a id="with-tool-calls"></a>
### 包含工具调用时

如果助手调用工具，循环会继续：

```
prompt("Read config.json")
├─ agent_start
├─ turn_start
├─ message_start/end  { userMessage }
├─ message_start      { assistantMessage with toolCall }
├─ message_update...
├─ message_end        { assistantMessage }
├─ tool_execution_start  { toolCallId, toolName, args }
├─ tool_execution_update { partialResult }           // If tool streams
├─ tool_execution_end    { toolCallId, result }
├─ message_start/end  { toolResultMessage }
├─ turn_end           { message, toolResults: [toolResult] }
│
├─ turn_start                                        // Next turn
├─ message_start      { assistantMessage }           // LLM responds to tool result
├─ message_update...
├─ message_end
├─ turn_end
└─ agent_end
```

工具执行模式可配置：

- `parallel`（默认）：按顺序预检工具调用，并发执行获准的工具；每个工具结果确定后立即发出 `tool_execution_end`，然后按助手原始调用顺序发出 toolResult 消息和 `turn_end.toolResults`
- `sequential`：逐个执行工具调用，与历史行为一致

并行模式下，工具完成事件按实际完成顺序发出，但持久化的 toolResult 消息仍按助手原始调用顺序排列。

可通过智能体配置中的 `toolExecution` 设置全局模式，也可通过 `AgentTool` 上的 `executionMode` 单独配置工具。如果一批调用中任意工具设置了 `executionMode: "sequential"`，无论全局配置如何，整批调用都会顺序执行。

`beforeToolCall` 钩子在 `tool_execution_start` 之后、参数解析校验通过后运行。它可以阻止执行，并为被阻止的结果附加 `terminate: true`。`afterToolCall` 钩子在工具执行完成后、发出 `tool_execution_end` 和最终工具结果消息事件前运行。

工具、被阻止的 `beforeToolCall` 结果及 `afterToolCall` 的覆盖结果都可以返回 `terminate: true`，提示跳过自动发起的后续 LLM 调用。只有本批次所有最终工具结果都设置了 `terminate: true`，循环才会提前停止。混合批次仍正常继续。

`Agent` 类通过 `AgentOptions` 接受 `shouldStopAfterTurn`。底层循环调用方可以在 `AgentLoopConfig` 中设置相同钩子：

```typescript
const stream = agentLoop(
  prompts,
  context,
  {
    model,
    convertToLlm,
    shouldStopAfterTurn: async ({ message, toolResults, context, newMessages }) => {
      return shouldCompactBeforeNextTurn(context.messages);
    },
  },
  undefined,
  models.streamSimple.bind(models),
);
```

`shouldStopAfterTurn` 在助手响应及所有工具执行正常完成、`turn_end` 发出之后运行。如果返回 `true`，循环发出 `agent_end` 并退出，此时尚未轮询 steering 或 follow-up 队列，也尚未启动下一次 LLM 调用。它不会中止提供方的流，不会取消正在运行的工具，也不会改变助手消息的停止原因。`AgentOptions` 中的回调还会通过第二个参数收到当前运行的 `AbortSignal`。

使用 `Agent` 类时，助手的 `message_end` 处理会作为工具预检开始前的同步屏障。因此，`beforeToolCall` 看到的智能体状态已经包含发起该工具调用的助手消息。

<a id="continue-event-sequence"></a>
### continue() 的事件顺序

`continue()` 从已有上下文继续，不添加新消息。可用于出错后重试。

```typescript
// After an error, retry from current state
await agent.continue();
```

上下文中的最后一条消息必须是 `user` 或 `toolResult`，不能是 `assistant`。

<a id="event-types"></a>
### 事件类型

| 事件 | 说明 |
|-------|-------------|
| `agent_start` | 智能体开始处理 |
| `agent_end` | 本次运行的最后一个事件；运行完全结束仍需等待此事件的订阅者执行完成 |
| `turn_start` | 新一轮开始（一次 LLM 调用及工具执行） |
| `turn_end` | 本轮结束，包含助手消息和工具结果 |
| `message_start` | 任意消息开始（user、assistant、toolResult） |
| `message_update` | **仅助手消息。** 包含带增量内容的 `assistantMessageEvent` |
| `message_end` | 消息完成 |
| `tool_execution_start` | 工具开始执行 |
| `tool_execution_update` | 工具流式报告进度 |
| `tool_execution_end` | 工具执行完成 |

`Agent.subscribe()` 的监听器按注册顺序逐一等待执行。`agent_end` 表示不再发出循环事件，但 `await agent.waitForIdle()` 和 `await agent.prompt(...)` 要等 `agent_end` 监听器完成后才结束等待。

<a id="agent-options"></a>
## Agent 选项

```typescript
const agent = new Agent({
  // Initial state
  initialState: {
    systemPrompt: string,
    model: Model<any>,
    thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
    tools: AgentTool<any>[],
    messages: AgentMessage[],
  },

  // Convert AgentMessage[] to LLM Message[] (required for custom message types)
  convertToLlm: (messages) => messages.filter(...),

  // Transform context before convertToLlm (for pruning, compaction)
  transformContext: async (messages, signal) => pruneOldMessages(messages),

  // Steering mode: "one-at-a-time" (default) or "all"
  steeringMode: "one-at-a-time",

  // Follow-up mode: "one-at-a-time" (default) or "all"
  followUpMode: "one-at-a-time",

  // Required stream function
  streamFn: models.streamSimple.bind(models),

  // Session ID for provider caching
  sessionId: "session-123",

  // Dynamic API key resolution (for expiring OAuth tokens)
  getApiKey: async (provider) => refreshToken(),

  // Tool execution mode: "parallel" (default) or "sequential"
  toolExecution: "parallel",

  // Preflight each tool call after args are validated. Can block execution.
  beforeToolCall: async ({ toolCall, args, context }) => {
    if (toolCall.name === "bash") {
      return { block: true, reason: "bash is disabled", terminate: true };
    }
  },

  // Postprocess each tool result before final tool events are emitted.
  afterToolCall: async ({ toolCall, result, isError, context }) => {
    if (toolCall.name === "notify_done" && !isError) {
      return { terminate: true };
    }
    if (!isError) {
      return { details: { ...result.details, audited: true } };
    }
  },

  // Stop gracefully after a completed turn, before queued messages are polled.
  shouldStopAfterTurn: async ({ context }, signal) => {
    return shouldCompactBeforeNextTurn(context.messages, signal);
  },

  // Custom thinking budgets for token-based providers
  thinkingBudgets: {
    minimal: 128,
    low: 512,
    medium: 1024,
    high: 2048,
  },
});
```

<a id="agent-state"></a>
## Agent 状态

```typescript
interface AgentState {
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool<any>[];
  messages: AgentMessage[];
  readonly isStreaming: boolean;
  readonly streamingMessage?: AgentMessage;
  readonly pendingToolCalls: ReadonlySet<string>;
  readonly errorMessage?: string;
}
```

通过 `agent.state` 访问状态。

赋值 `agent.state.tools = [...]` 或 `agent.state.messages = [...]` 时，先复制顶层数组再存储。修改读取到的数组会改变当前智能体状态。

流式处理期间，`agent.state.streamingMessage` 包含当前尚未完成的助手消息。

在本次运行完全结束前，`agent.state.isStreaming` 一直为 `true`，其中包括等待 `agent_end` 订阅者的时间。

<a id="methods"></a>
## 方法

<a id="prompting"></a>
### 提交提示

```typescript
// Text prompt
await agent.prompt("Hello");

// With images
await agent.prompt("What's in this image?", [
  { type: "image", data: base64Data, mimeType: "image/jpeg" }
]);

// AgentMessage directly
await agent.prompt({ role: "user", content: "Hello", timestamp: Date.now() });

// Continue from current context (last message must be user or toolResult)
await agent.continue();
```

<a id="state-management"></a>
### 状态管理

```typescript
agent.state.systemPrompt = "New prompt";
agent.state.model = getModel("openai", "gpt-4o");
agent.state.thinkingLevel = "medium";
agent.state.tools = [myTool];
agent.toolExecution = "sequential";
agent.beforeToolCall = async ({ toolCall }) => undefined;
agent.afterToolCall = async ({ toolCall, result }) => undefined;
agent.shouldStopAfterTurn = async ({ context }) => shouldCompactBeforeNextTurn(context.messages);
agent.state.messages = newMessages; // top-level array is copied
agent.state.messages.push(message);
agent.reset();
```

<a id="session-and-thinking-budgets"></a>
### 会话与思考预算

```typescript
agent.sessionId = "session-123";

agent.thinkingBudgets = {
  minimal: 128,
  low: 512,
  medium: 1024,
  high: 2048,
};
```

<a id="control"></a>
### 控制

```typescript
agent.abort();           // Cancel current operation
await agent.waitForIdle(); // Wait for completion
```

<a id="events"></a>
### 事件

```typescript
const unsubscribe = agent.subscribe(async (event, signal) => {
  if (event.type === "agent_end") {
    // Final barrier work for the run
    await flushSessionState(signal);
  }
});
unsubscribe();
```

<a id="steering-and-follow-up"></a>
## 运行中引导与后续任务

Steering 消息允许你在智能体执行工具时插入引导。Follow-up 消息允许你排入后续工作，使智能体在原本即将停止时继续处理。

```typescript
agent.steeringMode = "one-at-a-time";
agent.followUpMode = "one-at-a-time";

// While agent is running tools
agent.steer({
  role: "user",
  content: "Stop! Do this instead.",
  timestamp: Date.now(),
});

// After the agent finishes its current work
agent.followUp({
  role: "user",
  content: "Also summarize the result.",
  timestamp: Date.now(),
});

const steeringMode = agent.steeringMode;
const followUpMode = agent.followUpMode;

agent.clearSteeringQueue();
agent.clearFollowUpQueue();
agent.clearAllQueues();
```

使用 clearSteeringQueue、clearFollowUpQueue 或 clearAllQueues 清除队列中的消息。

一轮结束后检测到 steering 消息时：
1. 当前助手消息中的所有工具调用都已完成
2. 注入 steering 消息
3. LLM 在下一轮响应

只有不再有工具调用且没有 steering 消息时，才检查 follow-up 消息。如果队列中有消息，就注入它们并再运行一轮。

<a id="custom-message-types"></a>
## 自定义消息类型

通过声明合并扩展 `AgentMessage`：

```typescript
declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    notification: { role: "notification"; text: string; timestamp: number };
  }
}

// Now valid
const msg: AgentMessage = { role: "notification", text: "Info", timestamp: Date.now() };
```

在 `convertToLlm` 中处理自定义类型：

```typescript
const agent = new Agent({
  streamFn: models.streamSimple.bind(models),
  convertToLlm: (messages) => messages.flatMap(m => {
    if (m.role === "notification") return []; // Filter out
    return [m];
  }),
});
```

<a id="tools"></a>
## 工具

使用 `AgentTool` 定义工具：

```typescript
import { Type } from "typebox";

const readFileTool: AgentTool = {
  name: "read_file",
  label: "Read File",  // For UI display
  description: "Read a file's contents",
  parameters: Type.Object({
    path: Type.String({ description: "File path" }),
  }),
  // Override execution mode for this tool (optional).
  // "sequential" forces the entire batch to run one at a time.
  // "parallel" allows concurrent execution with other tool calls.
  // If omitted, the global toolExecution config applies.
  executionMode: "sequential",
  execute: async (toolCallId, params, signal, onUpdate) => {
    const content = await fs.readFile(params.path, "utf-8");

    // Optional: stream progress
    onUpdate?.({ content: [{ type: "text", text: "Reading..." }], details: {} });

    // Optional: add `terminate: true` here to skip the automatic follow-up LLM call
    // when every finalized tool result in the batch does the same.
    return {
      content: [{ type: "text", text: content }],
      details: { path: params.path, size: content.length },
    };
  },
};

agent.state.tools = [readFileTool];
```

<a id="error-handling"></a>
### 错误处理

工具失败时应**抛出错误**，不要将错误消息作为普通内容返回。

```typescript
execute: async (toolCallId, params, signal, onUpdate) => {
  if (!fs.existsSync(params.path)) {
    throw new Error(`File not found: ${params.path}`);
  }
  // Return content only on success
  return { content: [{ type: "text", text: "..." }] };
}
```

智能体会捕获抛出的错误，并以 `isError: true` 的工具错误形式报告给 LLM。

从 `execute()`、被阻止的 `beforeToolCall` 或 `afterToolCall` 返回 `terminate: true`，可提示智能体在当前工具批次结束后停止。只有批次中所有最终工具结果都要求终止时才生效。该提示仅用于运行时；发出的 `toolResult` 对话记录消息仍是标准 LLM 工具结果。

<a id="proxy-usage"></a>
## 代理使用方式

对于通过后端代理请求的浏览器应用：

```typescript
import { Agent, streamProxy } from "@earendil-works/pi-agent-core";

const agent = new Agent({
  streamFn: (model, context, options) =>
    streamProxy(model, context, {
      ...options,
      authToken: "...",
      proxyUrl: "https://your-server.com",
    }),
});
```

<a id="low-level-api"></a>
## 底层 API

如需绕过 Agent 类直接控制：

```typescript
import { agentLoop, agentLoopContinue } from "@earendil-works/pi-agent-core";

const context: AgentContext = {
  systemPrompt: "You are helpful.",
  messages: [],
  tools: [],
};

const config: AgentLoopConfig = {
  model: getModel("openai", "gpt-4o"),
  convertToLlm: (msgs) => msgs.filter(m => ["user", "assistant", "toolResult"].includes(m.role)),
  toolExecution: "parallel",  // overridden by per-tool executionMode if set
  beforeToolCall: async ({ toolCall, args, context }) => undefined,
  afterToolCall: async ({ toolCall, result, isError, context }) => undefined,
};

const userMessage = { role: "user", content: "Hello", timestamp: Date.now() };

const streamFn = models.streamSimple.bind(models);
for await (const event of agentLoop([userMessage], context, config, undefined, streamFn)) {
  console.log(event.type);
}

// Continue from existing context
for await (const event of agentLoopContinue(context, config, undefined, streamFn)) {
  console.log(event.type);
}
```

这些底层流用于观察事件。它们保留事件顺序，但不会等待你的异步事件处理完成后才让生产方进入后续阶段。如果需要让消息处理成为工具预检前的同步屏障，应使用 `Agent` 类，而非直接使用 `agentLoop()` 或 `agentLoopContinue()`。

<a id="license"></a>
## 许可证

MIT

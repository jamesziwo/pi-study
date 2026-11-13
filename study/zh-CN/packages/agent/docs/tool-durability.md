> 中文阅读版；原文路径：`packages/agent/docs/tool-durability.md` · [英文原文](../../../../../packages/agent/docs/tool-durability.md) · [阅读索引](../../../README.md)
> 对应提交：`7ca5b1bde4d3dafe3f7555407bd96043b5b660ee` · 原文 SHA-256：`e42fc1900b7a80a6a525e31b6bd4b551b937a5e8f5cadc5cae7a7fe12a74d874`
> 正文译为中文，代码示例及其中注释保留英文；命令和路径按原项目解释。本页仅供阅读，不代表执行其中操作；历史设计和研究结论不等于当前运行时保证。

<a id="tool-durability--implementation-handoff"></a>
# 工具持久化——实现交接

本文规定持久化工具调用生命周期，以及在当前工具 API 上增加的最小 harness 专用进度检查点扩展。除此之外，本文不定稿 harness 原生公开工具接口；该接口必须提供这里要求的能力，同时不暴露原始会话存储。

设计包含两个独立增量：

1. 在外部副作用结算与按源顺序放入对话之间，增加持久 `outcome_ready` 状态；
2. 为完整、有界的 `onUpdate` 快照提供按需启用、可替换的持久检查点。

<a id="problem"></a>
## 问题

并行工具副作用按完成顺序结束，而工具结果条目必须按助手源顺序进入对话。

没有中间持久状态时：

```text
calls: A, B, C
B finishes
C finishes
A is still running
process crashes
```

即 A、B、C 三次调用中 B、C 已完成，A 仍运行，此时进程崩溃。

由于 A 阻止了按源顺序放置结果，B、C 只存在于进程内存。恢复会将它们当作未解决调用，可能重放或中断其实已经完成的副作用。

解决方法是分离两种顺序：

1. **结果持久化：** 按实际完成顺序；
2. **条目实化：** 按助手源顺序。

完整且已最终处理的结果立即存入 `pi.pending.entry`，调用变为 `outcome_ready`；等所有更早源位置都已完成或结果就绪，再放入对话。

<a id="goals"></a>
## 目标

1. 完整最终结果持久化后，绝不重新执行工具。
2. 持久保留乱序完成的并行结果，同时不违反转录顺序。
3. 保留现有整工具 `replay: "safe" | "never"` 契约。
4. 支持调用作用域内的持久 memo，为 Flue 风格 `step.do` 提供基础。
5. 保留由工具选择的有界进度检查点，用于重连及不安全中断恢复。
6. 结果结算、取消或外部终结后，隔离工具的迟到写入。
7. 最终树条目保持规范、完整、不可变，且其界限独立于进度快照。

<a id="non-goals"></a>
## 非目标

- 任意外部副作用恰好执行一次。
- 每次 `step.do` 都拥有嵌套持久状态机。
- 从进度输出推断工具完成。
- 将部分输出视为规范最终结果。
- 让工具访问原始 `Session`、`SessionMutator` 或绑定存储地址。
- 在本文定稿公开 harness 原生工具类型。

<a id="durable-identities"></a>
## 持久身份

每次调用在执行前已预留结果条目 ID。将它用作稳定的公开调用身份：

```text
invocationId = resultEntryId
```

它在会话内唯一，安全重放时保留，并区别于提供方批次内的 `toolCallId`；后续助手消息可能复用后者。

外围操作状态继续提供：

- `operationId`；
- `turnId`/生成 step ID；
- `sourceIndex`；
- 助手条目 ID；
- 捕获的配置和执行模式。

<a id="storage"></a>
## 存储

<a id="existing-bound-values"></a>
### 现有绑定值

```ts
operationToolArgs(operationId, turnId, sourceIndex)
// Effective validated arguments, persisted before effect admission.

pendingEntry(resultEntryId)
// Complete finalized ToolResultMessage while outcome_ready awaits placement.
```

<a id="invocation-memos"></a>
### 调用 memo

在 `session/values.ts` 定义由操作拥有的地址构造器：

```ts
export const operationToolMemo = (
  operationId: string,
  invocationId: string,
  memoName: string,
) => value<JsonValue>(
  "pi.op.tool_memo",
  `${operationId}:${invocationId}:${memoName}`,
);
```

`memoName` 必须非空且不含 `:`。可以用点或斜杠进行应用内分组。`setMemo(name, undefined)` 删除精确绑定值。

`scanValues(operationToolMemoPrefix(operationId))` 支持防御性操作清理。`scanValues(operationToolMemoPrefix(operationId, invocationId))` 支持在一个结果就绪时原子清理该调用。核心清理使用这些由负责模块定义的前缀构造器，不重复原始保留 namespace/key 语法。

<a id="partial-tool-output"></a>
### 部分工具输出

持久恢复值是工具选择的最新完整、有界进度快照。它代表当前总状态，因此使用一个绑定值地址：

```ts
export const pendingToolOutput = (
  operationId: string,
  invocationId: string,
) => value<AgentToolResult<unknown>>(
  "pi.pending.tool_output",
  `${operationId}:${invocationId}`,
);
```

这是辅助观察数据，从不证明副作用成功或完成。存储值与实时 `partialResult` 的 content/details/usage 形状完全相同；恢复无需工具专用进度编解码器。

工具负责快照限界、检查点频率和去重；harness 负责同步入队、promise 跟踪、调用隔离与清理。首版 API 没有通用字节上限，不截断或重新解释类型化工具数据；可信进程内工具应遵守有界快照契约。没有工具可见的 `flush()`，也没有进度更新持久列表。

崩溃可能丢失最新已提交检查点之后的实时更新。压缩前，JSONL 物理增长与不同检查点请求的大小和频率成正比；Memory、SQLite 只保留一个当前值。若持续变化的输出每两秒保存 50 KiB，JSONL 未压缩的最坏情况约为每十分钟 15 MiB。

<a id="tool-update-api"></a>
## 工具更新 API

保留现有全量快照更新回调，并增加 harness 专用选项：

```ts
export interface AgentHarnessToolUpdateOptions {
  /** Request replacement of this invocation's durable recovery checkpoint. */
  checkpoint?: true;
}

export type AgentHarnessToolUpdateCallback<TDetails> = (
  partialResult: AgentToolResult<TDetails>,
  options?: AgentHarnessToolUpdateOptions,
) => void;
```

`AgentHarnessTool` 使用此回调，替代旧 `AgentToolUpdateCallback`。即使没有实时监听器，harness 也始终提供它，因为工具可能通过它请求持久化。旧 `AgentTool` 与旧 agent loop 无法兑现持久检查点，因此保持原样。

每次回调仍是立即实时更新。回调同步且返回 `void`；`checkpoint: true` 额外请求持久化该完整快照，并非持久化确认。内部 harness 保留最新 `events.emit(tool_update)` promise，使既有监听器投递在 `after_tool` 前完成；工具不等待，也不接收该 promise。

每次 `checkpoint:true` 同步向 Session 变更串行通道入队一次标量替换，为 promise 附加常规 harness 故障观察器，并替换进程内 `latestCheckpointWrite` 引用。写入本身既不丢弃也不合并，替换引用不会让较早拒绝无人观察：

- Session 变更 FIFO 保持请求顺序；
- 每次变更验证同一调用仍为 `effect_pending`；
- 最新 promise 完成意味着所有更早检查点写入完成；
- 工具 promise 结算时停止接纳更新，并在 `after_tool` 前等待最新 promise；
- 检查点提交失败，按常规存储故障规则使 harness 故障。

工具请求检查点的速度若超过存储处理速度，工作可能在内存排队。可信工具契约下，频率由工具负责。内置 bash 策略使普通使用中的队列有界。

需要去重时，工具应与最近请求的检查点比较。存储不会每次检查点都读取当前标量并深度比较。

<a id="bash-policy"></a>
### Bash 策略

内置 bash 保留当前 100 ms 实时更新频率。最多每两秒请求一次检查点，且完整有界快照必须不同于最近请求的检查点：

```ts
const BASH_UPDATE_THROTTLE_MS = 100;
const BASH_CHECKPOINT_INTERVAL_MS = 2_000;
```

当前 `ShellCaptureProgress` 已提供有界快照：最后 2,000 行或 50 KiB，加截断元数据和溢出文件路径。初始空更新仅实时投递。输出量不会加快检查点频率。短工具可能不写任何检查点就结算，因为将直接提交完整最终结果。

<a id="tool-call-state"></a>
## 工具调用状态

为调用联合增加 `outcome_ready`：

```ts
type ToolCall =
  | {
      status: "planned";
      sourceIndex: number;
      resultEntryId: string;
    }
  | {
      status: "effect_pending";
      sourceIndex: number;
      resultEntryId: string;
      replay: "never" | "safe";
    }
  | {
      status: "outcome_ready";
      sourceIndex: number;
      resultEntryId: string;
      terminate: boolean;
    }
  | {
      status: "completed";
      sourceIndex: number;
      resultEntryId: string;
      terminate: boolean;
    };
```

`outcome_ready` 表示：

- 执行、错误归一化和 `after_tool` 已结束，或 harness 已构造最终合成结果；
- 完整最终 `ToolResultMessage` 位于 `pendingEntry(resultEntryId)`；
- 调用 memo 与部分输出存储已删除；
- 工具绝不能再执行；
- 由于更早调用尚未实化，不可变结果条目可能还不存在。

具体联合以后可以携带少量结算元数据，但不得重复最终结果载荷。

<a id="state-transitions"></a>
## 状态转换

```text
planned
  ├─ real effect cleared       → effect_pending
  └─ immediate/synthetic       → outcome_ready

effect_pending
  ├─ live effect settles       → outcome_ready
  ├─ safe orphan replay settles→ outcome_ready
  └─ unsafe orphan synthesis   → outcome_ready

outcome_ready
  └─ source position eligible  → completed
```

实现可以把 `outcome_ready → completed` 合并进最终处理可立即放置的头部调用的同一事务，但语义检查和测试仍必须覆盖乱序调用的持久 `outcome_ready`。建议先实现显式两事务形式。

<a id="fresh-execution"></a>
## 首次执行

<a id="clearance-and-intent"></a>
### 执行许可与意图

副作用前后持久化边界不变：

```text
planned
→ prepare arguments, run before_tool, validate replacements
→ TX[
     set pi.op.tool_args,
     set call = effect_pending(replay)
   ]
→ post-commit tool_start
→ admit tool execution
```

即准备参数、运行 `before_tool` 并验证替换值，在事务中写参数和 `effect_pending(replay)`，提交后发 `tool_start`，再接纳工具执行。

调用作用域能力仅对此持久 `effect_pending` 调用生效。

<a id="partial-output"></a>
### 部分输出

每次 `onUpdate(partialResult, options)` 都通过既有事件/快照路径发布实时更新。`options.checkpoint === true` 时，harness 额外请求标量替换：

```text
TX[
  setValue(pendingToolOutput(operationId, invocationId), partialResult)
]
```

变更验证相同操作、turn、源位置和 invocation 仍为 `effect_pending`。它不重写 `pi.op.state`。结算后的迟到检查点直接返回，不提交。

工具必须保存有界完整快照，而非无界增长的值。Bash 使用其原本实时发送的同一有界 `ShellCaptureProgress` 快照。客户端可以渲染并本地保留比持久检查点更新的实时更新，但这些更新明确只存在于进程内。

<a id="finalization-to-outcome_ready"></a>
### 最终处理至 `outcome_ready`

工具 promise 结算时：

1. 同步停止接纳更新，并使调用能力过期；
2. 等待最新跟踪的 `tool_update` 投递和检查点写入 promise；各自完成都意味着其前序队列完成；
3. 若是真实首次执行或安全重放结果，且取消没有阻止钩子，则运行 `after_tool`；
4. 构造完整最终 `ToolResultMessage`；
5. 将结果提交为 `outcome_ready`；
6. 从已提交的暂存转换发出并等待 `tool_end`。

`setMemo()` 返回 promise，工具必须等待；`step.do` 始终如此。返回前已发起但未等待的变更，仍排在暂存之前，并被暂存删除。能力过期后开始的调用会拒绝。没有额外的调用写入排空机制。

事务：

```text
TX[
  setValue(
    pendingEntry(resultEntryId),
    { type: "message", payload: finalizedToolResultMessage },
  ),
  deleteValue(pendingToolOutput(operationId, invocationId)),
  deleteValue(memo.address) for every memo returned before commit by
    scanValues(operationToolMemoPrefix(operationId, invocationId)),
  setValue(operationState(operationId), call = outcome_ready(terminate))
]
```

此事务是调用此后永不重放的线性化点。提交后的 `tool_end` 因而是最终结果已就绪的持久证据，不再是提交前的副作用观察。

暂存消息包含最终：

- 文本/图像内容；
- 提供方工具调用 ID 与工具名；
- details；
- `isError`；
- 已报告的用量快照；
- 新增工具名称；
- 时间戳。

`terminate` 仍是编排状态，因为它控制批次后续执行，并在放置时复制到不可变条目的 `terminate` 字段。暂存的 `addedToolNames` 在结果实化到转录之前，不影响活动工具集。

<a id="source-ordered-materialization"></a>
## 按源顺序实化

任一调用进入 `outcome_ready` 后，从第一个未完成源位置开始，查找连续就绪前缀。

示例：

```text
[completed, outcome_ready, outcome_ready, effect_pending]
             └──────── ready prefix ────────┘
```

放置事务之前，按源顺序发出并等待每个最终结果的 `message_start`、`message_end`。可行时用一个事务实化前缀，随后按同一源顺序发出 `entry_added` 和已报告用量事件：

```text
TX[
  insert result entry i from pendingEntry(i),
  deleteValue(pendingEntry(i)),
  insert tool usage row i if reported,

  insert result entry i+1 with parent = result i,
  deleteValue(pendingEntry(i+1)),
  insert tool usage row i+1 if reported,

  setValue(branchTip(lane), newest result),
  setValue(operationState(operationId),
           calls i..i+1 = completed and, when complete, next checkpoint)
]
```

每个插入条目使用已预留 `resultEntryId`。事务内部按源顺序构造父链。

工具报告的用量在放置前持久保留于暂存消息。首版实现将其账本行与条目实化原子写入，保持当前条目/用量顺序，避免账本引用尚不存在的条目。无需预留用量 ID，因为放置事务失败时，账本行和 completed 状态都不会写入。

最后一个调用实化时，同一事务调用 `scanValues(operationToolArgsPrefix(operationId, turnId))`，删除每个返回地址，并转换到正确检查点：

- 所有结果都要求终止 → `may_finish`，无需最终助手响应；
- 否则 → `need_assistant(false)`。

<a id="parallel-execution"></a>
## 并行执行

结果暂存遵循实际完成顺序；条目实化遵循源顺序。

```text
A, B, C start
B finishes → B outcome_ready
C finishes → C outcome_ready
A finishes → A outcome_ready
             materialize A, B, C
```

B、C 暂存后崩溃：

```text
A effect_pending
B outcome_ready
C outcome_ready
```

恢复仅对 A 应用结果未知策略。B、C 无需工具注册或钩子执行即可变为条目。

持久不变量从“已完成调用构成按源顺序的前缀”扩展为：

- 已完成调用构成按源顺序的前缀；
- 该前缀之后，并行调用可以任意混合 `planned`、`effect_pending`、`outcome_ready`；
- 只有按源顺序实化才能延长已完成前缀。

顺序执行在已完成前缀之后，最多构造一个非 planned 调用。恢复时信任已提交调用状态；负责过程在创建及消费转换时维持此形状，而非进行广泛恢复审计。

<a id="unsafe-recovery-with-partial-output"></a>
## 带部分输出的不安全恢复

对于孤立的 `effect_pending` 且 `replay: "never"`：

1. 若存在，读取 `pendingToolOutput(operationId, invocationId)`；
2. 保留其有界内容及可序列化 details；
3. 追加强制的人类可读中断标记；
4. 构造由 harness 拥有、`isError: true` 的 `ToolResultMessage`；
5. 提交为 `outcome_ready` 并清理调用状态。

标记必须说明输出不完整，且外部结果未知。`isError: true` 描述交给模型的结果，不断言外部副作用失败。

最终文本后缀示例：

```text
[Tool execution was interrupted. The preceding output is the latest durable progress snapshot; newer live output may be missing, and the external outcome is unknown.]
```

其含义是工具执行被中断，前文是最新持久进度快照，可能缺少更新的实时输出，外部结果未知。

规则：

- 此合成结果不运行 `after_tool`；
- 保留检查点中的 `usage`，但忽略 `addedToolNames` 和 `terminate`，因为进度没有最终结果权威；
- 设置 `terminate: false`，不增加工具；
- 检查点缺失也合法，此时仅产生中断结果；
- 不从部分输出中看似成功的文本推断完成；
- 部分输出和调用 memo 的清理，与合成结果暂存原子完成。

<a id="safe-recovery"></a>
## 安全恢复

对于孤立 `effect_pending`，且存储声明与当前声明均为 `replay: "safe"`：

1. 保留调用 memo；
2. 原子删除 `pendingToolOutput(operationId, invocationId)`；
3. 按需发出/重置进程内进度观察；
4. 使用持久参数和相同 `invocationId` 重新执行工具；
5. 已完成的 `step.do` 返回 memo 值；
6. 新部分输出重建干净的进度流；
7. 最终处理遵循普通 `outcome_ready` 路径。

删除旧进度避免重放代码再次发出进度时出现重复块。删除后、接纳重放前崩溃，仍为 `effect_pending`；下一次恢复重复相同安全流程。

当前工具声明缺失或不再安全时，采用不安全中断恢复，不暂停等待。

<a id="invocation-memos"></a>
## 调用 memo

harness 原生工具调用获得专门的调用能力，概念上等价于：

```ts
interface AgentHarnessToolInvocation {
  readonly invocationId: string;
  readonly operationId: string;
  readonly turnId: string;

  getMemo(key: string): Promise<JsonValue | undefined>;
  setMemo(key: string, value: JsonValue | undefined): Promise<void>;
}
```

每次操作：

1. 验证 memo 名，并检查进程内能力是否过期；
2. 返回 promise 前，同步将工作排入 Session 变更串行通道；
3. 工作执行时，验证操作、turn、源位置和 invocation 仍是相同 `effect_pending` 调用；
4. 只构造并读写 `operationToolMemo(operationId, invocationId, name)`；
5. 能力过期或持久所有权丢失后拒绝。

持久检查对获授权的外部终结很重要。普通执行中，工具返回前发起的 memo 变更按 FIFO 排在结果暂存前；之后发起的调用无法通过能力过期检查。

迟到的僵尸回调既不能在 `outcome_ready` 后重建 memo，也不能写入后续操作。

memo 是立即持久化的重放状态，不是应用可见的结算状态。调用仍为 `effect_pending` 时，它们跨关闭/崩溃存活；任何真实或合成结果就绪时删除。

除其他操作自有地址外，终止清理还防御性扫描并删除以下地址族：

```ts
scanValues(operationToolMemoPrefix(operationId))
scanValues(pendingToolOutputPrefix(operationId))
```

每个返回的 `StoredValue` 都提供供 `deleteValue` 使用的精确绑定地址；后续操作不再接收原始 key。

<a id="flue-style-stepdo"></a>
## Flue 风格 `step.do`

在调用 memo 上构建 `step.do`，无需独立的 harness 状态联合：

```ts
interface ToolSteps {
  do<T extends JsonValue>(
    name: string,
    effect: () => T | Promise<T>,
  ): Promise<T>;
}
```

算法：

```text
validate deterministic unique name
→ getMemo("step/" + name)
→ present: return stored value
→ absent: run effect
→ setMemo("step/" + name, value)
→ await durability
→ return value
```

即验证确定且唯一的名称，读取 `step/` 加名称的 memo；存在则返回，不存在则执行副作用、写 memo、等待持久化，再返回。

崩溃行为：

```text
before/during effect                    → effect may run on replay
effect returned, memo not committed     → effect may run on replay
memo committed                          → replay returns memo
step A memoized, step B interrupted      → rerun tool; A skips, B runs
```

副作用执行前/执行中、或副作用已返回但 memo 未提交时，重放可能再次执行；memo 提交后则返回已存值；A 已 memo 化、B 中断时，重跑工具会跳过 A、执行 B。

这是恰好记录一次、至少执行一次，不能让任意外部副作用恰好执行一次。外部 API 支持时，应用可由 `(invocationId, stepName)` 派生稳定外部幂等键。

错误不保存为 memo。抛出的副作用要么参与当前工具结果，要么在安全整工具恢复后再次执行。

此阶段不增加逐 step 的 `replay: "never"`。正确支持它需要嵌套 `planned → effect_pending → completed` 状态及明确的结果未知策略。已讨论的 Flue 用例使用整工具重放策略即可。

一次实时执行内重复调用相同 step 名是违反不变量的错误。安全重放之间，名称必须确定一致。

<a id="application-persistent-state"></a>
## 应用持久状态

Flue 风格应用状态区别于调用 memo。

调用 memo：

```text
step completed → memo becomes visible immediately
```

应用状态：

```text
tool stages state change
→ crash before outcome_ready: state must not appear committed
→ outcome_ready: state and finalized result become visible together
```

即 step 完成后 memo 立即可见；应用状态则先暂存变更，`outcome_ready` 前崩溃不得表现为已提交，进入该状态时才与最终结果一起可见。

不要在执行期间直接调用 `Session.setValue()` 来实现应用状态。

两个有效实现阶段：

1. Flue 在外部持有状态，并原子保存应用状态和按 `invocationId` 索引的完整结果 memo。
2. 后续 harness API 接受暂存应用值写入，在 `outcome_ready` 事务中提升为正式状态。

只有 Flue 的 `usePersistentState` 移入 harness 所有的会话值时，才需要第二项。其公开类型与冲突语义仍是 harness 原生工具讨论中的未决设计。

<a id="cancellation"></a>
## 取消

取消协调绝不重放恢复出的工具。

- `planned` 调用获得合成 aborted 结果，并进入 `outcome_ready`；
- 已启动的实时调用可以在已取消控制下最终处理真实本地结果，再以 `terminate: false` 进入 `outcome_ready`；
- 恢复出的 `effect_pending` 调用使用中断合成结果，可包含部分输出，无论是否声明安全重放；
- 保留已有 `outcome_ready` 调用，并按源顺序实化；
- 每个取消结果暂存时删除调用 memo 和部分输出；
- 恢复后的合成协调不启动 `before_tool` 或 `after_tool`。

只有全部调用结果实化，且按既有取消规则排空已接纳延迟写入后，才运行 aborted 终止事务。

<a id="close-and-external-finalization"></a>
## 关闭与外部终结

关闭仍是受控崩溃：

- 已在接纳屏障内入队的 memo/检查点变更可以完成；
- 最新已提交工具请求检查点之后的实时输出可能丢失；
- 不写合成结果或取消标记；
- 持久状态留在 `effect_pending` 或 `outcome_ready`。

外部终结在终止事务中删除操作拥有的参数、调用 memo、部分输出、暂存待放置结果及其他待处理条目。之后试图暂存结果的实时任务无法通过所有权隔离检查，并经 `OperationEnded` 停止。

<a id="restore-and-consumption-time-reads"></a>
## 恢复与消费时读取

基础恢复从所属模块必需的值构造可信 lane/operation 投影。它不加载或语义审计工具参数、调用 memo、进度检查点、暂存结果、已完成条目、已完成前缀形状或捕获执行模式之间的关系。

负责当前类型化状态的过程，只进行精确的消费时读取：

<a id="planned"></a>
### `planned`

执行许可无需辅助恢复读取。它准备调用，并在副作用接纳之前写入参数。

<a id="effect_pending"></a>
### `effect_pending`

激活读取 `operationToolArgs(operationId, turnId, sourceIndex)`，可选读取 `pendingToolOutput(operationId, invocationId)`。消费时缺少必需参数属于不变量缺陷。调用 memo 只通过作用域能力读取。安全重放、不安全中断和快照均不使用宽范围前缀扫描。

<a id="outcome_ready"></a>
### `outcome_ready`

实化读取 `pendingEntry(resultEntryId)`。消费时若缺失或可信消息关系错误，属于不变量缺陷。无需工具身份或副作用恢复。

<a id="completed"></a>
### `completed`

普通分派不在恢复时审计条目。后续上下文/树读取通过正常类型化路径消费不可变条目。

每次实时变更仍在 Session 串行通道验证当前操作、turn、源位置、invocation 和 status。这些检查隔离并发结算、取消与外部终结，不是历史恢复验证。终止前缀清理仍是防御性的，不使孤立数据扫描成为恢复一部分。

<a id="snapshots-and-reconnect"></a>
## 快照与重连

重连客户端可能看到：

- 断连前，比最新持久检查点更新的进程内实时进度；
- 进程替换后，只看到最新已提交有界检查点；
- `outcome_ready` 调用在 `runningTools` 中作为 settled 行，直到按源顺序实化；
- 已完成调用位于转录中。

`LaneSnapshot.operation.runningTools` 是判别联合。effect-pending 工具具有 `status: "running"`，可选 `result` 包含最新完整进度快照，重开后回退到持久检查点。outcome-ready 调用具有 `status: "settled"`、必需的完整最终 `result` 和 `isError`；它留在这里，直到不可变结果条目的 `entry_added` 移除该行，并把同样呈现放入转录。planned、completed 调用省略。

<a id="events-and-hooks"></a>
## 事件与钩子

- `tool_start` 开始新调用的公开处理呈现；它从建立副作用意图或合成暂存结果的提交发出，本身不证明外部副作用已开始。意图执行副作用时携带有效参数，即时合成结果则携带源参数。
- 实时进度事件和持久进度检查点不证明完成。
- harness 在 `after_tool` 前等待最新 `tool_update` 投递，保持既有监听器顺序，而不将 `onUpdate` 改为异步。
- `tool_end` 在 `outcome_ready` 暂存提交之后按完成顺序携带完整最终结果。它是持久结算证据，不重复 `tool_start` 的参数。
- 对首次被阻止、非法、截断或 planned-cancellation 的合成结果，暂存提交先发 `tool_start` 再发 `tool_end`；这些路径仍不运行工具副作用或副作用后钩子。副作用意图之后取消，使用先前意图绑定的 start 和暂存绑定的 end。
- 不安全恢复的副作用已由初始快照表示为 running；中断合成暂存时，可以只发带恢复标签的 `tool_end`。
- 消息生命周期和 `entry_added` 在暂存结果实化时发生，而非首次进入 `outcome_ready` 时；`entry_added` 只移除相应 settled 行。
- 被动监听器不能重入修改调用状态。

带埋点存储测试断言：真实执行为 `intent commit → tool_start → tool_update* → outcome staging → tool_end → source-ordered placement`；首次合成结果为 `outcome staging → tool_start → tool_end → source-ordered placement`。不回放历史事件；安全重放从清除检查点提交发出恢复 `tool_start`，从结果暂存发出 `tool_end`。

<a id="races"></a>
## 竞争情况

| 竞争 | 要求结果 |
|---|---|
| 检查点与工具结算 | 所有已接纳检查点先入队；结算等待最新 promise，暂存再删除检查点值；忽略迟到更新。 |
| memo 写入与 `outcome_ready` | 已等待或返回前已入队的写入先于暂存，随后被删除；返回后调用拒绝；外部终结先发生则持久所有权检查拒绝。 |
| B 结果与更早 A 结算 | B 独立暂存；放置等待 A。 |
| 结果暂存后崩溃 | 工具绝不重放，待放置结果随后实化。 |
| 源前缀放置期间崩溃 | 事务要么不暴露该前缀任何部分，要么暴露全部。 |
| 安全重放与旧部分输出 | 重放发出新进度前，删除旧绑定检查点值。 |
| 取消与真实结算 | Session 变更顺序选择已取消控制下的真实结果或合成协调；最多暂存一个结果。 |
| 终止终结与迟到结果 | 终止所有权先赢，或结果先暂存；迟到任务绝不重建操作数据。 |
| 外部终结与 memo/检查点变更 | 变更先发生则被终止清理删除；终结先发生则变更的持久所有权检查拒绝。 |

<a id="invariants"></a>
## 不变量

1. `invocationId` 等于预留结果条目 ID，安全重放期间稳定。
2. `outcome_ready` 或 `completed` 调用绝不再执行。
3. 每个 `outcome_ready` 调用恰有一个完整匹配的 `pi.pending.entry` 值。
4. 已完成调用构成按源顺序的前缀。
5. 只有按源顺序实化能延长该前缀。
6. 已完成前缀之后，并行调用可以混合 planned、effect-pending、outcome-ready 状态。
7. 调用 memo 仅在对应调用为 `effect_pending` 时存在。
8. 部分输出只是辅助信息，绝不确立副作用完成。
9. 不安全合成结果明确说明捕获输出不完整、外部结果未知。
10. 暂存结果时，原子删除调用 memo 和部分输出。
11. 实化时，原子插入不可变条目并删除其暂存待处理值。
12. 迟到调用能力不能在结果结算或操作丢失后写入。
13. `step.do` 只有 memo 写入提交后才完成 memo 化；副作用仍是至少一次执行。
14. 操作终止清理不留下工具参数、调用 memo、部分输出或暂存结果。

<a id="required-tests"></a>
## 必需测试

<a id="state-and-restore"></a>
### 状态与恢复

- 每种可信 planned/effect-pending/outcome-ready/completed 投影，无辅助读取即可恢复；
- 基础恢复不审计已完成前缀或执行模式关系；
- effect-pending 消费读取精确必需参数和可选有界检查点；
- outcome-ready 消费读取精确暂存结果；
- 必需参数或暂存结果缺失时，在消费过程失败，而非基础恢复；
- 暂存后调用 memo 和部分输出不存在；
- 快照/激活只在需要时加载精确有界检查点值。

<a id="parallel-ordering"></a>
### 并行顺序

- A 仍待处理时，B、C 可以暂存；
- 崩溃/重开证明 B、C 绝不重放；
- A 恢复后，通过一次按源顺序的 A/B/C 放置事务完成；
- 混合 `[completed, outcome_ready, planned, effect_pending, outcome_ready]` 状态；
- 即时合成结果可以乱序暂存；
- 全部要求终止的批次在有序放置后正确转换。

<a id="replay-and-interruption"></a>
### 重放与中断

- 安全重放使用持久参数和相同调用 ID；
- 安全重放保留 step memo，但清除旧部分输出；
- 当前声明从 safe 降为 never 时走中断；
- 无检查点和有完整有界检查点的不安全恢复；
- 合成结果表达错误/不完整/未知，绝不运行 `after_tool`；
- 取消绝不安全重放恢复出的调用。

<a id="invocation-memos-and-stepdo"></a>
### 调用 memo 与 `step.do`

- 在调用地址范围内 set/get/delete memo；
- 重开后已完成 step 跳过副作用；
- memo 提交前崩溃会重新执行副作用；
- memo 提交后崩溃返回 memo；
- 多个已完成 step 后接一个中断 step；
- 同次实时执行重复 step 名被拒绝；
- memo 写入与结果暂存竞争；
- 过期、取消结果暂存及外部终结后，能力写入被拒绝；
- 终止清理移除崩溃遗留 memo。

<a id="partial-output"></a>
### 部分输出

- 普通更新只实时投递；
- `checkpoint: true` 写入完整有界快照；
- 工具选择的检查点频率与去重；
- bash 每 100 ms 发实时快照，最多每两秒请求一次不同检查点；
- 每个选中检查点入队一次写入，工具结算时等待最新 promise 意味着所有更早写入完成；
- 结果暂存后的检查点不能重建地址值；
- Memory、JSONL、SQLite 恢复相同检查点值；
- JSONL 增长遵循检查点频率，而非原始 bash 输出量；
- 终止后压缩按现有无效字节策略回收被替代/删除的检查点快照。

<a id="atomicity-and-instrumentation"></a>
### 原子性与埋点

- 精确验证意图、同步更新接纳、异步更新投递、`after_tool`、outcome-ready 暂存、提交后 `tool_end`、按源顺序消息生命周期及实化顺序；
- 结果暂存与 memo/输出清理原子完成；
- 实化与待处理删除、用量、tip、状态原子完成；
- 每个边界发生崩溃；
- 意图之前不启动副作用；
- `outcome_ready` 不启动副作用或钩子；
- 终止事务移除全部操作自有工具值。

<a id="implementation-map"></a>
## 实现分布

预期运行时涉及：

- `packages/agent/src/harness/session/types.ts` 中的操作状态类型；
- 可信恢复投影与精确消费时地址读取；
- 工具批次过程和按源顺序实化；
- 终止清理与取消协调；
- harness 专用更新选项、快照和事件；
- 在 Session 变更串行通道上实现调用作用域能力；
- 通过绑定值/列表 API 验证后端一致性；
- 带埋点存储的事务断言。

`session/values.ts` 中的具体内置地址构造器：

```text
operationToolMemo(operationId, invocationId, name) → value("pi.op.tool_memo", ...)
pendingToolOutput(operationId, invocationId)      → value("pi.pending.tool_output", ...)
pendingEntry(resultEntryId)                       → value("pi.pending.entry", ...)
```

先实现 `outcome_ready` 和调用 memo，再做进度检查点。该状态本身即可解决错误的并行重放；检查点改善重连观察及不安全中断诊断，但不成为完成权威。

> 中文阅读版；原文路径：`packages/agent/docs/assistant-durability.md` · [英文原文](../../../../../packages/agent/docs/assistant-durability.md) · [阅读索引](../../../README.md)
> 对应提交：`eccca93e642558afbdba3b122cb11f5cbbf66f08` · 原文 SHA-256：`c07961d0fb7fb8416bf980544f952cf1491f8c1526822a8eb4b02b03490e164c`
> 正文译为中文，代码示例及其中注释保留英文；命令和路径按原项目解释。本页仅供阅读，不代表执行其中操作；历史设计和研究结论不等于当前运行时保证。

<a id="assistant-partial-durability--implementation-handoff"></a>
# 助手部分输出持久化：实现交接

本文规定普通助手生成和延迟响应轮询中，如何持久保存部分助手消息。基础包括：values.md 的绑定类型化值/列表地址；pi-ai 的 AssistantMessageFrame、AssistantMessageFrameEncoder、reduceAssistantMessageFrames()；harness.md 的助手意图、副作用及结果提交状态机。

设计保存紧凑、可回放的流帧，但不让它们成为操作状态的权威来源，也不在每次更新时写入不断增长的完整部分消息。

<a id="goals"></a>
## 目标

1. 进程丢失后重建最近已提交的部分助手消息。
2. 保留提供方流顺序，避免重复完整快照的写放大。
3. 存储提交不对提供方流施加背压。
4. 复用 pi-ai 标准帧转换及归约语义。
5. 保持公开助手事件顺序。
6. 恢复仍以操作 effect_pending 状态为权威。
7. 正常或合成响应提交时，原子删除全部部分帧。

<a id="non-goals"></a>
## 非目标

- 从帧推断提供方已完成。
- 将终止 done/error 事件与响应结果分开持久化。
- 保证提供方请求恰好执行一次。
- 公开帧游标或帧持久化事件。
- 通用批处理、定时器、合并或 flush API。
- 保存结构化摘要生成流。
- 保存任意提供方 SDK 事件或重复完整 partial 快照。

<a id="storage"></a>
## 存储

session/values.ts 中的内置地址构造器：

```ts
export const pendingAssistantFrames = (
  operationId: string,
  responseEntryId: string,
) => list<AssistantMessageFrame>(
  "pi.pending.assistant_frame",
  `${operationId}:${responseEntryId}`,
);
```

过程为普通生成或延迟轮询绑定一个精确地址：

```ts
const frames = pendingAssistantFrames(operationId, responseEntryId);
```

responseEntryId 已在助手/延迟 effect_pending 状态中预留。操作状态不保存帧数量、游标或列表身份；后续列表操作只接收 frames，不再接收另一个键。

每个列表元素是一个 AssistantMessageFrame，由存储事务的全局写序列排序。该列表仅为辅助数据：可以不存在；不证明请求已接纳、完成、成功或失败；不选择重启位置；基础恢复不读取它。

<a id="frame-contract"></a>
## 帧契约

每条提供方流创建一个 pi-ai 编码器，按顺序输入每个事件：

```ts
const encoder = new AssistantMessageFrameEncoder();
const frame = encoder.encode(event);
```

partial 是提供方共享的“截至当前响应”活对象，不是事件发生时的快照。编码器为每个打开的块维护计数，裁去已被更靠后的块起始快照表示的文本/思考增量前缀。对于已推进的工具调用，只暂存同步所需的原始 JSON 前缀，随后输出一个检查点并恢复紧凑增量；不会逐事件克隆不断增长的完整消息。

- start 产生内容为空的元数据帧。
- 非终止事件产生零或一个帧。
- 已被覆盖的排队增量不产生帧。
- done/error 不产生帧，最终响应提交另行处理。
- start 前初始化 error 合法，不产生帧。
- 文本、思考、工具结束帧包含权威的完整块值。
- 完成的工具调用参数仍未按工具 schema 校验。

不要再定义一套 harness 帧编解码器或归约器。持久层直接保存 pi-ai 导出的值，初始化使用 reduceAssistantMessageFrames()。

提供方事件的块可以交错。编码和归约依赖 contentIndex，不依赖块连续性。文本和普通思考块发布 *_start 时必须为空，之后仅通过对应增量追加直到结束；隐藏思考可在开始时已完整且不产生增量。流式工具调用从空参数开始，通过增量输出完整原始 JSON；若起始就包含完整参数，提供方必须先输出能在事件边界解析成该快照的累计增量前缀，再输出后续参数增量。

<a id="fresh-stream-scheduling"></a>
## 新流调度

刻意采用最简单的调度：每个转换帧对应一个列表追加事务，在提供方循环中入队，但不等待存储。

每个 start 或更新事件的流程：

```text
encode the event against the per-stream frame encoder
→ when a frame is returned, synchronously enqueue invocation-fenced appendList(frames, frame)
→ attach the ordinary harness-fault observer to the returned promise
→ replace process-local latestFrameWrite promise reference
→ emit and await the existing message_start/message_update event
→ consume the next provider event
```

对应含义为：编码事件；返回帧时同步入队受调用身份保护的 appendList；立即为 Promise 附加常规 harness 故障观察器；替换进程内 latestFrameWrite 引用；发出并等待既有 message_start/message_update；再消费下一提供方事件。

同步调用 appendList 保证帧变更按提供方事件顺序进入 Session 串行队列，但过程不逐次等待写入。每个 Promise 在替换最新引用前立即被观察以传播故障。已覆盖事件不分配持久帧或写入。编码器状态仅与打开块数及活跃工具 JSON 流尚未同步的前缀有关，不保留第二份完整消息；模型输出上限将排队帧内存限制为有界输出加帧/事务开销。

事件侧保持现有行为：AssistantStreamObserver.start/update 对每个事件等待 events.emit()。提供方循环前进时没有未完成助手事件交付，因此无需另设“最新事件交付 Promise”。

提供方流结束时：

```text
stop frame admission
→ await latestFrameWrite when present
→ run after_response
→ emit message_end
→ classify and commit final response settlement
```

即停止接纳帧、等待最新写入、运行 after_response、发出 message_end，再分类并提交最终响应。Session 变更队列为 FIFO，因此最新写入完成意味着所有先前追加都完成。无需 Promise 数组、定时器、批处理器、活跃/等待状态、合并器或公开/内部 flush 方法。

帧追加失败会在 after_response 开始前使 harness 故障。完整最终响应仍仅存在于进程内，存储故障后不得再提交。

<a id="normal-settlement"></a>
## 正常结果提交

使用过帧列表的每次助手响应提交，必须在写入不可变响应条目、用量、tip 和下一操作状态的同一事务中删除精确列表：

```text
TX[
  insert response entry R,
  insert usage U,
  setValue(branchTip(lane), R),
  deleteList(frames),
  setValue(operationState(operationId), classified next state)
]
```

适用于成功助手响应、提供方 error/aborted 响应、有效延迟响应及延迟轮询响应。

after_response 可以在提交前转换最终响应。帧保留提供方流的观察结果，不可变条目则是钩子处理后的标准结果。

最终帧追加之后、结果提交之前崩溃，仍恢复为 effect_pending；帧不能把看似完整的草稿变成已提交响应。

<a id="unknown-outcome-generation-recovery"></a>
## 结果未知的生成恢复

孤立的助手生成 effect_pending 不再有存活提供方流。激活时：

1. 从当前类型化状态构造精确 frames 地址，并有界分页读取。
2. 用 reduceAssistantMessageFrames() 归约帧值。
3. 在预留响应 ID 下构造 harness 拥有的合成助手响应。
4. 有帧时保留重建的部分内容和安全的消息身份元数据。
5. 设置 stopReason 为 error、用量为零，附上明确的中断/结果未知错误消息或诊断。
6. 原子提交合成响应、零用量行、帧列表删除、tip，以及常规重试/失败状态。

警告必须表达：提供方请求已中断；前面的内容是最近已提交的部分响应，可能缺失更新的实时输出，外部请求结果未知。原始警告示例：

```text
The provider request was interrupted. The preceding content is the latest
committed partial response; newer live output may be missing, and the external
request outcome is unknown.
```

若没有 start 帧提交，使用捕获的模型/API 身份生成相同合成错误，但内容为空。

合成响应遵循普通助手错误分类：尚有尝试次数时插入错误响应并进入正常重试等待/下一次尝试；达到上限时，在同一结果事务中插入响应并将操作终止为失败。

错误响应保留在持久对话历史中，但按现有投影规则从后续提供方上下文省略。中断错误响应中的部分工具调用绝不执行。恢复不运行 after_response，因为没有可信的完整提供方结果可转换。

<a id="cancellation"></a>
## 取消

活跃流取消后，通过正常最终 aborted 响应结束；先等待所有已接纳帧，再由正常提交删除列表。

恢复到已取消的助手/延迟 effect_pending 时，取消协调会归约已有帧，生成保留已提交部分内容的合成 aborted 响应，使用零用量及原预留 ID，原子插入响应并删除列表；不启动提供方请求，也不运行响应钩子。

即使归约内容看似完整，取消仍优先决定分类。

<a id="deferred-polling"></a>
## 延迟轮询

返回 AssistantMessageEventStream 的延迟轮询使用相同地址构造器：

- 正常 pending/ready/error 提交删除该轮询帧列表。
- 恢复取消时，从帧合成 aborted 响应。
- 未获许可且结果未知的恢复轮询保持暂停，可在快照中暴露持久部分内容。
- 轮询许可用新预留响应/用量 ID 替换未知轮询时，该意图事务删除废弃的旧列表地址。
- 替代轮询在新响应 ID 下使用全新列表。

帧不改变轮询次数规则。

<a id="structural-generation-scope"></a>
## 结构化生成范围

结构化摘要生成流仍仅存在于进程内。它们不发出公开助手消息生命周期，且一次结构发布前可能跨多个嵌套提供方请求；现有尝试级重试及用量恢复仍是权威来源。

本阶段不把其中间文本存入 pendingAssistantFrames 地址。若需要结构化部分诊断，应增加独立且范围明确的消费者，不应静默复用对话助手语义。

<a id="snapshots-and-reconnect"></a>
## 快照与重连

LaneSnapshot.streamingMessage 表示最近观察到的部分助手消息，不证明当前附着着提供方流。优先级为：

1. 拥有活跃流时的最新进程内部分内容。
2. 否则在助手/延迟 effect_pending 下，从已提交帧页归约的值。
3. 否则缺省。

因此恢复后的 lane 可以处于 suspended，同时 streamingMessage 非 undefined。该字段不属于 transcript；只有 entry_added 才将完整响应移入历史并清除部分内容。

快照初始化从可信类型化操作状态构造精确绑定地址，并执行助手消费者的总帧数/页数预算。不扫描任意列表，不进行广泛语义恢复审计。

重连不回放历史 message_start/message_update；快照携带持久部分内容。之后恢复仅为实际提交的合成响应发出带恢复标签的正常消息生命周期。

<a id="events"></a>
## 事件

已开始生成保持如下实时事件顺序：

```text
message_start
→ message_update*                 each listener delivery awaited by provider loop
→ await latest frame write
→ after_response
→ message_end
→ atomic response settlement + frame-list delete
→ entry_added
→ usage
```

即消息开始、逐次等待监听器交付的更新、等待最新帧写入、after_response、message_end、原子响应提交与列表删除、entry_added、usage。

请求初始化失败可能在 start 前产生 error，此时不发 message_start 或帧，继续经过 after_response、message_end 和普通错误提交。start 前出现成功 done 或更新是协议缺陷。

帧提交只发出普通存储遥测，没有公开帧事件，也不声称 message_update 已持久化。entry_added 仍是最终助手条目已提交的唯一证明。

实时更新事件之后、异步排队的帧追加提交之前可能崩溃；重连只显示最新已提交帧前缀，可能落后于最后实时事件。

<a id="close-fault-and-external-finalization"></a>
## 关闭、故障与外部终结

关闭相当于受控崩溃：不写合成响应；已排队帧提交是正常接纳的 Session 工作，可在关闭屏障下完成；进程丢失可丢弃尚未提交的变更；重新打开时在不变的 effect_pending 下恢复最新已提交前缀。

帧提交存储失败会使 harness 故障，该进程之后不再提交响应结果。

获授权的外部终结在终止事务中删除操作拥有的列表地址。每次追加在 Session 队列内核对当前操作/响应所有权：追加先发生则终止清理删除它；终结先发生则旧追加被拒绝，不能重建状态。

<a id="terminal-cleanup-forks-and-migrations"></a>
## 终止清理、分叉与迁移

正常或合成响应提交本应删除精确地址。操作终止事务仍防御性地在助手/延迟 effect_pending 下构造并删除当前操作拥有的帧地址。

空闲分叉不复制 pi.pending.assistant_frame 地址族列表。精确重写和迁移对列表分页处理，保留时维持元素序列。

改变 AssistantMessageFrame 形状的迁移，必须映射每个存活元素，或显式删除整个列表，使 effect_pending 恢复时没有部分内容；绝不能从旧帧推断完成。

JSONL 在快照压缩前仍保留被删除帧的字节，逻辑删除立即生效。

<a id="races"></a>
## 竞争情况

| 竞争 | 要求结果 |
|---|---|
| 帧追加与下一帧 | 同步入队保持提供方事件顺序。 |
| 帧追加与流结束 | 结果提交等待最新 Promise，先完成所有已接纳追加。 |
| 实时更新与帧提交 | 任一可先完成；事件仅为观察，重连仅用已提交帧。 |
| 追加与外部终结 | 追加先发生由清理删除；终结先发生则阻止旧追加。 |
| 有排队写入时进程丢失 | 只恢复已提交前缀。 |
| 最终帧与响应提交 | 帧先提交，响应事务原子删除列表并插入最终条目。 |
| 激活与快照 | 都归约同一已提交序列前缀，激活随后可提交结果并清除它。 |
| 未知生成与重试 | 后续尝试前，先用旧预留 ID 提交部分合成错误。 |
| 未知延迟轮询与替换 | 新替代意图删除旧列表，新响应 ID 使用新列表。 |

<a id="invariants"></a>
## 不变量

1. 标量助手/延迟状态是唯一重启权威。
2. 一个 effect_pending 响应 ID 恰好构造一个帧列表地址。
3. 每个存储元素都是导出的 pi-ai AssistantMessageFrame。
4. done/error 终止事件绝不保存为帧。
5. 帧顺序是提供方事件顺序的子序列；被覆盖而无帧的事件不扰乱顺序。
6. 流结束时等待最新写入 Promise，意味着所有已接纳追加完成。
7. 帧不证明提供方完成，也不抑制结果未知恢复。
8. 最终或合成响应提交原子删除精确列表。
9. 恢复部分内容可出现在 streamingMessage，提交前不进入 transcript。
10. 中断的部分工具调用不生成工具计划，因为合成响应以 error/aborted 结束。
11. 本阶段结构化生成不写 pendingAssistantFrames 列表。
12. 终止清理、外部终结和空闲分叉不留下操作拥有的助手帧列表。

<a id="required-tests"></a>
## 必需测试

<a id="frame-integration"></a>
### 帧集成

- 每流一个编码器正确处理共享实时 partial 和同步事件突发，无内容重复。
- 每事件追加零或一个帧，已覆盖排队增量不追加。
- done/error，包括生成前错误，不追加。
- 交错 contentIndex 保持序列。
- 提供方循环不等待单次帧写入。
- 下一提供方事件前同步入队帧追加。
- 仅保留最新 Promise 引用。
- 最新 Promise 完成意味着所有先前写入完成。
- 输出有界则排队帧内存有界。
- 存储失败阻止 after_response 并使 harness 故障。

<a id="settlement-and-recovery"></a>
### 结果提交与恢复

- 每类普通响应原子删除帧列表。
- 在所有帧/提交边界模拟崩溃。
- 覆盖无帧及部分文本、思考、工具调用帧。
- 保留权威结束帧内容。
- 中断生成先提交部分合成错误，再重试或因上限失败。
- 中断的部分工具调用绝不执行。
- 恢复使用零用量及既有预留 ID。
- 取消时合成 aborted 响应保留已提交部分内容。
- 恢复合成提交绝不运行 after_response。

<a id="deferred-snapshots-and-lifecycle"></a>
### 延迟、快照与生命周期

- 延迟轮询帧持久化与正常清理。
- 无许可的未知轮询快照。
- 替代意图删除废弃轮询帧。
- 实时部分内容优先于持久归约。
- 重开后在暂停的 effect_pending lane 暴露归约 streamingMessage。
- 不回放历史更新事件。
- 恢复提交在 entry_added 时清除部分内容。
- 结构化生成不写助手帧列表。

<a id="storage-lifecycle"></a>
### 存储生命周期

- Memory/JSONL/SQLite 对相同帧序列归约结果相同。
- 正常、合成、取消和外部终止转换后列表均不存在。
- 空闲分叉排除帧。
- JSONL 压缩移除删除帧的字节。
- 迁移映射或明确丢弃每个旧帧。
- 埋点记录追加/删除顺序，遥测不包含帧内容。

<a id="implementation-map"></a>
## 实现位置

预期涉及 session/values.ts 的地址构造器；values.md 的绑定存储实现；助手执行观察器和生成过程；延迟轮询；激活与取消恢复；快照初始化；终止清理、分叉和迁移；带埋点写入器及后端一致性测试。

先实现绑定类型化值/列表地址，再实现帧入队和结果提交，最后实现恢复/快照。在实现运行时助手能力对齐前，将完整生命周期更新到 harness.md。

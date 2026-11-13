> 中文阅读版；原文路径：`packages/agent/docs/values.md` · [英文原文](../../../../../packages/agent/docs/values.md) · [阅读索引](../../../README.md)
> 对应提交：`7ca5b1bde4d3dafe3f7555407bd96043b5b660ee` · 原文 SHA-256：`ca2dfc2bd97d8e4f8eacddc9254b9077eb1403a20d5660ed844309b54c471c43`
> 正文译为中文，代码示例及其中注释保留英文；命令和路径按原项目解释。本页仅供阅读，不代表执行其中操作；历史设计和研究结论不等于当前运行时保证。

<a id="typed-values-and-lists"></a>
# 类型化值与列表

本文规定 Session、harness 和应用使用的可变存储原语。

公开抽象是**绑定的类型化地址**：

- `value<T>(namespace, key?)` 指定一个可替换的持久值；
- `list<T>(namespace, key?)` 指定一个只追加的持久列表，元素类型为 `T`。

构造地址时一次性绑定 namespace/key。此后所有操作只接收该地址。因此应用代码写为：

```ts
const state = value<ApplicationState>("my-app.state");
const events = list<ApplicationEvent>("my-app.events");

await session.getValue(state, context);
await session.setValue(state, nextState, context);
await session.readList(events, { limit: 100 }, context);
await session.appendList(events, event, context);
```

调用时**不需要**反复传入第二个含义不明的 key：

```ts
// Not the API.
await session.readList(events, "another-key", { limit: 100 }, context);
```

应用确实需要按 key 区分实例时，为该实例构造地址：

```ts
const workspaceEvents = (workspaceId: string) =>
  list<ApplicationEvent>("my-app.events", workspaceId);

await session.readList(workspaceEvents("pi"), { limit: 100 }, context);
```

存储可以在物理上按 `(kind, namespace, key)` 索引地址，但此表示不会泄漏到每次读写调用。Storage、Session、harness 代码与应用使用同一套地址概念。没有全局值类型映射、动态注册表、令牌目录或独立的应用状态存储机制。

<a id="goals"></a>
## 目标

1. 为一个精确持久地址指定一个编译期值类型。
2. 应用无需声明合并或修改核心类型映射，即可定义标量值和列表。
3. 从 Storage 到 Session 使用相同的类型化地址及操作名称。
4. 保留当前标量替换语义。
5. 追加一个列表元素时不读取或重写已有元素。
6. 每个列表元素使用现有的会话全局事务 `seq`，用于排序和分页。
7. 将值和列表元素与条目、用量原子提交。
8. Memory、JSONL、SQLite 提供相同逻辑行为。
9. 列表读取保持有界且显式。
10. 标量操作状态保持权威；辅助列表绝不选择恢复状态。

<a id="non-goals"></a>
## 非目标

本阶段不定义：

- 助手帧内容或归约语义；
- 工具进度语义；
- 对可信进程内值的运行时验证；
- 单元素或单列表的字节限制；
- 列表截断或逐元素删除；
- 通用事件日志、journal、流恢复协议或操作 reducer；
- 全局注册地址对象；
- 向工具暴露原始 Session 或事务访问。

消费者负责地址构造、内容限制、清理时点、分叉策略、迁移策略以及消费时的数据加载。`assistant-durability.md` 定义首个列表消费者。

<a id="bound-address-model"></a>
## 绑定地址模型

```ts
declare const storedValueType: unique symbol;

interface StoredAddressBase {
  /** Stable persisted grouping name. */
  readonly namespace: string;
  /** Exact member inside that grouping. Empty is legal. */
  readonly key: string;
  readonly kind: "value" | "list";
}

export interface Value<T> extends StoredAddressBase {
  readonly kind: "value";
  /** Compile-time only and invariant in T. */
  readonly [storedValueType]?: (value: T) => T;
}

export interface ValueList<T> extends StoredAddressBase {
  readonly kind: "list";
  /** T is one element, not the whole list. */
  readonly [storedValueType]?: (value: T) => T;
}

export function value<T>(namespace: string, key = ""): Value<T> {
  validateAddress(namespace, key);
  return Object.freeze({ namespace, key, kind: "value" });
}

export function list<T>(namespace: string, key = ""): ValueList<T> {
  validateAddress(namespace, key);
  return Object.freeze({ namespace, key, kind: "list" });
}
```

这个虚拟函数使 `T` 保持不变性：一种类型的地址不能静默拓宽为另一种。它没有运行时字段。

规则：

- `namespace` 必须非空；
- 契约将命名空间 `pi` 和全部 `pi.*` 保留给内置功能；
- 应用构造保留地址属于可信进程内代码的编程缺陷；没有运行时权限划分、注册表或目录；
- 两个组成部分都不能包含 Memory 后端的内部分隔符（`\u0000`）；
- 空 key 合法，是应用级单个值或列表的自然地址；
- 对象身份没有持久语义；
- 分别构造、但 `(kind, namespace, key)` 相同的地址，标识相同持久位置；
- 用不兼容的 TypeScript 类型构造同一持久位置，属于可信代码的编程缺陷；
- 同一存储版本内，标量与列表地址不能共享 `(namespace, key)`；违反此项属于可信代码的编程缺陷，存储不执行跨 kind 冲突检查；
- 改变地址 namespace、key、kind 或不兼容的值形状，都需要迁移。

两个组成部分保持分离，不拼接成一体。因此，动态应用 key 和操作 ID 除存储分隔符规则外，无需额外转义约定。

<a id="exact-addresses-not-families"></a>
### 精确地址，而非地址族

一个地址指定一个值或一个列表。内部代码需要动态 key 时，使用小型构造器：

```ts
export const branchTip = (lane: string) =>
  value<string | null>("pi.branch.tip", lane);

export const operationState = (operationId: string) =>
  value<OperationState>("pi.op.state", operationId);

export const operationToolArgs = (
  operationId: string,
  stepId: string,
  sourceIndex: number,
) => value<Record<string, JsonValue>>(
  "pi.op.tool_args",
  `${operationId}:${stepId}:${sourceIndex}`,
);

export const pendingAssistantFrames = (
  operationId: string,
  responseEntryId: string,
) => list<AssistantMessageFrame>(
  "pi.pending.assistant_frame",
  `${operationId}:${responseEntryId}`,
);
```

这让各 key 语法封装在其负责模块中。调用方获得已经绑定的类型化地址：

```ts
await reader.getValue(operationState(operationId));
await reader.readList(pendingAssistantFrames(operationId, responseEntryId), options);
```

<a id="no-global-value-map"></a>
### 不使用全局值映射

删除现有的全局命名空间到类型的映射：

```ts
interface RegisterValues { /* delete */ }
interface ListRegisterValues { /* delete */ }
type RegisterNamespace = keyof RegisterValues; // delete
```

类型改由地址构造器持有：

```ts
export const applicationState = value<MyApplicationState>("my-app.state");
export const applicationEvents = list<MyApplicationEvent>("my-app.events");
```

应用应使用稳定、不易冲突的命名空间前缀。契约将 `pi` 命名空间及完整 `pi.*` 前缀保留给内置功能；`pi2` 等外观相似的名字仍合法。核心和应用代码使用相同的 `value()`、`list()` 构造器。测试断言每个内置地址都使用保留前缀。没有运行时权限划分、注册表或目录。

<a id="built-in-addresses"></a>
## 内置地址

内置构造器集中在 `packages/agent/src/harness/session/values.ts`，由消费者直接导入。代表性定义：

```ts
export const branchTip = (lane: string) =>
  value<string | null>("pi.branch.tip", lane);
export const laneConfig = (lane: string) =>
  value<LaneConfiguration>("pi.lane.config", lane);
export const laneState = (lane: string) =>
  value<LaneState>("pi.lane.state", lane);
export const operationResult = (operationId: string) =>
  value<OperationResultRecord>("pi.result", operationId);

/** Used only by scanValues() to enumerate Branch names. */
export const branchTipInventoryPrefix = () =>
  value<string | null>("pi.branch.tip");

export const operationMeta = (operationId: string) =>
  value<OperationMeta>("pi.op.meta", operationId);
export const operationState = (operationId: string) =>
  value<OperationState>("pi.op.state", operationId);
export const operationToolArgs = (operationId: string, stepId: string, sourceIndex: number) =>
  value<Record<string, JsonValue>>(
    "pi.op.tool_args",
    `${operationId}:${stepId}:${sourceIndex}`,
  );
export const operationToolMemo = (operationId: string, invocationId: string, name: string) =>
  value<JsonValue>("pi.op.tool_memo", `${operationId}:${invocationId}:${name}`);
export const operationPreparation = (operationId: string, taskId: string) =>
  value<DurableStructuralPreparation>(
    "pi.op.preparation",
    `${operationId}:${taskId}`,
  );

/** Prefix addresses are exported only for namespace-scoped scanValues(). */
export const operationToolArgsPrefix = (operationId: string, stepId?: string) =>
  value<Record<string, JsonValue>>(
    "pi.op.tool_args",
    stepId === undefined ? `${operationId}:` : `${operationId}:${stepId}:`,
  );
export const operationToolMemoPrefix = (operationId: string, invocationId?: string) =>
  value<JsonValue>(
    "pi.op.tool_memo",
    invocationId === undefined ? `${operationId}:` : `${operationId}:${invocationId}:`,
  );
export const operationPreparationPrefix = (operationId: string) =>
  value<DurableStructuralPreparation>("pi.op.preparation", `${operationId}:`);

export const pendingEntry = (entryId: string) =>
  value<PendingEntry>("pi.pending.entry", entryId);
export const pendingToolOutput = (operationId: string, invocationId: string) =>
  value<AgentToolResult<unknown>>(
    "pi.pending.tool_output",
    `${operationId}:${invocationId}`,
  );
export const pendingAssistantFrames = (operationId: string, responseEntryId: string) =>
  list<AssistantMessageFrame>(
    "pi.pending.assistant_frame",
    `${operationId}:${responseEntryId}`,
  );
export const pendingToolOutputPrefix = (operationId: string) =>
  value<AgentToolResult<unknown>>("pi.pending.tool_output", `${operationId}:`);

export const sessionName = value<string>("pi.session.name");
export const entryLabel = (entryId: string) => value<string>("pi.entry.label", entryId);
```

`OperationMeta` 是存于 `pi.op.meta` 的不可变接纳元数据。进程内 `Operation` 投影为 `{ meta: OperationMeta, state: OperationState }`，由独立的元数据值和状态值组装；绝不作为整体存于一个地址。

导出的五个扫描前缀构造器为 `branchTipInventoryPrefix`、`operationToolArgsPrefix`、`operationToolMemoPrefix`、`operationPreparationPrefix`、`pendingToolOutputPrefix`。它们的地址只供 `scanValues()` 使用。

应用直接定义自己的 `value()`、`list()` 地址；没有内置自定义应用状态命名空间或自定义状态 API。`AgentHarnessToolInvocation.getMemo()`、`setMemo()` 是基于 `operationToolMemo(...)`、受调用身份隔离的能力，不是原始 Session 访问。调用 memo 仍由操作拥有，并在工具结果持久化后删除。

测试断言内置构造器产生文档规定的 kind、namespace 和 key 语法。构造器可能是动态的，因此没有试图枚举所有可能地址的运行时目录。

<a id="shared-read-api"></a>
## 共享读取 API

Storage、Session、SessionReader、SessionMutator 使用相同读取签名：

```ts
export interface StoredValue<T> {
  address: Value<T>;
  value: T;
  seq: number;
}

export interface ListElement<T> {
  /** Global transaction-write sequence assigned by storage. */
  seq: number;
  value: T;
}

export interface ListCursor {
  seq: number;
}

export interface ListReadOptions {
  /** Exclusive cursor. */
  cursor?: ListCursor;
  /** Default: asc. */
  order?: "asc" | "desc";
  /** Query-page size. Default: 1,000. Values above 10,000 clamp to 10,000. */
  limit?: number;
}

interface ValueReader {
  getValue<T>(address: Value<T>): Promise<StoredValue<T> | undefined>;

  /** Internal bounded-prefix operation. The address key is interpreted as a prefix. */
  scanValues<T>(prefix: Value<T>): Promise<StoredValue<T>[]>;

  readList<T>(
    address: ValueList<T>,
    options?: ListReadOptions,
  ): Promise<ListElement<T>[]>;
}
```

`scanValues(prefixAddress)` 扫描命名空间完全匹配、key 以绑定 key 开头的标量地址，按 key 升序返回。核心调用点只使用上述导出前缀构造器，使原始 namespace/key 语法留在 `session/values.ts`。前缀地址只传给 `scanValues()`，不传给精确 get/set/delete。没有不受限制的跨命名空间转储。普通应用读取使用精确地址。

`Session` 使用同一地址提供直接的单次转换写入：

```ts
interface Session extends ValueReader {
  setValue<T>(
    address: Value<T>,
    next: NoInfer<T>,
    context: Context,
  ): Promise<void>;
  deleteValue<T>(address: Value<T>, context: Context): Promise<void>;
  appendList<T>(
    address: ValueList<T>,
    element: NoInfer<T>,
    context: Context,
  ): Promise<void>;
  deleteList<T>(address: ValueList<T>, context: Context): Promise<void>;
}
```

`getName()`、`setName()`、`getLabel()`、`setLabel()` 等专用辅助函数可以继续作为内置地址的薄封装。应用直接定义并使用自己的标量/列表地址。

`SessionMutator` 仍是读取能力加一次原子 `commit(writes)`。它不提供直接 `setValue()`/`appendList()`，以免这些方法单独消耗唯一一次提交；调用方构造类型化写入数组，并一起提交。

<a id="typed-transaction-writes"></a>
## 类型化事务写入

通过类型化辅助函数构造写入。条目和用量构造器隐藏存储判别字段；只有辅助函数验证地址与值的类型关系之后，才擦除值/列表类型：

```ts
interface EntryWrite {
  kind: "entry";
  entry: NewEntry;
}

interface UsageWrite {
  kind: "usage";
  row: Omit<UsageRow, "seq">;
}

interface ValueSetWrite {
  kind: "value";
  op: "set";
  namespace: string;
  key: string;
  value: unknown;
}

interface ValueDeleteWrite {
  kind: "value";
  op: "delete";
  namespace: string;
  key: string;
}

interface ListAppendWrite {
  kind: "list";
  op: "append";
  namespace: string;
  key: string;
  value: unknown;
}

interface ListDeleteWrite {
  kind: "list";
  op: "delete";
  namespace: string;
  key: string;
}

export function insertEntry(entry: NewEntry): EntryWrite;
export function insertUsage(row: Omit<UsageRow, "seq">): UsageWrite;
export function setValue<T>(address: Value<T>, next: NoInfer<T>): ValueSetWrite;
export function deleteValue<T>(address: Value<T>): ValueDeleteWrite;
export function appendList<T>(address: ValueList<T>, element: NoInfer<T>): ListAppendWrite;
export function deleteList<T>(address: ValueList<T>): ListDeleteWrite;
```

`NoInfer<T>` 让地址成为类型权威。TypeScript 不得从不兼容的写入值推导出更宽的 `T`。

`Write` 包含这六种辅助函数返回类型。一个事务可以原子混合所有写入种类。Harness 和应用代码使用辅助函数，不手工构造存储写入形状。

Session 直接方法与事务辅助函数有意采用相同操作名。前者执行并提交一次 Session 变更；后者为显式组合的事务构造一条写入。

<a id="scalar-semantics"></a>
## 标量语义

对于一个 `Value<T>` 地址：

- `setValue` 替换当前值；
- `deleteValue` 删除它；
- 删除不存在的值是空操作；
- 删除后 set 会重新创建；
- 不保留值历史；
- 当前值记录最近一次 set 的 `seq`；
- 事务失败时，标量写入及其同事务其他写入均不可见。

<a id="list-semantics"></a>
## 列表语义

一条 append 写入携带一个不可变元素。事务追加多个元素时，包含多条 append 写入。每条写入使用现有全局递增事务序列：

```text
TX[
  appendList(frames, A),       // seq 41
  setValue(operationState, X), // seq 42
  appendList(frames, B),       // seq 43
]
```

读取 `frames` 时先返回 `A`，再返回 `B`。无关写入造成的序列空隙符合预期。元素 `seq` 在会话范围全局有效，唯一标识该次已提交写入；它是排序/游标身份，不是应用领域 ID。需要领域身份的应用应将它放入 `T`。

规则：

- append 从不读取已有元素；
- 元素提交后不可变；
- `deleteList(address)` 删除该精确地址的全部元素；
- 删除不存在的列表是空操作；
- 同一事务先 delete 后 append，会原子创建一个新列表；
- 没有逐元素更新、删除、插入或截断；
- 接纳事务所需的全部验证和序列化，在 Memory 状态变化前完成；
- 事务失败时，其列表及非列表写入均不可见。

“只追加”描述列表存在期间的元素。删除整个列表是生命周期清理，不是元素修改。

<a id="list-reads"></a>
### 列表读取

- 升序读取返回 `seq > cursor.seq`；
- 降序读取返回 `seq < cursor.seq`；
- 先按 `order` 排序，再应用 `limit`；
- 不存在和空列表都返回 `[]`；
- 调用方用最后返回元素的 `seq` 继续；
- 空页表示迭代结束；
- `limit` 仅是查询页大小：必须为正的安全整数，默认 1,000，超过 10,000 则截为 10,000；它不限制列表总长度或字节数。

```ts
let cursor: ListCursor | undefined;
while (true) {
  const page = await reader.readList(events, { cursor, order: "asc", limit: 100 });
  if (page.length === 0) break;
  consume(page);
  cursor = { seq: page[page.length - 1]!.seq };
}
```

游标是序列过滤条件，不是快照或列表代次令牌。并发的后续追加可能出现在后续升序页。删除整个列表可能使游标过期；读取只是将序列比较应用于当前存活元素。

不要增加无界的“读取整个列表”辅助函数。

<a id="assistant-partial-frames"></a>
## 助手部分帧

助手部分输出持久化是首个内置列表消费者：

```ts
const frames = pendingAssistantFrames(operationId, responseEntryId);
```

`AssistantMessageFrame`、`AssistantMessageFrameEncoder`、`reduceAssistantMessageFrames()` 来自 `@earendil-works/pi-ai`。不要再定义一套帧编解码器或 reducer。

针对每个可转换的非终止提供方事件，助手过程执行：

```text
convert event to frame
→ synchronously enqueue appendList(frames, frame) on the Session mutation line
→ attach the ordinary harness-fault observer to that returned promise
→ replace the process-local latestFrameWrite reference
→ emit and await the existing message event
→ consume the next provider event
```

即转换为帧，同步向 Session 变更串行通道入队 append，为返回 promise 附加常规 harness 故障观察器，替换进程内 `latestFrameWrite` 引用，发出并等待既有消息事件，然后消费下一提供方事件。

提供方循环不逐帧等待存储。同步入队保持提供方事件顺序。每个 promise 都附有故障观察器，因此替换最新引用不会使较早拒绝无人观察。有界输出使排队工作有界。流结算时，过程停止接纳帧，在 `after_response` 前等待最新 append promise；Session 变更 FIFO 保证它完成就意味着所有更早追加均完成。没有定时器、批处理器、合并器或 flush API。

标量助手 `effect_pending` 仍是权威。每次 append 的变更执行时，都验证相同操作、尝试和响应 ID 仍拥有 lane。帧从不证明请求被接纳、完成、成功或失败。

最终或合成助手结算在同一原子提交中删除精确列表，并写入不可变响应、用量、Branch tip 和下一标量状态：

```text
TX[
  insert final assistant entry,
  insert usage,
  deleteList(frames),
  setValue(operationState(operationId), nextState),
]
```

`assistant-durability.md` 定义帧转换、未知结果合成、取消、延迟轮询、快照与事件顺序。

<a id="restore-policy"></a>
## 恢复策略

标量操作状态仍是唯一重启权威：

1. 从必需标量值构造可信 lane/operation 投影；
2. 信任已提交类型化值，不审计每个引用载荷或阶段关系；
3. 过程或快照消费辅助状态时，从当前类型化标量状态推导精确绑定地址；
4. 只加载消费者需要的有界标量值或列表页。

除非消费者明确要求某元素，否则辅助列表缺失合法。列表内容绝不证明外部副作用完成。实时变更仍验证当前操作、阶段、尝试及预留身份，作为并发隔离；这不是恢复验证。

基础恢复不枚举列表。对于助手帧，只有在消费类型化助手/延迟 `effect_pending` 状态时，快照或恢复才推导 `pendingAssistantFrames(operationId, responseEntryId)`。

每个列表消费者定义：

- 地址语法；
- 元素及总字节界限；
- 页/加载预算；
- 清理转换；
- 分叉与迁移策略。

<a id="memory-backend"></a>
## Memory 后端

Memory 可以用独立映射保存当前值与列表元素：

```ts
const scalarValues = new Map<string, StoredValue<unknown>>();
const listValues = new Map<string, ListElement<unknown>[]>();

function physicalKey(address: StoredAddressBase): string {
  return `${address.namespace}\u0000${address.key}`;
}
```

- 标量 set 替换一个映射值；
- 标量 delete 删除它；
- 列表 append 压入已分配序列的元素；
- 列表 delete 删除整个数组；
- 列表 read 按排他游标过滤，再按已验证 limit 截取；
- entries、values、lists、usage、stats 发生变更前，完成事务准备。

供 JSONL/分叉工具使用的存储快照，包含当前标量值，以及保留原始序列号的存活列表元素。

<a id="sqlite-backend"></a>
## SQLite 后端

逻辑 schema 包含一张当前值表和一张列表元素表：

```sql
CREATE TABLE scalar_values (
  namespace TEXT NOT NULL,
  key       TEXT NOT NULL,
  seq       INTEGER NOT NULL,
  value     TEXT NOT NULL,
  PRIMARY KEY (namespace, key)
) WITHOUT ROWID;

CREATE TABLE list_values (
  namespace TEXT    NOT NULL,
  key       TEXT    NOT NULL,
  seq       INTEGER NOT NULL,
  value     TEXT    NOT NULL,
  PRIMARY KEY (namespace, key, seq)
) WITHOUT ROWID;
```

WP01 原地替换尚未完成的格式 4 schema：编辑 `sqlite/migrations/001_initial.sql`，把物理 `registers` 表重命名为 `scalar_values`，增加 `list_values`，保留 `SQLITE_STORAGE_VERSION = 1`。此在制实现没有迁移运行器，不支持 WP01 之前的 SQLite 文件。不要在此工作包中增加迁移机制。

列表操作：

```sql
INSERT INTO list_values(namespace, key, seq, value) VALUES (?, ?, ?, ?);

SELECT seq, value FROM list_values
WHERE namespace = ? AND key = ? AND seq > ?
ORDER BY seq ASC LIMIT ?;

SELECT seq, value FROM list_values
WHERE namespace = ? AND key = ? AND seq < ?
ORDER BY seq DESC LIMIT ?;

DELETE FROM list_values WHERE namespace = ? AND key = ?;
```

没有游标时，省略序列条件。所有写入参与现有 `BEGIN IMMEDIATE` 事务；Session 写权限所有权属于宿主生命周期，不属于 SQLite 存储。用 `EXPLAIN QUERY PLAN` 断言分页使用主键且没有临时排序。

<a id="jsonl-backend"></a>
## JSONL 后端

逻辑记录携带绑定地址的物理组成部分：

```jsonl
{"kind":"list","op":"append","seq":41,"namespace":"pi.pending.assistant_frame","key":"O:R","value":{"type":"text_delta","contentIndex":0,"delta":"hi"}}
{"kind":"list","op":"delete","seq":52,"namespace":"pi.pending.assistant_frame","key":"O:R"}
```

标量记录使用 `kind:"value"` 以及 `op:"set"|"delete"`。WP01 保留 JSONL 格式 4 和存储版本 1，但原地替换尚未完成的记录写法；不支持 WP01 之前的格式 4 文件，也不保留旧 `kind:"register"` 解码器。

重放将记录折叠为 Memory 状态：

- 标量 set 替换当前地址；
- 标量 delete 删除它；
- 列表 append 增加 `{ seq, value }`；
- 列表 delete 删除整个列表。

一个事务仍对应一个物理 JSONL 行，多条写入使用数组。因此撕裂尾部处理无需新分帧机制即可保持原子性。

<a id="snapshot-compaction"></a>
### 快照压缩

压缩按序列顺序，将保留原始 `seq` 的每个存活列表元素，与存活条目、标量值和用量行合并写出。不要把一个存活列表折叠为合成元素，也不要重新分配序列号；两者都会破坏游标与后端等价性。

已删除列表不产生快照记录。快照重写在格式 4 头中保存 `nextSeq`，以免丢弃最新 delete 后复用序列；普通只追加文件可以省略此字段，从已重放写入中推导。

<a id="forks-and-rewrites"></a>
## 分叉与重写

分叉和精确重写代码按具体地址语法决定策略：

- 操作拥有的 `pi.op.*` 标量值不复制到空闲分叉；
- 分叉不复制不可变 `pi.result` 操作记录；
- 不复制 `pi.pending.entry`、`pi.pending.tool_output`、`pi.pending.assistant_frame` 的值/列表；
- lane 及语义会话值遵循既有范围规则；
- 通用分叉不复制应用定义的值/列表；消费功能若依赖应用状态复制，必须先增加显式的地址专用策略。

精确重写保留列表元素时，保留其 `seq`，除非显式重映射整个目标序列空间。

<a id="schema-evolution"></a>
## Schema 演进

绑定地址的 namespace、key 语法、kind 和值类型属于持久 schema：

- 改 namespace 或 key 语法，需要显式地址迁移；
- 标量改列表或列表改标量，需要显式迁移；
- 存储绝不根据观察到的记录推断或强制转换 kind；
- 修改 TypeScript 值形状、且旧存储值不兼容时，需要完整值迁移；
- 列表迁移按序列分页，要么保留 `seq` 映射元素，要么删除整个列表；
- 迁移不得一次加载无界逻辑列表。

增加通用列表存储会原地替换当前在制后端 schema。构造尚无持久值的新应用地址无需迁移。

<a id="instrumentation-and-telemetry"></a>
## 埋点与遥测

带埋点的存储装饰器提供基于地址的读取 API，并按精确事务顺序记录已提交的类型擦除写入。

遥测 session-write 条目种类区分标量值写入和列表写入。遥测 schema 允许时，可以将 namespace/key 名作为属性，但值、助手帧、prompt 和工具输出绝不进入遥测。

append 路径测试证明追加提交前没有 `readList`。帧持久化 promise 始终附加 harness 故障观察器，即使较早 promise 已不再是最新结算顺序引用。

<a id="invariants"></a>
## 不变量

1. 在同一存储版本中，一个绑定地址有稳定的 namespace/key/kind 和一个可信值类型。
2. 地址对象身份没有持久语义。
3. 契约保留 `pi` 和全部 `pi.*`；每个内置命名空间以 `pi.` 开头，应用使用它属于可信代码编程缺陷。
4. 恰好五个内置前缀构造器封装 Branch 清单与操作清理语法；结果只供命名空间范围内的 `scanValues()` 使用。
5. 标量与列表地址不能占据相同物理位置；这是可信代码编程规则，不是运行时跨 kind 冲突检查。
6. 类型化读取和通过辅助函数构造的写入保留 `T`。
7. 标量辅助函数拒绝列表地址；列表辅助函数拒绝标量地址。
8. 地址构造后，Session/Storage 操作绝不再要求第二个 key。
9. 每个列表元素不可变，并携带其全局唯一已提交写入 `seq`。
10. 所有后端按序列顺序返回同一列表地址的元素。
11. append 不读取目标列表。
12. 标量/列表写入与同事务的条目、用量原子提交。
13. 整列表 delete 后，该地址不留元素。
14. 不存在和空列表都读为 `[]`。
15. 基础恢复只依赖必需标量状态，不枚举辅助列表。
16. 辅助列表从不确立副作用完成，也不选择重启状态。
17. JSONL 压缩保留存活元素序列。
18. 终止清理不留下操作拥有的标量值或列表。

<a id="required-tests"></a>
## 必需测试

<a id="address-typing-and-identity"></a>
### 地址类型与身份

- `value<T>()`、`list<T>()` 以不变方式保留声明的 `T`；
- 标量读取推导绑定地址的值类型；
- 列表读取推导元素类型；
- `setValue` 在编译期拒绝不兼容值；
- `appendList` 在编译期拒绝不兼容元素；
- 标量辅助函数拒绝列表地址，列表辅助函数拒绝标量地址；
- 独立构造的相等地址访问相同持久位置；
- 同一物理地址的不兼容定义，作为编程缺陷记录并测试；
- 空 key 可用，空 namespace 和含分隔符的组成部分被拒绝；
- 核心和应用使用同一 `value()`、`list()` 构造器，无私有构造器、权限令牌、注册表或目录；
- 内置地址构造器产生精确的 `pi.branch.tip`、`pi.lane.*`、`pi.op.*`、`pi.pending.*`、`pi.session.name`、`pi.entry.label` namespace/key/kind 三元组；
- 每个内置命名空间以 `pi.` 开头，应用夹具使用非保留命名空间；
- `branchTipInventoryPrefix()` 绑定空 key 的 `pi.branch.tip` 清单前缀，仅通过 `scanValues` 枚举 Branch；
- 工具参数前缀覆盖一个操作、可选一个 step；工具 memo 前缀覆盖一个操作、可选一次 invocation；准备数据与工具输出前缀精确覆盖一个操作；
- 每个前缀构造器结果只供 `scanValues` 使用，没有清单或清理调用手工构造原始保留命名空间；
- 应用地址无需声明合并或核心目录即可使用；
- Storage 或 Session 操作均不接受额外 key 参数。

<a id="scalar-regression"></a>
### 标量回归

- set/get/delete/recreate 行为不变；
- 替换仅保留最新逻辑值和最近 set 的 `seq`；
- 类型化写入辅助函数保留混合事务顺序；
- 前缀扫描将绑定地址 key 解释为前缀，且限于命名空间内；
- 新标量 JSONL/SQLite 文件只使用 value/list schema；明确不支持 WP01 之前的在制文件。

<a id="list-conformance"></a>
### 列表一致性

扩展共享后端一致性套件：

- 追加一个元素并分页读取；
- 同事务向同地址多次追加；
- 被无关写入隔开的追加，仍保留列表内顺序；
- 每个元素获得独立全局写入 `seq`；
- 升序与降序排他游标；
- 默认、显式、非法及截断上限的 limit；
- 不存在的列表返回 `[]`；
- 删除整列表及删除不存在列表；
- 同事务先 delete 后 append；
- 后续写入非法时回滚；
- 列表、条目、用量、标量组合事务保持原子性；
- Memory、JSONL、SQLite 返回相同页和游标；
- JSONL 撕裂的多写入事务不暴露任何列表元素；
- JSONL 重放和压缩保留游标；
- SQLite 分页使用主键，无临时排序；
- append 不读取列表；
- 基础恢复无需列表读取即可构造可信标量投影，之后按消费需要有界加载；
- close 拒绝后续读取，并履行已接纳提交。

<a id="application-surface"></a>
### 应用接口

- 应用级标量 get/set 无需额外 key；
- 应用级列表 read/append 无需额外 key；
- 应用可显式构造按工作区区分的动态地址；
- Storage 和 Session 接受相同地址对象，推导相同类型；
- Session 直接写入串行执行且只提交一次；
- 显式 `Session.mutate()` 可以将类型化值/列表写入与条目、用量原子组合。

<a id="assistant-frame-integration--deferred-beyond-wp01"></a>
### 助手帧集成——延期至 WP01 之后

- 每个转换后的非终止帧追加到精确绑定的 effect-pending 响应地址；
- 终止 `done`/`error` 事件不追加；
- append 同步入队，不对提供方施加背压；
- 每个帧写入 promise 都有已观察的故障路径；
- 为结算排序仅保留最新 promise 引用；
- 等待最新 promise 意味着所有更早追加完成；
- 归约分页重建与不中断流相同的部分消息；
- 列表缺失恢复为没有持久部分内容；
- 最终/合成结算原子删除帧列表；
- 未知副作用恢复只读由当前标量状态推导的有界列表；
- 外部终结删除操作拥有的列表；
- 空闲分叉不含帧列表；
- 后端字节增长随追加线性增长，而不是反复写快照造成的增长。

<a id="implementation-map"></a>
## 实现分布

预期主要变更：

- 用 `packages/agent/src/harness/session/values.ts` 替换 `session/registers.ts`，放入地址、构造器、类型化写入辅助函数及内置地址构造器；
- 从 `session/types.ts` 删除 `RegisterValues`、命名空间联合、register 令牌类型及原始 namespace/key 读取签名；
- 通过 Storage、SessionReader、SessionMutator、Session 暴露 `ValueReader`；
- Session 通过绑定地址提供直接的应用标量/列表方法；
- 更新 Memory 状态、JSONL 编解码/存储、快照、分叉/重写代码、埋点与一致性套件；
- 原地替换 SQLite 尚未完成的初始 schema，改为 `scalar_values`、`list_values`；保留存储版本 1，不增加迁移运行器；
- 更新遥测 schema 源并重新生成 `telemetry-schema.md`；不要手工编辑生成文件。

WP01 仅完成通用地址/存储及只恢复投影的覆盖。`assistant-durability.md` 规定之后的消费生命周期；助手执行、延迟轮询、恢复、快照加载、memo/检查点能力及操作清理，只随各自运行时工作包落地。

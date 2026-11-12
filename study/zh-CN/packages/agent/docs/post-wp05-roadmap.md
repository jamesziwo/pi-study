> 中文阅读版；原文路径：`packages/agent/docs/post-wp05-roadmap.md` · [英文原文](../../../../../packages/agent/docs/post-wp05-roadmap.md) · [阅读索引](../../../README.md)
> 对应提交：`eccca93e642558afbdba3b122cb11f5cbbf66f08` · 原文 SHA-256：`2dba08e6aaffc7e8317b1e1c8a35cf3f390cc1bdc7cb7634902c80f26ab72c36`
> 正文译为中文，代码示例及其中注释保留英文；命令和路径按原项目解释。本页仅供阅读，不代表执行其中操作；历史设计和研究结论不等于当前运行时保证。

<a id="post-wp05-roadmap-audit"></a>
# WP05 之后的路线图审计

**审计基线：** `5507d76ee`（`dev`，2026-08-27）。

**状态：** 这是规划事项清单，不是行为契约。[`harness.md`](../../../../../packages/agent/docs/harness.md) 中与当前产品边界一致的内容仍是规范。必须明确解决下列矛盾；本文不会暗中选择其中一方。

<a id="scope-and-method"></a>
## 范围与方法

本次审计覆盖持久化 AgentHarness，以及与其直接耦合的 Session 后端和呈现路径：

- `packages/agent/src/harness`、`packages/agent/src/search` 及其测试和文档；
- `packages/session-backends/sqlite-node`；
- 当前 `packages/protocol`、`packages/client`、`packages/server` 的呈现路径；
- 承载该路径的 `packages/coding-agent/src/experimental` 及其专项测试；
- `packages/telemetry`、`packages/ai`、`packages/agent` 中的遥测基础设施。

清单已对照当前源码、测试、各包 README、完整 `harness.md`、WP00–WP07 的完成状态、可执行的 WP08 交接文档、明确的桩实现/TODO/跳过项以及已发布的包边界检查。如果当前源码和已完成的 WP05 契约已取代历史交接内容，就不再将后者算作待办。

<a id="executive-result"></a>
## 审计结论

WP05 已完成至 M10。剩余助手输出工作归属[移动端助手输出交接文档](../../../../../packages/agent/docs/mobile-handoff/01-harness/05-assistant-output/message-update.md)及其编号前置任务。当前 Harness 执行图没有未完成的运行路径：`watchSession()` 是唯一仍为 `SliceNotImplemented` 的 Harness 方法。

这**并不**意味着周边持久化系统已经完整。其余审计发现如下：

1. 规范要求 JSONL 快照压缩，但没有实现；
2. 一个必需的 Harness 方法仍是桩（`watchSession`）；
3. 有意删除的原始 `RemoteSession` 与之后 WP06/`harness.md` 的规范性描述冲突；
4. 公开搜索类型只有骨架，与较新的搜索设计冲突，且没有实现；
5. 遥测定义了完整词汇，但生产代码只创建工具钩子 span；
6. 仓库、客户端 watch、查询边界、文档和端到端测试还有较小缺口。

在审计基线之后，WP07 完成了 SQLite 宿主所有权对齐及活动源分叉支持；历史交接文档见 [`work-packages/07-sqlite-host-ownership-live-forks.md`](../../../../../packages/agent/docs/work-packages/07-sqlite-host-ownership-live-forks.md)。独立的具名分支、整树状态及有界内存分叉重设计现在由 WP08 负责，可执行交接文档见 [`work-packages/08-named-branch-streaming-forks.md`](../../../../../packages/agent/docs/work-packages/08-named-branch-streaming-forks.md)。

<a id="required-missing-functionality-and-contract-contradictions"></a>
## 必需但缺失的功能及契约矛盾

<a id="r12--session-wide-harness-watch"></a>
### R12——覆盖整个 Session 的 Harness watch

**证据**

- `src/harness/agent-harness.ts` 公开了 `AgentHarness.watchSession(context)`。
- `src/harness/runtime/harness.ts` 中的 `Harness.watchSession()` 抛出 `SliceNotImplemented("watchSession")`。
- `SessionSnapshot` 当前只包含 `{ lanes: LaneInfo[]; faulted: boolean }`。
- `src/harness/events.ts` 和 `src/harness/runtime/lane.ts` 已提供 lane watch、事件缓冲、投递尾部屏障及 `resnapshot()`。

**剩余边界**

为动态 lane 清单与故障状态定义一致的捕获和折叠机制。决定有意保持精简的 `SessionSnapshot` 是继续精简，还是增加会话元数据、统计及全局配置。然后实现先快照后事件、lane 创建、重新获取快照、监听器重入、关闭/故障行为；若承诺仅靠事件即可复制状态，还需实现会话 reducer。

**依赖**

独立于移动端助手输出交接及 SQLite 内部实现。应先完成它，再构建依赖它的带修订版本的 Transcript 服务或远程全会话观察功能。

<a id="jsonl-snapshot-compaction"></a>
### JSONL 快照压缩

**证据**

`harness.md` §1.7 规定：通过临时文件加重命名压缩快照，保留序列高水位和列表游标，打开时检查阈值，并在删除终态/结果数据后回收空间。`JsonlStorage` 已实现原子创建、撕裂尾部修复、旧版 v3 重写、追加及分叉快照，但没有当前状态快照重写，也没有无效字节统计。

**影响**

被替代的 `pi.op.state`、已删除的待处理载荷、工具检查点和助手帧列表，会无限期保留为物理字节。通用压缩与[移动端助手输出交接](../../../../../packages/agent/docs/mobile-handoff/01-harness/05-assistant-output/message-update.md)相互补充：压缩在事后回收会话作用域内失效的写入历史；交接方案则将待处理助手/工具输出移入临时作用域，使其根本不进入主日志历史，并用 Chord 操作批次替换全量/逐帧复制。

**依赖**

助手输出交接不依赖 J1：作用域存储负责待处理输出的预期生命周期，而 J1 仍负责回收已被替代的会话作用域状态。应独立衡量两者，避免混淆效果。

<a id="remote-session-contract-contradiction--decision-required"></a>
### Remote Session 契约矛盾——需要决策

**当前产品边界**

提交 `f8a6e670d` 有意删除 `RemoteSession`、原始 Session RPC 协议及服务端变更作用域管理器，改用由 attachment 边界隔离的路由语义服务。当前 protocol/server README 明确指出，真正的 `Session` 和 `AgentHarness` 对象只存在于进程内。已发布路径支持 Session 发现、创建、附着，主 lane 的 prompt/watch，以及允许列表中的插件服务调用；不会通过 RPC 暴露 `Session`、`SessionMutation`、值/列表、分支或存储。

**冲突的契约**

删除之后编写的 WP06 要求使用“当前无 key 的 RemoteSession 变更传输”，把远程 begin/read/commit/publication/end 列入必需测试和停止条件，并禁止删除该机制。`harness.md` §§2.8、9.1 同样要求本地和远程实现保留此生命周期。但在审计基线中，没有相应实现、协议 schema、客户端门面、服务端持有的作用域、worker 适配器或一致性测试。

**所需决策**

安排实现之前，必须选择一项：

1. **仍有意让 Session 限于进程内：** 从当前规范文档删除不实的 RemoteSession 要求，保留语义服务 RPC；或者
2. **必须提供 RemoteSession：** 安排独立工作包，覆盖变更 begin/read/commit/end、断连/超时清理、先发布后结束、值/列表/分支/条目/统计、协议验证、客户端/服务端/worker 适配器及远程一致性测试。

不要把当前 lane-watch 兼容 RPC 或插件服务 RPC 算作 RemoteSession。不要原样恢复已删除的 507 行门面：它早于无 key 的 Session/Branch 契约，并大量依赖无类型解码。

<a id="telemetry-contract-exceeds-implementation"></a>
### 遥测契约超出实现范围

**证据**

`src/harness/telemetry.ts` 和生成的 `docs/telemetry-schema.md` 声明了 `pi.ai.request`、operation、checkpoint、turn、step、tool、hook、sleep、event-handler、session-write 等 span。生产源码只启动 `pi.harness.hook`，且仅针对已注册的 `before_tool`/`after_tool` 处理器。AI 选项传递 `telemetryContext`，但没有提供方路径启动 `pi.ai.request`。服务端请求入口支持取消，却没有 trace carrier 或客户端/服务端 RPC span。传输/worker 生命周期与事件投递边界仍留有 `TODO_CONTEXT`。

**剩余边界**

拆为独立工作包处理：

1. 本地 Harness/Session/AI 埋点及运行时测试；
2. RPC trace carrier 与客户端/服务端传播；
3. 由应用选择的可选 exporter/适配器。

先确认是否仍需要每一种已声明 span。保留则实现；不保留则删除没有支持的公开 schema，并修正 `harness.md`。不要将遥测与 Context/RPC 取消混在一起；后者已有独立的请求 ID 信号机制。

<a id="s3--search"></a>
### S3——搜索

**证据**

`src/search/index.ts` 导出公开的 `SessionSearchService` 骨架，含 `sync()`、`notify()` 及返回数组的 `searchEntries()`。而 `harness.md` §2.8 规定的是独立服务、分离的追赶同步/通知工具、感知 generation 的游标，以及可选的 `AsyncIterable` 条目搜索。当前没有工厂、同步工具、游标存储、投影或源码中的 SQLite FTS 实现。审计基线中的 SQLite README 曾宣传并不存在的 `createSqliteSessionSearch()` 行为；本次审计修正了 README，而没有把缺失 API 当作已经实现。

**剩余边界**

实现之前，先替换或协调公开接口草案，并决定元数据过滤（`cwd`）、候选集限制或索引元数据的方案。在排序并应用 `limit` 之后再过滤是不正确的。然后实现独立追赶同步和单独的 SQLite FTS5 投影；不要给 repository 增加搜索方法。

<a id="r11--schema-migrations-activation-gated"></a>
### R11——按启用条件触发的 schema 迁移

当前不需要格式 4 的迁移。Memory 只处理当前格式；JSONL 和 SQLite 拒绝不支持的存储版本；SQLite 仅运行幂等的 `001_initial.sql`。格式 4 稳定后，首次引入不兼容的持久存储版本、地址或状态变更之前，才必须启动 R11。它不是移动端助手输出交接或当前在制格式替换的前置任务。

启用时，必须在独占所有权下提供按顺序、事务性的打开时迁移，提供按版本区分的 JSONL 解码和迁移后压缩，并完整映射每个可达的未结束操作叶节点以及保留下来的值/列表。

<a id="correctness-and-data-safety-debt"></a>
## 正确性与数据安全欠账

<a id="sqlite-host-ownership-and-live-source-forks--completed-by-wp07"></a>
### SQLite 宿主所有权与活动源分叉——WP07 已完成

权威产品规则位于 `plugins.md`：恰好一个由宿主指定的进程拥有 Session 写权限；通常是 Session worker，但服务端可以临时拥有新建或分叉目标，随后关闭并移交。存储后端不实现写者所有权。执行破坏性仓库管理前，服务端先关闭 worker。

SQLite 现在遵循该规则：写者租约 schema/模块、申领、续租定时器、租约失效路径和提交前回调均已删除，未引入替代锁或所有权原语。create/open/fork/delete 保留仓库内 ID 预留。元数据打开和删除使用真正不创建文件的读写模式；列举及外部分叉源使用不创建文件的只读连接。

同仓库分叉保留源 `commitQueue` 的排序衔接点。对于由其他位置持有的源（包括活动 worker），通过一个独立、只读、延迟开启的 WAL 事务，从其精确的规范化容器路径读取。针对单文件与共享容器的专项测试，会在读者建立快照之后、关闭之前，提交一个完整的后续源事务：第一次分叉完全排除它，之后的分叉则完整包含它。

WP07 还完成了规范化 `(containerPath, sessionId)` 活动身份、安全的显式 ID 文件名、自定义 `databasePath` 父目录创建、以 Session 为范围的共享容器删除、WAL/SHM 清理，以及等待全部结果的 SQLite 仓库关闭。可写打开/删除拒绝外来元数据；外部分叉源只能从其精确路径只读访问。`createdAt` 相同的列举结果仍无确定性的次级排序，留待后续保持行为的清理工作。

<a id="repository-close-ownership-is-unspecified"></a>
### 仓库关闭时的所有权未定义

`JsonlSessionRepo.close()` 含 Agent 源码中唯一仍有效的 TODO，且不会关闭任何已打开的 Session 句柄。Memory 仍使用快速失败的 `Promise.all`；SQLite 已对当前打开的句柄执行后端内等待全部结果的清理，但已获准执行的 create/open/fork 仍可能在仓库关闭捕获句柄集合后注册新句柄。`SessionRepo` 本身不声明 `close()`，共享一致性测试也未定义仓库对句柄的所有权，或如何等待已接纳的仓库操作结束。应通过一个仓库生命周期工作包统一解决所有权与清理；未决定共同契约前，不要继续单独修补某个后端。

<a id="client-watch-staleness-after-disconnect"></a>
### 断连后客户端 watch 过期

断连时 `Client` 会清空活动 watch 监听器映射，但现有 `LaneWatch` 对象保留本地 `ready`/`started` 状态和旧 watch ID。重新连接/附着后，它们仍可能调用 `start()` 或 `resnapshot()`，随后在远端失败，而不是按 `packages/client/README.md` 所述确定性地拒绝过期对象。服务订阅对象有类似问题：监听器被清空，存活对象悄然失效。用连接/附着代次隔离修复两者，并补充专项重连测试。此项独立于 R12：当前客户端方法只是主 lane watch 的兼容接口。

<a id="query-bounds-and-sqlite-bind-limits"></a>
### 查询边界与 SQLite 绑定参数限制

- SQLite `getEntries(ids)` 为每个请求 ID 生成一个占位符，可能超过引擎的变量数量限制。
- 条目、用量和分支的 limit 临时采用 `Math.max(0, limit)`。Memory 与 SQLite 对 `NaN`、无穷大、小数和极端值的行为不同；与列表读取不同，这里没有共享的规范化契约。

先在 Agent 一致性测试中定义跨后端查询 limit 语义，再将 SQLite ID 查询分块。这是存储契约加固工作包，不属于 WP07。

<a id="harness-contract-and-conformance-closure"></a>
### Harness 契约与一致性收尾

- 公开 `OperationStatus` 含 `"running"`，但 lane 检查、快照和 `reduceLaneSnapshot` 当前只产生 `"open"` 或 `"aborting"`。应定义并实现其产生路径，或删除无用变体。
- 重写前的 abort 契约先绑定/发布 `operation_abort`，再兑现取消 promise 并向活动 gate 发信号。当前 `Lane.command()` 先实化结果（兑现/发信号），再构造并绑定事件批次，尽管仍会在释放 Session 变更串行通道前绑定接收者。应决定修改实现，还是保留并记录当前不会交错的顺序；增加明确的顺序测试。
- 生产 gate-close 契约仅允许 `HarnessClosed | HarnessFault`，但私有源码原语接受任意 `Error`，独立测试也使用更宽类型。应收窄声明和测试夹具，或明确保留私有范围内的放宽。
- `harness.md` 第 9 部分是必需的一致性矩阵。现有专项测试广泛覆盖执行图，包括全部 13 个叶节点的取消协调；但没有经过审计的一一对应证据，证明每种关闭/重开叶节点场景及每个竞争行都覆盖两种确定性顺序。应审计矩阵，只补缺失场景，而不是笼统宣称全部完成。

此工作包应与遥测、RemoteSession 及移动端助手输出交接分开；它只处理本地契约/测试收尾。

<a id="disabled-real-worker-persistence-regression"></a>
### 被禁用的真实 worker 持久化回归测试

`packages/coding-agent/test/experimental-remote-runtime.test.ts` 仍跳过“通过 worker 所有的 Harness 完成并持久化 prompt”，理由是已过时的“有运行时无工具执行后重新启用”。现在已有无工具执行。应重新启用，或改为使用确定性模拟提供方的真实 worker 持久化测试；不要调用真实付费提供方。

<a id="performance-debt"></a>
## 性能欠账

<a id="mobile-assistant-output-handoff--durable-and-replication-amplification"></a>
### 移动端助手输出交接——持久化与复制放大

用户提供、位于仓库外的动机样例 mini Session 为 303,920 字节，共 569 个物理行。这些外部测量是证据，不是已入库的可复现夹具：

- 477 次助手帧追加，序列化写入约 118,418 字节；
- 12 次帧列表删除；提及帧命名空间的物理行总计 148,214 字节；
- 被替代的 `pi.op.state` 写入约 51,568 字节，一次结构准备约 26,192 字节，说明通用 JSONL 压缩和帧专用限界是不同问题。

权威设计见[移动端助手输出交接](../../../../../packages/agent/docs/mobile-handoff/01-harness/05-assistant-output/message-update.md)，按 [`mobile-handoff/README.md`](../../../../../packages/agent/docs/mobile-handoff/README.md) 中 `01-harness` 的编号前置项推进。Chord 增量跟踪已落地；作用域存储、工具输出集成和助手输出集成尚未落地。

实现必须增加确定性的仓库夹具和测量脚本，以复现或替代上述数据；随后测量 Memory 逻辑元素、SQLite 行/页/WAL、JSONL sidecar/主日志峰值字节以及重开/重放时间。交接方案必须保留未知结果恢复、调用隔离、非阻塞提供方流式输出及结算后退役，同时消除逐帧持久写入和二次方增长的 `message_update` 复制。数值预算应放在实现交接文档/测试中，不应另起相互竞争的独立设计。

<a id="sqlite-branch-divergence"></a>
### SQLite 分支分歧

`createDivergentBranchForEntry()` 复制最新压缩点之后的每一行；若没有压缩，则从根复制至父节点。因此，对很长且未压缩的转录首次分叉，需要 O(history) 次写入。这暴露出 `harness.md` §2.6 的内部矛盾：开头承诺的有界前缀，与其自身基于压缩点的复制算法冲突，而实现遵循了后者。应同时修改规范与 segment 表示，使分叉可以在父节点边界引用一个覆盖该范围的 segment。保留共享容器支持，并增加大规模未压缩分叉以及链结构正确性的测试/基准。

<a id="fork-contract-and-materialization--wp08-actionable"></a>
### 分叉契约与实化——WP08 可执行

当前所有后端都会实化与源等规模的分叉快照。分支范围默认 `main`，没有具名 Branch 祖先验证；整树范围遗漏应用值/列表；JSONL 对已关闭源进行分叉重放时可能修复源。WP08 将替换为强制指定具名分支或整树范围、单一且封闭的内置状态策略、整树分叉包含完整当前应用状态，以及按后端实现的有界内存复制流程。保留 WP07 的宿主所有权、物理身份、同仓库顺序及独立活动源 WAL 边界。

<a id="sqlite-catalog-statements-stats-and-reclamation"></a>
### SQLite 目录、语句、统计与回收

- 默认每会话一个文件的 `list()` 会串行、同步地打开和配置每个 SQLite 文件，且静默跳过失败。共享容器或外部目录才是可扩展部署选择；有界异步调度不能让 `DatabaseSync` 变成非阻塞。
- 多数热点查询每次都重新 prepare 语句。测量后再缓存由明确局部所有者持有的语句。
- 每条用量记录都会解析并重写完整的聚合用量 JSON。
- 删除共享容器中的行不会回收页。维护/VACUUM 策略应另行定义，不要随意在普通删除中加入 `VACUUM`。

这些是可测量的优化/运维工作包，不是正确性修复。

<a id="pending-payload-amplification-and-mutation-line-parallelism"></a>
### 待处理载荷放大与变更通道并行

排队载荷有意写入两次，即 `pendingEntry → immutable entry`；修改前先测量极端载荷。按 key 划分的 Session 变更通道仍是可选项，需要性能分析及重新审计可变状态所有权。两者都不是当前正确性工作。

<a id="behavior-preserving-cleanup-and-documentation-repair"></a>
## 保持行为的清理与文档修复

本次审计已完成：

- 重写 SQLite README 中并不存在的 `SqliteSessionRepository`/搜索 API、错误的 `await using` 和 `appendMessage` 示例、FTS 触发器/重建描述，以及“一个共享连接”的说法；
- 协调 `harness.md` 默认单文件 SQLite 的描述与实际支持的可选共享容器；
- 使 `harness.md` 第 8 部分与本审计一致，并修正 `telemetry.md` 过时的驱动所有权/RPC 取消状态；
- 修正 coding-agent 设置文档：安装级遥测配置也会控制部分提供方的归因请求头。

剩余清理：

- **Harness 自有 DTO 边界：** 持久化 Harness 仍从 `src/types.ts` 导入旧 agent-loop DTO：`AgentMessage`、`AgentToolResult`、`AgentToolCall`、`AgentTool`、`QueueMode`、`ThinkingLevel`。后续一次性切换到独立的 `HarnessMessage`、`CustomHarnessMessages`、`HarnessToolResult`、`HarnessToolCall`、`HarnessQueueMode`、`HarnessThinkingLevel` 定义；保留 `AgentHarnessTool` 作为可执行 Harness 配置类型。一起更新 Harness 内部、根导出、声明合并测试、文档和 experimental coding-agent 消费方。不要将新消息/工具 DTO 别名指回旧类型，否则会保留本项要移除的耦合。
- 保留共享容器支持，不要顺带删除。
- 删除或使用闲置的 `insertEntryRow()`、`insertUsageLedgerRow()`。
- 先用正确性测试固定两条路径，再合并重复的 SQLite 分支载荷/结构扫描基础代码。
- 删除 schema 前，先决定闲置的 `sessions.metadata` 和未经测量的索引是否有未来负责方；不要随意改 schema。
- 只有决定保留遥测接口后，才合并 `startAiSpan()`/`startHarnessSpan()` 实现。
- 历史持久化文档若仍写得像实施队列，应标记为已交付。WP00–WP07、`runtime-simplification.md`、`values.md` 中旧消费方延期事项及外部最终化设计，都不是当前运行时待办。

<a id="optional-or-deferred-product-capabilities"></a>
## 可选或延期的产品能力

以下事项不阻塞持久化 Harness：

- API 决策之后的独立 S3 搜索；
- 移除 Accounts，并产出带修订版本的 Transcript；
- 为实验性本地服务端提供经认证的工作区/客户端授权；
- 私有返回引用、服务流控、多窗格呈现、插件内核/重载收尾，以及版本偏差协商；
- 管理用精确重写工具；
- 分区 Postgres 后端/保留策略；
- 通用远程 Harness/对象能力；
- 在具体快照压力足以证明需要之前引入 DeltaState 或增量复制；
- 生产遥测 exporter；
- 在不兼容的已稳定格式变更触发 R11 之前实施 schema 迁移。

<a id="recommended-dependency-order"></a>
## 建议的依赖顺序

先按数据安全，再按依赖排序。只有不修改相同契约时，独立路线才可并行。

1. **Harness 契约/一致性收尾。** 解决 `OperationStatus.running`、abort 信号/事件绑定顺序、gate-close 类型及第 9 部分覆盖矩阵。
2. **Remote Session 决策（仅决策）。** 尽早解决错误的规范边界。选择进程内则修文档；选择原始 RemoteSession 则之后创建独立协议/客户端/服务端/worker 工作包，不并入遥测或 R12。
3. **客户端 watch/订阅过期**及**仓库生命周期契约。** 两个较小且独立的正确性工作包；扩展服务端/worker 生命周期语义前完成。生命周期工作包还必须解决 Memory 仓库关闭的快速失败问题。
4. **[移动端 Harness 交接](../../../../../packages/agent/docs/mobile-handoff/README.md)。** 按编号前置项推进作用域存储、工具输出和助手输出；保留全部恢复边界，并落地确定性的放大测量。
5. **JSONL 快照压缩。** 实现已有规范要求的物理回收路径，以及剩余会话作用域历史的指标。
6. **R12 全会话 watch。** 构建带修订版本的 Transcript/全会话远程观察之前，完成唯一的 Harness 桩方法。
7. **若保留遥测：** 先协调 schema，再本地埋点、RPC 传播，最后可选 exporter。RPC 传播应在 Remote Session/产品边界决策之后。
8. **WP08——具名分支与流式分叉。** 按可执行交接文档实现，不重新讨论 WP07 的所有权或生命周期决策。
9. **SQLite 分支/查询性能加固。** 与已完成的 WP07 所有权对齐及 WP08 分叉语义分开；必须提供基准。
10. **S3 搜索。** 先决定 API、过滤、游标，再实现追赶同步和独立 FTS 投影。
11. **R11 迁移。** 紧邻首次不兼容的已稳定持久 schema 变更之前启动，不提前。

<a id="stop-conditions-for-roadmap-accuracy"></a>
## 路线图准确性的停止条件

任一事实变化时，都必须更新清单：

- `watchSession` 不再是唯一的 Harness `SliceNotImplemented` 方法；
- 原始 RemoteSession 被重新安排实现，或从规范契约移除；
- JSONL 快照压缩落地；
- 遥测 schema 已实现或移除；
- S3 公开 API 已协调；
- 持久格式变化触发 R11；
- WP08 落地，或其分叉契约发生变化；
- 宿主权限契约发生变化。

> 中文阅读版；原文路径：`packages/agent/docs/runtime-simplification.md` · [英文原文](../../../../../packages/agent/docs/runtime-simplification.md) · [阅读索引](../../../README.md)
> 对应提交：`eccca93e642558afbdba3b122cb11f5cbbf66f08` · 原文 SHA-256：`1bf746b56adf8588ce348d0936c696737614fd88946e213a44b9fc19e8029238`
> 正文译为中文，代码示例及其中注释保留英文；命令和路径按原项目解释。本页仅供阅读，不代表执行其中操作；历史设计和研究结论不等于当前运行时保证。

<a id="existing-agentharness-runtime-simplification"></a>
# 现有 AgentHarness 运行时简化

<a id="scope"></a>
## 范围

重构 packages/agent/src/harness/runtime/ 下真实实现，以及 session/types.ts 中的标准持久类型，不是隔离的临时试验。

执行图已完整覆盖，公开 drive 已启用。格式 4 仍在开发中，因此替换持久类型无需迁移或兼容表示。

<a id="implementation-status"></a>
## 实现状态

M6 前完成时的测量：简化前 eb1185d93 为 5,358 行 TypeScript；首次简化后 417905647 为 4,667 行；简化基础层 0e77e57d9 为 4,654 行；共减少 704 行，即 13.1%。

简化阶段已实现：

- 显式 ContinueOperationResult<T> 和 cancel_requested，替代隐式 undefined。
- 生成、延迟轮询、工具调用均采用准备不可变输入、发布持久意图、执行副作用、发布持久结果的具体阶段。
- 共用助手流协议消费及 Drive 响应生命周期。
- publishResponse 统一助手/延迟结果发布，publishConfigurationFailure 统一相同的意图前配置失败转换。
- 源顺序工具结果发布、一次读取的不可变来源校验，以及在 tool-placement.ts 中共用批次重建。
- 移除同调用工具状态防御、未经检查的 toolOperation() 转型及其结果联合；保留真实兄弟并发、进度和 memo 检查。
- 集中 lane 存储分类，避免重复投影读取。
- 删除检查点无效检查并精确保留检查点。
- 在 runtime/transcript.ts 共用对话历史机制。
- 缩小 LanePatch，移除冗余 Drive Promise 完成标志及未使用的操作拒绝分支。

完成时最大文件为 lane.ts（约 996 行）、tools.ts（663）、checkpoint.ts（452）、response.ts（417）。

<a id="wp05-structural-status"></a>
### WP05 结构化执行状态

M6 在简化基础上建立结构化执行，首个完整阶段增加：共用的以压缩边界限定的上下文/历史读取和已提交条目事件装饰；由调用方拥有的单次提供方请求接口，用于压缩和分支摘要，同时保留旧非 harness 调用方重试行为；structural.ts 中各结构 at 叶子的直接过程；每触发一次的阈值路由及原子溢出准备发布；逐请求结构意图与用量提交、尝试重试/恢复、钩子决策、压缩/导航发布和终止清理；覆盖阈值/溢出、分割轮次用量、生成与钩子结果、重试/上限/恢复、模型缺失、请求中持久取消、导航和准备数据损坏的聚焦测试。

随后 R1a、R2、R3 将排队输入移至 lane，用不可变操作记录替代初始化后的类别结果，并把类别笛卡尔积压缩为 13 个中性叶子。R1b 用共用原子边界规划器、基于历史推导的阈值保护及队列外 finish-hook 重新规划，替代过渡检查点排空与标记字段。M7 移除 drained 控制，增加原子排空并返回的取消，协调全部 13 叶子，并安装完整直接分派器。

M8 增加 lane 基础/便捷接口、一个有序带标签 inbox、空闲所有权、快照/事件复制、reduceLaneSnapshot 和远程重取快照；M9 协调规范；M10 为普通提供方转发由 Session 元数据 ID 和 lane 名组成的唯一稳定身份，结构摘要保持全新请求身份。M10 完成时，runtime 为 7,410 行，drive 为 4,147，lane.ts 为 1,992，structural.ts 为 1,221，新规范归约器为 193 行。相对已评审 M7，公开接口和复制层增加 1,130 行，持久 13 叶子过程模型不变。

保持可见的持久顺序：prepare → publish intent → perform effect → publish outcome。不要引入通用 Procedure 接口、运行器、调度器、图、回调计划或依赖门面。历史工作包文档保持不变。

<a id="core-model"></a>
## 核心模型

Lane 是覆盖一个持久 lane 投影的进程内 actor。

- Lane.state 是 tip、配置、当前操作、控制、inbox ID 和最新操作 ID 的权威。
- 每个支持的变更通过 Session 串行队列提交，并在释放前发布匹配的 Lane.state。
- 一个 lane 拥有的 Drive 是推进操作状态的唯一写者。
- 同操作调用者观察同一 Drive，无调用者拥有它。
- 安装 Drive 后，调用取消只停止该调用者的观察。
- requestAbort 是唯一持久操作取消入口。
- close 封闭变更接纳，不修改操作状态或替换 Drive。
- 进程丢失销毁所有实时续体，附着后从持久状态恢复。
- 执行中 Session 读取只取 Lane.state 指定内容，不重新发现控制状态。

<a id="durable-state"></a>
## 持久状态

OperationState 只有 at 一个判别字段，包含 13 个直接叶子：starting、checkpoint、assistant.ready、assistant.effect_pending、assistant.retry_wait、tools、deferred.suspended、deferred.effect_pending、summary.deciding、summary.ready、summary.effect_pending、summary.retry_wait、navigation.ready_to_commit。

每个叶子携带统一 OperationScope。摘要四态携带一个 SummaryTask，其封闭 ResultBoundary 选择运行内检查点恢复、独立完成或导航提交；摘要算法从边界推导，不在状态中重复。Control 保持正交。ToolBatch 仍是子状态机，因为并行工具子任务确实会并发修改兄弟调用状态。

<a id="state-and-content-boundary"></a>
## 状态与内容边界

过程不得读取 laneState、operationMeta、operationState、branchTip、laneConfig、operationResult 地址来决定执行，而应使用变更队列提供的当前 Lane.state。

存储读取仅用于内容和清理：提示、助手、延迟来源、最终助手和已完成工具条目；压缩边界内分支上下文；pendingEntry 载荷；助手帧列表；工具参数、memo、检查点；结构准备；暂存工具结果；终止清理需要的操作拥有前缀扫描。

<a id="concurrency-model"></a>
## 并发模型

<a id="operation-advancement"></a>
### 操作推进

Drive 过程存活期间，没有支持的并发 actor 能改变或移除其操作状态：inbox 方法只改 inbox；requestAbort 只改 control；close 阻止后续接纳；同操作调用加入现有 Drive；lane 忙时不能接纳另一操作；进程崩溃则移除续体本身。

所以普通转换不重复检查操作存在性、ID、种类、at、尝试身份或嵌套状态。这些是分派建立的前置条件，不是受支持的竞争。

真实竞争仍包括：副作用接纳或提交前取消；检查点路由或终止前 inbox 到达；并行工具子任务暂存和物化兄弟结果；排队帧/检查点/memo 写入与结果提交；重试定时器与取消/关闭；延迟许可消费；Session 队列上的 accept/claim 串行化。

<a id="cancellation-boundaries"></a>
### 取消边界

只在三处检查取消：drive 循环普通分派前；外部副作用即将启动的门控；副作用结果提交时读取当前 control 并提交相应取消结果。

普通转换辅助函数可在 control 为 cancel_requested 时集中拒绝推进，过程不手工重复该分支。

<a id="close"></a>
### 关闭

关闭 harness 时：标记 harness/lane 接纳关闭；封闭并排空 Session 变更队列；通过关闭观察 Promise 拒绝客户端观察；持续观察分离的 pass Promise，避免后续拒绝无人处理；已接纳变更排空后关闭 Session。

close 不进行持久写入、不安装替代 Drive、不创建失去所有权状态。晚返回副作用的变更会被 HarnessClosed 拒绝。是否同时向进程内提供方/工具发送信号，属于资源清理策略，不是持久状态机行为，不应与 Drive 替换或恢复耦合。

<a id="small-concrete-mutation-api"></a>
## 小而具体的变更 API

用两个具体 Lane 操作替代过程内重复 LaneCommand 样板；它们不是调度器、图或动作解释器。

<a id="continueoperation"></a>
### continueOperation

用于普通非终止推进：进入 Session 队列；接收权威 Lane 投影和操作状态；已取消时不调用语义规划器，直接返回明确 cancel_requested；规划器给出过程专用写入、完整下一状态、物化和事件；辅助函数追加标准 operationState 写入并发布对应进程内投影；不验证预期状态或 at。

<a id="settleoperation"></a>
### settleOperation

用于已接纳提供方/工具/结构副作用之后，以及真实并行子转换：即使已取消也进入队列；向语义规划器提供当前 control/inbox 及进程内结果；原子提交载荷、用量、tip 移动、清理和分类后的下一状态；追加标准状态写入并发布投影；规划器返回终止决策时，追加不可变 operationResult、带 lastOperationId 的空闲 laneState 及空闲进程内投影。

调用方提供类型化结果、清理/发布写入、最终结果和事件；终止业务决策仍在所属过程中可见。

<a id="durable-procedure-shape"></a>
## 持久过程形式

带副作用的过程暴露四个具体阶段：

```text
prepare immutable inputs
→ publish durable effect intent
→ perform the external effect
→ publish one durable outcome
```

意图阶段必须可见且先于外部副作用，否则副作用之后、意图之前崩溃会没有可恢复的结果未知标记。各过程使用 prepareGeneration、publishGenerationIntent、performGeneration、publishResponse 等具体函数，不使用通用 Procedure 抽象。

<a id="drive-lifecycle"></a>
## Drive 生命周期

移除安装者拥有模型：删除 installerSignal、DriveAbandoned、LostOwnership/lost_ownership、精确对象 ABA 保护和 commandDriveOwned；除非 Flue 调查证实具体需要，否则删除 finalizedOutcome 及计划中的外部终结所有者保留。

activeDrive 只保留为 lane 的安装/加入槽位。安装将工作移交 lane，所有调用者（含安装者）都用自己的 Context 观察完成。安装前调用信号中止则不安装；安装后仅拒绝该调用者观察。pass 结束或达到持久等待后移除 Drive，进程内不替换活跃 pass。

requestAbort 保持两阶段门控顺序：

```text
beginAbort before cancellation mutation
commit cancel_requested
signalAbort after commit
```

即先 beginAbort，再提交 cancel_requested，提交后 signalAbort，防止持久标记提交期间接纳新副作用。

<a id="checks-that-remain"></a>
## 必须保留的检查

不要移除外部或引用内容校验：必需条目存在及角色；待处理载荷种类；延迟句柄身份；提供方流协议顺序；响应停止原因不变量；UUIDv7 后续条目时间戳解析；模型/工具配置可用性；工具来源索引和暂存结果身份；并行工具状态及就绪前缀放置；进度/memo 调用身份；重试时间戳和延迟许可算术。

这些检查验证数据或真实子任务并发，并非防御性重验操作状态机。

<a id="completed-staged-implementation-plan"></a>
## 已完成的分阶段实现计划

<a id="stage-1--canonical-flat-durable-types"></a>
### 阶段 1：标准扁平持久类型

文件包括 session/types.ts，runtime、restore、一致性辅助及聚焦测试中的仅编译消费者，harness.md 和工作包 05-direct-durable-drive.md。

将嵌套操作声明替换为扁平 at 联合；不使用兼容别名而保留全部持久数据；机械更新匹配，不改行为；保留 ToolBatch/ToolCall 嵌套；同次更新规范。

完成条件：npm run check 和既有聚焦运行时测试通过；标准操作状态不再有 phase.kind、generation status、deferred status 或结构决策 status。

<a id="stage-2--add-canonical-transition-operations"></a>
### 阶段 2：标准转换操作

涉及 runtime/lane.ts、runtime/types.ts 及 Lane 测试。增加 continueOperation/settleOperation 和终止后缀；统一配对持久写入与进程投影发布；集中取消分流；信任分派确定的叶子，不检查预期状态；调用点保留专用写入和事件构造。

完成条件：聚焦测试证明每次辅助提交后持久状态与 Lane.state 一致。

<a id="stage-3--convert-starting-checkpoint-and-assistant"></a>
### 阶段 3：转换 starting、checkpoint 和 assistant

涉及 checkpoint.ts、generation.ts、recovery.ts、progress.ts。移除重复操作/null/种类/状态检查及 same* 谓词；普通推进使用 continueOperation，助手提交使用 settleOperation；仅保留检查点 inbox/finish 竞争及进度通道所有权检查；若更精简，可将恢复并入 effect_pending 处理器。

完成条件：无控制状态存储读取、无重复助手状态校验，生成聚焦测试通过。

<a id="stage-4--convert-deferred-and-tools"></a>
### 阶段 4：转换 deferred 与 tools

涉及 deferred.ts、tools.ts、progress.ts。语义相同处共用助手/延迟响应条目、用量和工具计划构造；保留许可和句柄检查；移除顶层状态重验；保留逐调用工具状态合并、完成顺序暂存、源顺序放置、memo 和进度身份保护；活跃、恢复、取消使用同一个工具批次过程，不另设所有权结果路径。

完成条件：工具状态检查仅用于真实兄弟并发，延迟/工具/进度测试通过。

<a id="stage-5--remove-ownership-loss-machinery"></a>
### 阶段 5：移除失去所有权机制

涉及 runtime/types.ts、lane.ts、execution/effect-gate.ts、全部 drive/*.ts 及相关测试。移除 LostOwnership、commandDriveOwned、精确 Drive 检查、installerSignal、DriveAbandoned、finalizedOutcome；所有调用者平等观察；完成等待仅用 Context 控制观察取消；activeDrive 仅用于安装/加入仲裁；以安装/加入/观察取消测试替代 ABA/替换测试。

完成条件：生产运行时搜索不到失去所有权或安装者放弃相关术语。

<a id="stage-6--close-and-fault"></a>
### 阶段 6：关闭与故障

涉及 harness.ts、lane.ts、Drive 观察辅助及生命周期测试。封闭接纳并排空变更；关闭/故障拒绝观察，不替换 Drive 或改持久状态；观察分离 pass 失败；验证晚返回副作用无法在关闭后提交；是否发送本地副作用清理信号另行决定。

完成条件：关闭和进程丢失留下同一持久重启点；关闭路径不写取消或合成结果。

<a id="stage-7--finish-wp05-on-the-simpler-substrate"></a>
### 阶段 7：在更简单基础上完成 WP05

涉及 structural.ts、reconcile.ts、drive.ts 和 lane.ts 公开接口。基于扁平叶子及转换操作直接实现结构化生成；取消协调使用单个扁平状态 switch；完整 drive 使用单个 state.at switch；所有叶子均有完整处理后再接公开 claim/join/observation 和便捷方法。

除非 Flue 调查发现无法通过关闭、显式取消、恢复或离线管理表达的具体当前调用方，否则排除外部终结。

<a id="validation"></a>
## 验证

每个代码阶段之后：

```bash
npm run check
```

从包根运行每个修改过的聚焦测试文件，不直接运行完整 Vitest 套件。只有最后阶段使全部叶子处理完整后，才启用公开 drive。

最终审计：

```bash
rg 'lost_ownership|LostOwnership|DriveAbandoned|commandDriveOwned|installerSignal|finalizedOutcome' packages/agent/src/harness
rg 'operationState\(|laneState\(|branchTip\(|laneConfig\(' packages/agent/src/harness/runtime/drive
```

第二项可匹配写入构造器，但读取调用不得使用这些控制地址。

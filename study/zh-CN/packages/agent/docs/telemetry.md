> 中文阅读版；原文路径：`packages/agent/docs/telemetry.md` · [英文原文](../../../../../packages/agent/docs/telemetry.md) · [阅读索引](../../../README.md)
> 对应提交：`32d6520b9ecc37c999384bec962fe7ec8a6c48d1` · 原文 SHA-256：`31cd30ed04222de36ae002768ffde85db0a0dcf57aea3be6aad6bd8b2b4723c9`
> 正文译为中文，代码示例及其中注释保留英文；命令和路径按原项目解释。本页仅供阅读，不代表执行其中操作；历史设计和研究结论不等于当前运行时保证。

<a id="invocation-context-and-telemetry-design-notes"></a>
# 调用上下文与遥测设计笔记

> **状态：**设计输入，不是规范性契约。上下文原语及必填末尾 Context 已落地到 harness、会话、执行能力和托管 harness 适配器。本地传播仍属脚手架，不能证明完整遥测语义；多数运行时 span 及跨进程 trace 传播仍待设计或实现。Drive 所有权已归 harness，按 requestId 的 RPC 取消已实现，但二者都不提供分布式 trace 父子关系。接受的最终行为应归并进 harness.md；telemetry-schema.md 仍为生成的 span 名称和属性参考。

<a id="goal"></a>
## 目标

Session、Branch、AgentLane 和 AgentHarness 通过必填末尾 Context 显式接收调用范围控制数据。同一接收对象可能服务并发本地调用者或 RPC 客户端，因此不能保留可变或默认调用方上下文。

不使用 AsyncLocalStorage 的前提下，上下文要解决两个相关问题：

1. 在并发异步工作中保持正确遥测父子关系。
2. 存在 AbortSignal 时携带它，供 RPC 适配器映射为请求取消。

必须复用 @earendil-works/pi-telemetry，不引入另一套 span 抽象。

<a id="context-model"></a>
## 上下文模型

已实现的公开类型：

```ts
interface ContextKey<T> {
	readonly token: symbol;
	readonly valueType?: (value: T) => T;
}

interface Context {
	readonly abortSignal: AbortSignal | undefined;
	readonly telemetryContext: TelemetryContext;
	value<T>(key: ContextKey<T>): T | undefined;
	toString(): string;
}
```

valueType 仅为类型标记，运行时查找用键的 symbol token。createContextKey<T>(description) 创建并冻结具有唯一 token 的键。

上下文不可变，派生时创建关联父级的写时复制层。辅助函数将值放前面、父上下文放最后：

```ts
const requestContext = withAbortSignal(requestSignal, parentContext);
const spanContext = withTelemetryContext(span, requestContext);
const tenantContext = withContextValue(tenantKey, tenantId, spanContext);
```

已实现行为：

- BACKGROUND_CONTEXT 和 TODO_CONTEXT 是两个不同的空根，abortSignal 均为 undefined。
- telemetryContext 始终可用；未安装遥测值时回退到 NOOP_TELEMETRY_CONTEXT。
- withAbortSignal(signal, context) 在父级无信号时保留所给信号，否则用 AbortSignal.any() 与父信号组合。
- withCancel(context) 返回可独立取消的子上下文及 cancel(reason?)，父取消仍传播至子级。
- 类型化值用 symbol 身份和不可变写时复制层；同键新值遮蔽父值。
- 内置中止信号和遥测键为私有；调用方使用具名属性，不通过键获取。
- toString() 用于诊断，记录根及每层键描述。

上下文值是横切请求元数据，不是业务依赖。适合放入请求 ID、已认证主体、租户 ID 和诊断元数据；存储、模型、工具、持久状态和业务载荷不应放入。Context、signal、遥测对象及后端原生 span 对象绝不是持久数据。

<a id="receiver-ownership"></a>
## 接收对象所有权

共享接收对象保留身份及持久/进程状态，不保留调用上下文：

```text
AgentHarness receiver  ── no caller context
AgentLane receiver     ── no caller context
Session receiver       ── no caller context
Branch receiver        ── no caller context
```

每次调用提供自己的上下文，避免并发调用者相互覆盖遥测父级或取消信号。

代表单次进行中调用的进程内对象，可保留派生上下文，例如活跃 drive 任务或事件订阅；这不同于在共享 harness/session 接收对象上保存默认上下文。

AgentHarnessOptions.telemetryContext 已移除，因为 harness 级默认值无法表示父级不同的两个并发调用者。

<a id="existing-typed-telemetry-remains-authoritative"></a>
## 现有类型化遥测仍是权威契约

保留以下设计：TelemetryContext/TelemetrySpan；由回调拥有的 span 生命周期；AI_TELEMETRY_SCHEMA/HARNESS_TELEMETRY_SCHEMA；带类型的 span 名称、开始属性、完成属性和事件；startAiSpan()、startHarnessSpan()、createTypedSpanStarter()；适配器一致性行为。

startAiSpan()/startHarnessSpan() 向回调同时提供类型化 span 和派生调用上下文，封装 span 派生：

```ts
return startHarnessSpan(
	"pi.harness.run",
	attributes,
	async (span, runContext) => {
		return runDrive(runContext);
	},
	context,
);
```

辅助函数委托 context.telemetryContext.startSpan()，通过 withTelemetryContext(span, context) 将回调拥有的 span 安装到子上下文。下层工作必须接收该子上下文，而非父调用上下文。

不得修改上下文来安装活跃 span，也不得使用进程全局或接收对象全局的当前 span。

<a id="concurrent-parentage"></a>
## 并发父子关系

显式传播支持并发兄弟调用：

```ts
await parent.telemetryContext.startSpan({ name: "caller" }, async (callerSpan) => {
	const callerContext = withTelemetryContext(callerSpan, parent);
	await Promise.all([
		laneA.drive(optionsA, callerContext),
		laneB.drive(optionsB, callerContext),
	]);
});
```

各调用派生自己的子上下文，嵌套工作接收所属调用的子级。正确父子关系不依赖 Promise 调度或环境状态。

测试必须刻意交错并发分支，才能暴露意外的接收对象级上下文；顺序父子测试不足以证明正确性。

<a id="callbacks-hooks-and-events"></a>
## 回调、钩子与事件

作为操作一部分调用的宿主本地回调，在约定末尾位置接收当前调用上下文：

```ts
handler(event, context);
tool.execute(toolCallId, params, onUpdate, toolContext, invocation, context);
mutation(mutator, context);
```

当前传播已保留回调上下文，并为 before_tool/after_tool 处理器提供从 pi.harness.hook 派生的子上下文。扩展到所有钩子类型仍待完成；未安装钩子 span 的处理器当前直接接收操作上下文。

在 harness 进程内，事件保留触发它的上下文；缓冲事件观察器保存 `{ event, context }`。从该上下文启动 pi.harness.event_handler，并向各监听器传递子上下文，仍待完成。事件注册本身是宿主本地配置，没有操作父级。

Session 变更回调和提交接收相同的显式调用上下文。从提交调用启动 pi.session.write，再将子上下文传入存储提交，仍待实现。

<a id="drive-execution-and-joiners"></a>
## Drive 执行与等待者

多个调用者可对同一持久操作调用 drive()。仲裁决定哪个调用安装进程内执行，哪些调用加入等待。这是核心运行时问题，不是 RPC 独有问题，并发本地调用同样存在。

一次活跃执行只有一个遥测父级，其他调用者加入时不能更换父级。

```text
installer caller
└─ drive.execute
   └─ provider/tool work

joiner caller
└─ drive.join
```

等待者 span 描述该调用者的等待，至少携带 lane 名、持久操作 ID 和进程内执行 ID，最终结果可为 settled、caller_cancelled、execution_stopped 或 harness_closed。

等待者不得覆盖活跃执行上下文；通过操作/执行属性关联两个 span。span links 更适合表达此关系，但当前遥测契约没有 links。是否加入它属于遥测包的可选设计问题，不应因此发明多个父级。

分布式 trace 允许执行 span 比安装者 RPC span 活得更久。子 span 开始后，父子可重叠，并按任意顺序结束。

<a id="invocation-cancellation-versus-durable-cancellation"></a>
## 调用取消与持久取消

调用信号中止属于进程内控制，不表示请求了持久取消。

```text
context.abortSignal is present and aborts
→ stop only that caller's observation; an installed lane-owned Drive continues
→ do not write cancel_requested
→ preserve the same durable operation state
```

两个空根暴露的 undefined abortSignal 表示调用没有取消信号。只有 requestAbort()/abort() 写入持久 cancel_requested，并允许持久 aborted 结束状态。

运行时必须跟踪停止原因，不能把所有中止的提供方响应都解释成持久取消：

```ts
type ExecutionStopCause =
	| "no_drive_waiters"
	| "invocation_cancelled"
	| "harness_closed"
	| "durable_cancel_requested";
```

只有 durable_cancel_requested 能规范化并提交持久 aborted 结果。调用或断线中止时，若持久控制仍为 running，就不能提交助手 stopReason 为 aborted 的结束状态，否则违反持久状态机。

Drive 所有权已明确归 **harness**：安装后，即使调用者取消或断线，执行仍持续到持久完成或等待、显式持久取消、关闭、故障或进程丢失。等待者信号只控制自己的观察，不得把无关等待者信号用 AbortSignal.any() 合并后直接附到共享执行上。一个等待者取消不能取消其他所有调用者。

<a id="rpc-trace-propagation"></a>
## RPC trace 传播

客户端和服务器 span 可属于同一分布式 trace：

```text
caller
└─ rpc.client
   └─ rpc.server
      └─ harness/session operation
```

客户端不序列化 TelemetryContext，而是从 rpc.client span 注入与后端无关的 trace carrier。服务器将其提取为新的本地 TelemetryContext，并从中启动 rpc.server。

需要面向传输的适配器边界：

```ts
interface TelemetryPropagation {
	inject(context: TelemetryContext): JsonValue | undefined;
	extract(carrier: JsonValue | undefined): TelemetryContext;
}
```

生产实现可以使用 W3C traceparent/tracestate。当前遥测包尚无 carrier 注入/提取 API，因此需决定适配器属于遥测包、RPC 基础设施还是后端集成包；仍必须复用现有 TelemetryContext span 契约。

RPC 取消和遥测传播是独立控制通道：trace 元数据重建父子关系；requestId 加取消/断线消息控制服务器请求信号；两者都不出现在序列化方法参数中。

<a id="interface-migration-scaffolding"></a>
## 接口迁移脚手架

接收对象方法现在使用必填末尾 Context。具体实现、调用、回调适配器及对象字面量门面均已迁移，不仅依赖接口可赋值性。

TODO_CONTEXT 仍是临时迁移标记，不是语义根。当前使用集中在尚无法重建调用上下文的传输和 worker 边界，尤其是 Pi 协议请求入口和 worker RPC 入口。BACKGROUND_CONTEXT 表示有意不使用调用者上下文。

继续单独清点 TODO_CONTEXT。仅当边界能构造请求本地取消上下文及遥测父级时才替换；改成 BACKGROUND_CONTEXT 会掩盖未完成传播。编译通过仍不能证明遥测或取消正确。

<a id="required-tests-for-the-later-handoff"></a>
## 后续交接所需测试

当前已覆盖不可变类型值分层与遮蔽、不同空根、父子中止组合、兄弟取消隔离及工具钩子子级关系。待补覆盖包括：

- 同一共享接收对象上交错并发的遥测分支。
- 各钩子类型、工具、事件处理器及 Session 写入获得预期子上下文。
- 缓冲事件延迟交付时保留发出上下文。
- 不存在接收对象级遥测默认值。
- 预先中止的调用不启动外部副作用。
- lane 所有执行下安装者和等待者的取消隔离。
- 调用中止不改变已安装 Drive 和持久状态。
- 持久取消提交持久 aborted 结果。
- 关闭和断线不被误认为持久取消。
- 客户端到服务器的 trace 重建。
- 事件交付重建来源 trace 元数据。
- 缺失或异常 carrier 降级为 no-op/根遥测，不影响业务行为。

<a id="resolved-migration-decisions"></a>
## 已确定的迁移决策

- 接收对象方法采用一个必填末尾 Context。
- 共享 Harness、AgentLane、Session、Branch 不保留默认调用上下文。
- Context、AbortSignal、TelemetryContext 对象不跨 RPC 序列化。

<a id="open-decisions-before-the-telemetry-handoff"></a>
## 遥测交接前的未决事项

- 等待者是否需要遥测 links。
- trace carrier 适配器的归属和形式。
- 哪些上下文值可以跨 RPC，或者是否完全禁止。
- RPC 调用和 drive 加入等待的精确 span 名称及结果属性。

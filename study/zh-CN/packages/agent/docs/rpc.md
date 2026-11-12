> 中文阅读版；原文路径：`packages/agent/docs/rpc.md` · [英文原文](../../../../../packages/agent/docs/rpc.md) · [阅读索引](../../../README.md)
> 对应提交：`32d6520b9ecc37c999384bec962fe7ec8a6c48d1` · 原文 SHA-256：`089e7c850c8772f8ba21533873bd05ef8f843bc94afa63b203fc1ac26d57e4ec`
> 正文译为中文，代码示例及其中注释保留英文；命令和路径按原项目解释。本页仅供阅读，不代表执行其中操作；历史设计和研究结论不等于当前运行时保证。

<a id="facet-service-rpc"></a>
# Facet 服务 RPC

Chord 负责与应用无关的服务语义，以及可插拔的严格 JSON 连接边界。Pi 负责本文描述的具体传输封装、路由、附着状态和错误适配器。当前实现将 JsonValue 视为静态契约，不受支持值的运行时拒绝由具体序列化器完成。

> **状态：**实验性 facet 服务 RPC 语义的设计规范。

<a id="role"></a>
## 职责

provide()/use() 和 provideMany().spawn()/observe() 是 facet 系统隐藏的 RPC。facet 共享 TypeScript 服务契约，传输层承载服务与成员标识、严格 JSON 值、请求/订阅关联、带键实例的代次及绑定控制消息。宿主构建带类型的本地实现或门面；TypeScript 类型和任意对象不会跨越线路。独立加载的进程可能暂时运行不同源码代次，因此服务契约必须在支持的版本差异窗口内保持向前兼容；版本协商暂缓。

```text
session/server facet: provide() / provideMany().spawn()
                    ↕ hidden service RPC
presentation/session facet: use() / observe()
```

服务系统是扩展边界。展示 facet 接收语义服务和复制状态，不接收原始 Harness、Session、工具注册表、钩子注册表、凭据存储或存储句柄。

<a id="non-goals"></a>
## 非目标

不序列化 Context、AbortSignal、遥测对象、回调、工具、钩子、函数或任意对象图。不让核心 Harness/Session 实现感知传输机制。不让断线触发持久取消或服务拥有的工作取消。不为已限定为 JSON 的值建立逐方法编解码器。

<a id="service-contracts-and-typed-facades"></a>
## 服务契约与带类型门面

服务 token 是共享 TypeScript 契约和稳定服务 ID，不是生成的描述符，也不创建提供方。token 默认可远程发布；仅进程内使用的 token 声明 `{ local: true }`。provide() 向宿主图加入单例实现；provideMany() 在 facet setup 期间注册一个多实例服务所有者，返回 ServiceSpawner，后续 spawn() 发布实例。宿主自动发布所有非本地 provision。同一宿主服务图中的 token 只能有一种模式，混用单例和带键模式会报错。

提供方将每个暴露成员分类为方法或由 Chord 创建的 ReplicatedState，并在订阅快照中发布成员表。消费者通过普通属性访问获得成员名，例如 JavaScript Proxy 对 models.state 收到 state，对 models.refresh(context) 收到 refresh。门面绑定时，对照提供方声明的类型校验已访问的成员槽位。

本地和远程 use() 都返回稳定、延迟解析、供同一 token 的消费者共享的带类型门面。同步 setup 期间门面未连接，可以保存引用，但不能调用方法、读取状态或注册成员订阅。组装后，本地门面通过进程内实现槽位解析，远程门面通过宿主连接的服务绑定。提供方 facet 重载时，同一门面暂时不可用，随后替换目标；RPC 单例清除就绪状态，在既有订阅上安装完整替换快照，使已捕获方法和成员门面指向新实现。未绑定提供方时，方法调用失败，状态尚未初始化；不会仅因调用经过代理就自动排队。

远程方法返回 Promise，除声明的 Context 外，输入和输出均为严格 JSON。void 对应成功但无 result 字段的响应。不支持私有返回引用。客户端在传输前移除 Context，接收宿主构造新的本地上下文。Context 的契约位置由宿主控制且必须一致；示例采用必填的末尾 Context。业务缺省用 JSON null 或选项对象表达，不传输 undefined。

同时使用静态断言和运行时校验：静态检查限制远程方法与复制状态成员，运行时边界拒绝不支持的成员以及非 JSON 参数、结果和状态值。TypeScript 提供类型化门面，但不认证对端，也不创建运行时元数据。

`{ local: true }` 只移除远程发布及其传输契约限制。本地与非本地 provision 仍共用依赖账本、激活顺序、稳定单例槽位、带键实例代次、观察者取消、资源释放及提供方 facet 重载。本地单例槽位和带键注册表直接保存任意对象契约；非本地 provision 还把实现安装到远程提供方。

<a id="dependency-ledger"></a>
## 依赖账本

类型擦除不会隐藏服务身份，每个 token 在运行时保留稳定 ID。宿主用不可伪造的所有者身份创建 facet 环境，setup 阶段的服务方法向代次范围账本记录：

- provide()：单例提供。
- provideMany()：带键提供。
- use()：单例需求。
- observe()：带键需求。

facet 始终调用不带来源限定的 env.use()/env.observe()，不在调用中编码路由。setup 时返回与来源无关、未连接的句柄。setup 后，各连接返回提供方生成的服务目录，宿主将每项需求绑定到本地 provision 或恰好一个已连接提供方。方法确定模式，token 确定 ID，因此无需反射已擦除的 T，也无需手写另一份依赖列表。

首次获取或提供只能发生在 setup。后续命令、钩子和激活回调使用 setup 获取的门面、观察注册或 ServiceSpawner 能力；动态实例通过 provideMany() 返回的能力创建，晚期 spawn 不能引入未声明的 provision。

setup 后，宿主私下对照本地提供和连接目录解析需求，拒绝缺失提供方、重复远程提供及模式不匹配，并推导生命周期依赖边。尚未附着的 selected-Session 连接可暂时接受未解析需求并标为不可用；附着时根据 worker 生成目录验证，并缓存目录供后续分离代次使用。连接绑定属于代次，只包含选中的需求；失败或退役代次释放订阅，不销毁底层传输连接。内部服务图不同于模块加载器源码导入图，不是 facet 编写或可见的计划。

<a id="bindings-and-identity"></a>
## 绑定与身份

展示宿主将已连接服务器和选中 Session 的服务合并为一张图，所有 facet 使用相同的不带来源限定的环境 API。Session 服务调用不接受客户端选择的持久 sessionId；服务器负责授权并将展示端选中的 Session 绑定路由到 worker。

<a id="server-control-plane"></a>
### 服务器控制面

会话列表和管理是普通服务器单例服务，不是通用远程 Session 方法。SessionDirectory 以复制状态暴露对展示端安全的会话摘要；SessionManagement 提供 create、remove、attach、detach。TUI 或 Web facet 通过环境使用二者：

```ts
const directory = env.use(SessionDirectory);
const management = env.use(SessionManagement);
```

服务器为每条展示连接绑定一个服务提供方。工作区和客户端权限来自本地认证的连接身份，不来自摘要字段或方法参数。服务器可按客户端投影目录状态；无论如何，摘要不得暴露 owner ID、工作目录等服务器私有字段。

management.attach(sessionId, context) 改变展示宿主选中的 Session 服务。服务器关闭旧 Session 范围的请求、订阅和观察任务，将服务绑定到 worker，再初始化其单例状态和带键实例目录。所选 Session 根据连接身份授权。附着状态是报告选择及健康情况的宿主控制状态，不是目录服务；detach() 执行相同清理，但不安装替代绑定。

该路由需要宿主私有的绑定实例标识，在附着、分离、切换会话或替换故障 worker 时改变，其表示刻意不作规定。它防止旧会话的延迟帧被应用到新会话，不是 facet 可见服务值，也不能替代授权。

复制状态来源的结构身份为：

```text
(provider binding, service ID, optional instance key + generation, member name)
```

不存在可单独发现的 state ID。实例键是应用级逻辑键；关闭的键重用时，宿主拥有的 generation 改变，旧代理不能调用替代实例。requestId 标识一次传输调用，用于响应和取消。Harness/工具 invocationId 可用作实例键，如问题示例，但不能替代完整活地址中的服务、绑定和代次部分。

<a id="calls-context-and-routing"></a>
## 调用、上下文与路由

调用携带选择提供方绑定、服务、可选带键实例和成员所需的控制信息，以及请求 ID、JSON 参数和 trace carrier。服务器可解析控制字段来路由 Session 调用，但不解析 facet 业务载荷或加载其契约。服务端点校验成员和值，创建请求本地的中止控制器与 Context，安装已认证身份，再调用本地实现。

客户端将 context.abortSignal 映射到该请求的取消。断线取消该连接的活跃调用并关闭订阅；两者均不取消服务拥有的工作，也不写入持久 Harness 取消状态。逐客户端请求关联传至 worker，避免不同展示端的 requestId 冲突。

<a id="replicated-state-and-keyed-instances"></a>
## 复制状态与带键实例

ReplicatedState 是权威最新值复制，不是事件历史、持久存储、CRDT 或多写者状态。冷副本 value 为 undefined，初始化前订阅仅登记监听器，不立即调用。初始化先原子安装完整快照，再交付更新，因此不存在快照/更新间隙。初始化后 value 同步可读，订阅先报告当前值再报告后续更新。首次快照回调使用新的初始化上下文；已初始化副本使用新的本地交付上下文，不保留原始写入上下文。状态值是借用的不可变 JSON，不做防御性克隆；调用方不得修改或长期保留。

远程初始化使用以订阅为父级的新交付上下文；更新则根据来源 trace 元数据重建上下文。断线、撤回提供方、替换和路由切换清除就绪状态。重连或替换时先装入完整快照，再交付更新。传输层缓冲与初始化竞争的更新并检查序列；确认、流控和缺口恢复是独立协议机制。

observe() 用于发现带键实例，不是装有代理的 ReplicatedState。它将完整初始目录与有序新增、替换、移除事件协调一致。每个实例的初始状态成员完成初始化后，才启动观察任务。关闭实例时拒绝新调用，仅中止该实例观察任务，允许已接纳调用完成。Session facet 代次关闭时，env.observe() 注册会中止旧任务；替代代次根据新目录重新协调。

<a id="private-returned-references"></a>
## 私有返回引用

初始服务契约不包含私有返回引用。可发现的活实例优先用带键服务；具体功能若需要调用方私有的远程身份，必须显式传递引用，而非通过 observe() 发现，并限定到接收者和提供方绑定。

此设计不包含通用 Harness 投影。原始 Harness、Session、lane、工具、钩子和存储对象保留为本地权限能力。未来若需远程回调或通用对象能力，应另行定义明确协议和策略，不作为服务 RPC 的扩展。

<a id="context-cancellation-and-telemetry"></a>
## 上下文、取消与遥测

每个远程方法收到新的本地 Context；发送方对象、信号、遥测实现和任意类型值均不跨线路传输。客户端将中止信号映射到请求并注入 trace carrier；端点构建请求本地的中止信号及遥测父级。取消经服务器转发到 Session worker，按客户端加 requestId 隔离。

span 关系：

```text
caller
└─ rpc.client
   └─ rpc.server
      └─ service implementation
```

三个取消域必须分离：中止单次 RPC；通过 job.cancel() 等显式取消服务拥有的工作；通过 requestAbort() 等持久取消 Harness。传输取消和断线只执行第一种。超出调用生命周期的工作必须分离为服务拥有的任务，并具有独立控制器和遥测根。

<a id="security-and-lifecycle"></a>
## 安全与生命周期

只有已加载且未标记 local 的服务 token 可注册到远程边界。只有所属 ServiceSpawner 可创建实例。local 服务不可被远程发现，可使用不受限对象契约。远程提供方校验成员种类，具体序列化器保证业务值为 JSON。客户端不能将普通值伪装成控制封装、选择实例代次、在服务调用中切换到其他 Session 路由，或取消其他客户端请求。

服务器认证连接、授权附着，并在服务 Context 中重建客户端身份。普通业务参数不携带权限。凭据、提示词、补全结果、工具数据、文件系统内容及其他敏感值，需要明确的展示安全契约。

facet 环境拥有注册、添加的服务实例、观察以及通过 own() 显式注册的资源。连接绑定拥有传输订阅和活跃请求控制器。已接纳入站调用不附着到提供方 facet 生命周期：撤回提供方会拒绝新调用，但旧 facet 停用时，已接纳方法仍可继续。提供方自身的 Session 工作继续存活，除非其生命周期策略停止它。

<a id="tests"></a>
## 测试

面向 facet 的语义通过回环及分帧传输测试：

- setup 依赖账本所有权、拒绝晚期获取、本地/远程 use、带键提供方所有权、模式校验、token 驱动发布、延迟成员访问、替换后的稳定单例门面，以及 local 服务远程不可达。
- 严格 JSON 边界、方法上下文重建及请求取消隔离，不序列化 Context 值。
- 服务器/Session facet 隔离、选中 Session 切换、旧帧拒绝、worker 侧逐客户端请求关联。
- 冷态及初始化后的 ReplicatedState、快照/更新无竞争、新交付上下文，以及断线、重连、替换时清除和重新初始化。
- 实例目录初始化、有序协调、观察任务前状态初始化、基于代次拒绝旧实例，以及关闭或切换时清理任务。

附加测试覆盖已认证附着与身份、遥测传播、流控和缺口恢复，以及问答和共享评审应用模式。新增私有引用时，需单独覆盖生命周期及隔离。

<a id="open-protocol-mechanics"></a>
## 尚未确定的协议机制

具体调用、取消、订阅、快照/更新、带键实例、不可用和替换帧定义在 packages/protocol/src/protocol.ts。提供方与命名空间层负责成员分类、延迟门面、缓冲和排序。

仍未确定的包括确认、流控、序列缺口恢复、可能新增引用后的回收、协议版本协商，以及未来多面板展示如何表示多个选中 Session。单例提供方替换必须继续在既有订阅上安装完整替换快照，以保留方法和状态成员槽位身份。

<a id="example-directory-and-selected-session"></a>
## 示例：目录与选中会话

目录和管理服务是普通服务器服务，契约仅携带对展示端安全的值：

```ts
interface SessionSummary {
	serverId: string;
	sessionId: string;
	createdAt: string;
}

interface SessionDirectory {
	readonly state: ReplicatedState<{ revision: number; sessions: SessionSummary[] }>;
}

interface SessionManagement {
	create(options: { id?: string }, context: Context): Promise<SessionSummary>;
	remove(sessionId: string, context: Context): Promise<void>;
	attach(sessionId: string, context: Context): Promise<void>;
	detach(context: Context): Promise<void>;
}

const SessionDirectory = defineService<SessionDirectory>("pi.session-directory");
const SessionManagement = defineService<SessionManagement>("pi.session-management");
```

服务器 facet 从已认证 Context 推导客户端，授权请求的 Session，并完成绑定转换：

```ts
serverContext.provide(SessionDirectory, { state: directoryState });
serverContext.provide(SessionManagement, {
	async attach(sessionId, context) {
		const client = requireClientIdentity(context);
		authorizeSession(client, sessionId);
		await attachments.bind(client.clientId, sessionId, context);
	},
	async detach(context) {
		await attachments.unbind(requireClientIdentity(context).clientId, context);
	},
});
```

展示 facet 渲染和选择 Session：

```ts
setup(env) {
	const directory = env.use(SessionDirectory);
	const management = env.use(SessionManagement);
	const tui = env.use(Tui);

	tui.commands.register("sessions.switch", async (operation) => {
		const snapshot = directory.state.value;
		if (snapshot === undefined) return;
		const sessionId = await tui.select(
			"Sessions",
			snapshot.sessions.map((session) => ({ label: session.sessionId, value: session.sessionId })),
			{ signal: operation.abortSignal },
		);
		if (sessionId !== undefined) await management.attach(sessionId, operation);
	});
}
```

同一展示宿主的另一个 facet 使用选中 Session 的模型服务：

```ts
setup(env) {
	const models = env.use(Models);
	// After attach() settles, `models` addresses the selected worker.
}
```

展示端不会以选中的 sessionId 路由 models；宿主按服务 token 路由，传输层保留 selected-Session 绑定。服务器先关闭旧绑定资源，再初始化新绑定。

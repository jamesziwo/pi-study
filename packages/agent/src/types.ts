import type {
	Api,
	AssistantMessage,
	AssistantMessageEvent,
	AssistantMessageEventStream,
	Context,
	ImageContent,
	Message,
	Model,
	SimpleStreamOptions,
	TextContent,
	Tool,
	ToolResultMessage,
	Usage,
} from "@earendil-works/pi-ai";
import type { Static, TSchema } from "typebox";

/**
 * Stream function used by the agent loop. `Models.streamSimple` satisfies
 * this shape.
 *
 * Contract:
 * - Must not throw or return a rejected promise for request/model/runtime failures.
 * - Must return an AssistantMessageEventStream.
 * - Failures must be encoded in the returned stream via protocol events and a
 *   final AssistantMessage with stopReason "error" or "aborted" and errorMessage.
 * 中文：智能体循环使用的流式函数；Models.streamSimple 符合此类型。
 * 契约：请求、模型或运行时失败时，不得抛异常或返回被拒绝的 Promise；必须返回 AssistantMessageEventStream。
 * 失败须通过流中的协议事件和最终 AssistantMessage 表达，最终消息需包含
 * stopReason 为 error 或 aborted，以及 errorMessage。
 */
export type StreamFn = (
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;

/**
 * Configuration for how tool calls from a single assistant message are executed.
 *
 * - "sequential": each tool call is prepared, executed, and finalized before the next one starts.
 * - "parallel": tool calls are prepared sequentially, then allowed tools execute concurrently.
 *   `tool_execution_end` is emitted in tool completion order after each tool is finalized,
 *   while tool-result message artifacts are emitted later in assistant source order.
 * 中文：配置同一条助手消息中多个工具调用的执行方式。
 * sequential：每个调用完成准备、执行和收尾后，才开始下一个调用。
 * parallel：按顺序准备调用，再并发执行获准的工具；每个工具收尾后按完成顺序发出 tool_execution_end，
 * 随后才按助手原始消息中的顺序发出工具结果消息。
 */
export type ToolExecutionMode = "sequential" | "parallel";

/**
 * Controls how many queued user messages are injected when the agent loop reaches a queue drain point.
 *
 * - "all": drain and inject every queued message at that point.
 * - "one-at-a-time": drain and inject only the oldest queued message, leaving the rest queued for later drain points.
 * 中文：控制循环到达队列取出点时注入多少条排队的用户消息。
 * all：取出并注入所有排队消息；one-at-a-time：只取出并注入最早的一条，其余留待后续取出点处理。
 */
export type QueueMode = "all" | "one-at-a-time";

/** A single tool call content block emitted by an assistant message. */
// 中文：助手消息中发出的单个工具调用内容块。
export type AgentToolCall = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;

/**
 * Result returned from `beforeToolCall`.
 *
 * Returning `{ block: true }` prevents the tool from executing. The loop emits an error tool result instead.
 * `reason` becomes the text shown in that error result. If omitted, a default blocked message is used.
 * 中文：beforeToolCall 的返回结果。返回 { block: true } 会阻止工具执行，循环改为发出错误工具结果。
 * reason 作为错误结果的文本；省略时使用默认的阻止执行提示。
 */
export interface BeforeToolCallResult {
	block?: boolean;
	reason?: string;
	/**
	 * Hint that the agent should stop after the current tool batch when this call is blocked.
	 * Early termination only happens when every finalized tool result in the batch sets this to true.
	 * 中文：此调用被阻止时，建议智能体在当前工具批次后停止。
	 * 只有该批次每个定稿后的工具结果都将此值设为 true，才会提前终止。
	 */
	terminate?: boolean;
}

/**
 * Partial override returned from `afterToolCall`.
 *
 * Merge semantics are field-by-field:
 * - `content`: if provided, replaces the tool result content array in full
 * - `details`: if provided, replaces the tool result details value in full
 * - `isError`: if provided, replaces the tool result error flag
 * - `usage`: if provided, replaces the tool result usage
 * - `terminate`: if provided, replaces the early-termination hint
 *
 * Omitted fields keep the original executed tool result values.
 * There is no deep merge for `content`, `details`, or `usage`.
 * 中文：afterToolCall 返回的局部覆盖结果，按字段分别合并。
 * 提供 content 或 details 时，整体替换对应内容数组或详情值；isError 替换错误标志，
 * usage 替换用量，terminate 替换提前终止提示。省略的字段保留执行结果原值。
 * content、details 和 usage 均不进行深度合并。
 */
export interface AfterToolCallResult {
	content?: (TextContent | ImageContent)[];
	details?: unknown;
	isError?: boolean;
	/** Usage from the final tool execution itself, if available. Not used for main LLM context accounting. */
	// 中文：最终工具执行本身的用量（如果可用），不计入主模型上下文的用量统计。
	usage?: Usage;
	/**
	 * Hint that the agent should stop after the current tool batch.
	 * Early termination only happens when every finalized tool result in the batch sets this to true.
	 * 中文：建议智能体在当前工具批次后停止。
	 * 只有该批次每个定稿后的工具结果都将此值设为 true，才会提前终止。
	 */
	terminate?: boolean;
}

/** Context passed to `beforeToolCall`. */
// 中文：传入 beforeToolCall 的上下文。
export interface BeforeToolCallContext {
	/** The assistant message that requested the tool call. */
	// 中文：请求此次工具调用的助手消息。
	assistantMessage: AssistantMessage;
	/** The raw tool call block from `assistantMessage.content`. */
	// 中文：assistantMessage.content 中的原始工具调用块。
	toolCall: AgentToolCall;
	/** Validated tool arguments for the target tool schema. */
	// 中文：已通过目标工具 schema 校验的参数。
	args: unknown;
	/** Current agent context at the time the tool call is prepared. */
	// 中文：准备工具调用时的智能体上下文。
	context: AgentContext;
}

/** Context passed to `afterToolCall`. */
// 中文：传入 afterToolCall 的上下文。
export interface AfterToolCallContext {
	/** The assistant message that requested the tool call. */
	// 中文：请求此次工具调用的助手消息。
	assistantMessage: AssistantMessage;
	/** The raw tool call block from `assistantMessage.content`. */
	// 中文：assistantMessage.content 中的原始工具调用块。
	toolCall: AgentToolCall;
	/** Validated tool arguments for the target tool schema. */
	// 中文：已通过目标工具 schema 校验的参数。
	args: unknown;
	/** The executed tool result before any `afterToolCall` overrides are applied. */
	// 中文：应用任何 afterToolCall 覆盖之前的工具执行结果。
	result: AgentToolResult<any>;
	/** Whether the executed tool result is currently treated as an error. */
	// 中文：当前是否将该工具执行结果视为错误。
	isError: boolean;
	/** Current agent context at the time the tool call is finalized. */
	// 中文：工具调用收尾时的智能体上下文。
	context: AgentContext;
}

/** Context passed to `shouldStopAfterTurn`. */
// 中文：传入 shouldStopAfterTurn 的上下文。
export interface ShouldStopAfterTurnContext {
	/** The assistant message that completed the turn. */
	// 中文：完成本轮的助手消息。
	message: AssistantMessage;
	/** Tool result messages passed to the preceding `turn_end` event. */
	// 中文：传给此前 turn_end 事件的工具结果消息。
	toolResults: ToolResultMessage[];
	/** Current agent context after the turn's assistant message and tool results have been appended. */
	// 中文：追加本轮助手消息及工具结果之后的智能体上下文。
	context: AgentContext;
	/** Messages that this loop invocation will return if it exits at this point. Prompt runs include the initial prompt messages; continuation runs do not include pre-existing context messages. */
	// 中文：若循环在此退出，本次调用将返回的消息。提示请求包含初始提示消息；续跑不包含上下文中原有的消息。
	newMessages: AgentMessage[];
}

/** Replacement runtime state used by the agent loop before starting another provider request. */
// 中文：循环在发起下一次模型提供方请求之前使用的替换运行时状态。
export interface AgentLoopTurnUpdate {
	/** Context for the next provider request. */
	// 中文：下一次模型提供方请求使用的上下文。
	context?: AgentContext;
	/** Model for the next provider request. */
	// 中文：下一次模型提供方请求使用的模型。
	model?: Model<any>;
	/** Thinking level for the next provider request. */
	// 中文：下一次模型提供方请求使用的推理级别。
	thinkingLevel?: ThinkingLevel;
}

export interface PrepareNextTurnContext extends ShouldStopAfterTurnContext {}

export interface AgentLoopConfig extends SimpleStreamOptions {
	model: Model<any>;

	/**
	 * Converts AgentMessage[] to LLM-compatible Message[] before each LLM call.
	 *
	 * Each AgentMessage must be converted to a UserMessage, AssistantMessage, or ToolResultMessage
	 * that the LLM can understand. AgentMessages that cannot be converted (e.g., UI-only notifications,
	 * status messages) should be filtered out.
	 *
	 * Contract: must not throw or reject. Return a safe fallback value instead.
	 * Throwing interrupts the low-level agent loop without producing a normal event sequence.
	 * 中文：每次模型调用前，将 AgentMessage[] 转换为模型兼容的 Message[]。
	 * 每条消息必须转换为模型能理解的 UserMessage、AssistantMessage 或 ToolResultMessage；
	 * 无法转换的消息（如仅用于界面的通知、状态消息）应过滤掉。
	 * 契约：不得抛异常或拒绝 Promise，应返回安全的回退值；抛异常会中断底层循环，无法产生正常事件序列。
	 *
	 * @example
	 * ```typescript
	 * convertToLlm: (messages) => messages.flatMap(m => {
	 *   if (m.role === "custom") {
	 *     // Convert custom message to user message
	 *     // 中文：将自定义消息转换为用户消息。
	 *     return [{ role: "user", content: m.content, timestamp: m.timestamp }];
	 *   }
	 *   if (m.role === "notification") {
	 *     // Filter out UI-only messages
	 *     // 中文：过滤仅用于界面的消息。
	 *     return [];
	 *   }
	 *   // Pass through standard LLM messages
	 *   // 中文：原样保留标准模型消息。
	 *   return [m];
	 * })
	 * ```
	 */
	convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

	/**
	 * Optional transform applied to the context before `convertToLlm`.
	 *
	 * Use this for operations that work at the AgentMessage level:
	 * - Context window management (pruning old messages)
	 * - Injecting context from external sources
	 *
	 * Contract: must not throw or reject. Return the original messages or another
	 * safe fallback value instead.
	 * 中文：在 convertToLlm 之前对上下文执行可选变换。
	 * 适用于 AgentMessage 层面的操作，如管理上下文窗口（裁剪旧消息）或注入外部来源的上下文。
	 * 契约：不得抛异常或拒绝 Promise；应返回原消息或其他安全的回退值。
	 *
	 * @example
	 * ```typescript
	 * transformContext: async (messages) => {
	 *   if (estimateTokens(messages) > MAX_TOKENS) {
	 *     return pruneOldMessages(messages);
	 *   }
	 *   return messages;
	 * }
	 * ```
	 */
	transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;

	/**
	 * Resolves an API key dynamically for each LLM call.
	 *
	 * Useful for short-lived OAuth tokens (e.g., GitHub Copilot) that may expire
	 * during long-running tool execution phases.
	 *
	 * Contract: must not throw or reject. Return undefined when no key is available.
	 * 中文：为每次模型调用动态解析 API 密钥。适用于短期 OAuth 令牌（如 GitHub Copilot），
	 * 因为令牌可能在耗时较长的工具执行期间过期。
	 * 契约：不得抛异常或拒绝 Promise；没有可用密钥时返回 undefined。
	 */
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;

	/**
	 * Called after each turn fully completes and `turn_end` has been emitted.
	 *
	 * If it returns true, the loop emits `agent_end` and exits before polling steering or follow-up queues,
	 * without starting another LLM call. The current assistant response and any tool executions finish normally.
	 * This callback sees the completed-turn context and runs before `prepareNextTurn`.
	 *
	 * Use this to request a graceful stop after the current turn, e.g. before context gets too full.
	 *
	 * Contract: must not throw or reject. Throwing interrupts the low-level agent loop without producing a normal event sequence.
	 * 中文：每轮完整结束且已发出 turn_end 后调用。返回 true 时发出 agent_end，
	 * 在检查引导或后续消息队列之前退出，不再发起模型调用；当前助手响应和工具执行正常完成。
	 * 回调获得已完成轮次的上下文，并先于 prepareNextTurn 执行。
	 * 可用于要求当前轮结束后平稳停止，例如上下文即将过满时。
	 * 契约：不得抛异常或拒绝 Promise，否则底层循环会中断，无法产生正常事件序列。
	 */
	shouldStopAfterTurn?: (context: ShouldStopAfterTurnContext) => boolean | Promise<boolean>;

	/**
	 * Called after `turn_end` when the loop will continue, immediately before the next turn starts.
	 * Return replacement context/model/thinking state to affect that turn.
	 * Return undefined to keep using the current context/config.
	 * 中文：若循环将继续，则在 turn_end 之后、下一轮开始前调用。
	 * 返回替换的上下文、模型或推理状态以影响下一轮；返回 undefined 则继续使用当前上下文和配置。
	 */
	prepareNextTurn?: (
		context: PrepareNextTurnContext,
	) => AgentLoopTurnUpdate | undefined | Promise<AgentLoopTurnUpdate | undefined>;

	/**
	 * Returns steering messages to inject into the conversation mid-run.
	 *
	 * Called after the current assistant turn finishes executing its tool calls, unless `shouldStopAfterTurn` exits first.
	 * If messages are returned, they are added to the context before the next LLM call.
	 * Tool calls from the current assistant message are not skipped.
	 *
	 * Use this for "steering" the agent while it's working.
	 *
	 * Contract: must not throw or reject. Return [] when no steering messages are available.
	 * 中文：返回运行中需要注入对话的引导消息。
	 * 当前助手轮次的工具调用执行完毕后调用，除非 shouldStopAfterTurn 已提前退出。
	 * 返回的消息会在下一次模型调用前加入上下文，不会跳过当前助手消息中的工具调用。
	 * 用于在智能体工作期间调整其方向。契约：不得抛异常或拒绝 Promise；无可用消息时返回 []。
	 */
	getSteeringMessages?: () => Promise<AgentMessage[]>;

	/**
	 * Returns follow-up messages to process after the agent would otherwise stop.
	 *
	 * Called when the agent has no more tool calls and no steering messages.
	 * If messages are returned, they're added to the context and the agent
	 * continues with another turn.
	 *
	 * Use this for follow-up messages that should wait until the agent finishes.
	 *
	 * Contract: must not throw or reject. Return [] when no follow-up messages are available.
	 * 中文：返回应在智能体原本停止后处理的后续消息。没有更多工具调用和引导消息时调用。
	 * 若返回消息，则将其加入上下文，再执行一轮。适用于应等待智能体完成后再处理的消息。
	 * 契约：不得抛异常或拒绝 Promise；无可用后续消息时返回 []。
	 */
	getFollowUpMessages?: () => Promise<AgentMessage[]>;

	/**
	 * Tool execution mode.
	 * - "sequential": execute tool calls one by one
	 * - "parallel": preflight tool calls sequentially, then execute allowed tools concurrently;
	 *   emit `tool_execution_end` in tool completion order after each tool is finalized,
	 *   then emit tool-result message artifacts later in assistant source order
	 *
	 * Default: "parallel"
	 * 中文：工具执行模式，默认 parallel。
	 * sequential：逐个执行工具调用；parallel：顺序预检后并发执行获准的工具，
	 * 各工具收尾后按完成顺序发出 tool_execution_end，再按助手原始消息顺序发出工具结果消息。
	 */
	toolExecution?: ToolExecutionMode;

	/**
	 * Called before a tool is executed, after arguments have been validated.
	 *
	 * Return `{ block: true }` to prevent execution. The loop emits an error tool result instead.
	 * A blocked result can also set `terminate: true` to participate in the batch early-termination rule.
	 * The hook receives the agent abort signal and is responsible for honoring it.
	 * 中文：参数校验通过后、执行工具前调用。返回 { block: true } 可阻止执行，循环改为发出错误工具结果。
	 * 被阻止的结果也可设置 terminate: true，以参与批次提前终止判定。
	 * 此钩子收到智能体取消信号，必须自行响应取消。
	 */
	beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;

	/**
	 * Called after a tool finishes executing, before `tool_execution_end` and tool-result message events are emitted.
	 *
	 * Return an `AfterToolCallResult` to override parts of the executed tool result:
	 * - `content` replaces the full content array
	 * - `details` replaces the full details payload
	 * - `isError` replaces the error flag
	 * - `usage` replaces the tool result usage
	 * - `terminate` replaces the early-termination hint
	 *
	 * Any omitted fields keep their original values. No deep merge is performed.
	 * The hook receives the agent abort signal and is responsible for honoring it.
	 * 中文：工具执行结束后、发出 tool_execution_end 和工具结果消息事件前调用。
	 * 返回 AfterToolCallResult 可覆盖结果：content 整体替换内容数组，details 整体替换详情，
	 * isError 替换错误标志，usage 替换工具结果用量，terminate 替换提前终止提示。
	 * 省略字段保留原值，不进行深度合并。此钩子收到智能体取消信号，必须自行响应取消。
	 */
	afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
}

/**
 * Thinking/reasoning level for models that support it.
 * Note: "xhigh" and "max" are only supported by selected model families. Use model
 * thinking-level metadata from @earendil-works/pi-ai to detect support for a concrete model.
 * 中文：支持推理功能的模型所用的思考／推理级别。xhigh 和 max 仅部分模型系列支持；
 * 应使用 @earendil-works/pi-ai 的推理级别元数据判断具体模型是否支持。
 */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Extensible interface for custom app messages.
 * Apps can extend via declaration merging:
 * 中文：供应用自定义消息使用的可扩展接口。应用可通过声明合并扩展，如下例所示。
 *
 * @example
 * ```typescript
 * declare module "@mariozechner/agent" {
 *   interface CustomAgentMessages {
 *     artifact: ArtifactMessage;
 *     notification: NotificationMessage;
 *   }
 * }
 * ```
 */
export interface CustomAgentMessages {
	// Empty by default - apps extend via declaration merging
	// 中文：默认为空，由应用通过声明合并扩展。
}

/**
 * AgentMessage: Union of LLM messages + custom messages.
 * This abstraction allows apps to add custom message types while maintaining
 * type safety and compatibility with the base LLM messages.
 * 中文：AgentMessage 是模型消息与自定义消息的联合类型。
 * 这层抽象允许应用添加自定义消息类型，同时保持类型安全及与基础模型消息的兼容性。
 */
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];

/**
 * Public agent state.
 *
 * `tools` and `messages` use accessor properties so implementations can copy
 * assigned arrays before storing them.
 * 中文：智能体的公开状态。tools 和 messages 使用访问器属性，
 * 使实现方可以在存储前复制赋入的数组。
 */
export interface AgentState {
	/** System prompt sent with each model request. */
	// 中文：随每次模型请求发送的系统提示。
	systemPrompt: string;
	/** Active model used for future turns. */
	// 中文：后续轮次使用的当前模型。
	model: Model<any>;
	/** Requested reasoning level for future turns. */
	// 中文：为后续轮次请求的推理级别。
	thinkingLevel: ThinkingLevel;
	/** Available tools. Assigning a new array copies the top-level array. */
	// 中文：可用工具。赋入新数组时会复制数组的顶层。
	set tools(tools: AgentTool<any>[]);
	get tools(): AgentTool<any>[];
	/** Conversation transcript. Assigning a new array copies the top-level array. */
	// 中文：对话记录。赋入新数组时会复制数组的顶层。
	set messages(messages: AgentMessage[]);
	get messages(): AgentMessage[];
	/**
	 * True while the agent is processing a prompt or continuation.
	 *
	 * This remains true until awaited `agent_end` listeners settle.
	 * 中文：智能体处理提示请求或续跑期间为 true；直到被等待的 agent_end 监听器结束才改变。
	 */
	readonly isStreaming: boolean;
	/** Partial assistant message for the current streamed response, if any. */
	// 中文：当前流式响应中尚未完整的助手消息（如果存在）。
	readonly streamingMessage?: AgentMessage;
	/** Tool call ids currently executing. */
	// 中文：当前正在执行的工具调用 ID。
	readonly pendingToolCalls: ReadonlySet<string>;
	/** Error message from the most recent failed or aborted assistant turn, if any. */
	// 中文：最近一次失败或取消的助手轮次的错误信息（如果存在）。
	readonly errorMessage?: string;
}

/** Final or partial result produced by a tool. */
// 中文：工具产生的最终结果或部分结果。
export interface AgentToolResult<T> {
	/** Text or image content returned to the model. */
	// 中文：返回给模型的文本或图像内容。
	content: (TextContent | ImageContent)[];
	/** Arbitrary structured details for logs or UI rendering. */
	// 中文：供日志或界面渲染使用的任意结构化详情。
	details: T;
	/** Usage from the final tool execution itself, if available. Not used for main LLM context accounting. */
	// 中文：最终工具执行本身的用量（如果可用），不计入主模型上下文的用量统计。
	usage?: Usage;
	/** Names of tools introduced by this result and available from this transcript point onward. */
	// 中文：由此结果引入、从对话记录当前位置起可用的工具名称。
	addedToolNames?: string[];
	/**
	 * Hint that the agent should stop after the current tool batch.
	 * Early termination only happens when every finalized tool result in the batch sets this to true.
	 * 中文：建议智能体在当前工具批次后停止。
	 * 只有该批次每个定稿后的工具结果都将此值设为 true，才会提前终止。
	 */
	terminate?: boolean;
}

/**
 * Callback used by tools to stream partial execution updates.
 *
 * The callback is scoped to the current `execute()` invocation. Calls made after
 * the tool promise settles are ignored.
 * 中文：工具用于流式报告部分执行进展的回调，作用域仅限当前 execute() 调用。
 * 工具 Promise 完成或拒绝后发起的回调会被忽略。
 */
export type AgentToolUpdateCallback<T = any> = (partialResult: AgentToolResult<T>) => void;

/** Tool definition used by the agent runtime. */
// 中文：智能体运行时使用的工具定义。
export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> extends Tool<TParameters> {
	/** Human-readable label for UI display. */
	// 中文：供界面显示的人类可读标签。
	label: string;
	/**
	 * Optional compatibility shim for raw tool-call arguments before schema validation.
	 * Must return an object that matches `TParameters`.
	 * 中文：可选的原始工具参数兼容处理，在 schema 校验之前执行；必须返回符合 TParameters 的对象。
	 */
	prepareArguments?: (args: unknown) => Static<TParameters>;
	/** Execute the tool call. Throw on failure instead of encoding errors in `content`. */
	// 中文：执行工具调用。失败时应抛异常，不要把错误编码进 content。
	execute: (
		toolCallId: string,
		params: Static<TParameters>,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<TDetails>,
	) => Promise<AgentToolResult<TDetails>>;
	/** Recovery policy for an effect whose durable intent exists but whose outcome is unknown. */
	// 中文：操作意图已持久化、但执行结果未知时，该操作副作用的恢复策略。
	replay?: "never" | "safe";
	/**
	 * Per-tool execution mode override.
	 * - "sequential": this tool must execute one at a time with other tool calls.
	 * - "parallel": this tool can execute concurrently with other tool calls.
	 *
	 * If omitted, the default execution mode applies.
	 * 中文：单个工具的执行模式覆盖。sequential：必须与其他工具调用逐个执行；
	 * parallel：可与其他工具调用并发执行。省略时采用默认执行模式。
	 */
	executionMode?: ToolExecutionMode;
}

/** Context snapshot passed into the low-level agent loop. */
// 中文：传入底层智能体循环的上下文快照。
export interface AgentContext {
	/** System prompt included with the request. */
	// 中文：请求中携带的系统提示。
	systemPrompt: string;
	/** Transcript visible to the model. */
	// 中文：模型可见的对话记录。
	messages: AgentMessage[];
	/** Tools available for this run. */
	// 中文：本次运行可用的工具。
	tools?: AgentTool<any>[];
}

/**
 * Events emitted by the Agent for UI updates.
 *
 * `agent_end` is the last event emitted for a run, but awaited `Agent.subscribe()`
 * listeners for that event are still part of run settlement. The agent becomes
 * idle only after those listeners finish.
 * 中文：Agent 发出的事件，用于更新界面。agent_end 是本次运行最后发出的事件，
 * 但 Agent.subscribe() 中被等待的该事件监听器仍属于运行结束流程；监听器结束后才进入空闲状态。
 */
export type AgentEvent =
	// Agent lifecycle
	// 中文：智能体生命周期。
	| { type: "agent_start" }
	| { type: "agent_end"; messages: AgentMessage[] }
	// Turn lifecycle - a turn is one assistant response + any tool calls/results
	// 中文：轮次生命周期；一轮包含一次助手响应及其工具调用和结果。
	| { type: "turn_start" }
	| { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
	// Message lifecycle - emitted for user, assistant, and toolResult messages
	// 中文：消息生命周期，对 user、assistant 和 toolResult 消息发出。
	| { type: "message_start"; message: AgentMessage }
	// Only emitted for assistant messages during streaming
	// 中文：仅在助手消息的流式输出期间发出。
	| { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
	| { type: "message_end"; message: AgentMessage }
	// Tool execution lifecycle
	// 中文：工具执行生命周期。
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
	| { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
	| { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean };

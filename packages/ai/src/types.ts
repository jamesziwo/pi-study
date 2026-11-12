import type { TelemetryContext } from "@earendil-works/pi-telemetry";
import type { AnthropicOptions } from "./api/anthropic-messages.ts";
import type { AzureOpenAIResponsesOptions } from "./api/azure-openai-responses.ts";
import type { BedrockOptions } from "./api/bedrock-converse-stream.ts";
import type { GoogleOptions } from "./api/google-generative-ai.ts";
import type { GoogleVertexOptions } from "./api/google-vertex.ts";
import type { MistralOptions } from "./api/mistral-conversations.ts";
import type { OpenAICodexResponsesOptions } from "./api/openai-codex-responses.ts";
import type { OpenAICompletionsOptions } from "./api/openai-completions.ts";
import type { OpenAIResponsesOptions } from "./api/openai-responses.ts";
import type { PiMessagesOptions } from "./api/pi-messages.ts";
import type { AssistantMessageDiagnostic } from "./utils/diagnostics.ts";
import type { AssistantMessageEventStream } from "./utils/event-stream.ts";

export type { AssistantMessageEventStream } from "./utils/event-stream.ts";

export type KnownApi =
	| "openai-completions"
	| "mistral-conversations"
	| "openai-responses"
	| "azure-openai-responses"
	| "openai-codex-responses"
	| "anthropic-messages"
	| "bedrock-converse-stream"
	| "google-generative-ai"
	| "google-vertex"
	| "pi-messages";

export type Api = KnownApi | (string & {});

export type KnownImagesApi = "openrouter-images";

export type ImagesApi = KnownImagesApi | (string & {});

export type KnownProvider =
	| "amazon-bedrock"
	| "ant-ling"
	| "anthropic"
	| "google"
	| "google-vertex"
	| "openai"
	| "azure-openai-responses"
	| "openai-codex"
	| "radius"
	| "nvidia"
	| "deepseek"
	| "github-copilot"
	| "xai"
	| "groq"
	| "cerebras"
	| "openrouter"
	| "vercel-ai-gateway"
	| "zai"
	| "zai-coding-cn"
	| "mistral"
	| "minimax"
	| "minimax-cn"
	| "moonshotai"
	| "moonshotai-cn"
	| "huggingface"
	| "fireworks"
	| "together"
	| "baseten"
	| "opencode"
	| "opencode-go"
	| "kimi-coding"
	| "cloudflare-workers-ai"
	| "cloudflare-ai-gateway"
	| "qwen-token-plan"
	| "qwen-token-plan-cn"
	| "qwen-token-plan-individual"
	| "xiaomi"
	| "xiaomi-token-plan-cn"
	| "xiaomi-token-plan-ams"
	| "xiaomi-token-plan-sgp";
export type ProviderId = KnownProvider | string;

export type KnownImagesProvider = "openrouter";

export type ImagesProviderId = KnownImagesProvider | string;

export type ToolChoice = "auto" | "none";
export type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ModelThinkingLevel = "off" | ThinkingLevel;
export type ThinkingLevelMap = Partial<Record<ModelThinkingLevel, string | null>>;
export type ChatTemplateKwargValue =
	| string
	| number
	| boolean
	| null
	| {
			$var: "thinking.enabled" | "thinking.effort" | "thinking.budget";
			omitWhenOff?: boolean;
	  };

// 中文：用于限制 OpenAI 兼容服务器推理 token 数的顶层请求字段。
/** Top-level request field used to cap reasoning tokens on OpenAI-compatible servers. */
export type ThinkingTokenBudgetField = "thinking_token_budget" | "thinking_budget" | "thinking_budget_tokens";

// 中文：各思考级别的 token 预算（仅适用于基于 token 预算的提供方）。
/** Token budgets for each thinking level (token-based providers only) */
export interface ThinkingBudgets {
	minimal?: number;
	low?: number;
	medium?: number;
	high?: number;
}

// 中文：所有提供方共用的基础选项。
// Base options all providers share
export type CacheRetention = "none" | "short" | "long";

export type Transport = "sse" | "websocket" | "websocket-cached" | "auto";

// 中文：提供方作用域的环境覆盖值，优先级高于 process.env。
/** Provider-scoped environment overrides. Values take precedence over process.env. */
export type ProviderEnv = Record<string, string>;
export type ProviderHeaders = Record<string, string | null>;
export type FetchFunction = typeof globalThis.fetch;
export type SessionAffinityFormat = "openai" | "openai-nosession" | "openrouter";

export interface ProviderResponse {
	status: number;
	headers: Record<string, string>;
}

// 中文：提供方请求共用的认证、HTTP 传输和生命周期回调。
/** Authentication, HTTP transport, and lifecycle callbacks shared by provider requests. */
export interface ProviderRequestOptions<TModel = Model<Api>> {
	signal?: AbortSignal;
	// 中文：为本次逻辑请求产生的遥测数据显式指定父上下文。
	/** Explicit parent context for telemetry produced by this logical request. */
	telemetryContext?: TelemetryContext;
	apiKey?: string;
	// 中文：可选的提供方 HTTP 请求 fetch 实现，默认为 `globalThis.fetch`。无法注入自定义实现的适配器可能拒绝此选项；它不影响 WebSocket
	//  传输。
	/**
	 * Optional fetch implementation for provider HTTP requests.
	 * Defaults to `globalThis.fetch`. Provider adapters that cannot inject a custom implementation may reject it.
	 * This does not affect WebSocket transports.
	 */
	fetch?: FetchFunction;
	// 中文：提供方作用域的环境值。配置区域设置、端点占位符和代理变量等提供方选项时，这些值优先于 process.env。
	/**
	 * Provider-scoped environment values. These take precedence over process.env for
	 * provider configuration such as regional settings, endpoint placeholders, and
	 * proxy variables.
	 */
	env?: ProviderEnv;
	// 中文：可选回调，用于在发送前检查或替换提供方请求载荷。返回 undefined 表示保持载荷不变。
	/**
	 * Optional callback for inspecting or replacing provider payloads before sending.
	 * Return undefined to keep the payload unchanged.
	 */
	onPayload?: (payload: unknown, model: TModel) => unknown | undefined | Promise<unknown | undefined>;
	// 中文：收到 HTTP 响应后调用的可选回调。
	/**
	 * Optional callback invoked after an HTTP response is received.
	 */
	onResponse?: (response: ProviderResponse, model: TModel) => void | Promise<void>;
	// 中文：API 请求可附带的自定义 HTTP 头，与提供方默认值合并，调用方的值覆盖默认头。在 AWS Bedrock 中，通过 Smithy 的 `build` 阶段中间
	// 件注入，从而纳入 SigV4 签名；保留头（`x-amz-*`、`authorization`、`host`）会被静默忽略，以保持 SigV4 / bearer 认证正常
	// 。null 值会移除提供方或 API 的同名默认头。
	/**
	 * Optional custom HTTP headers to include in API requests.
	 * Merged with provider defaults; caller values override default headers.
	 * On AWS Bedrock these are injected via a Smithy `build`-step middleware so
	 * they are covered by SigV4 signing; reserved headers (`x-amz-*`,
	 * `authorization`, `host`) are silently ignored to preserve SigV4 / bearer auth.
	 * A null value suppresses a provider/API default header with the same name.
	 */
	headers?: ProviderHeaders;
	// 中文：支持该选项的提供方或 SDK 的 HTTP 请求超时，单位为毫秒。例如 OpenAI 和 Anthropic SDK 客户端默认为 10 分钟。
	/**
	 * HTTP request timeout in milliseconds for providers/SDKs that support it.
	 * For example, OpenAI and Anthropic SDK clients default to 10 minutes.
	 */
	timeoutMs?: number;
	// 中文：支持客户端重试的提供方或 SDK 的最大重试次数。例如 OpenAI 和 Anthropic SDK 客户端默认为 2 次。
	/**
	 * Maximum retry attempts for providers/SDKs that support client-side retries.
	 * For example, OpenAI and Anthropic SDK clients default to 2.
	 */
	maxRetries?: number;
	// 中文：服务器要求长时间等待时，重试前允许等待的最大毫秒数。如果服务器要求的延迟超过该值，请求立即失败，错误中包含要求的延迟，供上层重试逻辑处理并向用户说明。默认
	// 60000（60 秒）；设为 0 可取消上限。
	/**
	 * Maximum delay in milliseconds to wait for a retry when the server requests a long wait.
	 * If the server's requested delay exceeds this value, the request fails immediately
	 * with an error containing the requested delay, allowing higher-level retry logic
	 * to handle it with user visibility.
	 * Default: 60000 (60 seconds). Set to 0 to disable the cap.
	 */
	maxRetryDelayMs?: number;
}

export interface StreamOptions extends ProviderRequestOptions<Model<Api>> {
	// 中文：收到 HTTP 响应后、读取其响应体流之前调用的可选回调。
	/**
	 * Optional callback invoked after an HTTP response is received and before
	 * its body stream is consumed.
	 */
	onResponse?: (response: ProviderResponse, model: Model<Api>) => void | Promise<void>;
	temperature?: number;
	// 中文：任意采样参数，按原样合并到请求体中，位于具名请求字段之后，因此这里的同名键会覆盖前者。允许自定义 OpenAI 兼容服务器（llama.cpp、vLLM、
	// SGLang 等）接收 pi 未显式建模的参数，例如 `top_p`、`top_k`、`min_p`、`repetition_penalty`。按键覆盖
	// `Model.samplingParams`。仅由 OpenAI 兼容适配器（completions、responses、Azure responses）应用，其他
	// API 忽略。
	/**
	 * Arbitrary sampling parameters merged into the request body as-is, after the named request
	 * fields, so keys here override them. Lets custom OpenAI-compatible servers (llama.cpp, vLLM,
	 * SGLang, ...) receive parameters pi does not model, e.g. `top_p`, `top_k`, `min_p`,
	 * `repetition_penalty`. Merged over `Model.samplingParams` per key. Only applied by
	 * OpenAI-compatible adapters (completions, responses, Azure responses); other APIs ignore it.
	 */
	samplingParams?: Record<string, unknown>;
	maxTokens?: number;
	// 中文：支持多种传输方式的提供方所使用的首选传输方式。不支持此选项的提供方会忽略它。
	/**
	 * Preferred transport for providers that support multiple transports.
	 * Providers that do not support this option ignore it.
	 */
	transport?: Transport;
	// 中文：提示词缓存保留偏好，由提供方映射到其支持的值。默认值为 "short"。
	/**
	 * Prompt cache retention preference. Providers map this to their supported values.
	 * Default: "short".
	 */
	cacheRetention?: CacheRetention;
	// 中文：为支持会话缓存的提供方指定可选会话标识。提供方可将其用于提示词缓存、请求路由或其他与会话相关的功能；不支持的提供方会忽略。
	/**
	 * Optional session identifier for providers that support session-based caching.
	 * Providers can use this to enable prompt caching, request routing, or other
	 * session-aware features. Ignored by providers that don't support it.
	 */
	sessionId?: string;
	// 中文：支持 WebSocket 传输的提供方的连接超时，单位为毫秒。仅涵盖连接建立或打开握手；连接后的流空闲超时使用 timeoutMs。
	/**
	 * WebSocket connect timeout in milliseconds for providers that support
	 * WebSocket transports. This covers the connection/open handshake only;
	 * stream idleness after connection uses timeoutMs.
	 */
	websocketConnectTimeoutMs?: number;
	// 中文：API 请求中可附带的元数据。提供方提取其理解的字段并忽略其他字段。例如 Anthropic 使用 `user_id` 进行滥用追踪和限流。
	/**
	 * Optional metadata to include in API requests.
	 * Providers extract the fields they understand and ignore the rest.
	 * For example, Anthropic uses `user_id` for abuse tracking and rate limiting.
	 */
	metadata?: Record<string, unknown>;
}

export type ProviderStreamOptions = StreamOptions & Record<string, unknown>;

export interface DeferredFetchOptions extends ProviderRequestOptions<Model<Api>> {
	// 中文：提供方长轮询的最大持续时间，单位为毫秒。默认 0，表示只执行一次状态检查。
	/**
	 * Maximum provider long-poll duration in milliseconds.
	 * Defaults to 0, which performs one status check.
	 */
	wait?: number;
}

// 中文：尽力取消延迟响应时使用的请求选项。
/** Request options for best-effort deferred-response cancellation. */
export type DeferredCancelOptions = ProviderRequestOptions<Model<Api>>;

// 中文：将已知 API 映射到各提供方完整的流选项类型。来自 API 实现模块的纯类型导入在生成代码时会被擦除，因此不会妨碍 tree shaking。
/**
 * Maps known APIs to their full provider-specific stream option types.
 * Type-only imports from API implementation modules are erased at emit, so
 * this is tree-shake safe.
 */
export interface ApiOptionsMap {
	"anthropic-messages": AnthropicOptions;
	"openai-completions": OpenAICompletionsOptions;
	"openai-responses": OpenAIResponsesOptions;
	"openai-codex-responses": OpenAICodexResponsesOptions;
	"azure-openai-responses": AzureOpenAIResponsesOptions;
	"google-generative-ai": GoogleOptions;
	"google-vertex": GoogleVertexOptions;
	"mistral-conversations": MistralOptions;
	"bedrock-converse-stream": BedrockOptions;
	"pi-messages": PiMessagesOptions;
}

// 中文：某个 API 的完整流选项。已知 API 解析为其具体选项类型；自定义 API 字符串回退到通用结构。
/**
 * Full stream options for an API. Known APIs resolve to their concrete option
 * type; custom API strings fall back to the generic shape.
 */
export type ApiStreamOptions<TApi extends Api> = TApi extends keyof ApiOptionsMap
	? ApiOptionsMap[TApi]
	: StreamOptions & Record<string, unknown>;

// 中文：API 实现模块的统一流接口约定：`src/api/` 下每个模块均导出 `stream` 和 `streamSimple`；具备相应能力的模块还可导出延迟响应方法
// 。惰性包装器（`lazyApi()`）和提供方工厂将其作为值传递。这里是不区分具体 API 的调度接口；各 API 的选项类型由实现模块本身及通过
// `ApiStreamOptions` 定型的 `Provider.stream()` 提供。
/**
 * The uniform stream contract of an API implementation module: every module
 * under `src/api/` exports `stream` and `streamSimple`; capable modules may also
 * export deferred-response methods. Lazy wrappers (`lazyApi()`) and provider
 * factories pass these around as values. This is the untyped dispatch shape;
 * per-API option typing lives on the implementation modules themselves and on
 * `Provider.stream()` via `ApiStreamOptions`.
 */
export interface ProviderStreams {
	stream(model: Model<Api>, context: Context, options?: StreamOptions): AssistantMessageEventStream;
	streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
	fetchDeferred?(
		model: Model<Api>,
		handle: DeferredHandle,
		options?: DeferredFetchOptions,
	): AssistantMessageEventStream;
	cancelDeferred?(model: Model<Api>, handle: DeferredHandle, options?: DeferredCancelOptions): Promise<void>;
}

// 中文：图像生成 API 实现模块的统一接口约定：`src/api/` 下每个图像 API 模块都恰好导出 `generateImages`，因此模块本身满足此接口。惰性包
// 装器和图像提供方工厂将其作为值传递。
/**
 * The uniform contract of an image-generation API implementation module:
 * every image API module under `src/api/` exports exactly `generateImages`,
 * so the module itself satisfies this interface. Lazy wrappers and image
 * provider factories pass these around as values.
 */
export interface ProviderImages {
	generateImages(
		model: ImagesModel<ImagesApi>,
		context: ImagesContext,
		options?: ImagesOptions,
	): Promise<AssistantImages>;
}

export interface ImagesOptions extends ProviderRequestOptions<ImagesModel<ImagesApi>> {
	// 中文：API 请求中可附带的元数据。提供方提取其理解的字段，忽略其余字段。
	/**
	 * Optional metadata to include in API requests.
	 * Providers extract the fields they understand and ignore the rest.
	 */
	metadata?: Record<string, unknown>;
}

export type ProviderImagesOptions = ImagesOptions & Record<string, unknown>;

export interface AnthropicAllowedFallbackModel {
	provider: ProviderId;
	model: string;
	cost: ModelCost;
}

// 中文：传给 streamSimple() 和 completeSimple() 的统一选项，包含推理配置。
// Unified options with reasoning passed to streamSimple() and completeSimple()
export interface SimpleStreamOptions extends StreamOptions {
	// 中文：简单请求中与提供方无关的工具选择设置。省略时，适配器使用各提供方自身的行为。
	/** Provider-neutral tool selection for simple requests. When omitted, adapters use provider-specific behavior. */
	toolChoice?: ToolChoice;
	reasoning?: ThinkingLevel;
	// 中文：请求具备相应能力的提供方返回可持久使用的句柄，并异步继续处理请求。
	/** Ask a capable provider to return a durable handle and continue the request asynchronously. */
	deferred?: boolean | { window?: "15m" | "1h" | "24h" };
	// 中文：各思考级别的自定义 token 预算（仅适用于基于 token 预算的提供方）。
	/** Custom token budgets for thinking levels (token-based providers only) */
	thinkingBudgets?: ThinkingBudgets;
}

// 中文：带类型化选项的通用 StreamFunction。约定：必须返回 AssistantMessageEventStream；直接调用 streamSimple() 时
// ，若缺少请求认证信息，可能同步抛错。一旦返回流，请求、模型或运行时故障应编码到该流中。错误终止必须生成带 stopReason "error" 或 "aborted" 及
//  errorMessage 的 AssistantMessage，并通过流协议发出。
// Generic StreamFunction with typed options.
//
// Contract:
// - Must return an AssistantMessageEventStream.
// - Direct streamSimple() calls may throw synchronously when request auth is
//   missing. Once a stream is returned, request/model/runtime failures should
//   be encoded in that stream.
// - Error termination must produce an AssistantMessage with stopReason
//   "error" or "aborted" and errorMessage, emitted via the stream protocol.
export type StreamFunction<TApi extends Api = Api, TOptions extends StreamOptions = StreamOptions> = (
	model: Model<TApi>,
	context: Context,
	options?: TOptions,
) => AssistantMessageEventStream;

export type ImagesFunction<TApi extends ImagesApi = ImagesApi, TOptions extends ImagesOptions = ImagesOptions> = (
	model: ImagesModel<TApi>,
	context: ImagesContext,
	options?: TOptions,
) => Promise<AssistantImages>;

export interface TextSignatureV1 {
	v: 1;
	id: string;
	phase?: "commentary" | "final_answer";
}

export interface TextContent {
	type: "text";
	text: string;
	// 中文：例如用于 OpenAI responses 的消息元数据（旧版 id 字符串或 TextSignatureV1 JSON）。
	textSignature?: string; // e.g., for OpenAI responses, message metadata (legacy id string or TextSignatureV1 JSON)
}

export interface ThinkingContent {
	type: "thinking";
	thinking: string;
	// 中文：提供方特有的不透明或序列化推理重放数据。
	thinkingSignature?: string; // Provider-specific opaque or serialized reasoning replay data
	// 中文：为 true 时，思考内容已被安全过滤器隐去。不透明的加密载荷保存在 `thinkingSignature` 中，以便回传 API，保持多轮连续性。
	/** When true, the thinking content was redacted by safety filters. The opaque
	 *  encrypted payload is stored in `thinkingSignature` so it can be passed back
	 *  to the API for multi-turn continuity. */
	redacted?: boolean;
}

export interface ImageContent {
	type: "image";
	// 中文：以 base64 编码的图像数据。
	data: string; // base64 encoded image data
	// 中文：例如 "image/jpeg"、"image/png"。
	mimeType: string; // e.g., "image/jpeg", "image/png"
}

export interface ToolCall {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, any>;
	// 中文：Google 专用：用于复用思考上下文的不透明签名。
	thoughtSignature?: string; // Google-specific: opaque signature for reusing thought context
	// 中文：调用动态加载或带命名空间的工具时使用的 OpenAI Responses 命名空间。
	/** OpenAI Responses namespace for calls to dynamically loaded or namespaced tools. */
	namespace?: string;
}

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	// 中文：`cacheWrite` 中按 1 小时保留期写入的部分。只有 Anthropic 报告这一细分值。
	/** Subset of `cacheWrite` written with 1h retention. Only Anthropic reports this split. */
	cacheWrite1h?: number;
	// 中文：提供方报告的推理或思考 token 数。它是 `output` 的子集，`output` 已包含这些 token。公开推理细分用量的提供方将其设为数字（可能为 0）
	// ；不提供细分的提供方保留 undefined。
	/**
	 * Reasoning/thinking tokens, when the provider reports them. This is a subset of
	 * `output`: `output` already includes these tokens. Set to a number (possibly 0) by
	 * providers that expose a reasoning breakdown; left undefined by providers that don't.
	 */
	reasoning?: number;
	totalTokens: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

export type StopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface DeferredHandle {
	provider: string;
	modelId: string;
	api: string;
	// 中文：提供方标识令牌，例如响应 id，或批次 id 加行 id。
	/** Provider token, such as a response id or batch id plus row id. */
	id: string;
	expiresAt?: number;
	pollAfterMs?: number;
	// 中文：重建最终助手消息所需的提供方转换数据。
	/** Provider conversion data required to reconstruct the final assistant message. */
	data?: JsonValue;
}

export interface UserMessage {
	role: "user";
	content: string | (TextContent | ImageContent)[];
	// 中文：Unix 时间戳，单位为毫秒。
	timestamp: number; // Unix timestamp in milliseconds
}

export interface AssistantMessage {
	role: "assistant";
	content: (TextContent | ThinkingContent | ToolCall)[];
	api: Api;
	provider: ProviderId;
	model: string;
	// 中文：与请求的 `model` 不同时，记录具体的 `chunk.model`（例如 OpenRouter `auto` -> `anthropic/...`）。
	responseModel?: string; // Concrete `chunk.model` when different from the requested `model` (e.g. OpenRouter `auto` -> `anthropic/...`)
	// 中文：上游 API 提供时记录的、提供方特有的响应或消息标识。
	responseId?: string; // Provider-specific response/message identifier when the upstream API exposes one
	// 中文：本次响应实际使用的提供方原生 effort 级别。旧版或未受管理的响应中不存在此值。
	/** Exact provider-native effort level used for this response. Absent for legacy or unmanaged responses. */
	providerThinkingLevel?: string;
	// 中文：经过脱敏的提供方或运行时诊断，用于失败与恢复情况。
	diagnostics?: AssistantMessageDiagnostic[]; // Redacted provider/runtime diagnostics for failures and recoveries.
	usage: Usage;
	stopReason: StopReason;
	deferred?: DeferredHandle;
	errorMessage?: string;
	rawStopReason?: string;
	// 中文：提供方关于模型是否显式结束本轮的标记。保留用于调试，目前不影响智能体控制流。
	/**
	 * Provider indication of whether the model explicitly ended its turn.
	 * Preserved for debugging and does not currently affect agent control flow.
	 */
	endTurn?: boolean;
	// 中文：Unix 时间戳，单位为毫秒。
	timestamp: number; // Unix timestamp in milliseconds
}

export interface ToolResultMessage<TDetails = any> {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	// 中文：支持文本和图像。
	content: (TextContent | ImageContent)[]; // Supports text and images
	details?: TDetails;
	// 中文：工具执行本身的用量（若有），不计入主 LLM 的上下文用量核算。
	/** Usage from the tool execution itself, if available. Not part of main LLM context accounting. */
	usage?: Usage;
	// 中文：本结果产生后变得可用的 `Context.tools` 中的工具名称。原生支持延迟工具加载的提供方将此处作为加载点；其他提供方忽略它，正常使用
	// `Context.tools`。
	/**
	 * Names from `Context.tools` that became available after this result.
	 * Providers with native deferred tool loading use this as the load point;
	 * other providers ignore it and use `Context.tools` normally.
	 */
	addedToolNames?: string[];
	isError: boolean;
	// 中文：Unix 时间戳，单位为毫秒。
	timestamp: number; // Unix timestamp in milliseconds
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export type ImagesInputContent = TextContent | ImageContent;
export type ImagesOutputContent = TextContent | ImageContent;

export interface ImagesContext {
	input: ImagesInputContent[];
}

export type ImagesStopReason = "stop" | "error" | "aborted";

export interface AssistantImages {
	api: ImagesApi;
	provider: ImagesProviderId;
	model: string;
	output: ImagesOutputContent[];
	responseId?: string;
	usage?: Usage;
	stopReason: ImagesStopReason;
	errorMessage?: string;
	// 中文：Unix 时间戳，单位为毫秒。
	timestamp: number; // Unix timestamp in milliseconds
}

import type { TSchema } from "typebox";

// 中文：用于约束采样的 OpenAI 语法格式变体。
/** OpenAI grammar variants for constrained sampling. */
export type GrammarFormat = "openai_lark" | "openai_regex";

export type GrammarVariants = Partial<Record<GrammarFormat, string>>;

/**
 * Optional provider-side constrained sampling configs for a tool.
 *
 * The `json_schema` value roughly maps to the concept of `strict` in APIs which is
 * implemented as json-schema constrained sampling by APIs. Grammar variants let
 * callers provide provider-specific encodings of the same intended language.
 *
 * 中文：工具可选的提供方侧约束采样配置。
 * `json_schema` 大致对应 API 中的 `strict` 概念，API 通过 JSON Schema 约束采样实现它。
 * 语法变体允许调用方针对同一种目标语言，提供适用于不同提供方的编码表示。
 */
export type ConstrainedSamplingConfig =
	| {
			type: "json_schema";
			strict: "prefer" | "require";
	  }
	| {
			type: "grammar";
			variants: GrammarVariants;
	  };

export interface Tool<TParameters extends TSchema = TSchema> {
	name: string;
	description: string;
	parameters: TParameters;
	constrainedSampling?: false | ConstrainedSamplingConfig;
}

export interface Context {
	systemPrompt?: string;
	messages: Message[];
	tools?: Tool[];
}

// 中文：AssistantMessageEventStream 的事件协议。成功的流在增量更新前发出 `start`，以 `done` 结束；生成开始前若请求准备失败，可以
// 直接以 `error` 结束；`start` 之后的失败同样以 `error` 结束。直接调用 `streamSimple()` 时，缺少请求认证信息会同步抛错。更新事件
// 和 `done` 绝不能先于 `start`。`partial` 是共享的实时响应累积对象，不是事件发生时的快照。文本块和思考块在发出各自的 `*_start` 时为空，
// 仅通过对应的 `*_delta` 增长，直到权威的 `*_end`；被隐去的思考内容可能在开始时就完整且不发出增量。`toolcall_start` 时的工具调用参数因提
// 供方而异，`toolcall_delta` 携带后续 JSON 更新。
/**
 * Event protocol for AssistantMessageEventStream.
 *
 * Successful streams emit `start` before partial updates and terminate with
 * `done`. A stream may terminate directly with `error` when request setup fails
 * before generation starts; after `start`, failures also terminate with `error`.
 * Direct `streamSimple()` calls throw synchronously when request auth is missing.
 * Updates and `done` must never appear before `start`.
 *
 * `partial` is the shared live response-so-far helper, not an event-time
 * snapshot. Text and thinking blocks are empty when their `*_start` event is
 * emitted and grow only through their corresponding `*_delta` events until the
 * authoritative `*_end`. Redacted thinking may be complete at start and emit no
 * deltas. Tool-call arguments at `toolcall_start` are provider-specific;
 * `toolcall_delta` carries subsequent JSON updates.
 */
export type AssistantMessageEvent =
	| { type: "start"; partial: AssistantMessage }
	| { type: "text_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
	| { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
	| { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
	| {
			type: "done";
			reason: Extract<StopReason, "stop" | "length" | "toolUse" | "deferred">;
			message: AssistantMessage;
	  }
	| { type: "error"; reason: Extract<StopReason, "aborted" | "error">; error: AssistantMessage };

// 中文：OpenAI 兼容 completions API 的兼容性设置。可用于覆盖自定义提供方基于 URL 的自动检测结果。
/**
 * Compatibility settings for OpenAI-compatible completions APIs.
 * Use this to override URL-based auto-detection for custom providers.
 */
export interface OpenAICompletionsCompat {
	// 中文：提供方是否支持 `store` 字段。默认根据 URL 自动检测。
	/** Whether the provider supports the `store` field. Default: auto-detected from URL. */
	supportsStore?: boolean;
	// 中文：提供方是否支持 `developer` 角色（相对于 `system`）。默认根据 URL 自动检测。
	/** Whether the provider supports the `developer` role (vs `system`). Default: auto-detected from URL. */
	supportsDeveloperRole?: boolean;
	// 中文：提供方是否支持 `reasoning_effort`。默认根据 URL 自动检测。
	/** Whether the provider supports `reasoning_effort`. Default: auto-detected from URL. */
	supportsReasoningEffort?: boolean;
	// 中文：提供方是否支持 `stream_options: { include_usage: true }`，用于在流式响应中提供 token 用量。默认 true。
	/** Whether the provider supports `stream_options: { include_usage: true }` for token usage in streaming responses. Default: true. */
	supportsUsageInStreaming?: boolean;
	// 中文：流式响应是否包含 `finish_reason`。为 false 时，pi 在流结束时推断为 `stop` 或 `toolUse`。默认 true。
	/** Whether streamed responses include `finish_reason`. When false, pi infers `stop` or `toolUse` when the stream ends. Default: true. */
	supportsFinishReason?: boolean;
	// 中文：最大 token 数使用哪个字段。默认根据 URL 自动检测。
	/** Which field to use for max tokens. Default: auto-detected from URL. */
	maxTokensField?: "max_completion_tokens" | "max_tokens";
	// 中文：工具结果是否要求 `name` 字段。默认根据 URL 自动检测。
	/** Whether tool results require the `name` field. Default: auto-detected from URL. */
	requiresToolResultName?: boolean;
	// 中文：工具结果之后的用户消息前是否必须插入一条助手消息。默认根据 URL 自动检测。
	/** Whether a user message after tool results requires an assistant message in between. Default: auto-detected from URL. */
	requiresAssistantAfterToolResult?: boolean;
	// 中文：是否必须将思考块转换为带 <thinking> 分隔符的文本块。默认根据 URL 自动检测。
	/** Whether thinking blocks must be converted to text blocks with <thinking> delimiters. Default: auto-detected from URL. */
	requiresThinkingAsText?: boolean;
	// 中文：启用推理时，是否所有重放的助手消息都必须包含空的 reasoning_content 字段。默认根据 URL 自动检测。
	/** Whether all replayed assistant messages must include an empty reasoning_content field when reasoning is enabled. Default: auto-detected from URL. */
	requiresReasoningContentOnAssistantMessages?: boolean;
	// 中文：推理或思考参数格式："openai" 使用 reasoning_effort；"openrouter" 使用 reasoning: { effort }；
	// "deepseek" 使用 thinking: { type }，支持时再加 reasoning_effort；"together" 使用 reasoning: {
	// enabled }，支持时再加 reasoning_effort；"baseten" 使用可配置的 chat_template_args，支持时再加
	// reasoning_effort；"zai" 使用 thinking: { type }；"qwen" 使用顶层 enable_thinking: boolean；
	// "qwen-chat-template" 使用 chat_template_kwargs.enable_thinking 和 preserve_thinking；
	// "chat-template" 使用可配置的 chat_template_kwargs；"string-thinking" 使用顶层 thinking: string；
	// "ant-ling" 仅在映射后的 effort 非 null 时使用 reasoning: { effort }。默认 "openai"。
	/** Format for reasoning/thinking parameter. "openai" uses reasoning_effort, "openrouter" uses reasoning: { effort }, "deepseek" uses thinking: { type } plus reasoning_effort when supported, "together" uses reasoning: { enabled } plus reasoning_effort when supported, "baseten" uses configurable chat_template_args plus reasoning_effort when supported, "zai" uses thinking: { type }, "qwen" uses top-level enable_thinking: boolean, "qwen-chat-template" uses chat_template_kwargs.enable_thinking and preserve_thinking, "chat-template" uses configurable chat_template_kwargs, "string-thinking" uses top-level thinking: string, and "ant-ling" uses reasoning: { effort } only when the mapped effort is non-null. Default: "openai". */
	thinkingFormat?:
		| "openai"
		| "openrouter"
		| "deepseek"
		| "together"
		| "baseten"
		| "zai"
		| "qwen"
		| "chat-template"
		| "qwen-chat-template"
		| "string-thinking"
		| "ant-ling";
	// 中文：`thinkingFormat` 为 `chat-template` 时，作为 `chat_template_kwargs` 发送的关键字参数。使用 `{
	// "$var": "thinking.enabled" }`、`{ "$var": "thinking.effort" }` 或 `{ "$var":
	// "thinking.budget" }` 表示由 pi 控制的思考值。
	/** Kwargs to send as `chat_template_kwargs` when `thinkingFormat` is `chat-template`. Use `{ "$var": "thinking.enabled" }`, `{ "$var": "thinking.effort" }`, or `{ "$var": "thinking.budget" }` for pi-controlled thinking values. */
	chatTemplateKwargs?: Record<string, ChatTemplateKwargValue>;
	// 中文：`thinkingFormat` 为 `baseten` 时，作为 `chat_template_args` 发送的参数。使用 `{ "$var":
	// "thinking.enabled" }`、`{ "$var": "thinking.effort" }` 或 `{ "$var": "thinking.budget"
	// }` 表示由 pi 控制的思考值。
	/** Arguments to send as `chat_template_args` when `thinkingFormat` is `baseten`. Use `{ "$var": "thinking.enabled" }`, `{ "$var": "thinking.effort" }`, or `{ "$var": "thinking.budget" }` for pi-controlled thinking values. */
	chatTemplateArgs?: Record<string, ChatTemplateKwargValue>;
	// 中文：以请求字段 `provider` 发送的 OpenRouter 兼容路由偏好。
	/** OpenRouter-compatible routing preferences sent as the `provider` request field. */
	openRouterRouting?: OpenRouterRouting;
	// 中文：Vercel AI Gateway 路由偏好，仅当 baseUrl 指向 Vercel AI Gateway 时使用。
	/** Vercel AI Gateway routing preferences. Only used when baseUrl points to Vercel AI Gateway. */
	vercelGatewayRouting?: VercelGatewayRouting;
	// 中文：z.ai 是否支持顶层 `tool_stream: true`，用于流式传输工具调用增量。默认 false。
	/** Whether z.ai supports top-level `tool_stream: true` for streaming tool call deltas. Default: false. */
	zaiToolStream?: boolean;
	// 中文：用于按 `thinkingBudgets` 限制推理 token 数的顶层请求字段。这些端点中推理和回答共享 `max_tokens`，若没有预算，推理量大的一轮可
	// 能耗尽整个响应额度而不输出回答。vLLM 使用 `"thinking_token_budget"`，Qwen/DashScope/SGLang 使用
	// `"thinking_budget"`，llama.cpp 使用 `"thinking_budget_tokens"`。默认关闭，生成的模型目录不设置此项。
	/**
	 * Top-level request field used to cap reasoning tokens from `thinkingBudgets`.
	 * Reasoning and the answer share `max_tokens` on these endpoints, so without a budget a
	 * reasoning-heavy turn can consume the whole response and emit no answer.
	 * `"thinking_token_budget"` is vLLM, `"thinking_budget"` is Qwen/DashScope/SGLang,
	 * `"thinking_budget_tokens"` is llama.cpp. Off by default; not set on the generated catalog.
	 */
	thinkingTokenBudgetField?: ThinkingTokenBudgetField;
	// 中文：`thinkingTokenBudgetField: "thinking_token_budget"`（vLLM）的别名。优先使用
	// `thinkingTokenBudgetField`。默认 false。
	/** Alias for `thinkingTokenBudgetField: "thinking_token_budget"` (vLLM). Prefer `thinkingTokenBudgetField`. Default: false. */
	supportsThinkingTokenBudget?: boolean;
	// 中文：提供方是否支持采用 Lark/regex 语法格式的 OpenAI 自定义工具。为 false 时，语法约束工具回退为普通函数工具。默认 false；生成的模型目录
	// 会为支持此能力的模型启用。
	/** Whether the provider supports OpenAI custom tools with Lark/regex grammar formats. When false, grammar-constrained tools fall back to normal function tools. Default: false; the generated model catalog enables it for capable models. */
	supportsOpenAIGrammarTools?: boolean;
	// 中文：提供方是否支持工具定义中的 `strict` 字段。默认 true。
	/** Whether the provider supports the `strict` field in tool definitions. Default: true. */
	supportsStrictMode?: boolean;
	// 中文：提示词缓存的缓存控制约定。"anthropic" 将 Anthropic 风格的 `cache_control` 标记应用于系统提示词、最后一个工具定义，以及最后一
	// 条用户、助手或工具结果的文本内容。
	/** Cache control convention for prompt caching. "anthropic" applies Anthropic-style `cache_control` markers to the system prompt, last tool definition, and last user, assistant, or tool-result text content. */
	cacheControlFormat?: "anthropic";
	// 中文：是否发送来自 `options.sessionId` 的会话亲和数据。OpenRouter 端点默认 true，其他默认 false。
	/** Whether to send session-affinity data from `options.sessionId`. Default: true for OpenRouter endpoints, false otherwise. */
	sendSessionAffinityHeaders?: boolean;
	// 中文：提供方特有的延迟工具序列化模式。
	/** Provider-specific deferred tool serialization mode. */
	deferredToolsMode?: "kimi";
	// 中文：会话亲和头格式：`openai` 发送 `session_id`、`x-client-request-id` 和 `x-session-affinity`；
	// `openai-nosession` 发送 `x-client-request-id` 和 `x-session-affinity`；`openrouter` 发送
	// `x-session-id`。不影响由缓存保留策略控制的请求体参数 `prompt_cache_key`。默认自动检测。
	/** Session-affinity header format: `openai` sends `session_id`, `x-client-request-id`, and `x-session-affinity`; `openai-nosession` sends `x-client-request-id` and `x-session-affinity`; `openrouter` sends `x-session-id`. Does not affect the `prompt_cache_key` body param, which is governed by cache retention. Default: auto-detected. */
	sessionAffinityFormat?: SessionAffinityFormat;
	// 中文：提供方是否支持较长的提示词缓存保留期（取决于格式，使用 `prompt_cache_retention: "24h"` 或 Anthropic 风格的
	// `cache_control.ttl: "1h"`）。默认 true。
	/** Whether the provider supports long prompt cache retention (`prompt_cache_retention: "24h"` or Anthropic-style `cache_control.ttl: "1h"`, depending on format). Default: true. */
	supportsLongCacheRetention?: boolean;
	// 中文：以顶层请求字段 `priority` 发送的 vLLM 调度优先级（值越小越早处理；服务器默认 0）。仅在 vLLM 以 `--scheduling-policy
	// priority` 运行时有意义，可避免后台或批量工作阻塞交互会话。默认关闭，生成的模型目录不设置此项。
	/**
	 * vLLM scheduler priority sent as the top-level `priority` request field (lower values are
	 * handled earlier; server default 0). Only meaningful when vLLM runs with
	 * `--scheduling-policy priority`; useful for keeping background/batch work from stalling
	 * interactive sessions. Off by default; not set on the generated catalog.
	 */
	vllmPriority?: number;
}

// 中文：OpenAI Responses API 的兼容性设置。
/** Compatibility settings for OpenAI Responses APIs. */
export interface OpenAIResponsesCompat {
	// 中文：提供方是否支持 `developer` 角色（相对于 `system`）。默认 true。
	/** Whether the provider supports the `developer` role (vs `system`). Default: true. */
	supportsDeveloperRole?: boolean;
	// 中文：会话亲和头格式：`openai` 发送 `session_id` 和 `x-client-request-id`；`openai-nosession` 发送
	// `x-client-request-id`；`openrouter` 发送 `x-session-id`。不影响由缓存保留策略控制的请求体参数
	// `prompt_cache_key`。默认自动检测。
	/** Session-affinity header format: `openai` sends `session_id` and `x-client-request-id`; `openai-nosession` sends `x-client-request-id`; `openrouter` sends `x-session-id`. Does not affect the `prompt_cache_key` body param, which is governed by cache retention. Default: auto-detected. */
	sessionAffinityFormat?: SessionAffinityFormat;
	// 中文：提供方是否支持较长的提示词缓存保留期。GPT-5.6+ 使用 `prompt_cache_options.ttl: "30m"`，更早的模型使用
	// `prompt_cache_retention: "24h"`。默认 true。
	/** Whether the provider supports long prompt cache retention. This uses `prompt_cache_options.ttl: "30m"` on GPT-5.6+ and `prompt_cache_retention: "24h"` on earlier models. Default: true. */
	supportsLongCacheRetention?: boolean;
	// 中文：提供方是否支持严格 JSON Schema 函数工具。默认值因 API 而异；生成的 OpenAI 模型会显式启用。
	/** Whether the provider supports strict JSON-schema function tools. Defaults are API-specific; generated OpenAI models enable it explicitly. */
	supportsStrictMode?: boolean;
	// 中文：是否生成采用 Lark/regex 语法格式的 OpenAI 自定义工具。为 false 时，语法约束工具回退为普通函数工具。默认 false；生成的模型目录会为支
	// 持此能力的模型启用。
	/** Whether to emit OpenAI custom tools with Lark/regex grammar formats. When false, grammar-constrained tools fall back to normal function tools. Default: false; the generated model catalog enables it for capable models. */
	supportsOpenAIGrammarTools?: boolean;
	// 中文：模型是否支持以消息为锚点的 `additional_tools` 输入项。默认 false。
	/** Whether the model supports message-anchored `additional_tools` input items. Default: false. */
	supportsAdditionalTools?: boolean;
	// 中文：模型是否支持针对延迟工具、由客户端执行的工具搜索。默认 false。
	/** Whether the model supports client-executed tool search for deferred tools. Default: false. */
	supportsToolSearch?: boolean;
	// 中文：模型是否接受 `prompt_cache_options`（OpenAI GPT-5.6+ 提示词缓存）。较早的 OpenAI 模型会拒绝该参数。默认 false。
	/** Whether the model accepts `prompt_cache_options` (OpenAI GPT-5.6+ prompt caching). Older OpenAI models reject the parameter. Default: false. */
	supportsExplicitPromptCacheMode?: boolean;
	// 中文：提供方是否接受 `max_output_tokens` 参数。部分 Codex 协议网关会拒绝它。默认 true。
	/** Whether the provider accepts the `max_output_tokens` parameter. Some Codex-protocol gateways reject it. Default: true. */
	supportsMaxOutputTokens?: boolean;
}

// 中文：Anthropic Messages 兼容 API 的兼容性设置。
/** Compatibility settings for Anthropic Messages-compatible APIs. */
export interface AnthropicMessagesCompat {
	// 中文：提供方是否接受逐工具的 `eager_input_streaming`。为 false 时，Anthropic 提供方省略
	// `tools[].eager_input_streaming`，并为启用工具的请求发送旧版
	// `fine-grained-tool-streaming-2025-05-14` beta 头。默认 true。
	/**
	 * Whether the provider accepts per-tool `eager_input_streaming`.
	 * When false, the Anthropic provider omits `tools[].eager_input_streaming`
	 * and sends the legacy `fine-grained-tool-streaming-2025-05-14` beta header
	 * for tool-enabled requests.
	 * Default: true.
	 */
	supportsEagerToolInputStreaming?: boolean;
	// 中文：提供方是否支持 Anthropic 长缓存保留期（`cache_control.ttl: "1h"`）。默认 true。
	/** Whether the provider supports Anthropic long cache retention (`cache_control.ttl: "1h"`). Default: true. */
	supportsLongCacheRetention?: boolean;
	// 中文：启用缓存时，是否根据 `options.sessionId` 发送 `x-session-affinity` 头。Fireworks 等使用会话亲和进行提示词缓存路
	// 由的提供方需要此项，因为将请求发送到同一副本能最大化缓存命中。默认 false。
	/**
	 * Whether to send the `x-session-affinity` header from `options.sessionId`
	 * when caching is enabled. Required for providers like Fireworks that use
	 * session affinity for prompt cache routing (requests to the same replica
	 * maximize cache hits).
	 * Default: false.
	 */
	sendSessionAffinityHeaders?: boolean;
	// 中文：会话亲和格式。`"openrouter"` 发送 `x-session-id`；未设置时发送 `x-session-affinity`。
	/** Session-affinity format. `"openrouter"` sends `x-session-id`; when unset, sends `x-session-affinity`. */
	sessionAffinityFormat?: "openrouter";
	// 中文：提供方是否支持工具定义中的 Anthropic 风格 `cache_control` 标记。为 false 时，从工具参数中省略 `cache_control`。部
	// 分 Anthropic 兼容提供方（例如 Fireworks）不支持工具上的此字段，可能拒绝或忽略它。默认 true。
	/**
	 * Whether the provider supports Anthropic-style `cache_control` markers on
	 * tool definitions. When false, `cache_control` is omitted from tool params.
	 * Some Anthropic-compatible providers (e.g., Fireworks) do not support this
	 * field on tools and may reject or ignore it.
	 * Default: true.
	 */
	supportsCacheControlOnTools?: boolean;
	// 中文：模型是否接受 Anthropic 的 `temperature` 请求字段。Claude Opus 4.7+ 拒绝非默认温度值。默认 true。
	/**
	 * Whether the model accepts the Anthropic `temperature` request field.
	 * Claude Opus 4.7+ rejects non-default temperature values.
	 * Default: true.
	 */
	supportsTemperature?: boolean;
	// 中文：是否忽略模型 id，强制使用自适应思考（`thinking.type: "adaptive"` 加 `output_config.effort`）。必须使用该格式的
	// 内置模型在生成的元数据中设置此项。自定义 Anthropic 兼容提供方可为任何上游要求自适应格式的模型设为 `true`；覆盖内置模型配置时，可设为 `false` 来
	// 退出该行为。默认 false。
	/**
	 * Whether to force adaptive thinking (`thinking.type: "adaptive"` plus
	 * `output_config.effort`) regardless of the model id. Built-in models that
	 * require adaptive thinking set this in generated metadata. Custom
	 * Anthropic-compatible providers can set this to `true` for any model whose
	 * upstream requires the adaptive format. Set to `false` to
	 * opt out on overridden built-in models.
	 * Default: false.
	 */
	forceAdaptiveThinking?: boolean;
	// 中文：是否将空思考签名重放为 `signature: ""`，而不是将思考转换为文本。默认 false。
	/** Whether to replay empty thinking signatures as `signature: ""` instead of converting thinking to text. Default: false. */
	allowEmptySignature?: boolean;
	// 中文：提供方是否支持 Anthropic 严格工具 schema。默认 false；生成的 Anthropic 模型会显式启用。
	/** Whether the provider supports Anthropic strict tool schemas. Default: false; generated Anthropic models enable it explicitly. */
	supportsStrictTools?: boolean;
	// 中文：该模型实际使用的传输方式是否支持仅含 effort 的系统消息及思考绑定控制。默认 false。
	/** Whether the exact model transport supports effort-only system messages and thinking binding controls. Default: false. */
	supportsMidConvoEffort?: boolean;
	// 中文：Anthropic 在 `fallbacks` 中接受的模型，用于服务端拒绝时的回退，并携带返回回退响应所需的本地计价元数据。不存在或为空时，调用方必须省略
	// `fallbacks`；若模型没有允许的回退目标，Anthropic 会拒绝该字段。
	/**
	 * Models Anthropic accepts in `fallbacks` for server-side refusal fallback,
	 * with local pricing metadata for returned fallback responses. When absent or
	 * empty, callers must omit `fallbacks`; Anthropic rejects the field for models
	 * with no permitted fallback targets.
	 */
	allowedFallbackModels?: AnthropicAllowedFallbackModel[];
	// 中文：提供方是否支持通过工具结果中的 `tool_reference` 块加载延迟工具。除 Haiku 和早于 Claude 4.5 的模型外，Anthropic 第一方
	// 模型默认 true；其他提供方默认 false。
	/**
	 * Whether the provider supports deferred tools loaded by `tool_reference`
	 * blocks in tool results. Default: true for first-party Anthropic models
	 * except Haiku and models older than Claude 4.5; false for other providers.
	 */
	supportsToolReferences?: boolean;
}

// 中文：Amazon Bedrock 模型的兼容性设置。
/** Compatibility settings for Amazon Bedrock models. */
export interface BedrockCompat {
	// 中文：模型是否支持 Bedrock 严格工具 schema。默认 false。
	/** Whether the model supports Bedrock strict tool schemas. Default: false. */
	supportsStrictMode?: boolean;
}

// 中文：OpenRouter 提供方路由偏好，控制 OpenRouter 将请求路由到哪些上游提供方。作为 OpenRouter API 请求体中的 `provider`
// 字段发送。参考链接见下方原文。
/**
 * OpenRouter provider routing preferences.
 * Controls which upstream providers OpenRouter routes requests to.
 * Sent as the `provider` field in the OpenRouter API request body.
 * @see https://openrouter.ai/docs/guides/routing/provider-selection
 */
export interface OpenRouterRouting {
	// 中文：是否允许备用提供方处理请求。默认 true。
	/** Whether to allow backup providers to serve requests. Default: true. */
	allow_fallbacks?: boolean;
	// 中文：是否仅保留支持请求中全部参数的提供方。默认 false。
	/** Whether to filter providers to only those that support all parameters in the request. Default: false. */
	require_parameters?: boolean;
	// 中文：数据收集设置。"allow"（默认）：允许可能存储数据或使用数据训练的提供方；"deny"：仅使用不收集用户数据的提供方。
	/** Data collection setting. "allow" (default): allow providers that may store/train on data. "deny": only use providers that don't collect user data. */
	data_collection?: "deny" | "allow";
	// 中文：是否仅路由到 ZDR（零数据保留）端点。
	/** Whether to restrict routing to only ZDR (Zero Data Retention) endpoints. */
	zdr?: boolean;
	// 中文：是否仅路由到允许文本蒸馏的模型。
	/** Whether to restrict routing to only models that allow text distillation. */
	enforce_distillable_text?: boolean;
	// 中文：按顺序尝试的提供方名称或 slug 列表；当前项不可用时回退到下一项。
	/** An ordered list of provider names/slugs to try in sequence, falling back to the next if unavailable. */
	order?: string[];
	// 中文：本次请求唯一允许使用的提供方名称或 slug 列表。
	/** List of provider names/slugs to exclusively allow for this request. */
	only?: string[];
	// 中文：本次请求要跳过的提供方名称或 slug 列表。
	/** List of provider names/slugs to skip for this request. */
	ignore?: string[];
	// 中文：用于筛选提供方的量化级别列表，例如 ["fp16", "bf16", "fp8", "fp6", "int8", "int4", "fp4", "fp32"]。
	/** A list of quantization levels to filter providers by (e.g., ["fp16", "bf16", "fp8", "fp6", "int8", "int4", "fp4", "fp32"]). */
	quantizations?: string[];
	// 中文：排序策略。可以是字符串（例如 "price"、"throughput"、"latency"），也可以是包含 `by` 和 `partition` 的对象。
	/** Sorting strategy. Can be a string (e.g., "price", "throughput", "latency") or an object with `by` and `partition`. */
	sort?:
		| string
		| {
				// 中文：排序指标："price"、"throughput"、"latency"。
				/** The sorting metric: "price", "throughput", "latency". */
				by?: string;
				// 中文：分区策略："model"（默认）或 "none"。
				/** Partitioning strategy: "model" (default) or "none". */
				partition?: string | null;
		  };
	// 中文：每百万 token 的最高价格（美元）。
	/** Maximum price per million tokens (USD). */
	max_price?: {
		// 中文：每百万提示词 token 的价格。
		/** Price per million prompt tokens. */
		prompt?: number | string;
		// 中文：每百万补全 token 的价格。
		/** Price per million completion tokens. */
		completion?: number | string;
		// 中文：每张图像的价格。
		/** Price per image. */
		image?: number | string;
		// 中文：每个音频单位的价格。
		/** Price per audio unit. */
		audio?: number | string;
		// 中文：每次请求的价格。
		/** Price per request. */
		request?: number | string;
	};
	// 中文：首选的最低吞吐量（token/秒）。可以是数值（应用于 p50），也可以是按百分位分别指定阈值的对象。
	/** Preferred minimum throughput (tokens/second). Can be a number (applies to p50) or an object with percentile-specific cutoffs. */
	preferred_min_throughput?:
		| number
		| {
				// 中文：第 50 百分位的最低 token/秒。
				/** Minimum tokens/second at the 50th percentile. */
				p50?: number;
				// 中文：第 75 百分位的最低 token/秒。
				/** Minimum tokens/second at the 75th percentile. */
				p75?: number;
				// 中文：第 90 百分位的最低 token/秒。
				/** Minimum tokens/second at the 90th percentile. */
				p90?: number;
				// 中文：第 99 百分位的最低 token/秒。
				/** Minimum tokens/second at the 99th percentile. */
				p99?: number;
		  };
	// 中文：首选的最大延迟（秒）。可以是数值（应用于 p50），也可以是按百分位分别指定阈值的对象。
	/** Preferred maximum latency (seconds). Can be a number (applies to p50) or an object with percentile-specific cutoffs. */
	preferred_max_latency?:
		| number
		| {
				// 中文：第 50 百分位的最大延迟，单位为秒。
				/** Maximum latency in seconds at the 50th percentile. */
				p50?: number;
				// 中文：第 75 百分位的最大延迟，单位为秒。
				/** Maximum latency in seconds at the 75th percentile. */
				p75?: number;
				// 中文：第 90 百分位的最大延迟，单位为秒。
				/** Maximum latency in seconds at the 90th percentile. */
				p90?: number;
				// 中文：第 99 百分位的最大延迟，单位为秒。
				/** Maximum latency in seconds at the 99th percentile. */
				p99?: number;
		  };
}

// 中文：Vercel AI Gateway 路由偏好，控制网关将请求路由到哪些上游提供方。参考链接见下方原文。
/**
 * Vercel AI Gateway routing preferences.
 * Controls which upstream providers the gateway routes requests to.
 * @see https://vercel.com/docs/ai-gateway/models-and-providers/provider-options
 */
export interface VercelGatewayRouting {
	// 中文：本次请求唯一允许使用的提供方 slug 列表，例如 ["bedrock", "anthropic"]。
	/** List of provider slugs to exclusively use for this request (e.g., ["bedrock", "anthropic"]). */
	only?: string[];
	// 中文：按顺序尝试的提供方 slug 列表，例如 ["anthropic", "openai"]。
	/** List of provider slugs to try in order (e.g., ["anthropic", "openai"]). */
	order?: string[];
}

export interface ModelCostRates {
	// 中文：美元/百万 token。
	input: number; // $/million tokens
	// 中文：美元/百万 token。
	output: number; // $/million tokens
	// 中文：美元/百万 token。
	cacheRead: number; // $/million tokens
	// 中文：美元/百万 token。
	cacheWrite: number; // $/million tokens
}

export interface ModelCostTier extends ModelCostRates {
	// 中文：请求的总输入用量超过此 token 数时使用本档位。
	/** Use this tier for requests whose total input usage exceeds this token count. */
	inputTokensAbove: number;
}

export interface ModelCost extends ModelCostRates {
	// 中文：对整个请求适用的计价档位。匹配到的最高输入阈值所对应档位应用于完整请求。
	/** Request-wide pricing tiers. The highest matching input threshold applies to the full request. */
	tiers?: ModelCostTier[];
}

// 中文：统一模型系统的模型接口。
// Model interface for the unified model system
export interface Model<TApi extends Api> {
	id: string;
	name: string;
	api: TApi;
	provider: ProviderId;
	baseUrl: string;
	reasoning: boolean;
	// 中文：将 pi 的思考级别映射为提供方或模型特有的值。缺少的键使用提供方默认值，null 表示不支持该级别。
	/**
	 * Maps pi thinking levels to provider/model-specific values.
	 * Missing keys use provider defaults. null marks a level as unsupported.
	 */
	thinkingLevelMap?: ThinkingLevelMap;
	input: ("text" | "image")[];
	cost: ModelCost;
	contextWindow: number;
	maxTokens: number;
	// 中文：此模型的默认采样参数。参见 {@link StreamOptions.samplingParams}；请求级同名键覆盖这些默认值。
	/** Default sampling parameters for this model. See {@link StreamOptions.samplingParams}; per-request keys override these. */
	samplingParams?: Record<string, unknown>;
	headers?: Record<string, string>;
	// 中文：OpenAI 兼容 API 的兼容性覆盖设置。未设置时根据 baseUrl 自动检测。
	/** Compatibility overrides for OpenAI-compatible APIs. If not set, auto-detected from baseUrl. */
	compat?: TApi extends "openai-completions"
		? OpenAICompletionsCompat
		: TApi extends "openai-responses" | "azure-openai-responses" | "openai-codex-responses"
			? OpenAIResponsesCompat
			: TApi extends "anthropic-messages"
				? AnthropicMessagesCompat
				: TApi extends "bedrock-converse-stream"
					? BedrockCompat
					: never;
}

export interface ImagesModel<TApi extends ImagesApi>
	extends Omit<Model<Api>, "api" | "provider" | "reasoning" | "contextWindow" | "maxTokens" | "compat"> {
	api: TApi;
	provider: ImagesProviderId;
	output: ("text" | "image")[];
}

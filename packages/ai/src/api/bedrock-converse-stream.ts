import type { Agent as HttpsAgent } from "node:https";
import {
	BedrockRuntimeClient,
	type BedrockRuntimeClientConfig,
	BedrockRuntimeServiceException,
	StopReason as BedrockStopReason,
	type Tool as BedrockTool,
	CachePointType,
	CacheTTL,
	type ContentBlock,
	type ContentBlockDeltaEvent,
	type ContentBlockStartEvent,
	type ContentBlockStopEvent,
	ConversationRole,
	ConverseStreamCommand,
	type ConverseStreamMetadataEvent,
	ImageFormat,
	type Message,
	type SystemContentBlock,
	type ToolChoice,
	type ToolConfiguration,
	type ToolResultContentBlock,
	ToolResultStatus,
} from "@aws-sdk/client-bedrock-runtime";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type { BuildMiddleware, DeserializeMiddleware, DocumentType, HttpResponse, MetadataBearer } from "@smithy/types";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { calculateCost } from "../models.ts";
import type {
	Api,
	AssistantMessage,
	CacheRetention,
	Context,
	ImageContent,
	Model,
	ProviderEnv,
	ProviderResponse,
	SimpleStreamOptions,
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingBudgets,
	ThinkingContent,
	ThinkingLevel,
	Tool,
	ToolCall,
	ToolResultMessage,
} from "../types.ts";
import { appendAssistantMessageDiagnostic } from "../utils/diagnostics.ts";
import { normalizeProviderError } from "../utils/error-body.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { providerHeadersToRecord } from "../utils/headers.ts";
import { parseStreamingJson } from "../utils/json-parse.ts";
import { resolveHttpProxyUrlForTarget } from "../utils/node-http-proxy.ts";
import { getProviderEnvValue } from "../utils/provider-env.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import { getJsonSchemaToolParameters, resolveJsonSchemaStrictSampling } from "./constrained-sampling.ts";
import {
	adjustMaxTokensForThinking,
	buildBaseOptions,
	clampMaxTokensToContext,
	clampReasoning,
} from "./simple-options.ts";
import { transformMessages } from "./transform-messages.ts";

export type BedrockThinkingDisplay = "summarized" | "omitted";

export interface BedrockOptions extends StreamOptions {
	region?: string;
	profile?: string;
	toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
	// 中文：支持的模型参见下方 AWS 推理文档链接。
	/* See https://docs.aws.amazon.com/bedrock/latest/userguide/inference-reasoning.html for supported models. */
	reasoning?: ThinkingLevel;
	// 中文：各思考级别的自定义 token 预算，覆盖默认预算。
	/* Custom token budgets per thinking level. Overrides default budgets. */
	thinkingBudgets?: ThinkingBudgets;
	// 中文：仅 Claude 4.x 模型支持；参见下方交错式思考与工具使用文档。
	/* Only supported by Claude 4.x models, see https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-extended-thinking.html#claude-messages-extended-thinking-tool-use-interleaved */
	interleavedThinking?: boolean;
	// 中文：控制响应返回 Claude 思考内容的方式。summarized：思考块包含思考摘要文本，是此处默认值；omitted：隐藏思考内容，但仍返回签名以维持多轮连续性，
	// 减少首个文本 token 的等待时间。注意：Anthropic API 对 Claude Opus 4.8 和 Mythos Preview 的默认值是 omitted；
	// 此处使用 summarized，以保持与较早 Claude 4 模型一致的行为。仅适用于 Bedrock 上的 Claude 模型。
	/**
	 * Controls how Claude's thinking content is returned in responses.
	 * - "summarized": Thinking blocks contain summarized thinking text (default here).
	 * - "omitted": Thinking content is redacted but the signature still travels back
	 *   for multi-turn continuity, reducing time-to-first-text-token.
	 *
	 * Note: Anthropic's API default for Claude Opus 4.8 and Mythos Preview is
	 * "omitted". We default to "summarized" here to keep behavior consistent with
	 * older Claude 4 models. Only applies to Claude models on Bedrock.
	 */
	thinkingDisplay?: BedrockThinkingDisplay;
	// 中文：附加到推理请求的键值对，用于成本分摊标签。键最多 64 个字符，不得以 aws: 开头；值最多 256 个字符；最多 50 对。标签会出现在 AWS Cost
	// Explorer 的拆分成本分摊数据中。API 文档链接见原注释。
	/** Key-value pairs attached to the inference request for cost allocation tagging.
	 * Keys: max 64 chars, no `aws:` prefix. Values: max 256 chars. Max 50 pairs.
	 * Tags appear in AWS Cost Explorer split cost allocation data.
	 * @see https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html */
	requestMetadata?: Record<string, string>;
	// 中文：用于 Bedrock API key 认证的 bearer token。设置后跳过 SigV4 签名，改为发送 Authorization: Bearer
	// <token>。token 对应身份需具备 bedrock:CallWithBearerToken IAM 权限。可通过 AWS_BEARER_TOKEN_BEDROCK
	//  环境变量设置或直接传入。授权文档链接见原注释。
	/** Bearer token for Bedrock API key authentication.
	 * When set, bypasses SigV4 signing and sends Authorization: Bearer <token> instead.
	 * Requires `bedrock:CallWithBearerToken` IAM permission on the token's identity.
	 * Set via AWS_BEARER_TOKEN_BEDROCK env var or pass directly.
	 * @see https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonbedrock.html */
	bearerToken?: string;
}

type Block = (TextContent | ThinkingContent | ToolCall) & {
	index?: number;
	partialJson?: string;
	// 中文：加密推理增量的临时缓冲区，最终合并到 thinkingSignature。
	/** Scratch buffer for encrypted reasoning deltas, joined into `thinkingSignature`. */
	redactedChunks?: Uint8Array[];
};

const EMPTY_TEXT_PLACEHOLDER = "<empty>";

// 中文：与 Anthropic API 路径用于隐藏思考内容的占位符一致。
/** Matches the placeholder the Anthropic API path uses for redacted thinking. */
const REDACTED_THINKING_PLACEHOLDER = "[Reasoning redacted]";

export const stream: StreamFunction<"bedrock-converse-stream", BedrockOptions> = (
	model: Model<"bedrock-converse-stream">,
	context: Context,
	options: BedrockOptions = {},
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "bedrock-converse-stream" as Api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "pending",
			timestamp: Date.now(),
		};

		const blocks = output.content as Block[];

		// 中文：通过 Pi 认证流程显式配置的 profile，即 profile 选项或存储凭据 env 中作用域内的 AWS_PROFILE，必须优先于环境中的
		// AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY。SDK 默认链已优先使用配置的 profile，但仅在客户端配置未设置
		// credentials 时成立。参见 #6957。
		// A profile explicitly configured through pi's auth flow (the `profile`
		// option or scoped `AWS_PROFILE` on the stored credential's env) must win
		// over ambient AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY. The SDK default
		// chain already prefers a configured profile over env keys, but only when
		// `credentials` is not set on the client config. See #6957.
		const optionsProfile = options.profile || options.env?.AWS_PROFILE;
		const config: BedrockRuntimeClientConfig = {
			profile: optionsProfile || getProviderEnvValue("AWS_PROFILE", options.env),
		};
		const configuredRegion = getConfiguredBedrockRegion(options);
		const hasAmbientConfiguredProfile = Boolean(getProviderEnvValue("AWS_PROFILE"));
		const endpointRegion = getStandardBedrockEndpointRegion(model.baseUrl);
		const useExplicitEndpoint = shouldUseExplicitBedrockEndpoint(
			model.baseUrl,
			configuredRegion,
			hasAmbientConfiguredProfile,
		);

		// 中文：仅在未配置区域或环境 AWS_PROFILE 时固定标准 AWS Bedrock 运行时端点。这样既保留 #3402 中的 VPC/代理自定义端点，也避免内置目录中
		// 的 us-east-1 等默认值覆盖 AWS_REGION/AWS_PROFILE。
		// Only pin standard AWS Bedrock runtime endpoints when no region or ambient AWS_PROFILE is configured.
		// This preserves custom endpoints (VPC/proxy) from #3402 without forcing built-in
		// catalog defaults such as us-east-1 to override AWS_REGION/AWS_PROFILE.
		if (useExplicitEndpoint) {
			config.endpoint = model.baseUrl;
		}

		// 中文：解析 Bedrock API key 认证所需的 bearer token。
		// Resolve bearer token for Bedrock API key auth.
		const skipAuth = getProviderEnvValue("AWS_BEDROCK_SKIP_AUTH", options.env) === "1";
		const bearerToken =
			options.bearerToken ||
			options.apiKey ||
			getProviderEnvValue("AWS_BEARER_TOKEN_BEDROCK", options.env) ||
			undefined;
		const useBearerToken = bearerToken !== undefined && !skipAuth;

		// 中文：仅限 Node.js/Bun 环境。
		// in Node.js/Bun environment only
		if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
			// 中文：区域解析优先级：ARN 内嵌区域 > 显式选项 > 环境变量 > SDK 默认链。模型 ID 为推理配置档案 ARN 时，从中提取区域，避免与为其他服务设置的
			// AWS_REGION 冲突。
			// Region resolution: ARN-embedded > explicit option > env vars > SDK default chain.
			// When the model ID is an inference profile ARN, extract the region from it.
			// This avoids conflicts with AWS_REGION set for other services.
			const arnRegionMatch = model.id.match(/^arn:aws(?:-[a-z0-9-]+)?:bedrock:([a-z0-9-]+):/);
			if (arnRegionMatch) {
				config.region = arnRegionMatch[1];
			} else if (configuredRegion) {
				config.region = configuredRegion;
			} else if (endpointRegion && useExplicitEndpoint) {
				config.region = endpointRegion;
			} else if (!hasAmbientConfiguredProfile) {
				config.region = "us-east-1";
			}

			// 中文：支持无需认证的代理。
			// Support proxies that don't need authentication
			if (skipAuth) {
				config.credentials = {
					accessKeyId: "dummy-access-key",
					secretAccessKey: "dummy-secret-key",
				};
			}

			const credentials = getConfiguredBedrockCredentials(options.env);
			if (!skipAuth && credentials && !optionsProfile) {
				config.credentials = credentials;
			}

			const proxyUrl = resolveHttpProxyUrlForTarget(model.baseUrl, options.env);
			if (proxyUrl) {
				// 中文：Bedrock 运行时从 v3.798.0 起默认使用基于 http2 模块的 NodeHttp2Handler，不支持 HTTP agent。改用
				// NodeHttpHandler，以支持 HTTP(S) 代理 agent。
				// Bedrock runtime uses NodeHttp2Handler by default since v3.798.0, which is based
				// on `http2` module and has no support for http agent.
				// Use NodeHttpHandler to support HTTP(S) proxy agents.
				config.requestHandler = new NodeHttpHandler({
					httpAgent: new HttpProxyAgent(proxyUrl),
					httpsAgent: new HttpsProxyAgent(proxyUrl) as unknown as HttpsAgent,
				});
			} else if (getProviderEnvValue("AWS_BEDROCK_FORCE_HTTP1", options.env) === "1") {
				// 中文：某些自定义端点要求使用 HTTP/1.1，而非 HTTP/2。
				// Some custom endpoints require HTTP/1.1 instead of HTTP/2
				config.requestHandler = new NodeHttpHandler();
			}
		} else {
			// 中文：非 Node 环境（浏览器）无法解析配置文件，因此回退到 us-east-1。
			// Non-Node environment (browser): fall back to us-east-1 since
			// there's no config file resolution available.
			config.region =
				configuredRegion || (endpointRegion && useExplicitEndpoint ? endpointRegion : undefined) || "us-east-1";
		}

		if (useBearerToken) {
			config.token = { token: bearerToken };
			config.authSchemePreference = ["httpBearerAuth"];
		}

		// 中文：保留在 try 外部，使 catch 仍能关联流中途的失败；以流事件传递的异常本身不携带 HTTP 元数据。
		// Kept outside the try so the catch can still correlate a mid-stream failure:
		// exceptions delivered as stream events carry no HTTP metadata of their own.
		let responseRequestId: string | undefined;

		try {
			const supportsStrictMode = model.compat?.supportsStrictMode ?? false;
			const client = new BedrockRuntimeClient(config);
			let observedRawResponse = false;
			if (options.onResponse) {
				addResponseHeadersMiddleware(client, options.onResponse, model, () => {
					observedRawResponse = true;
				});
			}
			const customHeaders = providerHeadersToRecord(options.headers);
			if (customHeaders) {
				addCustomHeadersMiddleware(client, customHeaders);
			}
			const cacheRetention = resolveCacheRetention(options.cacheRetention, options.env);
			const inferenceMaxTokens = options.maxTokens ?? (isAnthropicClaudeModel(model) ? model.maxTokens : undefined);
			let commandInput = {
				modelId: model.id,
				messages: convertMessages(context, model, cacheRetention, options.env),
				system: buildSystemPrompt(context.systemPrompt, model, cacheRetention, options.env),
				inferenceConfig: {
					...(inferenceMaxTokens !== undefined && { maxTokens: inferenceMaxTokens }),
					...(options.temperature !== undefined && { temperature: options.temperature }),
				},
				toolConfig: convertToolConfig(context.tools, options.toolChoice, supportsStrictMode),
				additionalModelRequestFields: buildAdditionalModelRequestFields(model, options),
				...(options.requestMetadata !== undefined && { requestMetadata: options.requestMetadata }),
			};
			const nextCommandInput = await options?.onPayload?.(commandInput, model);
			if (nextCommandInput !== undefined) {
				commandInput = nextCommandInput as typeof commandInput;
			}
			const command = new ConverseStreamCommand(commandInput);

			const response = await client.send(command, { abortSignal: options.signal });
			responseRequestId = normalizeDiagnosticValue(response.$metadata.requestId);
			if (!observedRawResponse && response.$metadata.httpStatusCode !== undefined) {
				const responseHeaders: Record<string, string> = {};
				if (response.$metadata.requestId) {
					responseHeaders["x-amzn-requestid"] = response.$metadata.requestId;
				}
				await options?.onResponse?.({ status: response.$metadata.httpStatusCode, headers: responseHeaders }, model);
			}

			for await (const item of response.stream!) {
				if (item.messageStart) {
					if (item.messageStart.role !== ConversationRole.ASSISTANT) {
						throw new Error("Unexpected assistant message start but got user message start instead");
					}
					stream.push({ type: "start", partial: output });
				} else if (item.contentBlockStart) {
					handleContentBlockStart(item.contentBlockStart, blocks, output, stream);
				} else if (item.contentBlockDelta) {
					handleContentBlockDelta(item.contentBlockDelta, blocks, output, stream);
				} else if (item.contentBlockStop) {
					handleContentBlockStop(item.contentBlockStop, blocks, output, stream);
				} else if (item.messageStop) {
					output.rawStopReason = item.messageStop.stopReason;
					const { stopReason, errorMessage } = mapStopReason(item.messageStop.stopReason);
					output.stopReason = stopReason;
					if (errorMessage) {
						output.errorMessage = errorMessage;
					}
				} else if (item.metadata) {
					handleMetadata(item.metadata, model, output);
				} else if (item.internalServerException) {
					throw item.internalServerException;
				} else if (item.modelStreamErrorException) {
					throw item.modelStreamErrorException;
				} else if (item.validationException) {
					throw item.validationException;
				} else if (item.throttlingException) {
					throw item.throttlingException;
				} else if (item.serviceUnavailableException) {
					throw item.serviceUnavailableException;
				}
			}

			if (options.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (output.stopReason === "pending") {
				throw new Error("Bedrock stream ended without a stop reason");
			}
			if (output.stopReason === "error" || output.stopReason === "aborted") {
				throw new Error(output.errorMessage || "An unknown error occurred");
			}

			// 中文：流可能在未停止所有块的情况下结束，因此也在此处执行最终处理。
			// A stream can settle without stopping every block, so finalize here too.
			for (const block of output.content) finalizeStreamingBlock(block as Block);
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) {
				finalizeStreamingBlock(block as Block);
			}
			output.stopReason = options.signal?.aborted ? "aborted" : "error";
			output.errorMessage = formatBedrockError(error);
			if (output.stopReason === "error") {
				appendBedrockFailureDiagnostic(output, error, responseRequestId);
			}
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

// 中文：Bedrock SDK 异常名称对应的可读前缀。agent-session 中的下游重试逻辑会匹配 server.?error 和
// service.?unavailable 等模式，因此保留旧版前缀格式，不直接使用 SDK 原始异常名称。
/**
 * Human-readable prefixes for Bedrock SDK exception names.
 * The downstream retry logic in agent-session matches patterns like
 * `server.?error` and `service.?unavailable`, so we preserve the legacy
 * prefix format rather than using the raw SDK exception name.
 */
const BEDROCK_ERROR_PREFIXES: Record<string, string> = {
	InternalServerException: "Internal server error",
	ModelStreamErrorException: "Model stream error",
	ValidationException: "Validation error",
	ThrottlingException: "Throttling error",
	ServiceUnavailableException: "Service unavailable",
};

// 中文：某些模型会拒绝账户或 profile 配置的 Bedrock 数据保留模式，例如提示该模型不支持 default 数据保留模式。引导用户查看说明如何配置受支持模式的
//  AWS 文档。
/**
 * Some models reject the account/profile's configured Bedrock data retention mode
 * (e.g. "data retention mode 'default' is not available for this model"). Point
 * users at the AWS docs explaining how to configure a supported mode.
 */
const BEDROCK_DATA_RETENTION_DOCS_URL = "https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html";

// 中文：为 Bedrock 错误添加可读前缀。来自 client.send() 和流事件条目的 AWS SDK 异常继承
// BedrockRuntimeServiceException。将 .name 映射为稳定的可读前缀，使下游重试逻辑、上下文溢出检测等可通过简单字符串匹配区分错误类别。
/**
 * Format a Bedrock error with a human-readable prefix.
 * AWS SDK exceptions (both from `client.send()` and from stream event items)
 * extend BedrockRuntimeServiceException. We map the `.name` to a stable
 * human-readable prefix so downstream consumers (retry logic, context-overflow
 * detection) can distinguish error categories via simple string matching.
 */
function formatBedrockError(error: unknown): string {
	const norm = normalizeProviderError(error);
	// 中文：SDK 未将原始 HTTP 响应体纳入消息时，显示该响应体及状态码；否则使用消息。这样可避免网关 403 被简化成 Unknown: UnknownError。
	// Surface the raw HTTP body (with status) when the SDK did not fold it into
	// the message; otherwise fall back to the message. This is what stops a
	// gateway 403 from collapsing to `Unknown: UnknownError`.
	const core =
		!norm.messageCarriesBody && norm.status !== undefined && norm.body !== undefined
			? `${norm.status}: ${norm.body}`
			: norm.message;
	const dataRetentionHint = /data retention mode/i.test(core)
		? ` See ${BEDROCK_DATA_RETENTION_DOCS_URL} for supported data retention modes.`
		: "";
	if (error instanceof BedrockRuntimeServiceException) {
		const prefix = BEDROCK_ERROR_PREFIXES[error.name] ?? error.name;
		return `${prefix}: ${core}${dataRetentionHint}`;
	}
	return `${core}${dataRetentionHint}`;
}

type SdkErrorMetadata = { $metadata?: { httpStatusCode?: unknown; requestId?: unknown } };

// 中文：超长响应头值直接丢弃，不截断：截断后的请求 ID 已不能作为有效请求 ID。
/** Over-long header values are dropped rather than truncated: a truncated request id is not a request id. */
const MAX_BEDROCK_DIAGNOSTIC_VALUE_CHARS = 200;

function normalizeDiagnosticValue(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_BEDROCK_DIAGNOSTIC_VALUE_CHARS) return undefined;
	return trimmed;
}

// 中文：SDK 对服务异常及未建模的流错误都会将建模的错误码放入 error.name，因此不要仅限定为 BedrockRuntimeServiceException。已建
// 模的 Bedrock 错误名称均以 Exception 结尾，与 TimeoutError 等传输错误名称不同。
/**
 * The SDK puts the modeled code on `error.name` for service exceptions and unmodeled stream errors alike, so
 * do not narrow to `BedrockRuntimeServiceException`. Modeled Bedrock errors all end in `Exception`, unlike
 * transport names such as `TimeoutError`.
 */
function extractBedrockErrorCode(error: unknown): string | undefined {
	if (!(error instanceof Error) || !error.name.endsWith("Exception")) return undefined;
	return normalizeDiagnosticValue(error.name);
}

// 中文：在 errorMessage 旁附加结构化元数据。errorMessage 保持逐字节不变，因为 isRetryableAssistantError 会对它做匹配。
// 未知字段直接省略，绝不猜测：流中途的已建模异常可能以普通对象字面量到达，只能使用 fallbackRequestId。仅提供 details，因为抛出的值不一定是
// Error。
/**
 * Structured metadata alongside `errorMessage`, which stays byte-identical because `isRetryableAssistantError`
 * matches against it. Unknown fields are omitted, never guessed: a modeled mid-stream exception reaches us as
 * a bare object literal, leaving only `fallbackRequestId`. `details` only, as the throw is not always `Error`.
 */
function appendBedrockFailureDiagnostic(
	output: AssistantMessage,
	error: unknown,
	fallbackRequestId: string | undefined,
): void {
	const metadata = (error as SdkErrorMetadata)?.$metadata;
	const details: Record<string, unknown> = {};

	if (typeof metadata?.httpStatusCode === "number") details.status = metadata.httpStatusCode;

	const errorCode = extractBedrockErrorCode(error);
	if (errorCode !== undefined) details.errorCode = errorCode;

	const requestId = normalizeDiagnosticValue(metadata?.requestId) ?? fallbackRequestId;
	if (requestId !== undefined) details.requestId = requestId;

	if (Object.keys(details).length === 0) return;

	appendAssistantMessageDiagnostic(output, { type: "bedrock_response_failure", timestamp: Date.now(), details });
}

// 中文：调用方提供的请求头绝不能覆盖这些键。host 和 x-amz-* 参与 SigV4 规范请求；authorization 由 SigV4 或 bearer
// token 路径（config.token + authSchemePreference）管理。比较时忽略大小写，查找前将调用方键名转换为小写。
/**
 * Header keys that must never be overwritten by caller-supplied headers.
 * `host` and `x-amz-*` participate in the SigV4 canonical request; `authorization`
 * is owned by SigV4 or the bearer-token path (config.token + authSchemePreference).
 * Compared case-insensitively (caller key is lower-cased before lookup).
 */
const RESERVED_HEADER_EXACT = new Set(["authorization", "host"]);

function isReservedHeader(key: string): boolean {
	const lower = key.toLowerCase();
	return lower.startsWith("x-amz-") || RESERVED_HEADER_EXACT.has(lower);
}

// 中文：通过 Smithy build 阶段中间件向 Bedrock 请求附加调用方请求头。build 阶段在请求序列化之后、SigV4 签名之前执行，因此注入的请求头也纳
// 入签名。保留的 SigV4/认证头（x-amz-*、authorization、host）会被静默跳过；其他调用方请求头覆盖请求中已有的同名头。
/**
 * Attach caller-supplied headers to the outgoing Bedrock request via a Smithy
 * `build`-step middleware. The `build` step runs after request serialisation but
 * before SigV4 signing, so injected headers are covered by the signature. Reserved
 * SigV4 / auth headers (`x-amz-*`, `authorization`, `host`) are silently skipped;
 * all other caller headers override any existing same-named header on the request.
 */
function addCustomHeadersMiddleware(client: BedrockRuntimeClient, headers: Record<string, string>): void {
	const middleware: BuildMiddleware<object, MetadataBearer> = (next) => async (args) => {
		const request = args.request;
		if (request && typeof request === "object" && "headers" in request) {
			const requestHeaders = (request as { headers: Record<string, string> }).headers;
			for (const [key, value] of Object.entries(headers)) {
				if (!isReservedHeader(key)) {
					requestHeaders[key] = value;
				}
			}
		}
		return next(args);
	};
	client.middlewareStack.add(middleware, { step: "build", name: "pi-ai-custom-headers", priority: "low" });
}

function isSmithyHttpResponse(response: unknown): response is HttpResponse {
	if (!response || typeof response !== "object") return false;
	const candidate = response as Partial<HttpResponse>;
	return typeof candidate.statusCode === "number" && !!candidate.headers && typeof candidate.headers === "object";
}

function toProviderResponse(response: unknown): ProviderResponse | undefined {
	if (!isSmithyHttpResponse(response)) return undefined;
	return { status: response.statusCode, headers: { ...response.headers } };
}

// 中文：Bedrock 建模的 $metadata 仅保留部分 HTTP 元数据，例如 requestId，因此自定义网关响应头会在调用方收到 onResponse 前丢失
// 。在 deserialize 阶段捕获原始 Smithy HTTP 响应，此时 SDK 已收到响应，但尚未消费事件流。
/**
 * Bedrock's modeled `$metadata` only preserves selected HTTP metadata (for example
 * requestId), so custom gateway headers are otherwise lost before callers see
 * `onResponse`. Capture the raw Smithy HTTP response at the deserialize step,
 * after the SDK receives the response but before the event stream is consumed.
 */
function addResponseHeadersMiddleware(
	client: BedrockRuntimeClient,
	onResponse: NonNullable<BedrockOptions["onResponse"]>,
	model: Model<"bedrock-converse-stream">,
	onObserved: () => void,
): void {
	const middleware: DeserializeMiddleware<object, MetadataBearer> = (next) => async (args) => {
		const result = await next(args);
		const providerResponse = toProviderResponse(result.response);
		if (providerResponse) {
			onObserved();
			await onResponse(providerResponse, model);
		}
		return result;
	};
	client.middlewareStack.add(middleware, { step: "deserialize", name: "pi-ai-response-headers" });
}

export const streamSimple: StreamFunction<"bedrock-converse-stream", SimpleStreamOptions> = (
	model: Model<"bedrock-converse-stream">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const base = {
		...buildBaseOptions(model, context, options, undefined),
		toolChoice: options?.toolChoice,
	} satisfies BedrockOptions;
	if (!options?.reasoning) {
		return stream(model, context, { ...base, reasoning: undefined } satisfies BedrockOptions);
	}

	if (isAnthropicClaudeModel(model)) {
		if (supportsAdaptiveThinking(model.id, model.name)) {
			return stream(model, context, {
				...base,
				reasoning: options.reasoning,
				thinkingBudgets: options.thinkingBudgets,
			} satisfies BedrockOptions);
		}

		// 中文：undefined 表示调用方未要求输出上限，让辅助函数使用模型上限。此处不要强制转为 0，否则思考预算将占满整个 maxTokens。
		// Undefined means the caller did not request an output cap; let the helper use the model cap.
		// Do not coerce to 0 here, or the thinking budget would become the entire maxTokens value.
		const adjusted = adjustMaxTokensForThinking(
			base.maxTokens,
			model.maxTokens,
			options.reasoning,
			options.thinkingBudgets,
		);

		const maxTokens = clampMaxTokensToContext(model, context, adjusted.maxTokens);

		return stream(model, context, {
			...base,
			maxTokens,
			reasoning: options.reasoning,
			thinkingBudgets: {
				...(options.thinkingBudgets || {}),
				[clampReasoning(options.reasoning)!]: Math.min(adjusted.thinkingBudget, Math.max(0, maxTokens - 1024)),
			},
		} satisfies BedrockOptions);
	}

	return stream(model, context, {
		...base,
		reasoning: options.reasoning,
		thinkingBudgets: options.thinkingBudgets,
	} satisfies BedrockOptions);
};

function handleContentBlockStart(
	event: ContentBlockStartEvent,
	blocks: Block[],
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
): void {
	const index = event.contentBlockIndex!;
	const start = event.start;

	if (start?.toolUse) {
		const block: Block = {
			type: "toolCall",
			id: start.toolUse.toolUseId || "",
			name: start.toolUse.name || "",
			arguments: {},
			partialJson: "",
			index,
		};
		output.content.push(block);
		stream.push({ type: "toolcall_start", contentIndex: blocks.length - 1, partial: output });
	}
}

function handleContentBlockDelta(
	event: ContentBlockDeltaEvent,
	blocks: Block[],
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
): void {
	const contentBlockIndex = event.contentBlockIndex!;
	const delta = event.delta;
	let index = blocks.findIndex((b) => b.index === contentBlockIndex);
	let block = blocks[index];

	if (delta?.text !== undefined) {
		// 中文：若文本块尚不存在，则创建它，因为文本块不会触发 handleContentBlockStart。
		// If no text block exists yet, create one, as `handleContentBlockStart` is not sent for text blocks
		if (!block) {
			const newBlock: Block = { type: "text", text: "", index: contentBlockIndex };
			output.content.push(newBlock);
			index = blocks.length - 1;
			block = blocks[index];
			stream.push({ type: "text_start", contentIndex: index, partial: output });
		}
		if (block.type === "text") {
			block.text += delta.text;
			stream.push({ type: "text_delta", contentIndex: index, delta: delta.text, partial: output });
		}
	} else if (delta?.toolUse && block?.type === "toolCall") {
		block.partialJson = (block.partialJson || "") + (delta.toolUse.input || "");
		block.arguments = parseStreamingJson(block.partialJson);
		stream.push({ type: "toolcall_delta", contentIndex: index, delta: delta.toolUse.input || "", partial: output });
	} else if (delta?.reasoningContent) {
		let thinkingBlock = block;
		let thinkingIndex = index;

		if (!thinkingBlock) {
			const newBlock: Block = { type: "thinking", thinking: "", thinkingSignature: "", index: contentBlockIndex };
			output.content.push(newBlock);
			thinkingIndex = blocks.length - 1;
			thinkingBlock = blocks[thinkingIndex];
			stream.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: output });
		}

		if (thinkingBlock?.type === "thinking") {
			if (delta.reasoningContent.text) {
				thinkingBlock.thinking += delta.reasoningContent.text;
				stream.push({
					type: "thinking_delta",
					contentIndex: thinkingIndex,
					delta: delta.reasoningContent.text,
					partial: output,
				});
			}
			// 中文：thinkingSignature 只能保存 Anthropic 签名或不透明的隐藏载荷，不能同时保存两者；混合会破坏先到达的数据。
			// `thinkingSignature` holds either an Anthropic signature or an opaque redacted
			// payload, never both: mixing them would corrupt whichever arrived first.
			if (delta.reasoningContent.signature && !thinkingBlock.redacted) {
				thinkingBlock.thinkingSignature =
					(thinkingBlock.thinkingSignature || "") + delta.reasoningContent.signature;
			}
			if (delta.reasoningContent.redactedContent?.length) {
				// 中文：来自 Bedrock 上非 Anthropic 模型（例如 OpenAI GPT-5.6）的加密推理。载荷是不透明的，因此像 Anthropic 路径保存隐藏思考内
				// 容一样，原样保存在 thinkingSignature 中，并在下一轮回放。
				// Encrypted reasoning from non-Anthropic models on Bedrock (e.g. OpenAI GPT-5.6).
				// The payload is opaque, so keep it verbatim in `thinkingSignature` the way the
				// Anthropic path stores redacted thinking, and replay it on the next turn.
				if (!thinkingBlock.redacted) {
					thinkingBlock.redacted = true;
					thinkingBlock.thinkingSignature = "";
					thinkingBlock.thinking += REDACTED_THINKING_PLACEHOLDER;
					stream.push({
						type: "thinking_delta",
						contentIndex: thinkingIndex,
						delta: REDACTED_THINKING_PLACEHOLDER,
						partial: output,
					});
				}
				thinkingBlock.redactedChunks ??= [];
				thinkingBlock.redactedChunks.push(delta.reasoningContent.redactedContent);
			}
		}
	}
}

// 中文：将缓冲的加密推理编码到 thinkingSignature，并丢弃临时缓冲区。临时缓冲区绝不能进入持久化消息：Uint8Array 会被序列化为以索引为键的对象，体
// 积约为 base64 载荷的十倍。
/**
 * Encodes buffered encrypted reasoning into `thinkingSignature` and drops the scratch
 * buffer, which must never reach a persisted message: `Uint8Array` serializes to an
 * index-keyed object roughly ten times the size of the base64 payload.
 */
function flushRedactedContent(block: Block): void {
	if (block.type !== "thinking" || !block.redactedChunks) return;
	block.thinkingSignature = bytesToBase64(block.redactedChunks);
	delete block.redactedChunks;
}

// 中文：移除所有流式临时字段。除 contentBlockStop 外，终止路径也会调用它，因为流可能在未停止每个块的情况下结束。
/**
 * Strips every streaming scratch field. Runs from the terminal paths as well as
 * `contentBlockStop`, because a stream can settle without stopping each block.
 */
function finalizeStreamingBlock(block: Block): void {
	delete block.index;
	// 中文：partialJson 仅为流式处理的临时缓冲区，绝不能持久化。
	// partialJson is only a streaming scratch buffer; never persist it.
	delete block.partialJson;
	flushRedactedContent(block);
}

function handleMetadata(
	event: ConverseStreamMetadataEvent,
	model: Model<"bedrock-converse-stream">,
	output: AssistantMessage,
): void {
	if (event.usage) {
		output.usage.input = event.usage.inputTokens || 0;
		output.usage.output = event.usage.outputTokens || 0;
		output.usage.cacheRead = event.usage.cacheReadInputTokens || 0;
		output.usage.cacheWrite = event.usage.cacheWriteInputTokens || 0;
		output.usage.totalTokens = event.usage.totalTokens || output.usage.input + output.usage.output;
		calculateCost(model, output.usage);
	}
}

function handleContentBlockStop(
	event: ContentBlockStopEvent,
	blocks: Block[],
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
): void {
	const index = blocks.findIndex((b) => b.index === event.contentBlockIndex);
	const block = blocks[index];
	if (!block) return;
	delete (block as Block).index;

	switch (block.type) {
		case "text":
			stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: output });
			break;
		case "thinking":
			flushRedactedContent(block);
			stream.push({ type: "thinking_end", contentIndex: index, content: block.thinking, partial: output });
			break;
		case "toolCall":
			block.arguments = parseStreamingJson(block.partialJson);
			// 中文：原地完成最终处理并移除临时缓冲区，使回放只携带解析后的参数。
			// Finalize in-place and strip the scratch buffer so replay only
			// carries parsed arguments.
			delete (block as Block).partialJson;
			stream.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: output });
			break;
	}
}

// 中文：检查模型是否支持自适应思考（Opus 4.6 及以上、Sonnet 4.6）。同时检查模型 ID 和名称，以支持 ARN 中不含模型名称的应用推理配置档案。
/**
 * Check if the model supports adaptive thinking (Opus 4.6+, Sonnet 4.6).
 * Checks both model ID and model name to support application inference profiles
 * whose ARNs don't contain the model name.
 */
function getModelMatchCandidates(modelId: string, modelName?: string): string[] {
	const values = modelName ? [modelId, modelName] : [modelId];
	return values.flatMap((value) => {
		const lower = value.toLowerCase();
		return [lower, lower.replace(/[\s_.:]+/g, "-")];
	});
}

function supportsAdaptiveThinking(modelId: string, modelName?: string): boolean {
	const candidates = getModelMatchCandidates(modelId, modelName);
	return candidates.some(
		(s) =>
			s.includes("opus-4-6") ||
			s.includes("opus-4-7") ||
			s.includes("opus-4-8") ||
			s.includes("opus-5") ||
			s.includes("sonnet-4-6") ||
			s.includes("sonnet-5") ||
			s.includes("fable-5"),
	);
}

function supportsNativeXhighEffort(model: Model<"bedrock-converse-stream">): boolean {
	const candidates = getModelMatchCandidates(model.id, model.name);
	return candidates.some(
		(s) =>
			s.includes("opus-4-7") ||
			s.includes("opus-4-8") ||
			s.includes("opus-5") ||
			s.includes("sonnet-5") ||
			s.includes("fable-5"),
	);
}

function mapThinkingLevelToEffort(
	model: Model<"bedrock-converse-stream">,
	level: SimpleStreamOptions["reasoning"],
): "low" | "medium" | "high" | "xhigh" | "max" {
	if (level === "xhigh" && supportsNativeXhighEffort(model)) return "xhigh";

	const mapped = level ? model.thinkingLevelMap?.[level] : undefined;
	if (typeof mapped === "string") return mapped as "low" | "medium" | "high" | "xhigh" | "max";

	switch (level) {
		case "minimal":
		case "low":
			return "low";
		case "medium":
			return "medium";
		case "high":
			return "high";
		default:
			return "high";
	}
}

// 中文：解析缓存保留偏好，默认使用 short，并读取 PI_CACHE_RETENTION 以兼容旧配置。
/**
 * Resolve cache retention preference.
 * Defaults to "short" and uses PI_CACHE_RETENTION for backward compatibility.
 */
function resolveCacheRetention(cacheRetention?: CacheRetention, env?: ProviderEnv): CacheRetention {
	if (cacheRetention) {
		return cacheRetention;
	}
	if (getProviderEnvValue("PI_CACHE_RETENTION", env) === "long") {
		return "long";
	}
	return "short";
}

// 中文：检查模型是否为 Bedrock 上的 Anthropic Claude。同时检查模型 ID 和名称，以支持 ARN 中不含模型名称的应用推理配置档案。
/**
 * Check if the model is an Anthropic Claude model on Bedrock.
 * Checks both model ID and model name to support application inference profiles
 * whose ARNs don't contain the model name.
 */
function isAnthropicClaudeModel(model: Model<"bedrock-converse-stream">): boolean {
	const id = model.id.toLowerCase();
	const name = model.name?.toLowerCase() ?? "";
	return (
		id.includes("anthropic.claude") ||
		id.includes("anthropic/claude") ||
		name.includes("anthropic.claude") ||
		name.includes("anthropic/claude") ||
		name.includes("claude")
	);
}

// 中文：检查模型是否支持提示词缓存。支持 Claude 3.5 Haiku、Claude 3.7 Sonnet、Claude 4.x 和 Claude 5。基础模型及系统定
// 义的推理配置档案，其模型 ID/ARN 包含模型名称，可在本地判断。对于 ARN 不含模型名称的应用推理配置档案，还检查由用户通过 models.json 或
// registerProvider 控制的 model.name。最后可设置 AWS_BEDROCK_FORCE_CACHE=1 强制启用缓存点。Amazon Nova 模
// 型有自动缓存，无需显式缓存点。
/**
 * Check if the model supports prompt caching.
 * Supported: Claude 3.5 Haiku, Claude 3.7 Sonnet, Claude 4.x models, Claude 5 models
 *
 * For base models and system-defined inference profiles the model ID / ARN
 * contains the model name, so we can decide locally.
 *
 * For application inference profiles (whose ARNs don't contain the model name),
 * also checks model.name which is user-controlled via models.json or registerProvider.
 * As a last resort, set AWS_BEDROCK_FORCE_CACHE=1 to enable cache points.
 * Amazon Nova models have automatic caching and don't need explicit cache points.
 */
function supportsPromptCaching(model: Model<"bedrock-converse-stream">, env?: ProviderEnv): boolean {
	const candidates = getModelMatchCandidates(model.id, model.name);

	const hasClaudeRef = candidates.some((s) => s.includes("claude"));
	if (!hasClaudeRef) {
		// 中文：应用推理配置档案的 ARN 不包含模型名称，允许用户通过环境变量强制启用缓存点。
		// Application inference profiles don't contain the model name in the ARN.
		// Allow users to force cache points via environment variable.
		if (getProviderEnvValue("AWS_BEDROCK_FORCE_CACHE", env) === "1") return true;
		return false;
	}
	// 中文：Claude 5 模型：fable-5、opus-5、sonnet-5。
	// Claude 5 models (fable-5, opus-5, sonnet-5)
	if (candidates.some((s) => s.includes("fable-5") || s.includes("opus-5") || s.includes("sonnet-5"))) return true;
	// 中文：Claude 4.x 模型：opus-4、sonnet-4、haiku-4。
	// Claude 4.x models (opus-4, sonnet-4, haiku-4)
	if (candidates.some((s) => s.includes("-4-"))) return true;
	// 中文：Claude 3.7 Sonnet 模型。
	// Claude 3.7 Sonnet
	if (candidates.some((s) => s.includes("claude-3-7-sonnet"))) return true;
	// 中文：Claude 3.5 Haiku 模型。
	// Claude 3.5 Haiku
	if (candidates.some((s) => s.includes("claude-3-5-haiku"))) return true;
	return false;
}

// 中文：检查模型是否支持 reasoningContent 中的思考签名。只有 Anthropic Claude 支持 signature 字段；OpenAI、Qwen、
// Minimax、Moonshot 等其他模型会报错，表示不支持 reasoningContent.reasoningText.signature 字段。同时检查模型 ID
//  和名称，以支持应用推理配置档案。
/**
 * Check if the model supports thinking signatures in reasoningContent.
 * Only Anthropic Claude models support the signature field.
 * Other models (OpenAI, Qwen, Minimax, Moonshot, etc.) reject it with:
 * "This model doesn't support the reasoningContent.reasoningText.signature field"
 *
 * Checks both model ID and model name to support application inference profiles.
 */
function supportsThinkingSignature(model: Model<"bedrock-converse-stream">): boolean {
	return isAnthropicClaudeModel(model);
}

function buildSystemPrompt(
	systemPrompt: string | undefined,
	model: Model<"bedrock-converse-stream">,
	cacheRetention: CacheRetention,
	env?: ProviderEnv,
): SystemContentBlock[] | undefined {
	if (!systemPrompt) return undefined;

	const blocks: SystemContentBlock[] = [{ text: sanitizeSurrogates(systemPrompt) }];

	// 中文：启用缓存时，为支持此功能的 Claude 模型添加缓存点。
	// Add cache point for supported Claude models when caching is enabled
	if (cacheRetention !== "none" && supportsPromptCaching(model, env)) {
		blocks.push({
			cachePoint: { type: CachePointType.DEFAULT, ...(cacheRetention === "long" ? { ttl: CacheTTL.ONE_HOUR } : {}) },
		});
	}

	return blocks;
}

function normalizeToolCallId(id: string): string {
	const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, "_");
	return sanitized.length > 64 ? sanitized.slice(0, 64) : sanitized;
}

function createNonBlankTextBlock(text: string): ContentBlock.TextMember | undefined {
	const sanitized = sanitizeSurrogates(text);
	return sanitized.trim().length === 0 ? undefined : { text: sanitized };
}

function createRequiredTextBlock(text: string): ContentBlock.TextMember {
	return createNonBlankTextBlock(text) ?? { text: EMPTY_TEXT_PLACEHOLDER };
}

function sanitizeBedrockDocument(value: DocumentType): DocumentType {
	if (Array.isArray(value)) {
		return value.map(sanitizeBedrockDocument);
	}
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([key]) => key.length > 0)
				.map(([key, nestedValue]) => [key, sanitizeBedrockDocument(nestedValue)]),
		);
	}
	return value;
}

function convertToolResultContent(content: (TextContent | ImageContent)[]): ToolResultContentBlock[] {
	const result: ToolResultContentBlock[] = [];
	for (const c of content) {
		if (c.type === "image") {
			result.push({ image: createImageBlock(c.mimeType, c.data) });
		} else {
			const textBlock = createNonBlankTextBlock(c.text);
			if (textBlock) result.push(textBlock);
		}
	}
	if (result.length === 0) result.push({ text: EMPTY_TEXT_PLACEHOLDER });
	return result;
}

function convertMessages(
	context: Context,
	model: Model<"bedrock-converse-stream">,
	cacheRetention: CacheRetention,
	env?: ProviderEnv,
): Message[] {
	const result: Message[] = [];
	const transformedMessages = transformMessages(context.messages, model, normalizeToolCallId);

	for (let i = 0; i < transformedMessages.length; i++) {
		const m = transformedMessages[i];

		switch (m.role) {
			case "user": {
				const content: ContentBlock[] = [];
				if (typeof m.content === "string") {
					content.push(createRequiredTextBlock(m.content));
				} else {
					for (const c of m.content) {
						switch (c.type) {
							case "text": {
								const textBlock = createNonBlankTextBlock(c.text);
								if (textBlock) content.push(textBlock);
								break;
							}
							case "image":
								content.push({ image: createImageBlock(c.mimeType, c.data) });
								break;
							default:
								continue;
						}
					}
					if (content.length === 0) content.push({ text: EMPTY_TEXT_PLACEHOLDER });
				}
				result.push({
					role: ConversationRole.USER,
					content,
				});
				break;
			}
			case "assistant": {
				// 中文：跳过内容为空的助手消息，例如被中止请求留下的消息；Bedrock 拒绝内容数组为空的消息。
				// Skip assistant messages with empty content (e.g., from aborted requests)
				// Bedrock rejects messages with empty content arrays
				if (m.content.length === 0) {
					continue;
				}
				const contentBlocks: ContentBlock[] = [];
				for (const c of m.content) {
					switch (c.type) {
						case "text": {
							// 中文：跳过空文本块。
							// Skip empty text blocks
							const textBlock = createNonBlankTextBlock(c.text);
							if (!textBlock) continue;
							contentBlocks.push(textBlock);
							break;
						}
						case "toolCall":
							contentBlocks.push({
								toolUse: { toolUseId: c.id, name: c.name, input: sanitizeBedrockDocument(c.arguments) },
							});
							break;
						case "thinking": {
							// 中文：加密推理是不透明的：将已保存载荷作为 redactedContent 成员回放，不将其转换为推理文本。
							// Encrypted reasoning is opaque: replay the stored payload as the
							// `redactedContent` member instead of lowering it to reasoning text.
							if (c.redacted) {
								const redactedContent = decodeRedactedContent(c.thinkingSignature);
								if (redactedContent?.length) {
									contentBlocks.push({ reasoningContent: { redactedContent } });
								}
								continue;
							}
							// 中文：跳过空思考块。
							// Skip empty thinking blocks
							const thinking = sanitizeSurrogates(c.thinking);
							if (thinking.trim().length === 0) continue;
							// 中文：只有 Anthropic 模型支持 reasoningText 中的 signature 字段。其他模型省略签名，以避免“不支持
							// reasoningContent.reasoningText.signature 字段”等错误。
							// Only Anthropic models support the signature field in reasoningText.
							// For other models, we omit the signature to avoid errors like:
							// "This model doesn't support the reasoningContent.reasoningText.signature field"
							if (supportsThinkingSignature(model)) {
								// 中文：签名在思考增量之后到达。部分消息或外部持久化消息若缺少签名，Bedrock 会拒绝回放的推理块。此时回退为纯文本，与 Anthropic 处理一致。
								// Signatures arrive after thinking deltas. If a partial or externally
								// persisted message lacks a signature, Bedrock rejects the replayed
								// reasoning block. Fall back to plain text, matching Anthropic.
								if (!c.thinkingSignature || c.thinkingSignature.trim().length === 0) {
									contentBlocks.push({ text: thinking });
								} else {
									contentBlocks.push({
										reasoningContent: {
											reasoningText: {
												text: thinking,
												signature: c.thinkingSignature,
											},
										},
									});
								}
							} else {
								contentBlocks.push({
									reasoningContent: {
										reasoningText: { text: thinking },
									},
								});
							}
							break;
						}
						default:
							continue;
					}
				}
				// 中文：所有内容块都被过滤掉时跳过该消息。
				// Skip if all content blocks were filtered out
				if (contentBlocks.length === 0) {
					continue;
				}
				result.push({
					role: ConversationRole.ASSISTANT,
					content: contentBlocks,
				});
				break;
			}
			case "toolResult": {
				// 中文：将所有连续的 toolResult 消息收集到一条用户消息中；Bedrock 要求所有工具结果放在同一条消息里。
				// Collect all consecutive toolResult messages into a single user message
				// Bedrock requires all tool results to be in one message
				const toolResults: ContentBlock.ToolResultMember[] = [];

				// 中文：添加当前工具结果，并组合其全部内容块。
				// Add current tool result with all content blocks combined
				toolResults.push({
					toolResult: {
						toolUseId: m.toolCallId,
						content: convertToolResultContent(m.content),
						status: m.isError ? ToolResultStatus.ERROR : ToolResultStatus.SUCCESS,
					},
				});

				// 中文：向后查看连续的 toolResult 消息。
				// Look ahead for consecutive toolResult messages
				let j = i + 1;
				while (j < transformedMessages.length && transformedMessages[j].role === "toolResult") {
					const nextMsg = transformedMessages[j] as ToolResultMessage;
					toolResults.push({
						toolResult: {
							toolUseId: nextMsg.toolCallId,
							content: convertToolResultContent(nextMsg.content),
							status: nextMsg.isError ? ToolResultStatus.ERROR : ToolResultStatus.SUCCESS,
						},
					});
					j++;
				}

				// 中文：跳过已经处理的消息。
				// Skip the messages we've already processed
				i = j - 1;

				result.push({
					role: ConversationRole.USER,
					content: toolResults,
				});
				break;
			}
			default:
				continue;
		}
	}

	// 中文：启用缓存时，为支持此功能的 Claude 模型在最后一条用户消息上添加缓存点。
	// Add cache point to the last user message for supported Claude models when caching is enabled
	if (cacheRetention !== "none" && supportsPromptCaching(model, env) && result.length > 0) {
		const lastMessage = result[result.length - 1];
		if (lastMessage.role === ConversationRole.USER && lastMessage.content) {
			(lastMessage.content as ContentBlock[]).push({
				cachePoint: {
					type: CachePointType.DEFAULT,
					...(cacheRetention === "long" ? { ttl: CacheTTL.ONE_HOUR } : {}),
				},
			});
		}
	}

	return result;
}

function convertToolConfig(
	tools: Tool[] | undefined,
	toolChoice: BedrockOptions["toolChoice"],
	supportsStrictMode: boolean,
): ToolConfiguration | undefined {
	if (!tools?.length) return undefined;
	if (toolChoice === "none") return undefined;

	const bedrockTools: BedrockTool[] = tools.map((tool) => {
		const strict = resolveJsonSchemaStrictSampling(tool, supportsStrictMode);
		return {
			toolSpec: {
				name: tool.name,
				description: tool.description,
				inputSchema: { json: getJsonSchemaToolParameters(tool, strict) as unknown as DocumentType },
				...(strict === true ? { strict: true } : {}),
			},
		};
	});

	let bedrockToolChoice: ToolChoice | undefined;
	switch (toolChoice) {
		case "auto":
			bedrockToolChoice = { auto: {} };
			break;
		case "any":
			bedrockToolChoice = { any: {} };
			break;
		default:
			if (toolChoice?.type === "tool") {
				bedrockToolChoice = { tool: { name: toolChoice.name } };
			}
	}

	return { tools: bedrockTools, toolChoice: bedrockToolChoice };
}

function mapStopReason(reason: string | undefined): { stopReason: StopReason; errorMessage?: string } {
	switch (reason) {
		case BedrockStopReason.END_TURN:
		case BedrockStopReason.STOP_SEQUENCE:
			return { stopReason: "stop" };
		case BedrockStopReason.MAX_TOKENS:
		case BedrockStopReason.MODEL_CONTEXT_WINDOW_EXCEEDED:
			return { stopReason: "length" };
		case BedrockStopReason.TOOL_USE:
			return { stopReason: "toolUse" };
		default:
			return reason
				? { stopReason: "error", errorMessage: `Provider stopped with: ${reason}` }
				: { stopReason: "error" };
	}
}

function getConfiguredBedrockRegion(options: BedrockOptions): string | undefined {
	return (
		options.region ||
		getProviderEnvValue("AWS_REGION", options.env) ||
		getProviderEnvValue("AWS_DEFAULT_REGION", options.env) ||
		undefined
	);
}

function getConfiguredBedrockCredentials(env?: ProviderEnv): BedrockRuntimeClientConfig["credentials"] | undefined {
	const accessKeyId = getProviderEnvValue("AWS_ACCESS_KEY_ID", env);
	const secretAccessKey = getProviderEnvValue("AWS_SECRET_ACCESS_KEY", env);
	if (!accessKeyId || !secretAccessKey) {
		return undefined;
	}
	const sessionToken = getProviderEnvValue("AWS_SESSION_TOKEN", env);
	return {
		accessKeyId,
		secretAccessKey,
		...(sessionToken ? { sessionToken } : {}),
	};
}

function getStandardBedrockEndpointRegion(baseUrl: string | undefined): string | undefined {
	if (!baseUrl) {
		return undefined;
	}

	try {
		const { hostname } = new URL(baseUrl);
		const match = hostname.toLowerCase().match(/^bedrock-runtime(?:-fips)?\.([a-z0-9-]+)\.amazonaws\.com(?:\.cn)?$/);
		return match?.[1];
	} catch {
		return undefined;
	}
}

function shouldUseExplicitBedrockEndpoint(
	baseUrl: string,
	configuredRegion: string | undefined,
	hasAmbientConfiguredProfile: boolean,
): boolean {
	const endpointRegion = getStandardBedrockEndpointRegion(baseUrl);
	if (!endpointRegion) {
		return true;
	}

	return !configuredRegion && !hasAmbientConfiguredProfile;
}

function isGovCloudBedrockTarget(model: Model<"bedrock-converse-stream">, options: BedrockOptions): boolean {
	const region = getConfiguredBedrockRegion(options);
	if (region?.toLowerCase().startsWith("us-gov-")) {
		return true;
	}

	const modelId = model.id.toLowerCase();
	return modelId.startsWith("us-gov.") || modelId.startsWith("arn:aws-us-gov:");
}

function buildAdditionalModelRequestFields(
	model: Model<"bedrock-converse-stream">,
	options: BedrockOptions,
): Record<string, any> | undefined {
	if (!options.reasoning || !model.reasoning) {
		return undefined;
	}

	if (isAnthropicClaudeModel(model)) {
		// 中文：GovCloud Bedrock 当前拒绝 Claude 的 thinking.display 字段。在 GovCloud Converse schema 支持之前
		// ，省略此字段。
		// GovCloud Bedrock currently rejects the Claude thinking.display field.
		// Omit it there until the GovCloud Converse schema catches up.
		const display = isGovCloudBedrockTarget(model, options) ? undefined : (options.thinkingDisplay ?? "summarized");
		const result: Record<string, any> = supportsAdaptiveThinking(model.id, model.name)
			? {
					thinking: { type: "adaptive", ...(display !== undefined ? { display } : {}) },
					output_config: { effort: mapThinkingLevelToEffort(model, options.reasoning) },
				}
			: (() => {
					const defaultBudgets: Record<ThinkingLevel, number> = {
						minimal: 1024,
						low: 2048,
						medium: 8192,
						high: 16384,
						// 中文：采用预算方式的 Claude 将扩展级别限制为 high。
						xhigh: 16384, // Budget-based Claude clamps extended levels to high
						max: 16384,
					};

					// 中文：自定义预算仅覆盖最高到 high 的 token 预算级别。
					// Custom budgets only cover token-based levels through high.
					const level = options.reasoning === "xhigh" || options.reasoning === "max" ? "high" : options.reasoning;
					const budget = options.thinkingBudgets?.[level] ?? defaultBudgets[options.reasoning];

					return {
						thinking: {
							type: "enabled",
							budget_tokens: budget,
							...(display !== undefined ? { display } : {}),
						},
					};
				})();

		if (!supportsAdaptiveThinking(model.id, model.name) && (options.interleavedThinking ?? true)) {
			result.anthropic_beta = ["interleaved-thinking-2025-05-14"];
		}

		return result;
	}

	return undefined;
}

function createImageBlock(mimeType: string, data: string) {
	let format: ImageFormat;
	switch (mimeType) {
		case "image/jpeg":
		case "image/jpg":
			format = ImageFormat.JPEG;
			break;
		case "image/png":
			format = ImageFormat.PNG;
			break;
		case "image/gif":
			format = ImageFormat.GIF;
			break;
		case "image/webp":
			format = ImageFormat.WEBP;
			break;
		default:
			throw new Error(`Unknown image type: ${mimeType}`);
	}

	return { source: { bytes: base64ToBytes(data) }, format };
}

function base64ToBytes(data: string): Uint8Array {
	const binaryString = atob(data);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return bytes;
}

// 中文：解码已保存的隐藏载荷。AWS SDK 以字节形式提供二进制数据，而持久化会话以 base64 保存。手工编辑或外部生成的会话可能含有非 base64 签名；此时丢弃
// 该块，避免整个请求失败。
/**
 * Decodes a stored redacted payload. The AWS SDK hands the blob over as bytes, but a
 * persisted session carries it as base64. A hand-edited or externally produced session
 * can hold a signature that is not base64; drop that block instead of failing the
 * whole request.
 */
function decodeRedactedContent(signature: string | undefined): Uint8Array | undefined {
	if (!signature) return undefined;
	try {
		return base64ToBytes(signature);
	} catch {
		return undefined;
	}
}

function bytesToBase64(chunks: Uint8Array[]): string {
	// 中文：加密推理可达数十 KB，因此分片构造二进制字符串，避免逐字节拼接。窗口大小保持在引擎对展开参数调用的参数数量限制之内。
	// Encrypted reasoning runs to tens of KB, so build the binary string in slices
	// rather than one concatenation per byte. The window stays under the engine's
	// argument-count limit for spread calls.
	const WINDOW = 0x8000;
	let binary = "";
	for (const chunk of chunks) {
		for (let i = 0; i < chunk.length; i += WINDOW) {
			binary += String.fromCharCode(...chunk.subarray(i, i + WINDOW));
		}
	}
	return btoa(binary);
}

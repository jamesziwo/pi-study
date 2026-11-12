import type { AssistantMessage } from "../types.ts";

function buildProviderErrorPattern(patterns: readonly string[]): RegExp {
	return new RegExp(patterns.join("|"), "i");
}

const NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN = buildProviderErrorPattern([
	// 中文：OpenCode Zen API 将 OpenCode Go 或免费套餐限制作为 429 JSON 错误类型返回。这些是订阅或账号限制，不是临时限流。
	// OpenCode Go/free-tier limits returned as 429 JSON error types by OpenCode's
	// Zen API. These are subscription/account limits, not transient throttles.
	"GoUsageLimitError",
	"FreeUsageLimitError",

	// 中文：达到滚动、每周或每月上限后，OpenCode Go 的订阅限制文本会要求用户启用可用余额用量。
	// OpenCode Go subscription-limit text asks users to enable available-balance
	// usage after rolling/weekly/monthly limits are reached.
	"Monthly usage limit reached",
	"available balance",

	// 中文：通用配额、预算或账单额度耗尽。`insufficient_quota` 是 OpenAI 的配额或计费错误码，其他字符串覆盖常见网关措辞。
	// Generic quota/budget/billing exhaustion. `insufficient_quota` is OpenAI's
	// quota/billing error code; the other strings cover common gateway wording.
	"insufficient_quota",
	"out of budget",
	"quota exceeded",
	"billing",
]);

const RETRYABLE_PROVIDER_ERROR_PATTERN = buildProviderErrorPattern([
	// 中文：通用的提供方负载、HTTP 状态及服务端临时故障。
	// Generic provider load, HTTP status, and server-side transient failures.
	"overloaded",
	"rate.?limit",
	"too many requests",
	"429",
	"500",
	"502",
	"503",
	"504",
	"524",
	"service.?unavailable",
	"server.?error",
	"internal.?error",

	// 中文：包装层或提供方对上游临时故障的描述，包括 OpenRouter 的 "Provider returned error" 响应（#2264）。
	// Wrapper/provider text for transient upstream failures, including OpenRouter
	// "Provider returned error" responses (#2264).
	"provider.?returned.?error",
	"exceeded request buffer limit while retrying upstream",

	// 中文：网络、代理和 fetch 传输故障。包括 OpenAI Codex 的原始 fetch 故障，如 "upstream connect"、"connection
	// refused"、"reset before headers"（#733），以及 OpenRouter 连接断开（#3317）。
	// Network, proxy, and fetch transport failures. This includes OpenAI Codex
	// raw-fetch failures such as "upstream connect", "connection refused", and
	// "reset before headers" (#733), plus OpenRouter connection drops (#3317).
	"network.?error",
	"connection.?error",
	"connection.?refused",
	"connection.?lost",
	"other side closed",
	"fetch failed",
	"getaddrinfo",
	"ENOTFOUND",
	"EAI_AGAIN",
	"upstream.?connect",
	"reset before headers",
	"socket hang up",
	"socket connection was closed",
	"timed? out",
	"timeout",
	"terminated",

	// 中文：WebSocket 传输可能报告关闭或错误文本，而非 HTTP/fetch 文本。
	// WebSocket transports can report close/error text instead of HTTP/fetch text.
	"websocket.?closed",
	"websocket.?error",

	// 中文：SDK 和传输层导致的流提前结束。Anthropic 可能抛出 "stream ended without ..." 和 "Anthropic stream
	// ended before message_stop"（#4433）；Bedrock/Smithy 可能抛出 HTTP/2 无响应错误（#3594）。
	// Premature stream endings from SDKs and transports. Anthropic can throw
	// "stream ended without ..." and "Anthropic stream ended before message_stop"
	// (#4433); Bedrock/Smithy can throw an HTTP/2 no-response error (#3594).
	"ended without",
	"stream ended before message_stop",
	"stream ended before a terminal response event",
	"http2 request did not get a response",

	// 中文：提供方要求的重试延迟超过上限时，应交由外层重试策略处理，使调用方可展示或中止退避（#1123）。
	// Provider-requested retry delay cap failures should flow through the outer
	// retry policy so callers can surface/abort the backoff (#1123).
	"retry delay",

	// 中文：OpenAI Responses 和 Bedrock 流异常在流中明确给出的重试提示（#6019）。
	// Explicit retry guidance emitted mid-stream by OpenAI Responses and Bedrock
	// stream exceptions (#6019).
	"you can retry your request",
	"try your request again",
	"please retry your request",

	// 中文：基于 gRPC 的提供方，例如 NVIDIA NIM。
	// gRPC based providers (e.g. NVIDIA NIM)
	"ResourceExhausted",
]);

// 中文：重试策略：次数有上限，使用指数退避（`baseDelayMs * 2^(attempt-1)`）。`maxAgentDelayMs` 限制每次计算出的延迟，默认
// 60 秒。与 coding-agent 中的 `settings.retry`（`enabled`、`maxRetries`、`baseDelayMs`、
// `maxAgentDelayMs`）对应；放在这里，使错误分类器与策略驱动的重试循环位于一起，可被 SDK 和其他调用方复用。
/**
 * Retry policy: bounded attempts with exponential backoff (`baseDelayMs * 2^(attempt-1)`).
 * `maxAgentDelayMs` caps each computed delay and defaults to 60 seconds.
 * Matches `settings.retry` (`enabled`, `maxRetries`, `baseDelayMs`, `maxAgentDelayMs`) in coding-agent; kept
 * here so the classifier and the policy-driven retry loop live together and stay reusable
 * by the SDK and other callers.
 */
export interface RetryPolicy {
	enabled: boolean;
	// 中文：最大重试次数，0 表示不重试。初次调用不计入重试次数。
	/** Max retry attempts (0 = no retries). The initial call never counts as a retry. */
	maxRetries: number;
	// 中文：基础延迟，单位为毫秒。加入抖动前，每次延迟为 `baseDelayMs * 2^(attempt-1)`。
	/** Base delay in ms. Per-attempt delay is `baseDelayMs * 2^(attempt-1)` before jitter. */
	baseDelayMs: number;
	// 中文：可选的智能体级重试延迟上限，单位为毫秒，默认 60 秒。
	/** Optional cap for agent-level retry delays in ms. Defaults to 60 seconds. */
	maxAgentDelayMs?: number;
}

export const DEFAULT_MAX_AGENT_RETRY_DELAY_MS = 60_000;

export function retryDelayMs(policy: Pick<RetryPolicy, "baseDelayMs" | "maxAgentDelayMs">, attempt: number): number {
	const delay = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
	const safeDelay = Number.isSafeInteger(delay) ? delay : Number.MAX_SAFE_INTEGER;
	return Math.min(safeDelay, policy.maxAgentDelayMs ?? DEFAULT_MAX_AGENT_RETRY_DELAY_MS);
}

// 中文：{@link retryAssistantCall} 在每次重试前后触发的可选回调。
/** Optional callbacks emitted by {@link retryAssistantCall} around each retry. */
export interface RetryCallbacks {
	// 中文：每次重试的退避等待之前触发，重试序号从 1 开始。
	/** Emitted before the backoff sleep of each retry attempt (1-indexed). */
	onRetryScheduled?: (
		attempt: number,
		maxAttempts: number,
		delayMs: number,
		errorMessage: string,
	) => void | Promise<void>;
	// 中文：退避等待之后、重试调用开始之前立即触发。
	/** Emitted after the backoff sleep, immediately before the retried call starts. */
	onRetryAttemptStart?: () => void | Promise<void>;
	// 中文：循环结束时触发一次；若后续调用正常完成，则表示成功。
	/** Emitted once when the loop ends: success if a later call completed normally. */
	onRetryFinished?: (success: boolean, attempt: number, finalError?: string) => void | Promise<void>;
}

class RetrySleepAbortError extends Error {
	constructor() {
		super("Aborted");
	}
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new RetrySleepAbortError());
			return;
		}
		const timeout = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timeout);
				reject(new RetrySleepAbortError());
			},
			{ once: true },
		);
	});
}

// 中文：执行一次产生助手消息的调用，并对临时错误进行有界重试。成功响应立即返回；中止是终止状态，绝不重试，但若发生在已安排重试之后则报告不成功。退避等待期间的中止也规范化为
//  aborted 的 `AssistantMessage`，调用方无需关心取消发生的时点。不可重试错误（由 {@link
// isRetryableAssistantError} 判断，包括配额或计费额度耗尽）立即返回，使确定性错误快速失败。其他情形按指数退避最多重试 `maxRetries`
// 次：每次等待前触发 `onRetryScheduled`，等待后且重试开始前触发 `onRetryAttemptStart`，最终触发一次
// `onRetryFinished`，无论因成功、次数耗尽还是退避中止而结束。`policy` 未定义或被禁用时，原样返回第一次响应，等价于直接调用 `produce()`
// 。
/**
 * Run a single assistant-producing call with bounded retry on transient errors.
 *
 * Behavior:
 * - A successful response is returned immediately. Aborts are terminal and never
 *   retried, but reported as unsuccessful if they happen after a retry was scheduled.
 *   Aborts during the backoff sleep are normalized to an aborted `AssistantMessage`
 *   too, so callers do not need to care when cancellation happened.
 * - A non-retryable error (per {@link isRetryableAssistantError}, including quota/
 *   billing exhaustion) is returned immediately so deterministic errors fail fast.
 * - Otherwise retries up to `maxRetries` times with exponential backoff, emitting
 *   `onRetryScheduled` before each sleep, `onRetryAttemptStart` after each sleep before
 *   the retried call starts, and `onRetryFinished` once at the end (whether the loop
 *   ends in success, exhausted retries, or an aborted backoff).
 *
 * When `policy` is undefined or disabled, the first response is returned unchanged
 * (equivalent to calling `produce()` directly).
 */
export async function retryAssistantCall(
	produce: () => Promise<AssistantMessage>,
	policy: RetryPolicy | undefined,
	signal: AbortSignal | undefined,
	callbacks?: RetryCallbacks,
): Promise<AssistantMessage> {
	const maxAttempts = policy?.enabled ? policy.maxRetries : 0;

	let attempt = 0;
	let lastRetry: { attempt: number; errorMessage: string } | undefined;
	for (;;) {
		const response = await produce();

		// 中文：中止：属于终止状态，但不算成功。绝不重试已中止的消息。
		// Abort: terminal but not successful. Never retry an aborted message.
		if (response.stopReason === "aborted") {
			if (lastRetry) await callbacks?.onRetryFinished?.(false, lastRetry.attempt);
			return response;
		}

		// 中文：成功：非错误、非中止的响应原样返回。
		// Success: non-error, non-abort responses return as-is.
		if (response.stopReason !== "error") {
			if (lastRetry) await callbacks?.onRetryFinished?.(true, lastRetry.attempt);
			return response;
		}

		// 中文：不可重试或预算耗尽：返回最终错误消息。
		// Non-retryable, or budget exhausted: return the final error message.
		if (attempt >= maxAttempts || !isRetryableAssistantError(response)) {
			if (lastRetry) await callbacks?.onRetryFinished?.(false, lastRetry.attempt, response.errorMessage);
			return response;
		}

		attempt++;
		lastRetry = { attempt, errorMessage: response.errorMessage || "Unknown error" };
		const delayMs = retryDelayMs(policy!, attempt);
		await callbacks?.onRetryScheduled?.(attempt, maxAttempts, delayMs, lastRetry.errorMessage);

		// 中文：将退避期间的中止规范化为与提供方流中止相同的 AssistantMessage 结构，使调用方无需关心取消发生的时间。
		// Normalize aborts during retry backoff to the same AssistantMessage shape as
		// provider stream aborts, so callers do not need to care when cancellation happened.
		try {
			await sleep(delayMs, signal);
		} catch (error) {
			await callbacks?.onRetryFinished?.(false, attempt, lastRetry.errorMessage);
			if (error instanceof RetrySleepAbortError) {
				const { errorMessage: _errorMessage, ...rest } = response;
				return { ...rest, stopReason: "aborted" };
			}
			throw error;
		}
		await callbacks?.onRetryAttemptStart?.();
	}
}

// 中文：判断失败的助手消息是否像提供方或传输层的临时错误，以便调用方决定是否重启最后一轮助手处理。此函数不实现重试策略；调用方应先单独处理上下文溢出，再应用自己的次数预算、
// 退避和报告逻辑，然后重新开始助手轮次。
/**
 * Classifies whether a failed assistant message looks like a transient provider
 * or transport error, so callers can decide if the last assistant turn should be
 * restarted.
 *
 * This does not implement retry policy. Callers should first handle context
 * overflow separately, then apply their own retry budget, backoff, and reporting
 * before restarting the assistant turn.
 */
export function isRetryableAssistantError(message: AssistantMessage): boolean {
	if (message.stopReason !== "error" || !message.errorMessage) return false;
	const errorMessage = message.errorMessage;
	if (NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN.test(errorMessage)) return false;
	return RETRYABLE_PROVIDER_ERROR_PATTERN.test(errorMessage);
}

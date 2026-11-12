// 中文：提供方 HTTP 错误对象的共用规范化逻辑。代理或网关后的端点可能返回非 2xx 响应，而提供方 SDK 无法将其响应体纳入 `error.message`。SDK
//  错误对象仍携带 HTTP 状态及原始或已解析的响应体，但字段名因 SDK 而异。仅读取 `error.message` 的 catch 块因此会丢失响应体，显示含糊的
// `"403 status code (no body)"`，或退化为 `"Unknown: UnknownError"`。`normalizeProviderError`
//  探测已知 SDK 字段结构（Mistral、`openai`、`@google/genai`、AWS Bedrock），返回结构化结果，供各提供方组合显示字符串。
// `messageCarriesBody` 标记 Anthropic / `@google/genai` 已将响应体纳入消息的正常情形，以保留内容并避免重复打印。
// Shared normalization for provider HTTP error objects.
//
// Endpoints behind a proxy / gateway may return a non-2xx response whose body
// the provider SDK cannot fold into `error.message`. The SDK error object still
// carries the HTTP status and the raw/parsed body, but under SDK-specific field
// names. Provider catch blocks that read only `error.message` therefore drop
// the body and surface opaque messages like `"403 status code (no body)"` or
// collapse to `"Unknown: UnknownError"`.
//
// `normalizeProviderError` probes the known SDK field shapes (Mistral,
// `openai`, `@google/genai`, AWS Bedrock) and returns a struct each provider
// composes into its display string. The `messageCarriesBody` flag captures the
// Anthropic / `@google/genai` happy path where the SDK already folded the body
// into the message, so providers can preserve it without double-printing.

export const MAX_PROVIDER_ERROR_BODY_CHARS = 4000;

export interface NormalizedProviderError {
	// 中文：可从 SDK 错误对象提取时记录的 HTTP 状态码。
	/** HTTP status code, when one could be extracted from the SDK error object. */
	status?: number;
	// 中文：原始 HTTP 响应体中的原因文本，已去除首尾空白并按上限截断。
	/** Raw HTTP body reason, already trimmed and truncated to the cap. */
	body?: string;
	// 中文：`error.message`；若抛出的不是 `Error`，则使用 `safeJsonStringify(error)`。
	/** `error.message`, or `safeJsonStringify(error)` for a non-`Error` throw. */
	message: string;
	// 中文：当 `message` 已包含响应体时为 true，无需另外追加响应体。
	/** True when `message` already contains the body (no separate body to add). */
	messageCarriesBody: boolean;
}

type SdkErrorShape = Error & {
	statusCode?: unknown;
	status?: unknown;
	body?: unknown;
	error?: unknown;
	$metadata?: { httpStatusCode?: unknown };
	$response?: { statusCode?: unknown; body?: unknown };
};

export function normalizeProviderError(error: unknown): NormalizedProviderError {
	if (!(error instanceof Error)) {
		return { message: safeJsonStringify(error), messageCarriesBody: false };
	}

	const sdkError = error as SdkErrorShape;
	const status = extractStatus(sdkError);
	const body = extractBody(sdkError);
	const messageCarriesBody = body === undefined || error.message.includes(body);

	return {
		status,
		body,
		message: error.message,
		messageCarriesBody,
	} satisfies NormalizedProviderError;
}

// 中文：按 SDK 字段顺序探测 HTTP 状态，取第一个数值：`statusCode`（Mistral）→ `status`（`openai`、
// `@google/genai`）→ `$metadata.httpStatusCode`（Bedrock）→ `$response.statusCode`（Bedrock
// ）。
/**
 * Probe the HTTP status, first numeric hit wins, in SDK-field order:
 * `statusCode` (Mistral) → `status` (`openai`, `@google/genai`) →
 * `$metadata.httpStatusCode` (Bedrock) → `$response.statusCode` (Bedrock).
 */
function extractStatus(error: SdkErrorShape): number | undefined {
	if (typeof error.statusCode === "number") return error.statusCode;
	if (typeof error.status === "number") return error.status;
	if (typeof error.$metadata?.httpStatusCode === "number") return error.$metadata.httpStatusCode;
	if (typeof error.$response?.statusCode === "number") return error.$response.statusCode;
	return undefined;
}

// 中文：按 SDK 字段顺序探测原始响应体原因，取第一个可用值：`body` 字符串（Mistral）→ 已解析的 JSON 响应体对象 `error`（`openai`
// SDK 的 `this.error`）→ `$response.body`（Bedrock）。空对象和未读取的响应流视为无响应体，避免显示 `"{}"` 或序列化后的流内
// 部结构。选中的响应体按上限截断。
/**
 * Probe the raw body reason, first usable hit wins, in SDK-field order:
 * `body` string (Mistral) → `error` parsed JSON body object (`openai` SDK's
 * `this.error`) → `$response.body` (Bedrock). Empty objects and unread response
 * streams are treated as no body so they do not surface as `"{}"` or serialized
 * stream internals. The chosen body is truncated to the cap.
 */
function extractBody(error: SdkErrorShape): string | undefined {
	const bodyText = pickBodyText(error);
	if (bodyText === undefined) return undefined;
	const trimmed = bodyText.trim();
	if (trimmed.length === 0) return undefined;
	return truncateErrorText(trimmed, MAX_PROVIDER_ERROR_BODY_CHARS);
}

function pickBodyText(error: SdkErrorShape): string | undefined {
	if (typeof error.body === "string") return error.body;
	if (isPlainNonEmptyObject(error.error)) return safeJsonStringify(error.error);
	const responseBody = error.$response?.body;
	if (typeof responseBody === "string") return responseBody;
	if (isReadableStreamLike(responseBody)) return undefined;
	if (isPlainNonEmptyObject(responseBody)) return safeJsonStringify(responseBody);
	return undefined;
}

function isReadableStreamLike(value: unknown): boolean {
	return typeof value === "object" && value !== null && "pipe" in value && typeof value.pipe === "function";
}

// 中文：只有普通对象才算 HTTP 响应体。SDK 错误字段可能保存类实例而非已解析的响应体：AWS SDK v3 的 `$response.body` 是 HTTP 流或
// 响应包装对象，将其字符串化会产生 `{"_events":...}` 等无用内容，并在组合显示字符串时替换掉 `error.message`。SDK 将实际反序列化后的异
// 常文本（如 "Input is too long..."、schema 校验详情等）放在 `error.message` 中，因此唯一有用的字符串反被噪声替代。类实例应视
// 为无响应体，使 `messageCarriesBody` 保持 true，保留真正的消息。这补充了前面的 `pipe` 检测：Web ReadableStream（含
// pipeTo/pipeThrough、无 `pipe`）和非流的 SDK 包装类无法通过原型检查，而解析得到的 JSON 响应体天然是普通对象，仍可通过。
/**
 * Only a PLAIN object counts as an HTTP body. SDK error fields can hold class
 * instances instead of parsed bodies — AWS SDK v3's `$response.body` is an
 * HTTP stream/response wrapper object, and stringifying one produced garbage
 * like `{"_events":...}` as the "body", which then REPLACED `error.message`
 * in the composed display string. `error.message` is where the SDK puts the
 * real deserialized exception text ("Input is too long...", schema validation
 * details, ...), so the one useful string was discarded for noise. A class
 * instance yields no body, `messageCarriesBody` stays true, and the real
 * message survives. Complements the `pipe` sniffing above: web
 * ReadableStreams (pipeTo/pipeThrough, no `pipe`) and non-stream SDK wrapper
 * classes fail the prototype check, while parsed JSON bodies (plain objects
 * by construction) still pass.
 */
function isPlainNonEmptyObject(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) return false;
	return Object.keys(value).length > 0;
}

// 中文：由规范化错误组合显示字符串。如果消息已包含响应体（Anthropic / `@google/genai` 的正常路径），或未提取到响应体或状态，则返回原消息。否则显
// 示状态和响应体，可加提供方前缀。不带前缀：`"<status>: <body>"`；带前缀：`"<prefix> (<status>): <body>"`。
/**
 * Compose a display string from a normalized error. When the message already
 * carries the body (Anthropic / `@google/genai` happy path) or no body/status
 * was extracted, the message is returned unchanged. Otherwise the status and
 * body are surfaced, with an optional provider prefix.
 *
 * - no prefix: `"<status>: <body>"`
 * - prefix:    `"<prefix> (<status>): <body>"`
 */
export function formatProviderError(norm: NormalizedProviderError, prefix?: string): string {
	if (norm.messageCarriesBody || norm.status === undefined || norm.body === undefined) {
		return prefix !== undefined && norm.status !== undefined
			? `${prefix} (${norm.status}): ${norm.message}`
			: norm.message;
	}
	return prefix !== undefined ? `${prefix} (${norm.status}): ${norm.body}` : `${norm.status}: ${norm.body}`;
}

export function truncateErrorText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}... [truncated ${text.length - maxChars} chars]`;
}

export function safeJsonStringify(value: unknown): string {
	try {
		const serialized = JSON.stringify(value);
		return serialized === undefined ? String(value) : serialized;
	} catch {
		return String(value);
	}
}

import type { AssistantMessage } from "../types.ts";

// 中文：检测不同提供方上下文溢出的正则模式，用于匹配输入超过模型上下文窗口时的错误消息。各提供方示例依次为：Anthropic 报提示词过长（213462 token 超过
//  200000 上限），或 HTTP 413 的 request_too_large / Request exceeds the maximum size；OpenAI
// 报输入超过模型上下文窗口；OpenAI/LiteLLM 报请求 token 数超过 131072 上限；OpenAI 兼容服务报输入长度 265330 超过 262144
// ；Google 报输入 1196265 token 超过 1048575；xAI 报最大提示长度 131072、请求包含 537812；Groq 要求缩短消息或补全；
// OpenRouter 报最大 X token、请求约 Y token；OpenRouter/Poolside 报输入 X 超过允许的 Y；Together AI 报输入
// X token 长于模型上下文 Y token；llama.cpp 报请求超过可用上下文并建议增大；LM Studio 报初始提示中要保留的 token 多于上下文长度；
// GitHub Copilot 报提示 token 数 X 超过 Y；MiniMax 报参数无效、上下文窗口超限；Kimi For Coding 报超过模型 token 限
// 制 X（请求 Y）；DS4 报提示 X token、配置上下文 Y；Cerebras 报 400/413 且无响应体；Mistral 报提示 X token 超过模型最大
// 上下文 Y。z.ai 不报错而静默接受溢出，通过 usage.input > contextWindow 处理。Xiaomi MiMo 将输入截断到刚好填满
// contextWindow，返回 finish_reason "length" 且 output=0（无生成空间），通过 stopReason "length"、零输出和
// 填满上下文联合检测。DashScope/Qwen 报输入长度应在 [1, X] 范围（HTTP 400 invalid_parameter_error）。Ollama 某
// 些部署静默截断，另一些报提示过长、超过最大上下文 X token。原始错误字符串保留在下方英文示例中。
/**
 * Regex patterns to detect context overflow errors from different providers.
 *
 * These patterns match error messages returned when the input exceeds
 * the model's context window.
 *
 * Provider-specific patterns (with example error messages):
 *
 * - Anthropic: "prompt is too long: 213462 tokens > 200000 maximum"
 * - Anthropic: "413 {\"error\":{\"type\":\"request_too_large\",\"message\":\"Request exceeds the maximum size\"}}"
 * - OpenAI: "Your input exceeds the context window of this model"
 * - OpenAI/LiteLLM: "Requested token count exceeds the model's maximum context length of 131072 tokens"
 * - OpenAI-compatible: "Input length (265330) exceeds model's maximum context length (262144)."
 * - Google: "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)"
 * - xAI: "This model's maximum prompt length is 131072 but the request contains 537812 tokens"
 * - Groq: "Please reduce the length of the messages or completion"
 * - OpenRouter: "This endpoint's maximum context length is X tokens. However, you requested about Y tokens"
 * - OpenRouter/Poolside: "Input length X exceeds the maximum allowed input length of Y tokens."
 * - Together AI: "The input (X tokens) is longer than the model's context length (Y tokens)."
 * - llama.cpp: "the request exceeds the available context size, try increasing it"
 * - LM Studio: "tokens to keep from the initial prompt is greater than the context length"
 * - GitHub Copilot: "prompt token count of X exceeds the limit of Y"
 * - MiniMax: "invalid params, context window exceeds limit"
 * - Kimi For Coding: "Your request exceeded model token limit: X (requested: Y)"
 * - DS4: "Prompt has X tokens, but the configured context size is Y tokens"
 * - Cerebras: "400/413 status code (no body)"
 * - Mistral: "Prompt contains X tokens ... too large for model with Y maximum context length"
 * - z.ai: Does NOT error, accepts overflow silently - handled via usage.input > contextWindow
 * - Xiaomi MiMo: Truncates input to fill contextWindow exactly, then returns finish_reason "length"
 *   with output=0 (no room left to generate). Detected via stopReason "length" + zero output +
 *   input filling the context window.
 * - DashScope/Qwen: "Range of input length should be [1, X]" (HTTP 400 invalid_parameter_error)
 * - Ollama: Some deployments truncate silently, others return errors like "prompt too long; exceeded max context length by X tokens"
 */
const OVERFLOW_PATTERNS = [
	// 中文：Anthropic token 数溢出。
	/prompt is too long/i, // Anthropic token overflow
	// 中文：Anthropic 请求字节数超限（HTTP 413）。
	/request_too_large/i, // Anthropic request byte-size overflow (HTTP 413)
	// 中文：Amazon Bedrock 提供方。
	/input is too long for requested model/i, // Amazon Bedrock
	// 中文：OpenAI（Completions 与 Responses API）。
	/exceeds the context window/i, // OpenAI (Completions & Responses API)
	// 中文：OpenAI 兼容代理（LiteLLM）。
	/exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/i, // OpenAI-compatible proxies (LiteLLM)
	// 中文：Google（Gemini）。
	/input token count.*exceeds the maximum/i, // Google (Gemini)
	// 中文：xAI（Grok）。
	/maximum prompt length is \d+/i, // xAI (Grok)
	// 中文：Groq 提供方。
	/reduce the length of the messages/i, // Groq
	// 中文：OpenRouter（多数后端）。
	/maximum context length is \d+ tokens/i, // OpenRouter (most backends)
	// 中文：OpenRouter/Poolside 提供方。
	/exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i, // OpenRouter/Poolside
	// 中文：Together AI 提供方。
	/input \(\d+ tokens\) is longer than the model'?s context length \(\d+ tokens\)/i, // Together AI
	// 中文：GitHub Copilot 提供方。
	/exceeds the limit of \d+/i, // GitHub Copilot
	// 中文：llama.cpp 服务器。
	/exceeds the available context size/i, // llama.cpp server
	// 中文：LM Studio 提供方。
	/greater than the context length/i, // LM Studio
	// 中文：MiniMax 提供方。
	/context window exceeds limit/i, // MiniMax
	// 中文：Kimi For Coding 提供方。
	/exceeded model token limit/i, // Kimi For Coding
	// 中文：Mistral 提供方。
	/too large for model with \d+ maximum context length/i, // Mistral
	// 中文：DS4 服务器。
	/prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?/i, // DS4 server
	// 中文：z.ai 的非标准 finish_reason 被作为错误文本呈现。
	/model_context_window_exceeded/i, // z.ai non-standard finish_reason surfaced as error text
	// 中文：Ollama 显式报告的溢出错误。
	/prompt too long; exceeded (?:max )?context length/i, // Ollama explicit overflow error
	// 中文：DashScope / Qwen Token Plan 提供方。
	/range of input length should be/i, // DashScope / Qwen Token Plan
	// 中文：通用兜底模式。
	/context[_ ]length[_ ]exceeded/i, // Generic fallback
	// 中文：通用兜底模式。
	/too many tokens/i, // Generic fallback
	// 中文：通用兜底模式。
	/token limit exceeded/i, // Generic fallback
	// 中文：Cerebras：400/413，且无响应体。
	/^4(?:00|13)\s*(?:status code)?\s*\(no body\)/i, // Cerebras: 400/413 with no body
];

// 中文：表示非溢出错误（例如限流或服务器错误）的模式。即使错误消息同时匹配 OVERFLOW_PATTERN，只要匹配此处任一模式，也应从溢出检测中排除。例如
// Bedrock 将限流错误格式化为 "ThrottlingException: Too many tokens, please wait before trying
// again."，意为 token 过多、请等待后重试；若不排除，就会误匹配 /too many tokens/i 溢出模式。
/**
 * Patterns that indicate non-overflow errors (e.g. rate limiting, server errors).
 * Error messages matching any of these are excluded from overflow detection
 * even if they also match an OVERFLOW_PATTERN.
 *
 * Example: Bedrock formats throttling errors as "ThrottlingException: Too many tokens,
 * please wait before trying again." which would match the /too many tokens/i overflow
 * pattern without this exclusion.
 */
const NON_OVERFLOW_PATTERNS = [
	// 中文：AWS Bedrock 的非溢出错误（formatBedrockError 生成的可读前缀）。
	/^(Throttling error|Service unavailable):/i, // AWS Bedrock non-overflow errors (human-readable prefixes from formatBedrockError)
	// 中文：通用限流。
	/rate limit/i, // Generic rate limiting
	// 中文：通用 HTTP 429 风格错误。
	/too many requests/i, // Generic HTTP 429 style
];

// 中文：检查助手消息是否表示上下文溢出。处理三种情形：一是显式错误，大多数提供方返回 stopReason "error" 及特定错误文本；二是静默溢出，部分提供方接受超限
// 请求且成功返回，此时检查 usage.input 是否超过上下文窗口；三是因长度停止的溢出，Xiaomi MiMo 输入填满窗口时可能返回 "length" 且零输出。可
// 靠检测的提供方及错误含义：Anthropic 提示过长（X > Y）或 request_too_large；OpenAI（Completions/Responses）超过
// 上下文窗口或模型最大上下文长度 X；Google Gemini 输入 token 数超限；xAI（Grok）最大提示 X、请求 Y；Groq 要求缩短消息；
// Cerebras 400/413 且无响应体；Mistral 提示 X token 超过最大 Y；OpenRouter 多数后端的最大上下文为 X；
// OpenRouter/Poolside 输入 X 超过允许的 Y；Together AI 输入 X token 长于上下文 Y；llama.cpp 超过可用上下文；LM
// Studio 超过上下文长度；Kimi For Coding 超过限制 X（请求 Y）；DS4 提示 X、配置上下文 Y；DashScope/Qwen 输入长度应在
// [1, X]。不可靠情形：z.ai 有时静默接受溢出，有时返回限流错误，传入 contextWindow 才能检测 usage.input 超限；Xiaomi MiMo
// 截断输入后返回 stopReason "length"、output=0，传入 contextWindow 才能检测“填满上下文且零输出”；Ollama 某些配置静默截断
// ，另一些返回上述模式可匹配的显式错误，由于不知道预期 token 数，此处仍无法检测静默截断。通过 settings.json 添加的自定义提供方可能无法被识别；添加支持
// 时，先发送超出窗口的请求，查看响应 errorMessage，构造匹配正则，再加入本文件 OVERFLOW_PATTERNS，或在调用本函数前自行检查。参数
// message 是待检查的助手消息；contextWindow 是可选窗口大小，用于检测静默溢出（z.ai）；消息表明溢出时返回 true。具体原始错误文本见下方英文列表
// 。
/**
 * Check if an assistant message represents a context overflow error.
 *
 * This handles three cases:
 * 1. Error-based overflow: Most providers return stopReason "error" with a
 *    specific error message pattern.
 * 2. Silent overflow: Some providers accept overflow requests and return
 *    successfully. For these, we check if usage.input exceeds the context window.
 * 3. Length-stop overflow: Xiaomi MiMo can return "length" with zero output when
 *    the input fills the context window.
 *
 * ## Reliability by Provider
 *
 * **Reliable detection (returns error with detectable message):**
 * - Anthropic: "prompt is too long: X tokens > Y maximum" or "request_too_large"
 * - OpenAI (Completions & Responses): "exceeds the context window", "exceeds the model's maximum context length of X tokens", or "exceeds model's maximum context length (X)"
 * - Google Gemini: "input token count exceeds the maximum"
 * - xAI (Grok): "maximum prompt length is X but request contains Y"
 * - Groq: "reduce the length of the messages"
 * - Cerebras: 400/413 status code (no body)
 * - Mistral: "Prompt contains X tokens ... too large for model with Y maximum context length"
 * - OpenRouter (most backends): "maximum context length is X tokens"
 * - OpenRouter/Poolside: "Input length X exceeds the maximum allowed input length of Y tokens."
 * - Together AI: "The input (X tokens) is longer than the model's context length (Y tokens)."
 * - llama.cpp: "exceeds the available context size"
 * - LM Studio: "greater than the context length"
 * - Kimi For Coding: "exceeded model token limit: X (requested: Y)"
 * - DS4: "Prompt has X tokens, but the configured context size is Y tokens"
 * - DashScope/Qwen: "Range of input length should be [1, X]"
 *
 * **Unreliable detection:**
 * - z.ai: Sometimes accepts overflow silently (detectable via usage.input > contextWindow),
 *   sometimes returns rate limit errors. Pass contextWindow param to detect silent overflow.
 * - Xiaomi MiMo: Truncates input to fit contextWindow then returns stopReason "length" with
 *   output=0. Pass contextWindow param to detect via the "filled context + zero output" signal.
 * - Ollama: May truncate input silently for some setups, but may also return explicit
 *   overflow errors that match the patterns above. Silent truncation still cannot be
 *   detected here because we do not know the expected token count.
 *
 * ## Custom Providers
 *
 * If you've added custom models via settings.json, this function may not detect
 * overflow errors from those providers. To add support:
 *
 * 1. Send a request that exceeds the model's context window
 * 2. Check the errorMessage in the response
 * 3. Create a regex pattern that matches the error
 * 4. The pattern should be added to OVERFLOW_PATTERNS in this file, or
 *    check the errorMessage yourself before calling this function
 *
 * @param message - The assistant message to check
 * @param contextWindow - Optional context window size for detecting silent overflow (z.ai)
 * @returns true if the message indicates a context overflow
 */
export function isContextOverflow(message: AssistantMessage, contextWindow?: number): boolean {
	// 中文：情形 1：检查错误消息模式。
	// Case 1: Check error message patterns
	if (message.stopReason === "error" && message.errorMessage) {
		// 中文：跳过匹配已知非溢出模式的消息，例如节流或限流。
		// Skip messages matching known non-overflow patterns (e.g. throttling / rate-limit)
		const isNonOverflow = NON_OVERFLOW_PATTERNS.some((p) => p.test(message.errorMessage!));
		if (!isNonOverflow && OVERFLOW_PATTERNS.some((p) => p.test(message.errorMessage!))) {
			return true;
		}
	}

	// 中文：情形 2：静默溢出（z.ai 风格），响应成功但用量超过上下文。
	// Case 2: Silent overflow (z.ai style) - successful but usage exceeds context
	if (contextWindow && message.stopReason === "stop") {
		const inputTokens = message.usage.input + message.usage.cacheRead;
		if (inputTokens > contextWindow) {
			return true;
		}
	}

	// 中文：情形 3：因长度停止的溢出（Xiaomi MiMo 风格）。服务器将超长输入截断到适合上下文窗口，未留下输出空间；返回 stopReason "length"、
	// output=0，且 input+cacheRead 填满窗口。
	// Case 3: Length-stop overflow (Xiaomi MiMo style) - server truncates oversized input
	// to fit the context window, leaving no room for output. Returns stopReason "length"
	// with output=0 and input+cacheRead filling the context window.
	if (contextWindow && message.stopReason === "length" && message.usage.output === 0) {
		const inputTokens = message.usage.input + message.usage.cacheRead;
		if (inputTokens >= contextWindow * 0.99) {
			return true;
		}
	}

	return false;
}

// 中文：检查因长度停止时，实际输出是否低于调用方或模型预期的输出上限。这可能由上下文压力或提供方截断造成，因此调用方可尝试一次有界的压缩后重试。
// `desiredMaxOutput` 必须是按上下文裁限之前的原始上限。
/**
 * Check whether a length stop ended below the caller or model's intended output limit.
 * Such responses may be caused by context pressure or provider-side truncation, so callers
 * can make one bounded compact-and-retry attempt. `desiredMaxOutput` must be the original
 * limit before any context-based clamping.
 */
export function isRecoverableLength(message: AssistantMessage, desiredMaxOutput: number): boolean {
	return message.stopReason === "length" && desiredMaxOutput > 0 && message.usage.output < desiredMaxOutput;
}

// 中文：获取溢出模式，供测试使用。
/**
 * Get the overflow patterns for testing purposes.
 */
export function getOverflowPatterns(): RegExp[] {
	return [...OVERFLOW_PATTERNS];
}

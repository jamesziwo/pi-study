// 中文：仅提供类型的兼容入口，用于 coding-agent 扩展的 OAuth 声明。
/** Type-only compatibility entry point for coding-agent extension OAuth declarations. */
export type {
	OAuthAuthInfo,
	OAuthCredentials,
	OAuthDeviceCodeInfo,
	OAuthLoginCallbacks,
	OAuthPrompt,
	OAuthSelectOption,
	OAuthSelectPrompt,
} from "./compat/extension-oauth-types.ts";

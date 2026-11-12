import type { ProviderEnv, ProviderHeaders } from "../types.ts";

// 中文：单次模型请求使用的认证信息。无法用 apiKey、headers 或 baseUrl 表达的值属于提供方配置，而非认证信息。
/**
 * Request auth for a single model request. If a value cannot be expressed as
 * `apiKey`, `headers`, or `baseUrl`, it is provider config, not auth.
 */
export interface ModelAuth {
	apiKey?: string;
	headers?: ProviderHeaders;
	baseUrl?: string;
}

// 中文：已存储的 API key 凭据。env 保存提供方范围内的环境或配置值，例如 Cloudflare 账户 ID 和网关 ID。
/**
 * Stored api-key credential. `env` holds provider-scoped environment/config
 * values such as Cloudflare account/gateway ids.
 */
export interface ApiKeyCredential {
	type: "api_key";
	key?: string;
	env?: ProviderEnv;
}

// 中文：扩展兼容流程返回的 OAuth token 数据。
/** OAuth token data returned by extension compatibility flows. */
export interface OAuthCredentials {
	refresh: string;
	access: string;
	expires: number;
	[key: string]: unknown;
}

// 中文：已存储的标准 OAuth 凭据。
/** Stored canonical OAuth credential. */
export interface OAuthCredential extends OAuthCredentials {
	type: "oauth";
}

// 中文：每个提供方保存一个带类型标记的凭据，对应当前 auth.json 的结构。
/** One type-tagged credential per provider — the shape of today's auth.json. */
export type Credential = ApiKeyCredential | OAuthCredential;

// 中文：用于枚举账户或状态的不含秘密信息的凭据元数据。
/** Non-secret credential metadata for account/status enumeration. */
export interface CredentialInfo {
	providerId: string;
	type: Credential["type"];
}

// 中文：公开认证操作和凭据操作的可选取消参数。
/** Optional cancellation for public auth and credential operations. */
export interface AuthOperationOptions {
	signal?: AbortSignal;
}

// 中文：由应用管理的凭据存储，以 Provider.id 为键，每个提供方一个凭据。modify 是唯一写入路径，使每次变更都按串行的读取—修改—写入流程执行；
// Models.getAuth() 在 modify 内刷新 OAuth，避免并发请求重复刷新已轮换的 token。应用登录后通过 modify(provider.id,
// async () => credential) 持久化凭据；登录和退出登录的编排由应用负责。错误语义：条目不存在时 read 返回 undefined；方法仅在存储失败时
// 拒绝，Models 将此类拒绝包装为 code 为 auth 的 ModelsError。尽力持久化的存储也属于有效实现，例如 coding-agent 的
// AuthStorage：提供内存视图，并在内部记录持久化错误。
/**
 * App-owned credential storage, keyed by `Provider.id`, one credential per
 * provider. `modify` is the only write path, so every mutation is a
 * serialized read-modify-write; `Models.getAuth()` runs OAuth refresh inside
 * `modify` so concurrent requests cannot double-refresh a rotated token. The
 * app persists a credential after login via
 * `modify(provider.id, async () => credential)`. Login/logout orchestration
 * is app-owned.
 *
 * Error semantics: `read` resolves `undefined` for missing entries. Methods
 * reject only on storage failure; `Models` wraps such rejections in
 * `ModelsError` with code "auth". Best-effort stores that serve an in-memory
 * view and record persistence errors internally (like coding-agent's
 * AuthStorage) are valid implementations.
 */
export interface CredentialStore {
	// 中文：读取已存储的凭据，可能已过期。用于展示或状态查询；解析后的请求认证信息来自 Models.getAuth()。
	/**
	 * Read the stored credential, possibly expired. Display/status use;
	 * resolved request auth comes from `Models.getAuth()`.
	 */
	read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined>;

	// 中文：列出已存储凭据的元数据，不解析或暴露秘密信息。实现不得在列举时执行配置的 API key 命令。
	/**
	 * List stored credential metadata without resolving or exposing secrets.
	 * Implementations must not execute configured API-key commands while listing.
	 */
	list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]>;

	// 中文：串行写入，也是唯一写入路径。fn 接收当前凭据，因为正确写入（刷新、刷新期间登录）依赖该值；返回新凭据，或返回 undefined 保持条目不变。按提供方 ID 互
	// 斥；底层存储支持时也应跨进程互斥，例如使用文件锁。返回写入后的凭据，fn 的拒绝会向上传播。
	/**
	 * Serialized write — the only write path. `fn` sees the current credential
	 * because correct writes (refresh, login-during-refresh) depend on it;
	 * return the new credential, or undefined to leave the entry unchanged.
	 * Mutual exclusion per provider id, cross-process too where the backing
	 * store supports it (e.g. a file lock). Resolves with the post-write
	 * credential. Rejections from `fn` propagate.
	 */
	modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		options?: AuthOperationOptions,
	): Promise<Credential | undefined>;

	// 中文：移除凭据，即退出登录。实现应将此操作与 modify 串行化。
	/** Remove a credential (logout). Implementations serialize this against `modify`. */
	delete(providerId: string, options?: AuthOperationOptions): Promise<void>;
}

// 中文：认证解析所需的环境访问接口，可为测试和浏览器注入实现。
/** Environment access for auth resolution. Injectable for tests and browsers. */
export interface AuthContext {
	env(name: string): Promise<string | undefined>;
	// 中文：检查文件是否存在，支持开头的 ~。浏览器中始终返回 false。
	/** Check whether a file exists. Supports a leading `~`. Always false in browsers. */
	fileExists(path: string): Promise<boolean>;
}

// 中文：模型认证解析的结果。
/** Result of resolving auth for a model. */
export interface AuthResult {
	auth: ModelAuth;
	// 中文：从凭据及环境上下文解析出的、提供方范围内的环境或配置值。
	/** Provider-scoped environment/config values resolved from credentials and ambient context. */
	env?: ProviderEnv;
	// 中文：状态界面使用的可读标签，例如 ANTHROPIC_API_KEY、OAuth、~/.aws/credentials。
	/** Human-readable label for status UI: "ANTHROPIC_API_KEY", "OAuth", "~/.aws/credentials". */
	source?: string;
}

export interface AuthCheck {
	source?: string;
	type: "api_key" | "oauth";
}

export type AuthType = "api_key" | "oauth";

// 中文：登录期间向用户展示的输入提示。其他渠道的事件完成当前步骤时，signal 可让流程取消尚未完成的提示；例如 manual_code 提示与回调服务器竞争，回调先完成
// 时便中止该提示。
/**
 * Prompt shown to the user during login. `signal` lets the flow cancel a
 * pending prompt when an out-of-band event resolves the step, e.g. a
 * `manual_code` prompt raced against a callback server, aborted when the
 * callback wins.
 */
export type AuthPrompt = { signal?: AbortSignal } & (
	| { type: "text"; message: string; placeholder?: string }
	| { type: "secret"; message: string; placeholder?: string }
	| { type: "select"; message: string; options: readonly { id: string; label: string; description?: string }[] }
	| { type: "manual_code"; message: string; placeholder?: string }
);

export interface AuthInfoLink {
	url: string;
	label?: string;
}

export type AuthEvent =
	| { type: "info"; message: string; links?: readonly AuthInfoLink[] }
	| { type: "auth_url"; url: string; instructions?: string }
	| {
			type: "device_code";
			userCode: string;
			verificationUri: string;
			intervalSeconds?: number;
			expiresInSeconds?: number;
	  }
	| { type: "progress"; message: string };

// 中文：API key 和 OAuth 流程共用的登录交互回调。prompt() 返回输入或选择的字符串，select 返回选项 ID；取消或中止时拒绝。signal 中止
// 整个登录流程，单个提示使用 AuthPrompt.signal 取消。
/**
 * Login interaction callbacks serving both api-key and OAuth flows.
 *
 * `prompt()` returns the entered/selected string (`select` returns the option
 * id). Rejects on cancel/abort. `signal` aborts the whole login flow;
 * per-prompt cancellation uses `AuthPrompt.signal`.
 */
export interface AuthInteraction {
	signal?: AbortSignal;

	prompt(prompt: AuthPrompt): Promise<string>;
	notify(event: AuthEvent): void;
}

// 中文：传给提供方登录实现的规范化交互接口。
/** Normalized interaction passed to provider login implementations. */
export type ProviderAuthInteraction = AuthInteraction & { signal: AbortSignal };

// 中文：API key 认证：已存储的密钥或提供方环境配置，加上环境来源（环境变量、AWS 配置档案、ADC 文件）。仅使用环境来源的提供方省略 login。
/**
 * Api-key auth: stored key/provider env plus ambient sources (env vars, AWS
 * profiles, ADC files). Ambient-only providers omit `login`.
 */
export interface ApiKeyAuth {
	// 中文：显示名称，例如 Anthropic API key。
	/** Display name, e.g. "Anthropic API key". */
	name: string;

	// 中文：交互式设置，提示输入密钥或提供方环境配置。缺省表示仅使用环境来源。
	/** Interactive setup (prompt for key/provider env). Absent = ambient-only. */
	login?(interaction: ProviderAuthInteraction): Promise<ApiKeyCredential>;

	// 中文：可选且无副作用的可用性检查。当 resolve() 可能执行命令或其他请求期间的工作时使用此方法。未提供时，Models 通过解析认证信息来检查可用性。
	/**
	 * Optional side-effect-free availability check. Use this when `resolve()` may
	 * execute commands or perform other request-time work. Missing means Models
	 * checks availability by resolving auth.
	 */
	check?(input: {
		ctx: AuthContext;
		credential?: ApiKeyCredential;
		signal: AbortSignal;
	}): Promise<AuthCheck | undefined>;

	// 中文：从已存储凭据及环境来源解析认证信息，按字段合并，例如 credential.key ?? env("...") 和 credential.env?.NAME ??
	// env("...")。undefined 表示未配置。解析范围是提供方；模型特定的端点准备工作在认证解析完成后执行。
	/**
	 * Resolve auth from the stored credential and/or ambient sources, merging
	 * per field (`credential.key ?? env("...")`, `credential.env?.NAME ?? env("...")`).
	 * undefined = not configured. Resolution is provider-scoped; model-specific
	 * endpoint preparation happens after auth has been resolved.
	 */
	resolve(input: {
		ctx: AuthContext;
		credential?: ApiKeyCredential;
		signal: AbortSignal;
	}): Promise<AuthResult | undefined>;
}

// 中文：OAuth 认证。分离 refresh 与 toAuth，让 Models 负责带锁刷新流程：refresh 生成凭据，toAuth 从最终存储的凭据推导请求认证信
// 息。
/**
 * OAuth auth. The `refresh`/`toAuth` split lets `Models` own the locked
 * refresh pattern: `refresh` produces a credential, `toAuth` derives request
 * auth from whatever credential ends up stored.
 */
export interface OAuthAuth {
	// 中文：显示名称，例如 Anthropic (Claude Pro/Max)。
	/** Display name, e.g. "Anthropic (Claude Pro/Max)". */
	name: string;

	// 中文：通过该认证方式获得的访问权限是否来自提供方订阅。
	/** Whether access through this auth method is backed by a provider subscription. */
	isSubscription?: boolean;

	// 中文：OAuth 登录选项在选择器中的标签，例如“使用 SuperGrok 或 X Premium 登录”。
	/** Selector label for the OAuth login option, e.g. "Sign in with SuperGrok or X Premium". */
	loginLabel?: string;

	login(interaction: ProviderAuthInteraction): Promise<OAuthCredential>;

	// 中文：使用 refresh token 换取新凭据。这是网络调用，失败时抛出异常，例如 invalid_grant。Models 在持有存储锁时执行它。
	/**
	 * Exchange the refresh token. Network call; throws on failure
	 * (invalid_grant etc.). `Models` runs this under the store lock.
	 */
	refresh(credential: OAuthCredential, signal: AbortSignal): Promise<OAuthCredential>;

	// 中文：从有效凭据推导请求认证信息，不产生副作用。支持每份凭据独有的 baseUrl，例如 GitHub Copilot。使用异步接口，以便延迟包装器在首次使用时加载实现。
	/**
	 * Side-effect-free derivation of request auth from a valid credential.
	 * Covers per-credential baseUrl (GitHub Copilot). Async so lazy wrappers
	 * can load the implementation on first use.
	 */
	toAuth(credential: OAuthCredential): Promise<ModelAuth>;
}

// 中文：提供方认证。apiKey 和 oauth 至少存在一个：即使是使用环境凭据的提供方及无需密钥的本地服务器，也提供 apiKey 认证，其 resolve() 用于报
// 告该提供方是否已配置。
/**
 * Provider auth. At least one of `apiKey`/`oauth` must be present: even
 * ambient-credential providers and keyless local servers provide `apiKey`
 * auth whose `resolve()` reports whether the provider is configured.
 */
export interface ProviderAuth {
	apiKey?: ApiKeyAuth;
	oauth?: OAuthAuth;
}

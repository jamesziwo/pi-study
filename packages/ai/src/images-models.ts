import { defaultProviderAuthContext as defaultAuthContext } from "./auth/context.ts";
import { InMemoryCredentialStore } from "./auth/credential-store.ts";
import { type AuthResolutionOverrides, ModelsError, resolveProviderAuth } from "./auth/resolve.ts";
import type { AuthContext, AuthResult, CredentialStore, ProviderAuth } from "./auth/types.ts";
import type { CreateModelsOptions } from "./models.ts";
import type { AssistantImages, ImagesApi, ImagesContext, ImagesModel, ImagesOptions, ProviderImages } from "./types.ts";

// 中文：图像生成提供方，对应聊天侧的 Provider，负责 id/name 元数据、认证、模型列表和生成行为。
/**
 * An image-generation provider: the image-side counterpart of `Provider`.
 * Owns id/name metadata, auth, model listing, and generation behavior.
 */
export interface ImagesProvider {
	readonly id: string;
	readonly name: string;

	// 中文：必填：apiKey/oauth 至少存在一个。语义与聊天提供方相同；未配置时 ImagesModels.getAuth() 返回 undefined。
	/**
	 * Required: at least one of `apiKey`/`oauth`. Same semantics as chat
	 * providers; `ImagesModels.getAuth()` returns undefined when the provider
	 * is unconfigured.
	 */
	readonly auth: ProviderAuth;

	// 中文：同步返回当前已知模型。静态提供方返回其目录；动态提供方返回最近一次 refreshModels() 后的列表，首次刷新前为空。不得抛出异常；ImagesModels
	//  将抛出异常的实现视为没有模型。
	/**
	 * Current known models, sync. Static providers return their catalog;
	 * dynamic providers return the list as of the last `refreshModels()`
	 * (empty before the first). Must not throw; `ImagesModels` treats a
	 * throwing implementation as having no models.
	 */
	getModels(): readonly ImagesModel<ImagesApi>[];

	// 中文：仅用于动态提供方：获取并更新模型列表，可能因网络原因拒绝。拒绝时保留最后已知列表，后续调用再重试。
	/**
	 * Dynamic providers only: fetch and update the model list. May reject
	 * (network); on rejection the model list stays at its last-known state
	 * and a later call retries.
	 */
	refreshModels?(): Promise<void>;

	generateImages(
		model: ImagesModel<ImagesApi>,
		context: ImagesContext,
		options?: ImagesOptions,
	): Promise<AssistantImages>;
}

// 中文：图像生成提供方的运行时集合，同时提供认证应用及便捷生成方法，对应聊天侧的 Models。
/**
 * Runtime collection of image-generation providers plus auth application and
 * generation convenience: the image-side counterpart of `Models`.
 */
export interface ImagesModels {
	getProviders(): readonly ImagesProvider[];
	getProvider(id: string): ImagesProvider | undefined;

	// 中文：同步读取一个或全部提供方的最后已知模型。尽力返回：getModels() 抛出异常的提供方不贡献模型。
	/**
	 * Sync read of last-known models from one provider or all providers.
	 * Best-effort: a provider whose `getModels()` throws yields no models.
	 */
	getModels(provider?: string): readonly ImagesModel<ImagesApi>[];

	// 中文：基于最后已知列表，同步进行运行时模型查找。
	/** Sync runtime model lookup against last-known lists. */
	getModel(provider: string, id: string): ImagesModel<ImagesApi> | undefined;

	// 中文：要求动态提供方重新获取模型列表。指定提供方 ID 时，其获取失败将以 ModelsError（model_source）拒绝；未指定时，并发尽力刷新所有提供方。没有
	//  refreshModels 的静态提供方不执行操作。
	/**
	 * Ask dynamic providers to re-fetch their model lists. With a provider id,
	 * rejects with `ModelsError` ("model_source") on that provider's fetch
	 * failure; without one, refreshes all providers concurrently best-effort.
	 * Static providers (no `refreshModels`) are no-ops.
	 */
	refresh(provider?: string): Promise<void>;

	// 中文：按提供方 ID 或图像模型解析请求认证，与 Models.getAuth() 契约一致：未知或未配置时返回 undefined，实际失败时以 ModelsError
	// （oauth/auth）拒绝。
	/**
	 * Resolve request auth by provider id or image model. Same contract as
	 * `Models.getAuth()`: undefined when unknown/unconfigured, rejects with
	 * `ModelsError` ("oauth"/"auth") on real failures.
	 */
	getAuth(providerId: string, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
	getAuth(model: ImagesModel<ImagesApi>, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;

	// 中文：解析并合并认证后，通过所属提供方生成图像，显式选项逐字段优先。永不拒绝；失败以 stopReason 为 error 的 AssistantImages 返回。
	/**
	 * Generate images through the owning provider with auth resolved and
	 * merged (explicit options win per field). Never rejects; failures are
	 * returned as an `AssistantImages` with `stopReason: "error"`.
	 */
	generateImages(
		model: ImagesModel<ImagesApi>,
		context: ImagesContext,
		options?: ImagesOptions,
	): Promise<AssistantImages>;
}

export interface MutableImagesModels extends ImagesModels {
	// 中文：按 provider.id 新增或替换，提供方 ID 唯一。
	/** Upsert/replace by provider.id. Provider ids are unique. */
	setProvider(provider: ImagesProvider): void;
	deleteProvider(id: string): void;
	clearProviders(): void;
}

class ImagesModelsImpl implements MutableImagesModels {
	private providers = new Map<string, ImagesProvider>();
	private credentials: CredentialStore;
	private authContext: AuthContext;

	constructor(options?: CreateModelsOptions) {
		this.credentials = options?.credentials ?? new InMemoryCredentialStore();
		this.authContext = options?.authContext ?? defaultAuthContext();
	}

	setProvider(provider: ImagesProvider): void {
		this.providers.set(provider.id, provider);
	}

	deleteProvider(id: string): void {
		this.providers.delete(id);
	}

	clearProviders(): void {
		this.providers.clear();
	}

	getProviders(): readonly ImagesProvider[] {
		return Array.from(this.providers.values());
	}

	getProvider(id: string): ImagesProvider | undefined {
		return this.providers.get(id);
	}

	getModels(provider?: string): readonly ImagesModel<ImagesApi>[] {
		if (provider !== undefined) {
			const entry = this.providers.get(provider);
			if (!entry) return [];
			try {
				return entry.getModels();
			} catch {
				return [];
			}
		}

		const models: ImagesModel<ImagesApi>[] = [];
		for (const entry of this.providers.values()) {
			try {
				models.push(...entry.getModels());
			} catch {
				// 中文：尽力返回：行为异常的提供方不贡献模型。
				// Best-effort: ill-behaved providers yield no models.
			}
		}
		return models;
	}

	getModel(provider: string, id: string): ImagesModel<ImagesApi> | undefined {
		return this.getModels(provider).find((model) => model.id === id);
	}

	async refresh(provider?: string): Promise<void> {
		if (provider !== undefined) {
			const entry = this.providers.get(provider);
			if (!entry?.refreshModels) return;
			try {
				await entry.refreshModels();
			} catch (error) {
				if (error instanceof ModelsError) throw error;
				throw new ModelsError("model_source", `Model refresh failed for ${provider}`, { cause: error });
			}
			return;
		}

		// 中文：不会拒绝：异步映射器将异常提供方的同步抛错也转为 Promise 拒绝，allSettled 会捕获全部结果。
		// Cannot reject: the async mapper turns even sync throws from ill-behaved
		// providers into rejections, and allSettled captures all of them.
		await Promise.allSettled(Array.from(this.providers.values(), async (entry) => entry.refreshModels?.()));
	}

	getAuth(providerId: string, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
	getAuth(model: ImagesModel<ImagesApi>, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
	async getAuth(
		providerOrModel: string | ImagesModel<ImagesApi>,
		overrides?: AuthResolutionOverrides,
	): Promise<AuthResult | undefined> {
		const providerId = typeof providerOrModel === "string" ? providerOrModel : providerOrModel.provider;
		const provider = this.providers.get(providerId);
		if (!provider) return undefined;
		return resolveProviderAuth(provider, this.credentials, this.authContext, overrides);
	}

	async generateImages(
		model: ImagesModel<ImagesApi>,
		context: ImagesContext,
		options?: ImagesOptions,
	): Promise<AssistantImages> {
		try {
			const provider = this.providers.get(model.provider);
			if (!provider) {
				throw new ModelsError("provider", `Unknown provider: ${model.provider}`);
			}

			const resolution = await this.getAuth(model, {
				apiKey: options?.apiKey,
				env: options?.env,
				signal: options?.signal,
			});
			const auth = resolution?.auth;
			if (!auth) {
				return provider.generateImages(model, context, options);
			}

			const requestModel = auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;

			// 中文：显式请求选项逐字段优先；headers/env 按键合并。
			// Explicit request options win per-field; headers/env merge per key.
			const apiKey = options?.apiKey ?? auth.apiKey;
			const headers = auth.headers || options?.headers ? { ...auth.headers, ...options?.headers } : undefined;
			const env =
				resolution.env || options?.env ? { ...(resolution.env ?? {}), ...(options?.env ?? {}) } : undefined;

			return await provider.generateImages(requestModel, context, { ...options, apiKey, headers, env });
		} catch (error) {
			return {
				api: model.api,
				provider: model.provider,
				model: model.id,
				output: [],
				stopReason: "error",
				errorMessage: error instanceof Error ? error.message : String(error),
				timestamp: Date.now(),
			};
		}
	}
}

export function createImagesModels(options?: CreateModelsOptions): MutableImagesModels {
	return new ImagesModelsImpl(options);
}

export interface CreateImagesProviderOptions {
	id: string;
	// 中文：显示名称，默认使用 id。
	/** Display name. Default: `id`. */
	name?: string;
	// 中文：必填：所有提供方都有认证语义，包括仅使用环境凭据或无需密钥的提供方。
	/** Required — every provider has auth semantics, even ambient/keyless ones. */
	auth: ProviderAuth;
	// 中文：初始模型列表，纯动态提供方为空。
	/** Initial model list (empty for purely dynamic providers). */
	models: readonly ImagesModel<ImagesApi>[];
	// 中文：动态提供方获取当前列表，成功后保存，并发调用共享同一个进行中的请求。可能拒绝：此时保留最后已知列表，拒绝向 refreshModels() 调用方传播，
	// ImagesModels.refresh(provider) 会将其包装为 model_source 类型的 ModelsError，后续调用可重试。
	/**
	 * Dynamic providers: fetch the current list. Stored on success; concurrent
	 * calls share one in-flight fetch. May reject: the stored list then stays
	 * at its last-known state, the rejection propagates to the caller of
	 * `refreshModels()` (wrapped as ModelsError "model_source" by
	 * `ImagesModels.refresh(provider)`), and a later call retries.
	 */
	refreshModels?: () => Promise<readonly ImagesModel<ImagesApi>[]>;
	api: ProviderImages;
}

// 中文：从各组成部分构建图像生成提供方。
/** Builds an image-generation provider from parts. */
export function createImagesProvider(input: CreateImagesProviderOptions): ImagesProvider {
	let models = input.models;
	let inflightRefresh: Promise<void> | undefined;
	const refreshModels = input.refreshModels;

	return {
		id: input.id,
		name: input.name ?? input.id,
		auth: input.auth,
		getModels: () => models,
		refreshModels: refreshModels
			? () => {
					inflightRefresh ??= (async () => {
						try {
							models = await refreshModels();
						} finally {
							inflightRefresh = undefined;
						}
					})();
					return inflightRefresh;
				}
			: undefined,
		generateImages: (model, context, options) => input.api.generateImages(model, context, options),
	};
}

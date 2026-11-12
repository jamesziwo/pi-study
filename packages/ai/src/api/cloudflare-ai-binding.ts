// 中文：通过 Workers AI 绑定传输 AI Gateway 请求。Pi 的 Cloudflare AI Gateway 支持使用 HTTPS（
// gateway.ai.cloudflare.com/v1/{account}/{gateway}/{provider}/...，见 api/cloudflare.ts），
// 即使调用方是与网关同账户的 Worker，也需要 Cloudflare API token。Worker 可通过 AI 绑定的 fetch 透传（
// env.AI.fetch()）访问网关，从而省去该 token；提供方透传路由为
// https://workers-binding.ai/ai-gateway/gateways/{gateway}/{provider}/{endpoint...}，结构与
//  HTTPS URL 相同，但不含账户 ID，因为绑定通道携带身份。绑定调用已在账户内预认证，以普通的流式 Response 返回提供方原生传输格式，因此 API 实现在
// 两种传输方式下行为一致。若模型 baseUrl 已指向该路由，无需转换，只需将 createAiBindingFetch 作为请求 fetch 传入。方法、请求头、查询字
// 符串及请求体流均原样进入绑定，不改写、不缓冲、不重新编码，因此支持任意方法、非 JSON 请求体及流式请求体。与直接调用 env.AI.fetch() 相比，本模块只增加
// 类型支持：Ai#fetch 在运行时存在（workerd/src/cloudflare/internal/ai-api.ts:158），但
// @cloudflare/workers-types 的 Ai 类尚未声明它，直接调用就需要在每个调用处做类型断言。AiBinding 通过将 fetch 声明为可选并在构
// 造时检查一次，承担这一类型适配，使 env.AI 可以直接传入。待 workers-types 声明 fetch 后，可去掉可选标记及运行时检查。
/**
 * AI Gateway transport over the Workers AI binding.
 *
 * pi's Cloudflare AI Gateway support speaks HTTPS
 * (`gateway.ai.cloudflare.com/v1/{account}/{gateway}/{provider}/...`, see `api/cloudflare.ts`),
 * which needs a Cloudflare API token even when the caller is a Worker in the gateway's own
 * account.
 *
 * A Worker avoids that token by talking to the gateway through the AI binding's `fetch`
 * passthrough (`env.AI.fetch()`), which serves the gateway's provider passthrough at
 * `https://workers-binding.ai/ai-gateway/gateways/{gateway}/{provider}/{endpoint...}` — the same
 * shape as the HTTPS URL, minus the account id (the binding channel carries identity). Binding
 * calls are pre-authenticated in-account and return the provider's native wire format as a
 * regular (streaming) `Response`, so API implementations behave identically over either
 * transport.
 *
 * A model whose `baseUrl` names that route therefore needs no translation: point it there and
 * pass {@link createAiBindingFetch} as the request `fetch`. Nothing is rewritten, buffered or
 * re-encoded — method, headers, query string and the body stream go to the binding as they
 * arrive, so every method, non-JSON body and streaming request body works.
 *
 * The only thing this module adds over calling `env.AI.fetch()` yourself is a type: `Ai#fetch`
 * exists at runtime (`workerd/src/cloudflare/internal/ai-api.ts:158`) but
 * `@cloudflare/workers-types`' `Ai` class does not declare it yet, so calling it directly means
 * casting the binding at every call site. {@link AiBinding} takes the cast instead — declare
 * `fetch` optional, check it once at construction — so `env.AI` can be passed as-is. Once
 * workers-types declares `fetch`, the optional marker and the runtime check both go away.
 */

import type { FetchFunction } from "../types.ts";

// 中文：使用结构类型描述 Workers AI 绑定 env.AI，使本模块不依赖 @cloudflare/workers-types。fetch 设为可选仅因为已发布的
// Ai 类型尚未声明它；实际绑定在运行时都有此方法。aiGatewayLogId 用来将类型限定为 AI 绑定：它是 Ai 独有的成员；缺少它时，该接口也会接受
// AiGateway 或任意手写的 { fetch } 对象，而这种错误会到运行时检查才被发现。
/**
 * The Workers AI binding (`env.AI`), described structurally so this module does not depend on
 * `@cloudflare/workers-types`.
 *
 * `fetch` is optional only because the published `Ai` type doesn't declare it yet — every real
 * binding has it at runtime. `aiGatewayLogId` is here to pin the type to the AI binding: it is
 * the one member unique to `Ai`, so without it this interface would also accept an `AiGateway`
 * or any hand-rolled `{ fetch }` object, which is exactly the mistake the runtime check reports
 * late.
 */
export interface AiBinding {
	aiGatewayLogId: string | null;
	fetch?(input: Request | string | URL, init?: RequestInit): Promise<Response>;
}

// 中文：经绑定路由的请求所使用的认证头占位值。API 实现在发送前要求 API key 或认可的认证头（authorization、x-api-key、
// cf-aig-authorization）；绑定调用已预认证，因此传入 cf-aig-authorization: Bearer
// ${CLOUDFLARE_GATEWAY_BINDING_AUTH_SENTINEL} 即可通过检查。网关会忽略并移除绑定路由请求中的
// cf-aig-authorization。应配合 Authorization: null 和 x-api-key: null，避免 SDK 的占位认证头到达网关；否则网关
// 会像处理 HTTPS 请求一样，将请求自带的认证头视为 BYOK（自带密钥）提供方密钥，覆盖网关保存的密钥。
/**
 * Placeholder value for auth headers on binding-routed requests. API implementations
 * require an API key or a recognized auth header (`authorization`, `x-api-key`,
 * `cf-aig-authorization`) before dispatch; binding calls are pre-authenticated, so pass
 * `cf-aig-authorization: Bearer ${CLOUDFLARE_GATEWAY_BINDING_AUTH_SENTINEL}` to satisfy
 * the check. The gateway ignores (and strips) `cf-aig-authorization` on binding-routed
 * requests. Pair it with `Authorization: null` / `x-api-key: null` so the SDKs' placeholder
 * auth headers never reach the gateway, which would treat a request-supplied auth header as a
 * BYOK provider key that overrides its stored keys — the same as it would over HTTPS.
 */
export const CLOUDFLARE_GATEWAY_BINDING_AUTH_SENTINEL = "cloudflare-gateway-binding";

// 中文：创建由 AI 绑定提供的 fetch，适用于 baseUrl 已指向该绑定所服务路由的模型，包括网关的提供方透传路由
// https://workers-binding.ai/ai-gateway/gateways/{gateway}/{provider}/...。请求原样传递。下方保留原始
//  TypeScript 使用示例。
/**
 * Create a `fetch` backed by the AI binding, for models whose `baseUrl` already names a route
 * the binding serves — including the gateway's provider passthrough,
 * `https://workers-binding.ai/ai-gateway/gateways/{gateway}/{provider}/...`. Requests pass
 * through untouched.
 *
 * ```ts
 * const model = {
 *   // ...
 *   baseUrl: `https://workers-binding.ai/ai-gateway/gateways/${gateway}/anthropic`,
 * };
 * await models.complete(model, context, {
 *   headers: {
 *     "cf-aig-authorization": `Bearer ${CLOUDFLARE_GATEWAY_BINDING_AUTH_SENTINEL}`,
 *     Authorization: null,
 *     "x-api-key": null,
 *   },
 *   fetch: createAiBindingFetch(env.AI),
 * });
 * ```
 */
export function createAiBindingFetch(binding: AiBinding): FetchFunction {
	// 中文：类型中的 fetch 是可选的，因此在这里提前检查其是否存在，避免直到首次推理请求时才出现难以理解的错误。
	// `fetch` is optional on the type, so its presence is checked here — early, rather than as a
	// confusing failure on the first inference request.
	if (typeof binding.fetch !== "function") {
		throw new TypeError("createAiBindingFetch: the AI binding does not expose fetch()");
	}
	// 中文：立即绑定方法：fetch 是可变属性，上面的类型收窄无法延续到返回的闭包中。
	// Bound eagerly: `fetch` is a mutable property, so the narrowing above would not survive into
	// the returned closure.
	const bindingFetch = binding.fetch.bind(binding);
	return (input, init) => bindingFetch(input, init);
}

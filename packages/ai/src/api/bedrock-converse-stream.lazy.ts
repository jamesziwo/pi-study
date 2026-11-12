import type { ProviderStreams } from "../types.ts";
import { lazyApi } from "./lazy.ts";

// 中文：使用变量形式的模块路径加载 Bedrock 实现，使打包器（浏览器冒烟测试、Bun 编译）无法沿导入链进入仅支持 Node 的 AWS SDK。通过 .ts/.js
//  后缀改写，使该方式在源码和构建产物中都有效。
/**
 * Loads the bedrock implementation through a variable specifier so bundlers
 * (browser smoke, Bun compile) cannot follow the import into the Node-only
 * AWS SDK. The `.ts`/`.js` rewrite keeps the trick working from both source
 * and built output.
 */
const importNodeOnlyApi = (specifier: string): Promise<unknown> => {
	const runtimeSpecifier = import.meta.url.endsWith(".js") ? specifier.replace(/\.ts$/, ".js") : specifier;
	return import(runtimeSpecifier);
};

let bedrockModuleOverride: ProviderStreams | undefined;

// 中文：覆盖动态导入的 Bedrock 实现。用于 Bun 二进制构建：变量形式的模块路径无法被打包，因此构建过程改为注册静态导入的模块。
/**
 * Overrides the dynamically imported bedrock implementation. Used by the Bun
 * binary build, where the variable-specifier import cannot be bundled; the
 * build registers a statically imported module instead.
 */
export function setBedrockProviderModule(module: ProviderStreams): void {
	bedrockModuleOverride = module;
}

export const bedrockConverseStreamApi = (): ProviderStreams =>
	lazyApi(
		async () =>
			bedrockModuleOverride ?? ((await importNodeOnlyApi("./bedrock-converse-stream.ts")) as ProviderStreams),
	);

import type { ProviderEnv } from "../types.ts";

let procEnvCache: Map<string, string> | null = null;

// 中文：针对 Bun 问题 https://github.com/oven-sh/bun/issues/27802 的回退逻辑。Bun 编译二进制在 Linux 沙箱内可能
// 暴露空 process.env，即使 /proc/self/environ 中有环境变量。此处有意重复
// packages/coding-agent/src/bun/restore-sandbox-env.ts 的 restoreSandboxEnv()，因为 ai 包可以不
// 经该入口直接使用，所以提供方环境查询不能依赖 process.env 已被修补。
/**
 * Fallback for https://github.com/oven-sh/bun/issues/27802.
 * Bun compiled binaries can expose an empty process.env inside Linux sandboxes
 * even though /proc/self/environ contains the environment.
 *
 * This intentionally duplicates restoreSandboxEnv() in
 * packages/coding-agent/src/bun/restore-sandbox-env.ts. The ai package can be
 * used directly, without going through that entrypoint, so provider env lookup
 * must not depend on process.env having been patched.
 */
function getBunSandboxEnvValue(name: string): string | undefined {
	if (typeof process === "undefined" || !process.versions?.bun || Object.keys(process.env).length > 0) {
		return undefined;
	}

	if (procEnvCache === null) {
		procEnvCache = new Map();
		try {
			const { readFileSync } = require("node:fs") as {
				readFileSync(path: string, encoding: BufferEncoding): string;
			};
			const data = readFileSync("/proc/self/environ", "utf-8");
			for (const entry of data.split("\0")) {
				const idx = entry.indexOf("=");
				if (idx > 0) {
					procEnvCache.set(entry.slice(0, idx), entry.slice(idx + 1));
				}
			}
		} catch {
			// 中文：/proc/self/environ 可能不存在或不可读。
			// /proc/self/environ may not exist or may not be readable.
		}
	}

	return procEnvCache.get(name);
}

// 中文：依次从作用域覆盖值、正常 process.env，以及为直接使用 pi-ai 的调用方复制的 Bun 沙箱回退逻辑中解析提供方环境值。
/**
 * Resolve a provider env value from scoped overrides, normal process.env, then
 * the duplicated Bun sandbox fallback for direct pi-ai consumers.
 */
export function getProviderEnvValue(name: string, env?: ProviderEnv): string | undefined {
	return (
		env?.[name] ||
		(typeof process !== "undefined" ? process.env[name] : undefined) ||
		getBunSandboxEnvValue(name) ||
		undefined
	);
}

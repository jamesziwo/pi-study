import type { StreamFn } from "./types.ts";

let defaultStreamFn: StreamFn | undefined;

// 中文：配置调用方省略 streamFn 时，Agent 和底层循环使用的回退流函数。
// 提供默认模型运行时的宿主可以在此安装其流函数，而不让 pi-agent-core 依赖提供方目录或兼容层。
/**
 * Configure the fallback used by Agent and low-level loops when callers omit streamFn.
 *
 * Hosts that provide a default model runtime can install its stream function here
 * without making pi-agent-core depend on a provider catalog or compatibility layer.
 */
export function setDefaultStreamFn(streamFn: StreamFn | undefined): void {
	defaultStreamFn = streamFn;
}

export function getDefaultStreamFn(): StreamFn {
	if (!defaultStreamFn) {
		throw new Error("No default stream function configured. Pass streamFn explicitly or call setDefaultStreamFn().");
	}
	return defaultStreamFn;
}

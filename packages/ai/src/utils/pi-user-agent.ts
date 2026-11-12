import type * as NodeOs from "node:os";

type ProcessWithOsBuiltinModule = typeof process & {
	getBuiltinModule?: (id: "node:os") => typeof NodeOs;
};

function loadNodeOs(): typeof NodeOs | null {
	if (typeof process === "undefined" || !(process.versions?.node || process.versions?.bun)) {
		return null;
	}
	return (process as ProcessWithOsBuiltinModule).getBuiltinModule?.("node:os") ?? null;
}

// 中文：保持运行时 OS 模块加载对浏览器安全；在顶层运行时导入 node:os 会破坏浏览器或 Vite 构建。
// Keep runtime OS loading browser-safe. A top-level runtime import of node:os breaks browser/Vite builds.
const nodeOs = loadNodeOs();

export function getPiUserAgent(): string {
	return nodeOs ? `pi (${nodeOs.platform()} ${nodeOs.release()}; ${nodeOs.arch()})` : "pi (browser)";
}

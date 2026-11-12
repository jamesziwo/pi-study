import type { ExecutionEnv } from "../types.ts";

// 中文：内置执行工具所需的文件系统与 shell 上下文。
/** Filesystem and shell context required by the built-in execution tools. */
export interface ExecutionToolContext {
	env: ExecutionEnv;
}

import type { Storage } from "../types.ts";

// 中文：由单个测试或基准测试用例独占的全新后端存储实例。
/** A fresh backend storage instance owned by one test or benchmark case. */
export interface StorageFixture extends AsyncDisposable {
	readonly storage: Storage;
}

// 中文：不依赖测试运行器的一致性测试用例，可注册到任意测试框架。
/** A runner-independent conformance case that can be registered with any test framework. */
export interface ConformanceCase {
	readonly group: string;
	readonly name: string;
	run(): Promise<void>;
}

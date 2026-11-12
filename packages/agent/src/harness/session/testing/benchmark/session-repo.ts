import { BACKGROUND_CONTEXT } from "../../../context.ts";
import type { SessionMetadata, SessionRepo } from "../../types.ts";
import { branchTip, laneConfig, laneState, setValue } from "../../values.ts";
import { STORAGE_BENCHMARK_DATASETS, type StorageBenchmarkDataset } from "./datasets.ts";
import { generateStorageBenchmarkSeedTransactions } from "./storage.ts";

export interface SessionRepoCatalogBenchmarkDataset {
	readonly name: string;
	readonly sessionCount: number;
}

interface SessionRepoCatalogReadBenchmarkScenario {
	readonly name: string;
	expectedResult(dataset: SessionRepoCatalogBenchmarkDataset): number;
	run(repo: SessionRepo): Promise<number>;
}

interface SessionRepoCatalogWriteBenchmarkOperation {
	run(): Promise<number>;
}

interface SessionRepoCatalogWriteBenchmarkScenario {
	readonly name: string;
	readonly expectedResult: number;
	prepare(repo: SessionRepo): Promise<SessionRepoCatalogWriteBenchmarkOperation>;
}

interface SessionRepoForkWriteBenchmarkScenario {
	readonly name: string;
	expectedResult(dataset: StorageBenchmarkDataset): number;
	run(repo: SessionRepo, source: SessionMetadata, dataset: StorageBenchmarkDataset): Promise<number>;
}

// 中文：包内使用的确定性会话 ID，由仓库基准测试负载共用。
/** Package-internal deterministic session id shared by repository benchmark workloads. */
export function sessionRepoBenchmarkSessionId(index: number): string {
	return `benchmark-session-${index.toString().padStart(8, "0")}`;
}

const BENCHMARK_SESSION_ID = sessionRepoBenchmarkSessionId(0);
const FORK_DESTINATION_SESSION_ID = sessionRepoBenchmarkSessionId(1);

function createCatalogDataset(scale: string, sessionCount: number): SessionRepoCatalogBenchmarkDataset {
	return {
		name: `synthetic catalog: ${scale} closed sessions`,
		sessionCount,
	};
}

// 中文：仓库测量共用的确定性已关闭会话目录。
/** Deterministic closed-session catalogs shared by repository measurements. */
export const SESSION_REPO_CATALOG_BENCHMARK_DATASETS: readonly SessionRepoCatalogBenchmarkDataset[] = [
	createCatalogDataset("100", 100),
	createCatalogDataset("1k", 1_000),
	createCatalogDataset("10k", 10_000),
];

// 中文：填充一个确定性目录，并按创建顺序返回其持久化元数据。
/** Seeds one deterministic catalog and returns its durable metadata in creation order. */
export async function seedSessionRepoCatalogBenchmark(
	repo: SessionRepo,
	dataset: SessionRepoCatalogBenchmarkDataset,
): Promise<SessionMetadata[]> {
	const metadata: SessionMetadata[] = [];
	for (let index = 0; index < dataset.sessionCount; index++) {
		const session = await repo.create({ id: sessionRepoBenchmarkSessionId(index) }, BACKGROUND_CONTEXT);
		metadata.push(session.metadata);
		await session.close(BACKGROUND_CONTEXT);
	}
	return metadata;
}

// 中文：共用的目录读取操作。返回数字可确保每次读取的结果都被使用。
/** Shared catalog reads. Returning a number ensures each result is consumed. */
export const SESSION_REPO_CATALOG_READ_BENCHMARK_SCENARIOS: readonly SessionRepoCatalogReadBenchmarkScenario[] = [
	{
		name: "list sessions",
		expectedResult(dataset) {
			return dataset.sessionCount;
		},
		async run(repo) {
			return (await repo.list(undefined, BACKGROUND_CONTEXT)).length;
		},
	},
];

// 中文：共用的目录写入操作。每次调用都会获得一个独立准备且状态等价的仓库。
/** Shared catalog writes. Every invocation receives an equivalent independently prepared repository. */
export const SESSION_REPO_CATALOG_WRITE_BENCHMARK_SCENARIOS: readonly SessionRepoCatalogWriteBenchmarkScenario[] = [
	{
		name: "create empty session",
		expectedResult: 1,
		prepare(repo) {
			return Promise.resolve({
				async run() {
					const session = await repo.create({ id: BENCHMARK_SESSION_ID }, BACKGROUND_CONTEXT);
					return session.metadata.id === BENCHMARK_SESSION_ID ? 1 : 0;
				},
			});
		},
	},
	{
		name: "open closed empty session",
		expectedResult: 1,
		async prepare(repo) {
			const session = await repo.create({ id: BENCHMARK_SESSION_ID }, BACKGROUND_CONTEXT);
			const { metadata } = session;
			await session.close(BACKGROUND_CONTEXT);
			return {
				async run() {
					const reopened = await repo.open(metadata, BACKGROUND_CONTEXT);
					return reopened.metadata.id === metadata.id ? 1 : 0;
				},
			};
		},
	},
	{
		name: "delete closed empty session",
		expectedResult: 1,
		async prepare(repo) {
			const session = await repo.create({ id: BENCHMARK_SESSION_ID }, BACKGROUND_CONTEXT);
			const { metadata } = session;
			await session.close(BACKGROUND_CONTEXT);
			return {
				async run() {
					await repo.delete(metadata, BACKGROUND_CONTEXT);
					return 1;
				},
			};
		},
	},
];

// 中文：首次分叉的计时使用规模受限的源数据，因为每轮迭代都拥有一个填充了等价初始数据的仓库。
/** Initial fork timing uses a bounded source because each iteration owns an equivalent seeded repository. */
export const SESSION_REPO_FORK_BENCHMARK_DATASETS: readonly StorageBenchmarkDataset[] = [
	STORAGE_BENCHMARK_DATASETS[0]!,
	STORAGE_BENCHMARK_DATASETS[1]!,
];

// 中文：填充一个确定性的、处于打开状态的源会话，其中包含线性 main 分支。
/** Seeds one deterministic open source session with a linear main branch. */
export async function seedSessionRepoForkBenchmark(
	repo: SessionRepo,
	dataset: StorageBenchmarkDataset,
): Promise<SessionMetadata> {
	const session = await repo.create({ id: BENCHMARK_SESSION_ID }, BACKGROUND_CONTEXT);
	for (const transaction of generateStorageBenchmarkSeedTransactions(dataset)) {
		await session.mutate((mutator) => mutator.commit(transaction, BACKGROUND_CONTEXT), BACKGROUND_CONTEXT);
	}
	await session.mutate(
		(mutator) =>
			mutator.commit(
				[
					setValue(branchTip("main"), dataset.tipId),
					setValue(laneConfig("main"), {
						model: { provider: "benchmark", modelId: "benchmark" },
						thinkingLevel: "off",
						activeToolNames: [],
					}),
					setValue(laneState("main"), { currentOperationId: null, lastOperationId: null, inbox: [] }),
				],
				BACKGROUND_CONTEXT,
			),
		BACKGROUND_CONTEXT,
	);
	return session.metadata;
}

// 中文：共用的分叉写入操作。每次调用都会获得一个等价的源仓库。
/** Shared fork writes. Every invocation receives an equivalent source repository. */
export const SESSION_REPO_FORK_WRITE_BENCHMARK_SCENARIOS: readonly SessionRepoForkWriteBenchmarkScenario[] = [
	{
		name: "fork open current branch",
		expectedResult(dataset) {
			return dataset.entryCount;
		},
		async run(repo, source, dataset) {
			const fork = await repo.fork(
				source,
				{ id: FORK_DESTINATION_SESSION_ID, scope: "branch", branch: "main" },
				BACKGROUND_CONTEXT,
			);
			return fork.metadata.id === FORK_DESTINATION_SESSION_ID && fork.metadata.parentSessionId === source.id
				? dataset.entryCount
				: 0;
		},
	},
];

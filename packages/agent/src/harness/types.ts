import type { SimpleStreamOptions, Transport } from "@earendil-works/pi-ai";
import type { Static, TSchema } from "typebox";
import type { AgentTool, AgentToolResult } from "../types.ts";
import type { Context } from "./context.ts";
import type { JsonValue } from "./session/types.ts";
import type { TruncationResult } from "./utils/truncate.ts";

// 中文：可能失败的操作结果。预期内的失败通过 `ok: false` 返回，而不是抛出。
/** Result of a fallible operation. Expected failures are returned as `ok: false` instead of thrown. */
export type Result<TValue, TError> = { ok: true; value: TValue } | { ok: false; error: TError };

// 中文：创建成功的 {@link Result}。
/** Create a successful {@link Result}. */
export function ok<TValue, TError>(value: TValue): Result<TValue, TError> {
	return { ok: true, value };
}

// 中文：创建失败的 {@link Result}。
/** Create a failed {@link Result}. */
export function err<TValue, TError>(error: TError): Result<TValue, TError> {
	return { ok: false, error };
}

// 中文：返回成功值，或抛出失败时的错误。用于测试及明确的适配器边界。
/** Return the success value or throw the failure error. Intended for tests and explicit adapter boundaries. */
export function getOrThrow<TValue, TError>(result: Result<TValue, TError>): TValue {
	if (!result.ok) throw result.error;
	return result.value;
}

// 中文：返回成功值或 `undefined`。仅允许对象值，避免基本类型的真假值判断导致错误。
/** Return the success value or `undefined`. Only object values are allowed to avoid truthiness bugs with primitives. */
export function getOrUndefined<TValue extends object, TError>(result: Result<TValue, TError>): TValue | undefined {
	return result.ok ? result.value : undefined;
}

// 中文：将抛出的未知值规范化为 Error 实例，再将其用作具有明确类型的错误原因。
/** Normalize unknown thrown values into Error instances before using them as typed error causes. */
export function toError(error: unknown): Error {
	if (error instanceof Error) return error;
	if (typeof error === "string") return new Error(error);
	try {
		return new Error(JSON.stringify(error));
	} catch {
		return new Error(String(error));
	}
}

// 中文：从 `SKILL.md` 文件加载或由应用提供的技能。按 agentskills.io 的建议，`name`、`description` 和 `filePath`
// 以 XML 格式块插入系统提示词。使用 {@link formatSkillsForSystemPrompt} 生成符合规范的系统提示词块。
/**
 * Skill loaded from a `SKILL.md` file or provided by an application.
 *
 * `name`, `description`, and `filePath` are inserted into the system prompt in an XML-formatted block as suggested by agentskills.io.
 * Use {@link formatSkillsForSystemPrompt} to generate the spec-compatible system prompt block.
 */
export interface Skill {
	// 中文：稳定的技能名称，用于查找及模型可见的列表。
	/** Stable skill name used for lookup and model-visible listings. */
	name: string;
	// 中文：模型可见的简短说明，描述何时使用该技能。
	/** Short model-visible description of when to use the skill. */
	description: string;
	// 中文：完整技能指令。
	/** Full skill instructions. */
	content: string;
	// 中文：技能文件的绝对路径，用于向模型显示位置及解析相对引用。
	/** Absolute path to the skill file. Used for model-visible location and resolving relative references. */
	filePath: string;
	// 中文：从模型可见的技能列表中隐藏该技能，但仍允许应用显式调用。
	/** Exclude this skill from model-visible skill lists while still allowing explicit application invocation. */
	disableModelInvocation?: boolean;
}

// 中文：可格式化为提示词、供显式调用的提示词模板。
/** Prompt template that can be formatted into a prompt for explicit invocation. */
export interface PromptTemplate {
	// 中文：稳定的模板名称，用于查找或应用命令路由。
	/** Stable template name used for lookup or application command routing. */
	name: string;
	// 中文：供命令列表或自动补全使用的可选说明。
	/** Optional description for command lists or autocomplete. */
	description?: string;
	// 中文：模板内容。参数占位符由 `formatPromptTemplateInvocation` 格式化。
	/** Template content. Argument placeholders are formatted by `formatPromptTemplateInvocation`. */
	content: string;
}

// 中文：提供给显式调用方法及系统提示词回调的资源。
/** Resources made available to explicit invocation methods and system-prompt callbacks. */
export interface AgentHarnessResources<
	TSkill extends Skill = Skill,
	TPromptTemplate extends PromptTemplate = PromptTemplate,
> {
	// 中文：可供显式调用的提示词模板。
	/** Prompt templates available for explicit invocation. */
	promptTemplates?: TPromptTemplate[];
	// 中文：可供模型使用及显式调用的技能。
	/** Skills available to the model and explicit skill invocation. */
	skills?: TSkill[];
}

// 中文：一次实时 Harness 工具进度更新的选项。
/** Options for one live harness tool progress update. */
export interface AgentHarnessToolUpdateOptions {
	// 中文：请求替换本次调用的持久化恢复检查点。
	/** Request replacement of this invocation's durable recovery checkpoint. */
	checkpoint?: true;
}

// 中文：提供给 Harness 原生工具的同步完整快照进度回调。
/** Synchronous full-snapshot progress callback supplied to harness-native tools. */
export type AgentHarnessToolUpdateCallback<TDetails> = (
	partialResult: AgentToolResult<TDetails>,
	options?: AgentHarnessToolUpdateOptions,
) => void;

// 中文：一次逻辑工具调用的稳定 Harness 身份标识，在安全重放期间保持不变。
/** Stable harness identity for one logical tool call, unchanged during safe replay. */
export interface AgentHarnessToolInvocation {
	// 中文：会话内唯一的不透明 id，等于为该调用预留的结果条目 id。
	/** Opaque session-unique id equal to the call's reserved result-entry id. */
	readonly invocationId: string;
	readonly operationId: string;
	readonly turnId: string;
	// 中文：读取一项调用作用域内的持久化重放备忘数据。
	/** Read one invocation-scoped durable replay memo. */
	getMemo(name: string): Promise<JsonValue | undefined>;
	// 中文：设置或删除一项调用作用域内的持久化重放备忘数据。
	/** Set or delete one invocation-scoped durable replay memo. */
	setMemo(name: string, value: JsonValue | undefined): Promise<void>;
}

// 中文：由 {@link AgentHarness} 执行、使用应用定义上下文的工具定义。
/** Tool definition executed by an {@link AgentHarness} with an application-defined context. */
export type AgentHarnessTool<
	TContext extends object | undefined,
	TParameters extends TSchema = TSchema,
	TDetails = unknown,
> = Omit<AgentTool<TParameters, TDetails>, "execute"> & {
	// 中文：使用针对当前轮次快照解析出的上下文执行工具调用。
	/** Execute the tool call with the context resolved for the current turn snapshot. */
	execute(
		toolCallId: string,
		params: Static<TParameters>,
		onUpdate: AgentHarnessToolUpdateCallback<TDetails>,
		toolContext: TContext,
		invocation: AgentHarnessToolInvocation,
		context: Context,
	): Promise<AgentToolResult<TDetails>>;
};

// 中文：静态工具上下文，或针对每轮快照解析上下文的提供函数。
/** Static tool context or provider resolved for each turn snapshot. */
export type AgentHarnessToolContextSource<TContext extends object | undefined> =
	| TContext
	| ((context: Context) => TContext | Promise<TContext>);

// 中文：由 Harness 管理并逐轮建立快照的一组选定提供方请求选项。
/** Curated provider request options owned by the harness and snapshotted per turn. */
export interface AgentHarnessStreamOptions {
	// 中文：转发给流函数的首选传输方式。
	/** Preferred transport forwarded to the stream function. */
	transport?: Transport;
	// 中文：提供方请求超时，单位为毫秒。
	/** Provider request timeout in milliseconds. */
	timeoutMs?: number;
	// 中文：提供方最大重试次数。
	/** Maximum provider retry attempts. */
	maxRetries?: number;
	// 中文：提供方要求的重试延迟的可选上限。
	/** Optional cap for provider-requested retry delays. */
	maxRetryDelayMs?: number;
	// 中文：与认证及生命周期请求头合并的额外请求头。
	/** Additional request headers merged with auth and lifecycle headers. */
	headers?: Record<string, string>;
	// 中文：随请求转发的提供方元数据。
	/** Provider metadata forwarded with requests. */
	metadata?: SimpleStreamOptions["metadata"];
	// 中文：提供方缓存保留提示。
	/** Provider cache retention hint. */
	cacheRetention?: SimpleStreamOptions["cacheRetention"];
	// 中文：请求具备相应能力的提供方异步继续生成。
	/** Ask a capable provider to continue generation asynchronously. */
	deferred?: boolean | { window?: "15m" | "1h" | "24h" };
}

// 中文：提供方钩子返回的逐请求流选项补丁。
/** Per-request stream option patch returned by provider hooks. */
export interface AgentHarnessStreamOptionsPatch
	extends Omit<Partial<AgentHarnessStreamOptions>, "headers" | "metadata"> {
	// 中文：请求头补丁。值为 `undefined` 时删除相应键；显式设置 `headers: undefined` 清除全部请求头。
	/** Header patch. `undefined` values delete keys; explicit `headers: undefined` clears all headers. */
	headers?: Record<string, string | undefined>;
	// 中文：元数据补丁。值为 `undefined` 时删除相应键；显式设置 `metadata: undefined` 清除全部元数据。
	/** Metadata patch. `undefined` values delete keys; explicit `metadata: undefined` clears all metadata. */
	metadata?: Record<string, unknown | undefined>;
}

// 中文：{@link FileSystem} 所寻址的文件系统对象种类。不会自动跟随符号链接。
/** Kind of filesystem object as addressed by a {@link FileSystem}. Symlinks are not followed automatically. */
export type FileKind = "file" | "directory" | "symlink";

// 中文：{@link FileSystem} 文件操作返回的稳定、与后端无关的文件错误码。
/** Stable, backend-independent file error codes returned by {@link FileSystem} file operations. */
export type FileErrorCode =
	| "aborted"
	| "not_found"
	| "permission_denied"
	| "not_directory"
	| "is_directory"
	| "invalid"
	| "not_supported"
	| "unknown";

// 中文：{@link FileSystem} 文件操作返回的错误。
/** Error returned by {@link FileSystem} file operations. */
export class FileError extends Error {
	// 中文：与后端无关的错误码。
	/** Backend-independent error code. */
	public code: FileErrorCode;
	// 中文：与失败相关的绝对寻址路径（若可用）。
	/** Absolute addressed path associated with the failure, when available. */
	public path?: string;

	constructor(code: FileErrorCode, message: string, path?: string, cause?: Error) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = "FileError";
		this.code = code;
		this.path = path;
	}
}

// 中文：{@link ExecutionEnv.exec} 返回的稳定、与后端无关的执行错误码。
/** Stable, backend-independent execution error codes returned by {@link ExecutionEnv.exec}. */
export type ExecutionErrorCode =
	| "aborted"
	| "timeout"
	| "shell_unavailable"
	| "spawn_error"
	| "callback_error"
	| "unknown";

// 中文：{@link ExecutionEnv.exec} 返回的错误。
/** Error returned by {@link ExecutionEnv.exec}. */
export class ExecutionError extends Error {
	// 中文：与后端无关的错误码。
	/** Backend-independent error code. */
	public code: ExecutionErrorCode;

	constructor(code: ExecutionErrorCode, message: string, cause?: Error) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = "ExecutionError";
		this.code = code;
	}
}

// 中文：压缩辅助函数返回的稳定错误码。
/** Stable compaction error codes returned by compaction helpers. */
export type CompactionErrorCode = "aborted" | "summarization_failed";

// 中文：压缩辅助函数返回的错误。
/** Error returned by compaction helpers. */
export class CompactionError extends Error {
	// 中文：与后端无关的错误码。
	/** Backend-independent error code. */
	public code: CompactionErrorCode;

	constructor(code: CompactionErrorCode, message: string, cause?: Error) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = "CompactionError";
		this.code = code;
	}
}

// 中文：分支摘要辅助函数返回的稳定错误码。
/** Stable branch-summary error codes returned by branch summarization helpers. */
export type BranchSummaryErrorCode = "aborted" | "summarization_failed";

// 中文：分支摘要辅助函数返回的错误。
/** Error returned by branch summarization helpers. */
export class BranchSummaryError extends Error {
	// 中文：与后端无关的错误码。
	/** Backend-independent error code. */
	public code: BranchSummaryErrorCode;

	constructor(code: BranchSummaryErrorCode, message: string, cause?: Error) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = "BranchSummaryError";
		this.code = code;
	}
}

// 中文：{@link FileSystem} 中一个文件系统对象的元数据。
/** Metadata for one filesystem object in a {@link FileSystem}. */
export interface FileInfo {
	// 中文：{@link path} 的基本文件名。
	/** Basename of {@link path}. */
	name: string;
	// 中文：执行环境中经过语法规范化的绝对寻址路径，不跟随符号链接。
	/** Absolute, syntactically normalized addressed path in the execution environment. Symlinks are not followed. */
	path: string;
	// 中文：对象种类。不跟随符号链接目标；需要时显式调用 {@link FileSystem.canonicalPath}。
	/** Object kind. Symlink targets are not followed; use {@link FileSystem.canonicalPath} explicitly. */
	kind: FileKind;
	// 中文：所寻址文件系统对象的字节大小。
	/** Size in bytes for the addressed filesystem object. */
	size: number;
	// 中文：修改时间，以 Unix 纪元以来的毫秒数表示。
	/** Modification time as milliseconds since Unix epoch. */
	mtimeMs: number;
}

// 中文：从文本文件读取的一行 UTF-8 文本。
/** One UTF-8 line read from a text file. */
export interface TextLine {
	text: string;
	// 中文：该行是否以 `\n` 结束；调用方据此丢弃末尾写入不完整的记录。
	/** Whether the line ended with `\n`; callers use this to discard a torn final record. */
	terminated: boolean;
}

// 中文：按需拉取的 UTF-8 行读取器，保留最后一行是否正常终止的信息。
/** Pull-based UTF-8 line reader that preserves final-line termination. */
export interface TextLineReader {
	readLine(context: Context): Promise<Result<TextLine | undefined, FileError>>;
	// 中文：释放已打开的文件。必须尽力清理，不得抛错或拒绝 Promise。
	/** Release the open file. Must be best-effort and must not throw or reject. */
	close(context: Context): Promise<void>;
}

// 中文：Harness 使用的文件系统能力。传入方法的路径可以是绝对路径，也可以相对于 {@link cwd}。文件操作返回文件系统命名空间中的寻址路径；除 {@link
// canonicalPath} 外，不会通过解析符号链接进行规范化。操作方法绝不能抛错或拒绝 Promise；包括意外后端故障在内的所有文件系统失败，都必须编码到返回的
// {@link Result} 中。实现必须保持这一不变量。
/**
 * Filesystem capability used by the harness.
 *
 * Paths passed to methods may be absolute or relative to {@link cwd}. Paths returned by file operations are addressed paths
 * in the filesystem namespace, but are not canonicalized through symlinks unless returned by {@link canonicalPath}.
 *
 * Operation methods must never throw or reject. All filesystem failures, including unexpected backend failures, must be
 * encoded in the returned {@link Result}. Implementations must preserve this invariant.
 */
export interface FileSystem {
	// 中文：解析相对路径时使用的当前工作目录。
	/** Current working directory for relative paths. */
	cwd: string;

	// 中文：返回绝对寻址路径，不要求路径存在，也不解析符号链接。
	/** Return an absolute addressed path without requiring it to exist and without resolving symlinks. */
	absolutePath(path: string, context: Context): Promise<Result<string, FileError>>;
	// 中文：在文件系统命名空间内连接路径片段，不要求结果路径存在。
	/** Join path segments in the filesystem namespace without requiring the result to exist. */
	joinPath(parts: string[], context: Context): Promise<Result<string, FileError>>;
	// 中文：读取 UTF-8 文本文件。
	/** Read a UTF-8 text file. */
	readTextFile(path: string, context: Context): Promise<Result<string, FileError>>;
	// 中文：打开 UTF-8 文本文件，以便按需逐行读取。
	/** Open a UTF-8 text file for pull-based line reading. */
	openTextLineReader(path: string, context: Context): Promise<Result<TextLineReader, FileError>>;
	// 中文：读取 UTF-8 文本行。实现应在读取 `maxLines` 行后停止。
	/** Read UTF-8 text lines. Implementations should stop once `maxLines` lines have been read. */
	readTextLines(
		path: string,
		options: { maxLines?: number } | undefined,
		context: Context,
	): Promise<Result<string[], FileError>>;
	// 中文：读取二进制文件。
	/** Read a binary file. */
	readBinaryFile(path: string, context: Context): Promise<Result<Uint8Array, FileError>>;
	// 中文：创建或覆盖文件；支持时创建父目录。
	/** Create or overwrite a file, creating parent directories when supported. */
	writeFile(path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>>;
	// 中文：创建文件或向文件追加；支持时创建父目录。
	/** Create or append to a file, creating parent directories when supported. */
	appendFile(path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>>;
	// 中文：原子重命名文件，目标已存在时替换它。不执行跨文件系统复制。
	/** Atomically rename a file, replacing the destination when it exists. Does not copy across filesystems. */
	renameFile(sourcePath: string, destinationPath: string, context: Context): Promise<Result<void, FileError>>;
	// 中文：返回寻址路径的元数据，不跟随符号链接。
	/** Return metadata for the addressed path without following symlinks. */
	fileInfo(path: string, context: Context): Promise<Result<FileInfo, FileError>>;
	// 中文：列出目录的直接子项，不跟随符号链接。
	/** List direct children of a directory without following symlinks. */
	listDir(path: string, context: Context): Promise<Result<FileInfo[], FileError>>;
	// 中文：返回已存在路径的规范路径；支持时解析符号链接。
	/** Return the canonical path for an existing path, resolving symlinks where supported. */
	canonicalPath(path: string, context: Context): Promise<Result<string, FileError>>;
	// 中文：路径不存在时返回 false。权限等其他错误返回 {@link FileError}。
	/** Return false for missing paths. Other errors, such as permission failures, return a {@link FileError}. */
	exists(path: string, context: Context): Promise<Result<boolean, FileError>>;
	// 中文：创建目录，默认 `recursive: true`。
	/** Create a directory. Defaults to `recursive: true`. */
	createDir(
		path: string,
		options: { recursive?: boolean } | undefined,
		context: Context,
	): Promise<Result<void, FileError>>;
	// 中文：删除文件或目录，默认 `recursive: false`、`force: false`。
	/** Remove a file or directory. Defaults to `recursive: false` and `force: false`. */
	remove(
		path: string,
		options: { recursive?: boolean; force?: boolean } | undefined,
		context: Context,
	): Promise<Result<void, FileError>>;
	// 中文：创建临时目录并返回绝对路径，默认 `prefix: "tmp-"`。
	/** Create a temporary directory and return its absolute path. Defaults to `prefix: "tmp-"`. */
	createTempDir(prefix: string | undefined, context: Context): Promise<Result<string, FileError>>;
	// 中文：创建临时文件并返回绝对路径，默认 `prefix: ""`、`suffix: ""`。
	/** Create a temporary file and return its absolute path. Defaults to `prefix: ""` and `suffix: ""`. */
	createTempFile(
		options: { prefix?: string; suffix?: string } | undefined,
		context: Context,
	): Promise<Result<string, FileError>>;

	// 中文：释放文件系统资源。必须尽力清理，不得抛错或拒绝 Promise。
	/** Release filesystem resources. Must be best-effort and must not throw or reject. */
	cleanup(context: Context): Promise<void>;
}

// 中文：超出限制后，在有界输出中保留哪一部分。
/** Which portion of bounded output survives after the limit is crossed. */
export type ShellOutputRetention = "head" | "tail";

// 中文：一个合并 shell 输出视图在源端的限制。
/** Source-side limits for one combined shell output view. */
export interface ShellOutputLimits {
	maxBytes: number;
	maxLines: number;
	// 中文：默认 `"tail"`。
	/** Defaults to `"tail"`. */
	retain?: ShellOutputRetention;
}

// 中文：调用方请求的有界 shell 输出捕获。
/** Bounded shell capture requested by the caller. */
export interface ShellOutputCaptureOptions {
	limits: ShellOutputLimits;
	// 中文：超出限制后，将完整输出保存在执行环境本地的文件中。
	/** Preserve complete output in an execution-environment-local file after the limits are crossed. */
	spill?: boolean;
}

// 中文：截断元数据，不重复保存已保留的文本。
/** Truncation metadata without a duplicate copy of the retained text. */
export type ShellOutputTruncation = Omit<TruncationResult, "content">;

// 中文：有界 shell 输出视图附带的元数据。
/** Metadata accompanying a bounded shell output view. */
export interface ShellOutputMetadata {
	truncation: ShellOutputTruncation;
	spillPath?: string;
	lastLineBytes?: number;
}

// 中文：完整的有界 shell 输出视图。
/** Complete bounded shell output view. */
export interface ShellOutputView extends ShellOutputMetadata {
	text: string;
}

// 中文：一个有界 shell 输出视图在源端的增量变化。
/** Incremental source-side change to one bounded shell output view. */
export type ShellOutputUpdate =
	| { kind: "replace"; output: ShellOutputView }
	| { kind: "append"; text: string; metadata: ShellOutputMetadata }
	| { kind: "slide"; drop: number; text: string; metadata: ShellOutputMetadata }
	| { kind: "metadata"; metadata: ShellOutputMetadata };

// 中文：有界 shell 执行的完成结果。输出文本通过 {@link ShellExecOptions.onUpdate} 交付。
/** Bounded shell completion. Output text is delivered through {@link ShellExecOptions.onUpdate}. */
export interface ShellExecResult extends ShellOutputMetadata {
	exitCode: number;
}

// 中文：{@link Shell.exec} 的选项。
/** Options for {@link Shell.exec}. */
export interface ShellExecOptions {
	// 中文：命令工作目录。相对路径根据 {@link ExecutionEnv.cwd} 解析，默认也是 {@link ExecutionEnv.cwd}。
	/** Working directory for the command. Relative paths are resolved against {@link ExecutionEnv.cwd}. Defaults to {@link ExecutionEnv.cwd}. */
	cwd?: string;
	// 中文：命令环境变量。`inheritEnv` 为 true 时，这些值覆盖继承的默认值。
	/** Environment variables for the command. Values override inherited defaults when `inheritEnv` is true. */
	env?: Record<string, string>;
	// 中文：是否继承执行环境的默认变量，默认 true。
	/** Whether to inherit the execution environment's default variables. Defaults to true. */
	inheritEnv?: boolean;
	// 中文：超时秒数。命令超出该时长时，实现应返回超时错误；默认不设超时。
	/** Timeout in seconds. Implementations should return a timeout error when the command exceeds this duration. Defaults to no timeout. */
	timeout?: number;
	// 中文：在源端进行有界捕获。此项和 `onUpdate` 都不存在时，输出被丢弃。
	/** Source-side bounded capture. Output is discarded when this and `onUpdate` are both absent. */
	capture?: ShellOutputCaptureOptions;
	// 中文：有界输出发生变化时调用。
	/** Called with bounded output changes. */
	onUpdate?: (update: ShellOutputUpdate, context: Context) => void;
}

// 中文：Harness 使用的 shell 执行能力。
/** Shell execution capability used by the harness. */
export interface Shell {
	// 中文：除非提供 `options.cwd`，否则在 {@link FileSystem.cwd} 中执行 shell 命令。
	/** Execute a shell command in {@link FileSystem.cwd} unless `options.cwd` is provided. */
	exec(
		command: string,
		options: ShellExecOptions | undefined,
		context: Context,
	): Promise<Result<ShellExecResult, ExecutionError>>;
	// 中文：释放 shell 资源。必须尽力清理，不得抛错或拒绝 Promise。
	/** Release shell resources. Must be best-effort and must not throw or reject. */
	cleanup(context: Context): Promise<void>;
}

// 中文：Harness 使用的文件系统与进程执行环境。
/** Filesystem and process execution environment used by the harness. */
export interface ExecutionEnv extends FileSystem, Shell {}

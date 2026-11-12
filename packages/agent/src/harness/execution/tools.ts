import { type ToolResultMessage, validateToolArguments } from "@earendil-works/pi-ai";
import type { AgentToolCall, AgentToolResult } from "../../types.ts";
import { type Context, withAbortSignal } from "../context.ts";
import type { JsonValue } from "../session/types.ts";
import type { AgentHarnessTool, AgentHarnessToolInvocation, AgentHarnessToolUpdateCallback } from "../types.ts";
import type { Gate } from "./effect-gate.ts";

// 中文：工具已存在、准备后的参数已通过校验的工具调用。
/** A tool call whose tool exists and whose prepared arguments passed validation. */
export interface PreparedToolCall<TContext extends object | undefined> {
	toolCall: AgentToolCall;
	tool: AgentHarnessTool<TContext>;
	args: Record<string, JsonValue>;
}

// 中文：未跨越外部工具副作用边界而直接构造的结果。
/** Synthetic result produced without crossing the external tool-effect boundary. */
export interface ImmediateToolOutcome {
	kind: "immediate";
	toolCall: AgentToolCall;
	result: AgentToolResult<unknown>;
	isError: true;
	terminate: boolean;
}

// 中文：工具执行前钩子管线的聚合决策。
/** Aggregated decision from the before-tool hook pipeline. */
export interface BeforeToolDecision {
	args?: Record<string, JsonValue>;
	block?: { reason: string; terminate?: boolean };
}

// 中文：已准备好且获准发布持久化意图并执行的调用。
/** A prepared call cleared for durable intent publication and execution. */
export interface ClearedToolCall<TContext extends object | undefined> {
	toolCall: AgentToolCall;
	tool: AgentHarnessTool<TContext>;
	args: Record<string, JsonValue>;
}

// 中文：工具执行后补丁应用之前的第二阶段原始工具输出。
/** Raw phase-two tool output before after-tool patching. */
export interface ExecutedToolCall {
	result: AgentToolResult<unknown>;
	isError: boolean;
}

// 中文：工具执行后钩子管线的聚合补丁。
/** Aggregated patch from the after-tool hook pipeline. */
export interface AfterToolPatch {
	content?: AgentToolResult<unknown>["content"];
	details?: JsonValue;
	isError?: boolean;
	usage?: AgentToolResult<unknown>["usage"];
	terminate?: boolean;
}

// 中文：已准备好转为持久化工具结果消息的最终工具输出。
/** Final tool output ready to become a durable tool-result message. */
export interface FinalizedToolCall {
	toolCall: AgentToolCall;
	result: AgentToolResult<unknown>;
	isError: boolean;
	terminate: boolean;
}

function createErrorToolResult(message: string): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text: message }],
		details: undefined,
	};
}

function immediateError(toolCall: AgentToolCall, message: string, terminate = false): ImmediateToolOutcome {
	return {
		kind: "immediate",
		toolCall,
		result: createErrorToolResult(message),
		isError: true,
		terminate,
	};
}

// 中文：解析工具，执行其确定性的参数准备，并校验结果。
/** Resolve a tool, apply its deterministic argument preparation, and validate the result. */
export function prepareToolCall<TContext extends object | undefined>(
	call: AgentToolCall,
	tools: AgentHarnessTool<TContext>[],
): PreparedToolCall<TContext> | ImmediateToolOutcome {
	const tool = tools.find((candidate) => candidate.name === call.name);
	if (!tool) {
		return immediateError(call, `Tool ${JSON.stringify(call.name)} is unavailable`);
	}

	try {
		const preparedArguments = tool.prepareArguments ? tool.prepareArguments(call.arguments) : call.arguments;
		const preparedCall: AgentToolCall =
			preparedArguments === call.arguments
				? call
				: { ...call, arguments: preparedArguments as Record<string, JsonValue> };
		const args = validateToolArguments(tool, preparedCall) as Record<string, JsonValue>;
		return { toolCall: call, tool, args };
	} catch (error) {
		return immediateError(call, error instanceof Error ? error.message : String(error));
	}
}

// 中文：应用显式钩子决策，并重新校验替换后的参数。
/** Apply an explicit hook decision and revalidate replacement arguments. */
export function applyBeforeToolDecision<TContext extends object | undefined>(
	prepared: PreparedToolCall<TContext>,
	decision: BeforeToolDecision | undefined,
): ClearedToolCall<TContext> | ImmediateToolOutcome {
	if (decision?.block) {
		return immediateError(prepared.toolCall, decision.block.reason, decision.block.terminate === true);
	}

	if (!decision?.args) {
		return { toolCall: prepared.toolCall, tool: prepared.tool, args: prepared.args };
	}

	try {
		const validatedArgs = validateToolArguments(prepared.tool, {
			...prepared.toolCall,
			arguments: decision.args,
		}) as Record<string, JsonValue>;
		return { toolCall: prepared.toolCall, tool: prepared.tool, args: validatedArgs };
	} catch (error) {
		return immediateError(prepared.toolCall, error instanceof Error ? error.message : String(error));
	}
}

// 中文：执行一次获准的外部工具副作用，将预期内的工具抛错转换为错误输出。
/** Execute one cleared external tool effect, converting expected tool throws to error output. */
export function executeToolCall<TContext extends object | undefined>(
	call: ClearedToolCall<TContext>,
	gate: Gate,
	onUpdate: AgentHarnessToolUpdateCallback<unknown>,
	toolContext: TContext,
	invocation: AgentHarnessToolInvocation,
	context: Context,
): Promise<ExecutedToolCall> {
	let acceptingUpdates = true;
	return gate.admit(async () => {
		const admittedContext = withAbortSignal(gate.signal, context);
		admittedContext.abortSignal?.throwIfAborted();
		try {
			const result = await call.tool.execute(
				call.toolCall.id,
				call.args,
				(partial, options) => {
					if (acceptingUpdates) onUpdate(partial, options);
				},
				toolContext,
				invocation,
				admittedContext,
			);
			return { result, isError: false };
		} catch (error) {
			return {
				result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
				isError: true,
			};
		} finally {
			acceptingUpdates = false;
		}
	});
}

// 中文：逐字段应用工具执行后补丁。
/** Apply an after-tool patch field by field. */
export function finalizeToolCall<TContext extends object | undefined>(
	call: ClearedToolCall<TContext>,
	executed: ExecutedToolCall,
	patch: AfterToolPatch | undefined,
): FinalizedToolCall {
	const result: AgentToolResult<unknown> = patch
		? {
				...executed.result,
				content: patch.content === undefined ? executed.result.content : patch.content,
				details: patch.details === undefined ? executed.result.details : patch.details,
				usage: patch.usage === undefined ? executed.result.usage : patch.usage,
				terminate: patch.terminate === undefined ? executed.result.terminate : patch.terminate,
			}
		: executed.result;
	return {
		toolCall: call.toolCall,
		result,
		isError: patch?.isError ?? executed.isError,
		terminate: result.terminate === true,
	};
}

// 中文：重建暂存的对话记录消息所表示的规范工具结果。
/** Reconstruct the canonical tool result represented by a staged transcript message. */
export function toolResultFromMessage(
	message: ToolResultMessage<unknown>,
	terminate: boolean,
): AgentToolResult<unknown> {
	return {
		content: message.content,
		details: message.details,
		...(message.usage === undefined ? {} : { usage: message.usage }),
		...(message.addedToolNames === undefined ? {} : { addedToolNames: message.addedToolNames }),
		...(terminate ? { terminate: true } : {}),
	};
}

// 中文：将最终工具输出转换为面向提供方的对话记录消息。
/** Convert finalized tool output to the provider-facing transcript message. */
export function createToolResultMessage(call: FinalizedToolCall): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: call.toolCall.id,
		toolName: call.toolCall.name,
		content: call.result.content ?? [],
		...(call.result.details === undefined ? {} : { details: call.result.details }),
		...(call.result.usage === undefined ? {} : { usage: call.result.usage }),
		...(call.result.addedToolNames?.length ? { addedToolNames: call.result.addedToolNames } : {}),
		isError: call.isError,
		timestamp: Date.now(),
	};
}

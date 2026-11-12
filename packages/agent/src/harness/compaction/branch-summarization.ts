import {
	type Api,
	contentText,
	type Model,
	type Models,
	type RetryCallbacks,
	type RetryPolicy,
	type Usage,
} from "@earendil-works/pi-ai";

import type { AgentMessage } from "../../types.ts";
import type { Context } from "../context.ts";
import { convertToLlm, createBranchSummaryMessage, createCompactionSummaryMessage } from "../messages.ts";
import type { Branch, Entry, Session } from "../session/index.ts";
import { BranchSummaryError, err, ok, type Result } from "../types.ts";
import {
	completeSimpleWithRetries,
	createSummaryRequestOptions,
	estimateTokens,
	SUMMARIZATION_SYSTEM_PROMPT,
	type SummaryRequest,
} from "./compaction.ts";
import {
	computeFileLists,
	createFileOps,
	extractFileOpsFromMessage,
	type FileOperations,
	formatFileOperations,
	serializeConversation,
} from "./utils.ts";

// 中文：已生成、准备持久化为分支摘要条目的摘要数据。
/** Generated branch summary data ready to be persisted as a branch-summary entry. */
export interface BranchSummaryResult {
	summary: string;
	usage?: Usage;
	readFiles: string[];
	modifiedFiles: string[];
}

// 中文：保存在生成的分支摘要条目上的文件操作详情。
/** File-operation details stored on generated branch summary entries. */
export interface BranchSummaryDetails {
	// 中文：探索被总结的分支时读取的文件。
	/** Files read while exploring the summarized branch. */
	readFiles: string[];
	// 中文：探索被总结的分支时修改的文件。
	/** Files modified while exploring the summarized branch. */
	modifiedFiles: string[];
}

export type { FileOperations } from "./utils.ts";

// 中文：为生成摘要准备好的分支内容。
/** Prepared branch content for summarization. */
export interface BranchPreparation {
	// 中文：选入分支摘要的消息。
	/** Messages selected for the branch summary. */
	messages: AgentMessage[];
	// 中文：从分支提取的文件操作。
	/** File operations extracted from the branch. */
	fileOps: FileOperations;
	// 中文：所选消息的估算 token 数。
	/** Estimated token count for selected messages. */
	totalTokens: number;
}

// 中文：选中用于生成分支摘要的条目。
/** Entries selected for branch summarization. */
export interface CollectEntriesResult {
	// 中文：按时间先后排列的待总结条目。
	/** Entries to summarize in chronological order. */
	entries: Entry[];
	// 中文：原 tip 与目标条目之间最深的公共祖先。
	/** Deepest common ancestor between the previous tip and target entry. */
	commonAncestorId: string | null;
}

// 中文：生成分支摘要的选项。
/** Options for generating a branch summary. */
export interface GenerateBranchSummaryOptions {
	// 中文：摘要请求经过的提供方集合，负责解析认证信息。
	/** Provider collection the summarization request goes through; owns auth resolution. */
	models: Models;
	// 中文：用于生成摘要的模型。
	/** Model used for summarization. */
	model: Model<Api>;
	// 中文：可选指令，用于追加到默认提示词或替换默认提示词。
	/** Optional instructions appended to or replacing the default prompt. */
	customInstructions?: string;
	// 中文：用自定义指令替换默认提示词，而不是追加。
	/** Replace the default prompt with custom instructions instead of appending them. */
	replaceInstructions?: boolean;
	// 中文：为提示词和模型输出预留的 token 数，默认 16384。
	/** Tokens reserved for prompt and model output. Defaults to 16384. */
	reserveTokens?: number;
	// 中文：针对临时摘要生成错误的可选重试策略。
	/** Optional retry policy for transient summarization errors. */
	retry?: RetryPolicy;
	// 中文：用于报告重试情况的可选回调。
	/** Optional callbacks for retry reporting. */
	callbacks?: RetryCallbacks;
}

// 中文：收集导航到其他会话树条目之前应当总结的条目。
/** Collect entries that should be summarized before navigating to a different session tree entry. */
export async function collectEntriesForBranchSummary(
	branch: Pick<Branch, "findEntries">,
	session: Pick<Session, "getEntry">,
	oldTipId: string | null,
	targetId: string,
	context: Context,
): Promise<CollectEntriesResult> {
	if (!oldTipId) {
		return { entries: [], commonAncestorId: null };
	}
	const oldPath = new Set((await branch.findEntries({ start: oldTipId }, context)).map((entry) => entry.id));
	const targetPath = await branch.findEntries({ start: targetId }, context);
	let commonAncestorId: string | null = null;
	for (const entry of targetPath) {
		if (oldPath.has(entry.id)) {
			commonAncestorId = entry.id;
			break;
		}
	}
	const entries: Entry[] = [];
	let current: string | null = oldTipId;

	while (current && current !== commonAncestorId) {
		const entry = await session.getEntry(current, context);
		if (!entry) throw new Error(`Corrupt session: entry ${current} not found`);
		entries.push(entry);
		current = entry.parentId;
	}
	entries.reverse();

	return { entries, commonAncestorId };
}
function getMessageFromEntry(entry: Entry): AgentMessage | undefined {
	switch (entry.type) {
		case "message":
			if (entry.message.role === "toolResult") return undefined;
			return entry.message;

		case "branch_summary":
			return createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp);

		case "compaction":
			return createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp);
		case "custom":
			return undefined;
	}
}

// 中文：在可选 token 预算内准备要总结的分支条目。
/** Prepare branch entries for summarization within an optional token budget. */
export function prepareBranchEntries(entries: Entry[], tokenBudget: number = 0): BranchPreparation {
	const messages: AgentMessage[] = [];
	const fileOps = createFileOps();
	let totalTokens = 0;
	for (const entry of entries) {
		if (
			entry.type !== "branch_summary" ||
			typeof entry.details !== "object" ||
			entry.details === null ||
			Array.isArray(entry.details)
		) {
			continue;
		}
		if (Array.isArray(entry.details.readFiles)) {
			for (const path of entry.details.readFiles) {
				if (typeof path === "string") fileOps.read.add(path);
			}
		}
		if (Array.isArray(entry.details.modifiedFiles)) {
			for (const path of entry.details.modifiedFiles) {
				if (typeof path === "string") fileOps.edited.add(path);
			}
		}
	}
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		const message = getMessageFromEntry(entry);
		if (!message) continue;
		extractFileOpsFromMessage(message, fileOps);

		const tokens = estimateTokens(message);
		if (tokenBudget > 0 && totalTokens + tokens > tokenBudget) {
			if (entry.type === "compaction" || entry.type === "branch_summary") {
				if (totalTokens < tokenBudget * 0.9) {
					messages.unshift(message);
					totalTokens += tokens;
				}
			}
			break;
		}

		messages.unshift(message);
		totalTokens += tokens;
	}

	return { messages, fileOps, totalTokens };
}

const BRANCH_SUMMARY_PREAMBLE = `The user explored a different conversation branch before returning here.
Summary of that exploration:

`;

const BRANCH_SUMMARY_PROMPT = `Create a structured summary of this conversation branch for context when returning later.

Use this EXACT format:

## Goal
[What was the user trying to accomplish in this branch?]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Work that was started but not finished]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [What should happen next to continue this work]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

// 中文：为离开的分支条目生成摘要。
/** Generate a summary for abandoned branch entries. */
export function generateBranchSummary(
	entries: Entry[],
	options: GenerateBranchSummaryOptions,
	context: Context,
): Promise<Result<BranchSummaryResult, BranchSummaryError>> {
	const { models, model, customInstructions, replaceInstructions, reserveTokens = 16384, retry, callbacks } = options;
	const contextWindow = model.contextWindow || 128000;
	const preparation = prepareBranchEntries(entries, contextWindow - reserveTokens);
	return generateBranchSummaryWithRequest(
		preparation,
		{ customInstructions, replaceInstructions },
		(aiContext, requestOptions, requestContext) =>
			completeSimpleWithRetries(models, model, aiContext, requestOptions, retry, callbacks, requestContext),
		context,
	);
}

export interface PreparedBranchSummaryOptions {
	customInstructions?: string;
	replaceInstructions?: boolean;
}

// 中文：通过调用方管理的单次请求接口，基于准备好的内容生成分支摘要。
/** Generate a prepared branch summary through a caller-owned one-request boundary. */
export async function generateBranchSummaryWithRequest(
	preparation: BranchPreparation,
	options: PreparedBranchSummaryOptions,
	request: SummaryRequest,
	context: Context,
): Promise<Result<BranchSummaryResult, BranchSummaryError>> {
	const { customInstructions, replaceInstructions } = options;
	const { messages, fileOps } = preparation;
	if (messages.length === 0) {
		return ok({ summary: "No content to summarize", readFiles: [], modifiedFiles: [] });
	}
	const llmMessages = convertToLlm(messages);
	const conversationText = serializeConversation(llmMessages);
	let instructions: string;
	if (replaceInstructions && customInstructions) {
		instructions = customInstructions;
	} else if (customInstructions) {
		instructions = `${BRANCH_SUMMARY_PROMPT}\n\nAdditional focus: ${customInstructions}`;
	} else {
		instructions = BRANCH_SUMMARY_PROMPT;
	}
	const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${instructions}`;

	const summarizationMessages = [
		{
			role: "user" as const,
			content: [{ type: "text" as const, text: promptText }],
			timestamp: Date.now(),
		},
	];
	const response = await request(
		{ systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
		createSummaryRequestOptions({ maxTokens: 2048 }, context),
		context,
	);
	if (response.stopReason === "aborted") {
		return err(new BranchSummaryError("aborted", response.errorMessage || "Branch summary aborted"));
	}
	if (response.stopReason === "error") {
		return err(
			new BranchSummaryError(
				"summarization_failed",
				`Branch summary failed: ${response.errorMessage || "Unknown error"}`,
			),
		);
	}

	let summary = contentText(response.content);
	summary = BRANCH_SUMMARY_PREAMBLE + summary;
	const { readFiles, modifiedFiles } = computeFileLists(fileOps);
	summary += formatFileOperations(readFiles, modifiedFiles);

	return ok({
		summary: summary || "No summary generated",
		usage: response.usage,
		readFiles,
		modifiedFiles,
	});
}

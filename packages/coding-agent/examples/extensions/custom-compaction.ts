// 中文：自定义压缩扩展：用整个上下文的完整摘要替代默认压缩。它不按默认方式保留最近 20k token 的对话轮次，而是汇总 messagesToSummarize 和
// turnPrefixMessages 的所有消息，完全舍弃旧轮次，只保留摘要。示例还展示使用不同模型 Gemini Flash 生成摘要，可能比主对话模型更便宜、更快。用
// 法见英文命令示例。
/**
 * Custom Compaction Extension
 *
 * Replaces the default compaction behavior with a full summary of the entire context.
 * Instead of keeping the last 20k tokens of conversation turns, this extension:
 * 1. Summarizes ALL messages (messagesToSummarize + turnPrefixMessages)
 * 2. Discards all old turns completely, keeping only the summary
 *
 * This example also demonstrates using a different model (Gemini Flash) for summarization,
 * which can be cheaper/faster than the main conversation model.
 *
 * Usage:
 *   pi --extension examples/extensions/custom-compaction.ts
 */

import { uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("session_before_compact", async (event, ctx) => {
		ctx.ui.notify("Custom compaction extension triggered", "info");

		const { preparation, branchEntries: _, signal } = event;
		const { messagesToSummarize, turnPrefixMessages, tokensBefore, firstKeptEntryId, previousSummary } = preparation;

		// 中文：使用 Gemini Flash 生成摘要，通常比对话模型更便宜、更快。
		// Use Gemini Flash for summarization (cheaper/faster than most conversation models)
		const model = ctx.modelRegistry.find("google", "gemini-2.5-flash");
		if (!model) {
			ctx.ui.notify(`Could not find Gemini Flash model, using default compaction`, "warning");
			return;
		}

		// 中文：合并所有消息以生成完整摘要。
		// Combine all messages for full summary
		const allMessages = [...messagesToSummarize, ...turnPrefixMessages];

		ctx.ui.notify(
			`Custom compaction: summarizing ${allMessages.length} messages (${tokensBefore.toLocaleString()} tokens) with ${model.id}...`,
			"info",
		);

		// 中文：将消息转换为可读文本。
		// Convert messages to readable text format
		const conversationText = serializeConversation(convertToLlm(allMessages));

		// 中文：如果有此前摘要，也纳入上下文。
		// Include previous summary context if available
		const previousContext = previousSummary ? `\n\nPrevious session summary for context:\n${previousSummary}` : "";

		// 中文：构建请求全面摘要的消息。
		// Build messages that ask for a comprehensive summary
		const summaryMessages = [
			{
				role: "user" as const,
				content: [
					{
						type: "text" as const,
						text: `You are a conversation summarizer. Create a comprehensive summary of this conversation that captures:${previousContext}

1. The main goals and objectives discussed
2. Key decisions made and their rationale
3. Important code changes, file modifications, or technical details
4. Current state of any ongoing work
5. Any blockers, issues, or open questions
6. Next steps that were planned or suggested

Be thorough but concise. The summary will replace the ENTIRE conversation history, so include all information needed to continue the work effectively.

Format the summary as structured markdown with clear sections.

<conversation>
${conversationText}
</conversation>`,
					},
				],
				timestamp: Date.now(),
			},
		];

		try {
			// 中文：传递 signal 以响应取消请求，例如用户取消压缩。
			// Pass signal to honor abort requests (e.g., user cancels compaction)
			const response = await ctx.modelRegistry.complete(
				model,
				{ messages: summaryMessages },
				{
					maxTokens: 8192,
					signal,
					cacheRetention: "none",
					sessionId: uuidv7(),
				},
			);

			const summary = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n");

			if (!summary.trim()) {
				if (!signal.aborted) ctx.ui.notify("Compaction summary was empty, using default compaction", "warning");
				return;
			}

			// 中文：返回压缩内容，SessionManager 会添加 id/parentId；使用准备结果中的 firstKeptEntryId 保留最近消息。
			// Return compaction content - SessionManager adds id/parentId
			// Use firstKeptEntryId from preparation to keep recent messages
			return {
				compaction: {
					summary,
					firstKeptEntryId,
					tokensBefore,
					usage: response.usage,
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Compaction failed: ${message}`, "error");
			// 中文：出错时回退到默认压缩。
			// Fall back to default compaction on error
			return;
		}
	});
}

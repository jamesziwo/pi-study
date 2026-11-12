// 中文：移除字符串中未配对的 Unicode 代理码元。未配对情况包括高代理 0xD800-0xDBFF 后没有匹配的低代理 0xDC00-0xDFFF，或反过来；它们会导
// 致许多 API 提供方发生 JSON 序列化错误。有效 emoji 和其他基本多文种平面之外的字符使用正确配对的代理码元，不受此函数影响。参数 text 为待清理文本，返
// 回去除未配对代理码元后的文本。下方示例保留有效 emoji；由 String.fromCharCode(0xD83D) 构造的孤立高代理没有对应低代理，会被删除，
// "Text ... here" 中留下两个空格。
/**
 * Removes unpaired Unicode surrogate characters from a string.
 *
 * Unpaired surrogates (high surrogates 0xD800-0xDBFF without matching low surrogates 0xDC00-0xDFFF,
 * or vice versa) cause JSON serialization errors in many API providers.
 *
 * Valid emoji and other characters outside the Basic Multilingual Plane use properly paired
 * surrogates and will NOT be affected by this function.
 *
 * @param text - The text to sanitize
 * @returns The sanitized text with unpaired surrogates removed
 *
 * @example
 * // Valid emoji (properly paired surrogates) are preserved
 * sanitizeSurrogates("Hello 🙈 World") // => "Hello 🙈 World"
 *
 * // Unpaired high surrogate is removed
 * const unpaired = String.fromCharCode(0xD83D); // high surrogate without low
 * sanitizeSurrogates(`Text ${unpaired} here`) // => "Text  here"
 */
export function sanitizeSurrogates(text: string): string {
	// 中文：替换未配对的高代理（0xD800-0xDBFF 后没有低代理），以及未配对的低代理（0xDC00-0xDFFF 前没有高代理）。
	// Replace unpaired high surrogates (0xD800-0xDBFF not followed by low surrogate)
	// Replace unpaired low surrogates (0xDC00-0xDFFF not preceded by high surrogate)
	return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

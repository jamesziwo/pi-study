// 中文：使用 Web Crypto API 的 PKCE 工具函数，适用于 Node.js 20 及以上版本和浏览器。
/**
 * PKCE utilities using Web Crypto API.
 * Works in both Node.js 20+ and browsers.
 */

// 中文：将字节编码为 base64url 字符串。
/**
 * Encode bytes as base64url string.
 */
function base64urlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// 中文：生成 PKCE 代码校验值 verifier 和挑战值 challenge，使用 Web Crypto API 保持跨平台兼容。
/**
 * Generate PKCE code verifier and challenge.
 * Uses Web Crypto API for cross-platform compatibility.
 */
export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
	// 中文：生成随机校验值 verifier。
	// Generate random verifier
	const verifierBytes = new Uint8Array(32);
	crypto.getRandomValues(verifierBytes);
	const verifier = base64urlEncode(verifierBytes);

	// 中文：计算 SHA-256 挑战值 challenge。
	// Compute SHA-256 challenge
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const challenge = base64urlEncode(new Uint8Array(hashBuffer));

	return { verifier, challenge };
}

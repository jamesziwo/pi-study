import { type TUnsafe, Type } from "typebox";

// 中文：创建字符串枚举 schema，兼容 Google API 以及其他不支持 anyOf/const 模式的提供方。下方示例定义 add、subtract、
// multiply、divide 四种操作，description 表示“要执行的操作”；Static 推导出的 Operation 类型为这四个字符串字面量的联合类型。示
// 例代码保持原样。
/**
 * Creates a string enum schema compatible with Google's API and other providers
 * that don't support anyOf/const patterns.
 *
 * @example
 * const OperationSchema = StringEnum(["add", "subtract", "multiply", "divide"], {
 *   description: "The operation to perform"
 * });
 *
 * type Operation = Static<typeof OperationSchema>; // "add" | "subtract" | "multiply" | "divide"
 */
export function StringEnum<T extends readonly string[]>(
	values: T,
	options?: { description?: string; default?: T[number] },
): TUnsafe<T[number]> {
	return Type.Unsafe<T[number]>({
		type: "string",
		enum: values as any,
		...(options?.description && { description: options.description }),
		...(options?.default && { default: options.default }),
	});
}

import type { Context, ContextKey } from "@earendil-works/chord";
import {
	awaitWithContext,
	BACKGROUND_CONTEXT,
	createContextKey,
	TODO_CONTEXT,
	withAbortSignal,
	withCancel,
	withContextValue,
	withoutAbortSignal,
} from "@earendil-works/chord/context";
import { NOOP_TELEMETRY_CONTEXT, type TelemetryContext } from "@earendil-works/pi-telemetry";

export {
	awaitWithContext,
	BACKGROUND_CONTEXT,
	type Context,
	type ContextKey,
	createContextKey,
	TODO_CONTEXT,
	withAbortSignal,
	withCancel,
	withContextValue,
	withoutAbortSignal,
};

const TELEMETRY_CONTEXT_KEY = createContextKey<TelemetryContext>("pi.telemetryContext");

// 中文：返回上下文附带的遥测父对象；没有时返回共享的空操作父对象。
/** Return the telemetry parent attached to a context, or the shared no-op parent. */
export function getTelemetryContext(context: Context): TelemetryContext {
	return context.value(TELEMETRY_CONTEXT_KEY) ?? NOOP_TELEMETRY_CONTEXT;
}

// 中文：派生一个上下文，使其遥测子节点使用指定的父对象或活动 span。
/** Derive a context whose telemetry children use the supplied parent or active span. */
export function withTelemetryContext(telemetryContext: TelemetryContext, context: Context): Context {
	return withContextValue(TELEMETRY_CONTEXT_KEY, telemetryContext, context);
}

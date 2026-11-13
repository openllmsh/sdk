import * as Schema from "../Schema.ts";
import * as McpSchema from "./McpSchema.ts";
declare const TypeId: "~effect/ai/McpClientError";
declare const ReasonTypeId: "~effect/ai/McpClientError/Reason";
declare const TransportError_base: Schema.Class<TransportError, Schema.Struct<{
    readonly _tag: Schema.tag<"TransportError">;
    readonly description: Schema.optional<Schema.String>;
    readonly cause: Schema.optional<Schema.Defect>;
}>, import("../Cause.ts").YieldableError>;
/**
 * The connection to the server failed: a process or HTTP request could not be
 * started, written or read, or ended before the response.
 *
 * @stability experimental
 * @category reasons
 * @since 4.0.6
 */
export declare class TransportError extends TransportError_base {
    readonly [ReasonTypeId]: "~effect/ai/McpClientError/Reason";
    get message(): string;
}
declare const ProtocolError_base: Schema.Class<ProtocolError, Schema.Struct<{
    readonly _tag: Schema.tag<"ProtocolError">;
    readonly code: Schema.optional<Schema.Int>;
    readonly data: Schema.optional<Schema.Unknown>;
    readonly description: Schema.optional<Schema.String>;
    readonly cause: Schema.optional<Schema.Defect>;
}>, import("../Cause.ts").YieldableError>;
/**
 * The server returned a JSON-RPC error, or sent a message that is not valid
 * JSON-RPC for the selected protocol.
 *
 * @stability experimental
 * @category reasons
 * @since 4.0.6
 */
export declare class ProtocolError extends ProtocolError_base {
    readonly [ReasonTypeId]: "~effect/ai/McpClientError/Reason";
    get message(): string;
}
declare const HttpError_base: Schema.Class<HttpError, Schema.Struct<{
    readonly _tag: Schema.tag<"HttpError">;
    readonly status: Schema.Int;
    readonly code: Schema.optional<Schema.Int>;
    readonly data: Schema.optional<Schema.Unknown>;
    readonly description: Schema.optional<Schema.String>;
    readonly wwwAuthenticate: Schema.optional<Schema.String>;
    readonly retryAfter: Schema.optional<Schema.String>;
}>, import("../Cause.ts").YieldableError>;
/**
 * The server answered an HTTP request with a non-success status. A JSON-RPC
 * error in the response body supplies `code`, `data` and `description`.
 *
 * @stability experimental
 * @category reasons
 * @since 4.0.6
 */
export declare class HttpError extends HttpError_base {
    readonly [ReasonTypeId]: "~effect/ai/McpClientError/Reason";
    get message(): string;
}
declare const UnsupportedError_base: Schema.Class<UnsupportedError, Schema.Struct<{
    readonly _tag: Schema.tag<"UnsupportedError">;
    readonly description: Schema.String;
    readonly result: Schema.optional<typeof McpSchema.CallToolResult>;
}>, import("../Cause.ts").YieldableError>;
/**
 * The server or the selected protocol does not support the requested
 * operation, or a tool result cannot be converted for a language model.
 *
 * @stability experimental
 * @category reasons
 * @since 4.0.6
 */
export declare class UnsupportedError extends UnsupportedError_base {
    readonly [ReasonTypeId]: "~effect/ai/McpClientError/Reason";
    get message(): string;
}
declare const ClosedError_base: Schema.Class<ClosedError, Schema.Struct<{
    readonly _tag: Schema.tag<"ClosedError">;
    readonly sessionExpired: Schema.optional<Schema.Boolean>;
    readonly description: Schema.optional<Schema.String>;
}>, import("../Cause.ts").YieldableError>;
/**
 * The client, its transport or its legacy HTTP session is closed.
 *
 * @stability experimental
 * @category reasons
 * @since 4.0.6
 */
export declare class ClosedError extends ClosedError_base {
    readonly [ReasonTypeId]: "~effect/ai/McpClientError/Reason";
    get message(): string;
}
declare const TimeoutError_base: Schema.Class<TimeoutError, Schema.Struct<{
    readonly _tag: Schema.tag<"TimeoutError">;
    readonly operation: Schema.String;
}>, import("../Cause.ts").YieldableError>;
/**
 * An operation did not complete within its deadline.
 *
 * @stability experimental
 * @category reasons
 * @since 4.0.6
 */
export declare class TimeoutError extends TimeoutError_base {
    readonly [ReasonTypeId]: "~effect/ai/McpClientError/Reason";
    get message(): string;
}
declare const LimitError_base: Schema.Class<LimitError, Schema.Struct<{
    readonly _tag: Schema.tag<"LimitError">;
    readonly description: Schema.String;
}>, import("../Cause.ts").YieldableError>;
/**
 * A message or a discovery scan exceeded a client limit.
 *
 * @stability experimental
 * @category reasons
 * @since 4.0.6
 */
export declare class LimitError extends LimitError_base {
    readonly [ReasonTypeId]: "~effect/ai/McpClientError/Reason";
    get message(): string;
}
declare const ConfigurationError_base: Schema.Class<ConfigurationError, Schema.Struct<{
    readonly _tag: Schema.tag<"ConfigurationError">;
    readonly description: Schema.String;
    readonly cause: Schema.optional<Schema.Defect>;
}>, import("../Cause.ts").YieldableError>;
/**
 * Client or toolkit options are invalid.
 *
 * @stability experimental
 * @category reasons
 * @since 4.0.6
 */
export declare class ConfigurationError extends ConfigurationError_base {
    readonly [ReasonTypeId]: "~effect/ai/McpClientError/Reason";
    get message(): string;
}
declare const ValidationError_base: Schema.Class<ValidationError, Schema.Struct<{
    readonly _tag: Schema.tag<"ValidationError">;
    readonly description: Schema.String;
    readonly cause: Schema.optional<Schema.Defect>;
}>, import("../Cause.ts").YieldableError>;
/**
 * A request payload, tool argument or result failed schema validation.
 *
 * @stability experimental
 * @category reasons
 * @since 4.0.6
 */
export declare class ValidationError extends ValidationError_base {
    readonly [ReasonTypeId]: "~effect/ai/McpClientError/Reason";
    get message(): string;
}
declare const ToolError_base: Schema.Class<ToolError, Schema.Struct<{
    readonly _tag: Schema.tag<"ToolError">;
    readonly result: typeof McpSchema.CallToolResult;
}>, import("../Cause.ts").YieldableError>;
/**
 * A tool reported an execution error with `isError`. The complete result is
 * retained.
 *
 * @stability experimental
 * @category reasons
 * @since 4.0.6
 */
export declare class ToolError extends ToolError_base {
    readonly [ReasonTypeId]: "~effect/ai/McpClientError/Reason";
    get message(): string;
}
/**
 * Union of MCP client and transport failure reasons.
 *
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export type McpClientErrorReason = TransportError | ProtocolError | HttpError | UnsupportedError | ClosedError | TimeoutError | LimitError | ConfigurationError | ValidationError | ToolError;
/**
 * Schema for the reasons carried by an `McpClientError`.
 *
 * @stability experimental
 * @category schemas
 * @since 4.0.6
 */
export declare const McpClientErrorReason: Schema.Union<[
    typeof TransportError,
    typeof ProtocolError,
    typeof HttpError,
    typeof UnsupportedError,
    typeof ClosedError,
    typeof TimeoutError,
    typeof LimitError,
    typeof ConfigurationError,
    typeof ValidationError,
    typeof ToolError
]>;
declare const McpClientError_base: Schema.Class<McpClientError, Schema.Struct<{
    readonly _tag: Schema.tag<"McpClientError">;
    readonly reason: Schema.Union<[typeof TransportError, typeof ProtocolError, typeof HttpError, typeof UnsupportedError, typeof ClosedError, typeof TimeoutError, typeof LimitError, typeof ConfigurationError, typeof ValidationError, typeof ToolError]>;
}>, import("../Cause.ts").YieldableError>;
/**
 * Error wrapping an MCP client or transport failure reason.
 *
 * **Details**
 *
 * Use `Effect.catchReason` or `Effect.catchReasons` to recover from selected
 * reasons. The error's `message` and `cause` come from its reason.
 *
 * **Example** (Recovering from a deadline failure)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { McpClientError } from "effect/ai"
 *
 * const operation = Effect.fail(new McpClientError.McpClientError({
 *   reason: new McpClientError.TimeoutError({ operation: "tools/call" })
 * }))
 * const recovered = operation.pipe(
 *   Effect.catchReason("McpClientError", "TimeoutError", () => Effect.succeed("deferred"))
 * )
 *
 * await Effect.runPromise(recovered) // => "deferred"
 * ```
 *
 * @stability experimental
 * @category errors
 * @since 4.0.6
 */
export declare class McpClientError extends McpClientError_base {
    readonly [TypeId]: "~effect/ai/McpClientError";
    readonly cause: ClosedError | ConfigurationError | HttpError | LimitError | ProtocolError | TimeoutError | ToolError | TransportError | UnsupportedError | ValidationError;
    get message(): string;
}
/**
 * Returns whether a value is an `McpClientError`.
 *
 * @stability experimental
 * @category guards
 * @since 4.0.6
 */
export declare const isMcpClientError: (u: unknown) => u is McpClientError;
/**
 * Returns whether a value is one of the `McpClientError` reasons.
 *
 * @stability experimental
 * @category guards
 * @since 4.0.6
 */
export declare const isMcpClientErrorReason: (u: unknown) => u is McpClientErrorReason;
export {};
//# sourceMappingURL=McpClientError.d.ts.map
/**
 * Errors produced by `McpClient` operations and transports.
 *
 * Every failure is an `McpClientError` whose `reason` is one of the reason
 * classes in this module: transport, protocol, HTTP, unsupported feature,
 * closed connection, timeout, limit, configuration, validation or
 * tool-reported errors.
 *
 * @stability experimental
 * @since 4.0.6
 */
import * as Predicate from "../Predicate.js";
import * as Schema from "../Schema.js";
import * as McpSchema from "./McpSchema.js";
const TypeId = "~effect/ai/McpClientError";
const ReasonTypeId = "~effect/ai/McpClientError/Reason";
/**
 * The connection to the server failed: a process or HTTP request could not be
 * started, written or read, or ended before the response.
 *
 * @stability experimental
 * @category reasons
 * @since 4.0.6
 */
export class TransportError extends /*#__PURE__*/Schema.Error("effect/ai/McpClientError/TransportError")({
  _tag: /*#__PURE__*/Schema.tag("TransportError"),
  description: /*#__PURE__*/Schema.optional(Schema.String),
  cause: /*#__PURE__*/Schema.optional(/*#__PURE__*/Schema.Defect())
}) {
  [ReasonTypeId] = ReasonTypeId;
  get message() {
    return this.description ?? "MCP transport failed";
  }
}
/**
 * The server returned a JSON-RPC error, or sent a message that is not valid
 * JSON-RPC for the selected protocol.
 *
 * @stability experimental
 * @category reasons
 * @since 4.0.6
 */
export class ProtocolError extends /*#__PURE__*/Schema.Error("effect/ai/McpClientError/ProtocolError")({
  _tag: /*#__PURE__*/Schema.tag("ProtocolError"),
  code: /*#__PURE__*/Schema.optional(Schema.Int),
  data: /*#__PURE__*/Schema.optional(Schema.Unknown),
  description: /*#__PURE__*/Schema.optional(Schema.String),
  cause: /*#__PURE__*/Schema.optional(/*#__PURE__*/Schema.Defect())
}) {
  [ReasonTypeId] = ReasonTypeId;
  get message() {
    const message = this.description ?? "MCP protocol error";
    return this.code === undefined ? message : `${message} (code ${this.code})`;
  }
}
/**
 * The server answered an HTTP request with a non-success status. A JSON-RPC
 * error in the response body supplies `code`, `data` and `description`.
 *
 * @stability experimental
 * @category reasons
 * @since 4.0.6
 */
export class HttpError extends /*#__PURE__*/Schema.Error("effect/ai/McpClientError/HttpError")({
  _tag: /*#__PURE__*/Schema.tag("HttpError"),
  status: Schema.Int,
  code: /*#__PURE__*/Schema.optional(Schema.Int),
  data: /*#__PURE__*/Schema.optional(Schema.Unknown),
  description: /*#__PURE__*/Schema.optional(Schema.String),
  wwwAuthenticate: /*#__PURE__*/Schema.optional(Schema.String),
  retryAfter: /*#__PURE__*/Schema.optional(Schema.String)
}) {
  [ReasonTypeId] = ReasonTypeId;
  get message() {
    const message = `MCP HTTP status ${this.status}`;
    return this.description === undefined ? message : `${message}: ${this.description}`;
  }
}
/**
 * The server or the selected protocol does not support the requested
 * operation, or a tool result cannot be converted for a language model.
 *
 * @stability experimental
 * @category reasons
 * @since 4.0.6
 */
export class UnsupportedError extends /*#__PURE__*/Schema.Error("effect/ai/McpClientError/UnsupportedError")({
  _tag: /*#__PURE__*/Schema.tag("UnsupportedError"),
  description: Schema.String,
  result: /*#__PURE__*/Schema.optional(McpSchema.CallToolResult)
}) {
  [ReasonTypeId] = ReasonTypeId;
  get message() {
    return this.description;
  }
}
/**
 * The client, its transport or its legacy HTTP session is closed.
 *
 * @stability experimental
 * @category reasons
 * @since 4.0.6
 */
export class ClosedError extends /*#__PURE__*/Schema.Error("effect/ai/McpClientError/ClosedError")({
  _tag: /*#__PURE__*/Schema.tag("ClosedError"),
  sessionExpired: /*#__PURE__*/Schema.optional(Schema.Boolean),
  description: /*#__PURE__*/Schema.optional(Schema.String)
}) {
  [ReasonTypeId] = ReasonTypeId;
  get message() {
    return this.sessionExpired === true ? "MCP session expired" : this.description ?? "MCP connection closed";
  }
}
/**
 * An operation did not complete within its deadline.
 *
 * @stability experimental
 * @category reasons
 * @since 4.0.6
 */
export class TimeoutError extends /*#__PURE__*/Schema.Error("effect/ai/McpClientError/TimeoutError")({
  _tag: /*#__PURE__*/Schema.tag("TimeoutError"),
  operation: Schema.String
}) {
  [ReasonTypeId] = ReasonTypeId;
  get message() {
    return `MCP ${this.operation} deadline exceeded`;
  }
}
/**
 * A message or a discovery scan exceeded a client limit.
 *
 * @stability experimental
 * @category reasons
 * @since 4.0.6
 */
export class LimitError extends /*#__PURE__*/Schema.Error("effect/ai/McpClientError/LimitError")({
  _tag: /*#__PURE__*/Schema.tag("LimitError"),
  description: Schema.String
}) {
  [ReasonTypeId] = ReasonTypeId;
  get message() {
    return this.description;
  }
}
/**
 * Client or toolkit options are invalid.
 *
 * @stability experimental
 * @category reasons
 * @since 4.0.6
 */
export class ConfigurationError extends /*#__PURE__*/Schema.Error("effect/ai/McpClientError/ConfigurationError")({
  _tag: /*#__PURE__*/Schema.tag("ConfigurationError"),
  description: Schema.String,
  cause: /*#__PURE__*/Schema.optional(/*#__PURE__*/Schema.Defect())
}) {
  [ReasonTypeId] = ReasonTypeId;
  get message() {
    return this.description;
  }
}
/**
 * A request payload, tool argument or result failed schema validation.
 *
 * @stability experimental
 * @category reasons
 * @since 4.0.6
 */
export class ValidationError extends /*#__PURE__*/Schema.Error("effect/ai/McpClientError/ValidationError")({
  _tag: /*#__PURE__*/Schema.tag("ValidationError"),
  description: Schema.String,
  cause: /*#__PURE__*/Schema.optional(/*#__PURE__*/Schema.Defect())
}) {
  [ReasonTypeId] = ReasonTypeId;
  get message() {
    return this.description;
  }
}
/**
 * A tool reported an execution error with `isError`. The complete result is
 * retained.
 *
 * @stability experimental
 * @category reasons
 * @since 4.0.6
 */
export class ToolError extends /*#__PURE__*/Schema.Error("effect/ai/McpClientError/ToolError")({
  _tag: /*#__PURE__*/Schema.tag("ToolError"),
  result: McpSchema.CallToolResult
}) {
  [ReasonTypeId] = ReasonTypeId;
  get message() {
    const text = this.result.content.find(block => block.type === "text");
    return text === undefined ? "MCP tool reported an error" : `MCP tool reported an error: ${text.text}`;
  }
}
/**
 * Schema for the reasons carried by an `McpClientError`.
 *
 * @stability experimental
 * @category schemas
 * @since 4.0.6
 */
export const McpClientErrorReason = /*#__PURE__*/Schema.Union([TransportError, ProtocolError, HttpError, UnsupportedError, ClosedError, TimeoutError, LimitError, ConfigurationError, ValidationError, ToolError]);
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
export class McpClientError extends /*#__PURE__*/Schema.Error("effect/ai/McpClientError/McpClientError")({
  _tag: /*#__PURE__*/Schema.tag("McpClientError"),
  reason: McpClientErrorReason
}) {
  [TypeId] = TypeId;
  cause = this.reason;
  get message() {
    return this.reason.message;
  }
}
/**
 * Returns whether a value is an `McpClientError`.
 *
 * @stability experimental
 * @category guards
 * @since 4.0.6
 */
export const isMcpClientError = u => Predicate.hasProperty(u, TypeId);
/**
 * Returns whether a value is one of the `McpClientError` reasons.
 *
 * @stability experimental
 * @category guards
 * @since 4.0.6
 */
export const isMcpClientErrorReason = u => Predicate.hasProperty(u, ReasonTypeId);
//# sourceMappingURL=McpClientError.js.map
/**
 * Encodes and decodes a single JSON array as a stream of its elements.
 *
 * **Details**
 *
 * Use `JsonArray` when a large response or file is one JSON document, such as
 * `[...]` or `{"items":[...],"total":n}`, and its elements should be processed
 * without buffering the whole document. Use `Ndjson` when the producer writes
 * one JSON value per line. This module is unrelated to `Schema.JsonArray`, the
 * type of a JSON array value.
 *
 * Decoders stream the elements of one array, the root array by default or the
 * array selected by an RFC 6901 JSON Pointer. Each element is buffered only
 * until it is complete and then parsed with `JSON.parse`. The rest of the
 * document is validated and discarded. Encoders write a stream of values as
 * one JSON array.
 *
 * **Example** (Streaming the items of a large HTTP response)
 *
 * ```ts
 * import { Effect, Schema, Stream } from "effect"
 * import { JsonArray } from "effect/encoding"
 * import { HttpClient, HttpClientResponse } from "effect/http"
 *
 * const User = Schema.Struct({ id: Schema.Number, name: Schema.String })
 *
 * // The response body is {"data":[{"id":1,"name":"Alice"},...],"total":...}
 * const program = HttpClientResponse.stream(HttpClient.get("https://example.com/users")).pipe(
 *   Stream.pipeThroughChannel(JsonArray.decodeSchema(User)({ pointer: "/data" })),
 *   Stream.runForEach((user) => Effect.log(user.name))
 * )
 * ```
 *
 * @stability unstable
 * @since 4.0.6
 */
import * as Arr from "../Array.ts";
import * as Cause from "../Cause.ts";
import * as Channel from "../Channel.ts";
import type * as Schema from "../Schema.ts";
declare const JsonArrayErrorTypeId = "~effect/encoding/JsonArray/JsonArrayError";
declare const JsonArrayError_base: new <A extends Record<string, any> = {}>(args: import("../Types.ts").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => Cause.YieldableError & {
    readonly _tag: "JsonArrayError";
} & Readonly<A>;
/**
 * Error raised when JSON array encoding or decoding fails.
 *
 * **Details**
 *
 * - `Syntax`: the input is not valid JSON, including an empty input or
 *   content after the document.
 * - `Limit`: a value exceeds `maxDepth` or `maxElementSize`, whether it is an
 *   element, a key, or a value outside the selected array.
 * - `Pointer`: the pointer target is missing or not an array, a value along the
 *   pointer is not an object or array, or an object along the pointer repeats
 *   the key that the pointer follows.
 * - `Encode`: a value has no JSON representation.
 *
 * Decoding errors set `offset`, a zero-based offset in UTF-16 code units into
 * the decoded text after any leading BOM. When a value is invalid or exceeds a
 * limit, the offset is the start of that value. `Encode` errors have no
 * offset. When `JSON.parse` or `JSON.stringify` throws, `Syntax` and `Encode`
 * errors retain the original thrown value as `cause`.
 *
 * @stability unstable
 * @category errors
 * @since 4.0.6
 */
export declare class JsonArrayError extends JsonArrayError_base<{
    readonly kind: "Syntax" | "Limit" | "Pointer" | "Encode";
    readonly message: string;
    readonly offset?: number | undefined;
    readonly cause?: unknown;
}> {
    /**
     * Marks this value as a JSON array encoding or decoding error for runtime
     * guards.
     *
     * @stability unstable
     * @since 4.0.6
     */
    readonly [JsonArrayErrorTypeId] = "~effect/encoding/JsonArray/JsonArrayError";
}
/**
 * Checks whether a value is a `JsonArrayError`.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.6
 */
export declare const isJsonArrayError: (u: unknown) => u is JsonArrayError;
/**
 * JSON array decoding options.
 *
 * **Details**
 *
 * - `pointer`: an RFC 6901 JSON Pointer to the array to stream, such as
 *   `"/data"`. Defaults to `""`, the root. Tokens select object members by
 *   key and array elements by index.
 * - `maxDepth`: the maximum nesting of arrays and objects in one value, where
 *   an array or object element has depth 1. Defaults to 1000.
 * - `maxElementSize`: the maximum length of one value in UTF-16 code units.
 *   Defaults to 16 MiB; `Infinity` disables the limit.
 *
 * Both limits also apply to values outside the selected array, which are
 * buffered and validated before being discarded. Invalid options throw when
 * the channel is created.
 *
 * @stability unstable
 * @category configuration
 * @since 4.0.6
 */
export interface DecodeOptions {
    readonly pointer?: string | undefined;
    readonly maxDepth?: number | undefined;
    readonly maxElementSize?: number | undefined;
}
/**
 * Creates a channel that parses the text of one JSON document and emits the
 * elements of one of its arrays.
 *
 * **When to use**
 *
 * Use when a large JSON array, or an object that contains one, arrives as
 * string chunks and its elements should be processed as they arrive.
 *
 * **Details**
 *
 * Each output chunk holds the elements completed by one input chunk. Elements
 * may span input chunks and are buffered only until they are complete. A
 * leading BOM is stripped.
 *
 * **Gotchas**
 *
 * - The document is validated as it streams, so elements from earlier
 *   successfully processed input chunks may already have been emitted when a
 *   later error fails the channel. Elements accumulated in the failing chunk
 *   are not emitted. A failure in content after the selected array signals
 *   that the document was invalid, but cannot guard against using earlier
 *   output.
 * - The pointer follows the first occurrence of a key, where `JSON.parse`
 *   keeps the last. A repeated followed key fails with a `Pointer` error, as
 *   does a first occurrence that is not an object or array where the pointer
 *   needs one. When the repeat comes after the selected array, elements from
 *   earlier successfully processed chunks may already have been emitted.
 * - A root that is not an array fails with a `Pointer` error unless the
 *   pointer selects an array inside it.
 *
 * **Example** (Streaming an array inside an envelope)
 *
 * ```ts import.meta.vitest
 * import { Effect, Stream } from "effect"
 * import { JsonArray } from "effect/encoding"
 *
 * const items = Stream.make("{\"total\":2,\"items\":[{\"id\":1},{\"i", "d\":2}]}").pipe(
 *   Stream.pipeThroughChannel(JsonArray.decodeString({ pointer: "/items" })),
 *   Stream.runCollect
 * )
 * await Effect.runPromise(items) // => [{ id: 1 }, { id: 2 }]
 * ```
 *
 * @see decode
 * @see decodeSchemaString
 * @stability unstable
 * @category decoding
 * @since 4.0.6
 */
export declare const decodeString: <IE = never, Done = unknown>(options?: DecodeOptions) => Channel.Channel<Arr.NonEmptyReadonlyArray<unknown>, IE | JsonArrayError, Done, Arr.NonEmptyReadonlyArray<string>, IE, Done>;
/**
 * Creates a channel that parses UTF-8 bytes of one JSON document and emits the
 * elements of one of its arrays.
 *
 * **Details**
 *
 * Multi-byte characters may span input chunks, and invalid UTF-8 is replaced
 * with U+FFFD.
 *
 * @see decodeString
 * @stability unstable
 * @category decoding
 * @since 4.0.6
 */
export declare const decode: <IE = never, Done = unknown>(options?: DecodeOptions) => Channel.Channel<Arr.NonEmptyReadonlyArray<unknown>, IE | JsonArrayError, Done, Arr.NonEmptyReadonlyArray<Uint8Array>, IE, Done>;
/**
 * Creates a channel that parses the text of one JSON document and decodes the
 * elements of one of its arrays with a schema.
 *
 * @see decodeString
 * @stability unstable
 * @category decoding
 * @since 4.0.6
 */
export declare const decodeSchemaString: <S extends Schema.Constraint>(schema: S) => <IE = never, Done = unknown>(options?: DecodeOptions) => Channel.Channel<Arr.NonEmptyReadonlyArray<S["Type"]>, Schema.SchemaError | JsonArrayError | IE, Done, Arr.NonEmptyReadonlyArray<string>, IE, Done, S["DecodingServices"]>;
/**
 * Creates a channel that parses UTF-8 bytes of one JSON document and decodes
 * the elements of one of its arrays with a schema.
 *
 * @see decodeSchemaString
 * @stability unstable
 * @category decoding
 * @since 4.0.6
 */
export declare const decodeSchema: <S extends Schema.Constraint>(schema: S) => <IE = never, Done = unknown>(options?: DecodeOptions) => Channel.Channel<Arr.NonEmptyReadonlyArray<S["Type"]>, Schema.SchemaError | JsonArrayError | IE, Done, Arr.NonEmptyReadonlyArray<Uint8Array>, IE, Done, S["DecodingServices"]>;
/**
 * Creates a channel that writes a stream of values as the text of one JSON
 * array.
 *
 * **Details**
 *
 * Each input chunk produces one string. An empty stream produces `"[]"`.
 * Values are written with `JSON.stringify`.
 *
 * **Gotchas**
 *
 * A value that `JSON.stringify` cannot write, such as `undefined`, a function
 * or a `bigint`, fails with an `Encode` error after the preceding text has
 * been emitted.
 *
 * **Example** (Writing values as a JSON array)
 *
 * ```ts import.meta.vitest
 * import { Effect, Stream } from "effect"
 * import { JsonArray } from "effect/encoding"
 *
 * const json = Stream.make({ id: 1 }, { id: 2 }).pipe(
 *   Stream.pipeThroughChannel(JsonArray.encodeString()),
 *   Stream.mkString
 * )
 * await Effect.runPromise(json) // => '[{"id":1},{"id":2}]'
 * ```
 *
 * @see encode
 * @see encodeSchemaString
 * @stability unstable
 * @category encoding
 * @since 4.0.6
 */
export declare const encodeString: <IE = never, Done = unknown>() => Channel.Channel<Arr.NonEmptyReadonlyArray<string>, IE | JsonArrayError, Done, Arr.NonEmptyReadonlyArray<unknown>, IE, Done>;
/**
 * Creates a channel that writes a stream of values as UTF-8 bytes of one JSON
 * array.
 *
 * @see encodeString
 * @stability unstable
 * @category encoding
 * @since 4.0.6
 */
export declare const encode: <IE = never, Done = unknown>() => Channel.Channel<Arr.NonEmptyReadonlyArray<Uint8Array>, IE | JsonArrayError, Done, Arr.NonEmptyReadonlyArray<unknown>, IE, Done>;
/**
 * Creates a channel that encodes values with a schema and writes them as the
 * text of one JSON array.
 *
 * @see encodeString
 * @stability unstable
 * @category encoding
 * @since 4.0.6
 */
export declare const encodeSchemaString: <S extends Schema.Constraint>(schema: S) => <IE = never, Done = unknown>() => Channel.Channel<Arr.NonEmptyReadonlyArray<string>, JsonArrayError | Schema.SchemaError | IE, Done, Arr.NonEmptyReadonlyArray<S["Type"]>, IE, Done, S["EncodingServices"]>;
/**
 * Creates a channel that encodes values with a schema and writes them as UTF-8
 * bytes of one JSON array.
 *
 * @see encodeSchemaString
 * @stability unstable
 * @category encoding
 * @since 4.0.6
 */
export declare const encodeSchema: <S extends Schema.Constraint>(schema: S) => <IE = never, Done = unknown>() => Channel.Channel<Arr.NonEmptyReadonlyArray<Uint8Array>, JsonArrayError | Schema.SchemaError | IE, Done, Arr.NonEmptyReadonlyArray<S["Type"]>, IE, Done, S["EncodingServices"]>;
export {};
//# sourceMappingURL=JsonArray.d.ts.map
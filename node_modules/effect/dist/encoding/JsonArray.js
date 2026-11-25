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
import * as Arr from "../Array.js";
import * as Cause from "../Cause.js";
import * as Channel from "../Channel.js";
import * as ChannelSchema from "../ChannelSchema.js";
import * as Data from "../Data.js";
import * as Effect from "../Effect.js";
import * as JsonPointer from "../JsonPointer.js";
import * as Predicate from "../Predicate.js";
import * as Pull from "../Pull.js";
const JsonArrayErrorTypeId = "~effect/encoding/JsonArray/JsonArrayError";
const encoder = /*#__PURE__*/new TextEncoder();
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
export class JsonArrayError extends /*#__PURE__*/Data.TaggedError("JsonArrayError") {
  /**
   * Marks this value as a JSON array encoding or decoding error for runtime
   * guards.
   *
   * @stability unstable
   * @since 4.0.6
   */
  [JsonArrayErrorTypeId] = JsonArrayErrorTypeId;
}
/**
 * Checks whether a value is a `JsonArrayError`.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.6
 */
export const isJsonArrayError = u => Predicate.hasProperty(u, JsonArrayErrorTypeId);
const makeConfig = options => {
  const pointer = options?.pointer ?? "";
  if (pointer !== "" && (!pointer.startsWith("/") || /~(?:[^01]|$)/.test(pointer))) {
    throw new Error(`JsonArray: pointer must be an RFC 6901 JSON Pointer, got ${JSON.stringify(pointer)}`);
  }
  const maxDepth = options?.maxDepth ?? 1000;
  if (!(Number.isInteger(maxDepth) && maxDepth >= 0)) {
    throw new Error(`JsonArray: maxDepth must be a non-negative integer, got ${maxDepth}`);
  }
  const maxElementSize = options?.maxElementSize ?? 16 * 1024 * 1024;
  if (!(maxElementSize >= 1)) {
    throw new Error(`JsonArray: maxElementSize must be at least 1, got ${maxElementSize}`);
  }
  const tokens = pointer === "" ? [] : pointer.slice(1).split("/").map(JsonPointer.unescapeToken);
  return {
    tokens,
    indices: tokens.map(token => /^(?:0|[1-9]\d*)$/.test(token) ? Number(token) : -1),
    maxDepth,
    maxElementSize
  };
};
const TAB = 9;
const LF = 10;
const CR = 13;
const SPACE = 32;
const QUOTE = 34;
const COMMA = 44;
const COLON = 58;
const LBRACKET = 91;
const BACKSLASH = 92;
const RBRACKET = 93;
const LBRACE = 123;
const RBRACE = 125;
const isWhitespace = c => c === SPACE || c === LF || c === CR || c === TAB;
const indexOf = (text, search, i) => {
  const index = text.indexOf(search, i);
  return index === -1 ? text.length : index;
};
const isValueStart = c => c === QUOTE || c === LBRACKET || c === LBRACE || c === 45 || c >= 48 && c <= 57 || c === 102 || c === 110 || c === 116;
// The scanner walks the containers along the pointer and the selected array.
// Every other value is captured whole and parsed with `JSON.parse`: elements
// are emitted, keys are matched against the pointer, and the rest is
// discarded.
// Structural states.
const VALUE = 0; // the value at the current pointer prefix
const OBJECT_START = 1; // after `{`: a key or `}`
const OBJECT_KEY = 2; // after `,`: a key
const OBJECT_COLON = 3; // after a key: `:`
const OBJECT_VALUE = 4; // after `:` for a key the pointer does not follow
const OBJECT_NEXT = 5; // after a member: `,` or `}`
const ARRAY_START = 6; // after `[`: a value or `]`
const ARRAY_VALUE = 7; // after `,`: a value
const ARRAY_NEXT = 8; // after an element: `,` or `]`
const END = 9; // after the document
// Capture modes.
const NONE = 0;
const SKIP = 1;
const ELEMENT = 2;
const KEY = 3;
class Scanner {
  config;
  state = VALUE;
  frames = [];
  key = "";
  started = false;
  // The offset of the start of the current chunk.
  base = 0;
  // The value being captured, which may span chunks.
  capture = NONE;
  start = 0;
  buffer = "";
  scalar = false;
  depth = 0;
  inString = false;
  escape = false;
  // Cached quote and backslash positions; the chunk length means not found.
  quote = -1;
  backslash = -1;
  // Absolute end of a batch that failed to parse. The precise scan handles
  // text before it, so the batch is not rescanned for every element.
  slow = 0;
  constructor(config) {
    this.config = config;
  }
  fail(kind, message, offset, cause) {
    return new JsonArrayError({
      kind,
      message,
      offset,
      cause
    });
  }
  pointerPrefix(length, ...rest) {
    return JSON.stringify(this.config.tokens.slice(0, length).concat(rest).map(token => "/" + JsonPointer.escapeToken(token)).join(""));
  }
  // Names the value being captured, for limit errors.
  subject() {
    if (this.capture === ELEMENT) return "Element";
    const depth = this.frames.length - 1;
    if (this.capture === KEY) return `Key in ${this.pointerPrefix(depth)}`;
    const frame = this.frames[depth];
    const token = frame.object ? this.key : String(frame.index - 1);
    return `Value outside the selected array at ${this.pointerPrefix(depth, token)}`;
  }
  feed(text, out) {
    if (!this.started && text.length > 0) {
      this.started = true;
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    }
    this.quote = -1;
    this.backslash = -1;
    let i = this.capture === NONE ? 0 : this.scan(text, 0, out);
    while (i < text.length) {
      const c = text.charCodeAt(i);
      i = isWhitespace(c) ? i + 1 : this.step(text, i, c, out);
    }
    if (this.capture !== NONE) {
      this.buffer += text.slice(Math.max(this.start - this.base, 0));
      this.checkSize(this.buffer.length);
    }
    this.base += text.length;
  }
  end() {
    if (this.state !== END || this.capture !== NONE) {
      throw this.fail("Syntax", "Unexpected end of input", this.base);
    }
  }
  // Handles one structural character and returns the next index.
  step(text, i, c, out) {
    const frame = this.frames[this.frames.length - 1];
    switch (this.state) {
      case VALUE:
        {
          const target = this.frames.length === this.config.tokens.length;
          if (c === LBRACKET || c === LBRACE && !target) {
            this.frames.push({
              object: c === LBRACE,
              target,
              found: false,
              index: 0
            });
            this.state = c === LBRACE ? OBJECT_START : ARRAY_START;
            return i + 1;
          }
          if (isValueStart(c)) {
            const expected = target ? "an array" : "an object or array";
            throw this.fail("Pointer", `Expected ${expected} at ${this.pointerPrefix(this.frames.length)}`, this.base + i);
          }
          break;
        }
      case OBJECT_START:
      case OBJECT_KEY:
        {
          if (c === QUOTE) {
            this.state = OBJECT_COLON;
            return this.begin(KEY, text, i, out);
          }
          if (c === RBRACE && this.state === OBJECT_START) return this.close(i);
          break;
        }
      case OBJECT_COLON:
        {
          if (c !== COLON) break;
          if (this.key === this.config.tokens[this.frames.length - 1]) {
            if (frame.found) {
              throw this.fail("Pointer", `Duplicate key ${JSON.stringify(this.key)} along the pointer`, this.base + i);
            }
            frame.found = true;
            this.state = VALUE;
          } else {
            this.state = OBJECT_VALUE;
          }
          return i + 1;
        }
      case OBJECT_VALUE:
        {
          if (!isValueStart(c)) break;
          this.state = OBJECT_NEXT;
          return this.begin(SKIP, text, i, out);
        }
      case OBJECT_NEXT:
      case ARRAY_NEXT:
        {
          if (c === COMMA) {
            this.state = this.state === OBJECT_NEXT ? OBJECT_KEY : ARRAY_VALUE;
            return i + 1;
          }
          if (c === (this.state === OBJECT_NEXT ? RBRACE : RBRACKET)) return this.close(i);
          break;
        }
      case ARRAY_START:
      case ARRAY_VALUE:
        {
          if (c === RBRACKET && this.state === ARRAY_START) return this.close(i);
          if (!isValueStart(c)) break;
          if (frame.target) {
            const next = this.scanElements(text, i, out);
            if (next > i) return next;
            this.state = ARRAY_NEXT;
            return this.begin(ELEMENT, text, i, out);
          }
          this.state = ARRAY_NEXT;
          if (frame.index++ === this.config.indices[this.frames.length - 1]) {
            frame.found = true;
            this.state = VALUE;
            return i;
          }
          return this.begin(SKIP, text, i, out);
        }
    }
    throw this.fail("Syntax", this.state === END ? "Unexpected content after the document" : `Unexpected character ${JSON.stringify(String.fromCharCode(c))}`, this.base + i);
  }
  close(i) {
    const frame = this.frames.pop();
    if (!frame.target && !frame.found) {
      throw this.fail("Pointer", `No value at ${this.pointerPrefix(this.frames.length + 1)}`, this.base + i);
    }
    const parent = this.frames[this.frames.length - 1];
    this.state = parent === undefined ? END : parent.object ? OBJECT_NEXT : ARRAY_NEXT;
    return i + 1;
  }
  // Starts capturing the value that begins at `i`.
  begin(mode, text, i, out) {
    const c = text.charCodeAt(i);
    this.capture = mode;
    this.start = this.base + i;
    this.inString = c === QUOTE;
    this.escape = false;
    this.depth = c === LBRACKET || c === LBRACE ? 1 : 0;
    this.scalar = !this.inString && this.depth === 0;
    if (this.depth > this.config.maxDepth) this.failDepth();
    return this.scan(text, i + 1, out);
  }
  // Continues the captured value from `i`, completing it if it ends in this
  // chunk. Returns the index after the value, or the chunk length.
  scan(text, i, out) {
    const end = this.scalar ? this.scanScalar(text, i) : this.scanNested(text, i);
    if (end === -1) return text.length;
    const source = this.buffer + text.slice(Math.max(this.start - this.base, 0), end);
    this.checkSize(source.length);
    const mode = this.capture;
    this.capture = NONE;
    this.buffer = "";
    let value;
    try {
      value = JSON.parse(source);
    } catch (cause) {
      throw this.fail("Syntax", "Invalid JSON value", this.start, cause);
    }
    if (mode === ELEMENT) out.push(value);else if (mode === KEY) this.key = value;
    return end;
  }
  // A scalar ends at the first delimiter, which `JSON.parse` then validates.
  scanScalar(text, i) {
    for (; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (isWhitespace(c) || c === COMMA || c === RBRACKET || c === RBRACE) return i;
    }
    return -1;
  }
  // Tracks only string, escape and nesting state; `JSON.parse` validates the
  // rest. Returns the index after the value, or -1.
  scanNested(text, i) {
    if (this.inString) {
      i = this.scanString(text, i, this.escape);
      if (i === -1) return -1;
      this.inString = false;
      if (this.depth === 0) return i;
    }
    let depth = this.depth;
    while (i < text.length) {
      const c = text.charCodeAt(i++);
      if (c === QUOTE) {
        i = this.scanString(text, i, false);
        if (i === -1) {
          this.inString = true;
          break;
        }
      } else if (c === LBRACKET || c === LBRACE) {
        if (++depth > this.config.maxDepth) this.failDepth();
      } else if ((c === RBRACKET || c === RBRACE) && --depth === 0) {
        this.depth = 0;
        return i;
      }
    }
    this.depth = depth;
    return -1;
  }
  // Scans string contents from `i`; returns the index after the closing quote,
  // or -1 if the string continues into the next chunk, recording `escape` for
  // `scanNested` to resume with.
  scanString(text, i, escape) {
    let plain = 0;
    while (i < text.length) {
      const c = text.charCodeAt(i++);
      if (escape) {
        escape = false;
      } else if (c === BACKSLASH) {
        escape = true;
      } else if (c === QUOTE) {
        return i;
      } else if (++plain === 16) {
        // A long string: jump to the next quote or backslash.
        if (this.quote < i) this.quote = indexOf(text, "\"", i);
        if (this.backslash < i) this.backslash = indexOf(text, "\\", i);
        i = Math.min(this.quote, this.backslash);
        plain = 0;
      }
    }
    this.escape = escape;
    return -1;
  }
  // Parses the elements from `i` up to the last comma or closing bracket at
  // the array's level with one `JSON.parse`. Wrapped in brackets, that text
  // parses only when every element and separator in it is valid. Returns `i`
  // to leave anything else, including errors, to the precise scan.
  scanElements(text, i, out) {
    if (this.base + i < this.slow) return i;
    const {
      maxDepth,
      maxElementSize
    } = this.config;
    let cut = -1;
    let start = i;
    let close = false;
    let depth = 0;
    let j = i;
    while (j < text.length) {
      const c = text.charCodeAt(j++);
      if (c === QUOTE) {
        j = this.scanString(text, j, false);
        if (j === -1) break;
      } else if (c === LBRACKET || c === LBRACE) {
        if (++depth > maxDepth) break;
      } else if (c === RBRACKET || c === RBRACE) {
        if (depth-- > 0) continue;
        // Including surrounding whitespace makes this a conservative size check.
        if (c === RBRACKET && j - 1 - start <= maxElementSize) {
          cut = j - 1;
          close = true;
        }
        break;
      } else if (c === COMMA && depth === 0) {
        if (j - 1 - start > maxElementSize) break;
        cut = j - 1;
        start = j;
      }
    }
    let values;
    if (cut !== -1) {
      try {
        values = JSON.parse("[" + text.slice(i, cut) + "]");
      } catch {
        this.slow = this.base + cut;
      }
    }
    // Rescanning may start before the cached matches, so discard them.
    this.quote = -1;
    this.backslash = -1;
    if (values === undefined) return i;
    for (let k = 0; k < values.length; k++) out.push(values[k]);
    if (close) return this.close(cut);
    this.state = ARRAY_VALUE;
    return cut + 1;
  }
  checkSize(size) {
    if (size > this.config.maxElementSize) {
      throw this.fail("Limit", `${this.subject()} exceeds maxElementSize of ${this.config.maxElementSize}`, this.start);
    }
  }
  failDepth() {
    throw this.fail("Limit", `${this.subject()} exceeds maxDepth of ${this.config.maxDepth}`, this.start);
  }
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
export const decodeString = options => {
  const config = makeConfig(options);
  return Channel.fromTransform((upstream, _scope) => Effect.sync(() => {
    const scanner = new Scanner(config);
    let done;
    const emit = run => {
      const out = [];
      try {
        run(out);
      } catch (error) {
        if (isJsonArrayError(error)) return Effect.fail(error);
        throw error;
      }
      return Arr.isArrayNonEmpty(out) ? Effect.succeed(out) : pull;
    };
    const pull = Effect.suspend(() => {
      if (done !== undefined) return done;
      return Pull.matchEffect(upstream, {
        onSuccess: texts => emit(out => {
          for (const text of texts) scanner.feed(text, out);
        }),
        onFailure: Effect.failCause,
        onDone: value => {
          done = Cause.done(value);
          return emit(() => scanner.end());
        }
      });
    });
    return pull;
  }));
};
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
export const decode = options => Channel.pipeTo(Channel.decodeText("utf-8", {
  ignoreBOM: true
}), decodeString(options));
/**
 * Creates a channel that parses the text of one JSON document and decodes the
 * elements of one of its arrays with a schema.
 *
 * @see decodeString
 * @stability unstable
 * @category decoding
 * @since 4.0.6
 */
export const decodeSchemaString = schema => options => Channel.pipeTo(decodeString(options), ChannelSchema.decodeUnknown(schema)());
/**
 * Creates a channel that parses UTF-8 bytes of one JSON document and decodes
 * the elements of one of its arrays with a schema.
 *
 * @see decodeSchemaString
 * @stability unstable
 * @category decoding
 * @since 4.0.6
 */
export const decodeSchema = schema => options => Channel.pipeTo(decode(options), ChannelSchema.decodeUnknown(schema)());
const stringify = value => {
  let output;
  try {
    output = JSON.stringify(value);
  } catch (cause) {
    throw new JsonArrayError({
      kind: "Encode",
      message: cause instanceof Error ? cause.message : String(cause),
      cause
    });
  }
  if (output === undefined) {
    throw new JsonArrayError({
      kind: "Encode",
      message: `Value of type ${typeof value} cannot be represented as JSON`
    });
  }
  return output;
};
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
export const encodeString = () => Channel.fromTransform((upstream, _scope) => Effect.sync(() => {
  let started = false;
  let done;
  const pull = Effect.suspend(() => {
    if (done !== undefined) return done;
    return Pull.matchEffect(upstream, {
      onSuccess: values => {
        let text;
        try {
          text = (started ? "," : "[") + values.map(stringify).join(",");
        } catch (error) {
          if (isJsonArrayError(error)) return Effect.fail(error);
          throw error;
        }
        started = true;
        return Effect.succeed(Arr.of(text));
      },
      onFailure: Effect.failCause,
      onDone: value => {
        done = Cause.done(value);
        return Effect.succeed(Arr.of(started ? "]" : "[]"));
      }
    });
  });
  return pull;
}));
/**
 * Creates a channel that writes a stream of values as UTF-8 bytes of one JSON
 * array.
 *
 * @see encodeString
 * @stability unstable
 * @category encoding
 * @since 4.0.6
 */
export const encode = () => Channel.map(encodeString(), Arr.map(text => encoder.encode(text)));
/**
 * Creates a channel that encodes values with a schema and writes them as the
 * text of one JSON array.
 *
 * @see encodeString
 * @stability unstable
 * @category encoding
 * @since 4.0.6
 */
export const encodeSchemaString = schema => () => Channel.pipeTo(ChannelSchema.encode(schema)(), encodeString());
/**
 * Creates a channel that encodes values with a schema and writes them as UTF-8
 * bytes of one JSON array.
 *
 * @see encodeSchemaString
 * @stability unstable
 * @category encoding
 * @since 4.0.6
 */
export const encodeSchema = schema => () => Channel.pipeTo(ChannelSchema.encode(schema)(), encode());
//# sourceMappingURL=JsonArray.js.map
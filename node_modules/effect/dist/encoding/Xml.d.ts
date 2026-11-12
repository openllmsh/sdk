/**
 * Decodes and encodes XML 1.0 documents as streams of events in Effect
 * channels.
 *
 * `decode` and `decodeString` turn UTF-8 bytes or text into events, and
 * `encode` and `encodeString` write events back as XML. `elements` collects
 * repeated elements, such as the items of a feed, into small trees, so that a
 * large document can be processed one record at a time.
 *
 * The decoder checks that documents are well-formed. It never reads external
 * resources and never expands entities declared in a DOCTYPE, so external
 * entity (XXE) and entity expansion attacks do not apply. It does not validate
 * documents against a DTD or schema, and reports names as written, without
 * resolving namespaces.
 *
 * @stability experimental
 * @since 4.0.6
 */
import * as Arr from "../Array.ts";
import * as Cause from "../Cause.ts";
import * as Channel from "../Channel.ts";
declare const XmlErrorTypeId = "~effect/encoding/Xml/XmlError";
declare const XmlError_base: new <A extends Record<string, any> = {}>(args: import("../Types.ts").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => Cause.YieldableError & {
    readonly _tag: "XmlError";
} & Readonly<A>;
/**
 * Error raised when XML cannot be decoded or encoded.
 *
 * **Details**
 *
 * The `kind` field identifies the failure:
 *
 * - `Syntax`: the input is not well-formed XML or not valid UTF-8.
 * - `Unsupported`: the input uses a feature this module does not process, such
 *   as an entity declared in a DOCTYPE or a byte encoding other than UTF-8.
 * - `Limit`: the input exceeds `maxTokenSize`, `maxDepth` or `maxElementSize`.
 * - `InvalidEvent`: the events do not form a well-formed document, such as an
 *   end tag that does not match its start tag.
 *
 * Errors from `decode` and `decodeString` carry the one-based `line` and
 * `column` where the problem was found, also appended to `message`. Columns
 * count UTF-16 code units, and lines end at LF, CR or CRLF.
 *
 * @stability experimental
 * @category errors
 * @since 4.0.6
 */
export declare class XmlError extends XmlError_base<{
    readonly kind: "Syntax" | "Unsupported" | "Limit" | "InvalidEvent";
    readonly message: string;
    readonly line?: number | undefined;
    readonly column?: number | undefined;
}> {
    /**
     * Marks this value as an XML error for runtime guards.
     *
     * @stability experimental
     * @since 4.0.6
     */
    readonly [XmlErrorTypeId] = "~effect/encoding/Xml/XmlError";
}
/**
 * Checks whether a value is an `XmlError`.
 *
 * @stability experimental
 * @category guards
 * @since 4.0.6
 */
export declare const isXmlError: (u: unknown) => u is XmlError;
/**
 * Event for the XML declaration at the start of a document, such as
 * `<?xml version="1.0" encoding="UTF-8"?>`.
 *
 * **Details**
 *
 * `encoding` and `standalone` are present only when the declaration sets them.
 *
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export interface Declaration {
    readonly _tag: "Declaration";
    readonly version: string;
    readonly encoding?: string | undefined;
    readonly standalone?: boolean | undefined;
}
/**
 * Event for a document type declaration, such as `<!DOCTYPE html>`.
 *
 * **Details**
 *
 * `publicId` and `systemId` are present only when the declaration names an
 * external DTD; the DTD is never read. Whitespace in `publicId` is collapsed
 * to single spaces and trimmed. The internal subset is not reported.
 *
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export interface Doctype {
    readonly _tag: "Doctype";
    readonly name: string;
    readonly publicId?: string | undefined;
    readonly systemId?: string | undefined;
}
/**
 * Event for a start tag, with its attributes in document order.
 *
 * **Details**
 *
 * `name` is the qualified name as written and is the only element-name field
 * the encoder reads.
 *
 * Attribute values have their references replaced and whitespace normalized as
 * XML requires. Decoded attributes inherit nothing, so only the attributes of
 * the tag are present and `__proto__` is an ordinary key. Their key order is
 * document order, as XML names are never integer-like. A `structuredClone` of
 * a decoded map gets `Object.prototype` back. A self-closing tag such as
 * `<br/>` is decoded as a `StartElement` followed by an `EndElement`.
 *
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export interface StartElement {
    readonly _tag: "StartElement";
    readonly name: string;
    readonly attributes: Readonly<Record<string, string>>;
}
/**
 * Event for an end tag.
 *
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export interface EndElement {
    readonly _tag: "EndElement";
    readonly name: string;
}
/**
 * Event for character data inside the root element.
 *
 * **Details**
 *
 * Adjacent text, references and CDATA sections are decoded into one `Text`
 * event that ends at the next tag, comment or processing instruction, however
 * the input is chunked. Line endings are normalized to `\n`.
 *
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export interface Text {
    readonly _tag: "Text";
    readonly text: string;
}
/**
 * Event for a comment, holding the text between `<!--` and `-->`.
 *
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export interface Comment {
    readonly _tag: "Comment";
    readonly text: string;
}
/**
 * Event for a processing instruction, such as
 * `<?xml-stylesheet href="style.xsl"?>`.
 *
 * **Details**
 *
 * `data` is the text after the target, without leading whitespace.
 *
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export interface ProcessingInstruction {
    readonly _tag: "ProcessingInstruction";
    readonly target: string;
    readonly data: string;
}
/**
 * Event produced by the decoders and consumed by the encoders.
 *
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export type Event = Declaration | Doctype | StartElement | EndElement | Text | Comment | ProcessingInstruction;
/**
 * Element collected by `elements`, with its attributes and children.
 *
 * **Details**
 *
 * Children are elements and strings of character data, in document order.
 * Adjacent text is merged into one string; comments and processing
 * instructions are dropped.
 *
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export interface Element {
    readonly name: string;
    readonly attributes: Readonly<Record<string, string>>;
    readonly children: ReadonlyArray<Element | string>;
}
/**
 * Options for the XML decoders.
 *
 * **Details**
 *
 * - `maxTokenSize`: the maximum length of a single token in UTF-16 code units,
 *   as written in the input: a tag with its attributes, a comment, a processing
 *   instruction, a DOCTYPE, or a text node including its references and CDATA
 *   sections. Defaults to 10 MiB; `Infinity` disables the limit.
 * - `maxDepth`: the maximum number of nested elements. Defaults to 1024;
 *   `Infinity` disables the limit.
 *
 * Memory per token and for open element names is bounded by `maxTokenSize`.
 * Invalid options throw when the channel is created.
 *
 * @stability experimental
 * @category configuration
 * @since 4.0.6
 */
export interface DecodeOptions {
    readonly maxTokenSize?: number | undefined;
    readonly maxDepth?: number | undefined;
}
/**
 * Options for `elements`.
 *
 * **Details**
 *
 * `maxElementSize` is the maximum size of one collected element, counted as
 * the UTF-16 code units of its names, attribute names and values, and text.
 * Defaults to 16 MiB; `Infinity` disables the limit. Invalid options throw when
 * the channel is created.
 *
 * @stability experimental
 * @category configuration
 * @since 4.0.6
 */
export interface ElementsOptions {
    readonly maxElementSize?: number | undefined;
}
/**
 * Creates a channel that decodes XML text chunks into events.
 *
 * **Details**
 *
 * - Tokens can be split anywhere between chunks. Each output chunk holds the
 *   events completed by one input chunk.
 * - The document must have one root element. Whitespace outside it is not
 *   reported.
 * - A leading byte order mark is skipped, and the encoding named by the XML
 *   declaration is ignored.
 * - Events completed before an error are emitted before the channel fails.
 *
 * **Gotchas**
 *
 * - End of input inside the root fails with a `Syntax` error ("unclosed
 *   element"); interruption ends the stream without this check.
 * - A DOCTYPE is reported as a `Doctype` event, and its internal subset is
 *   skipped without checking its declarations. They are not applied, so
 *   default attribute values are not added, and parameter entities are not
 *   expanded.
 * - References to entities other than `&lt;`, `&gt;`, `&amp;`, `&apos;` and
 *   `&quot;` fail with an `Unsupported` `XmlError` when the document has a
 *   DOCTYPE, and with a `Syntax` `XmlError` otherwise. Character references
 *   such as `&#233;` are always decoded.
 * - Names are reported as written, including namespace prefixes, and `xmlns`
 *   declarations are ordinary attributes.
 * - Tokens or aggregate open element names longer than `maxTokenSize`, and
 *   elements nested deeper than `maxDepth`, fail with a `Limit` `XmlError`. A
 *   long token can instead fail with an error found in its first
 *   `maxTokenSize + 1` characters.
 * - Strings in events can share memory with their input chunk, so keeping a
 *   short string, such as an id from each record, can keep the whole chunk in
 *   memory. Copy strings that are kept long, for example with
 *   `structuredClone`.
 *
 * **Example** (Decoding events)
 *
 * ```ts import.meta.vitest
 * import { Effect, Stream } from "effect"
 * import { Xml } from "effect/encoding"
 *
 * const events = Stream.make("<note id=\"1\">Hi &amp; bye<br/></note>").pipe(
 *   Stream.pipeThroughChannel(Xml.decodeString()),
 *   Stream.map((event) => event._tag),
 *   Stream.runCollect
 * )
 * await Effect.runPromise(events) // => ["StartElement", "Text", "StartElement", "EndElement", "EndElement"]
 * ```
 *
 * @see {@link decode} for UTF-8 byte input
 * @see {@link elements} for collecting repeated elements into trees
 * @see {@link encodeString} for the inverse operation
 *
 * @stability experimental
 * @category decoding
 * @since 4.0.6
 */
export declare const decodeString: <IE = never, Done = unknown>(options?: DecodeOptions) => Channel.Channel<Arr.NonEmptyReadonlyArray<Event>, XmlError | IE, Done, Arr.NonEmptyReadonlyArray<string>, IE, Done>;
/**
 * Creates a channel that decodes UTF-8 XML bytes into events.
 *
 * **Details**
 *
 * Works like `decodeString` after decoding the bytes as UTF-8. Multi-byte
 * characters can be split between chunks, and a leading byte order mark is
 * skipped.
 *
 * **Gotchas**
 *
 * - Invalid or truncated UTF-8 fails with a `Syntax` `XmlError`.
 * - An initial UTF-16 byte order mark or an XML declaration naming an encoding
 *   other than UTF-8 or US-ASCII fails with an `Unsupported` `XmlError`.
 *   Decode such bytes with a `TextDecoder` for that encoding and use `decodeString`.
 *
 * @see {@link decodeString} for text input and the shared gotchas
 *
 * @stability experimental
 * @category decoding
 * @since 4.0.6
 */
export declare const decode: <IE = never, Done = unknown>(options?: DecodeOptions) => Channel.Channel<Arr.NonEmptyReadonlyArray<Event>, XmlError | IE, Done, Arr.NonEmptyReadonlyArray<Uint8Array>, IE, Done>;
/**
 * Creates a channel that collects the elements at a path into trees.
 *
 * **When to use**
 *
 * Use to process large documents such as feeds, sitemaps or exports one record
 * at a time, without holding the whole document in memory.
 *
 * **Details**
 *
 * `path` lists element names from the root, and `"*"` matches any name. Each
 * element whose ancestors and own name match the path is emitted once its end
 * tag arrives, with all of its descendants; everything outside the matched
 * elements is skipped. Because paths start at the root, an element nested in a
 * matched element is part of its tree and is not emitted separately.
 *
 * **Gotchas**
 *
 * - A path that does not start at the root element matches nothing.
 * - Whitespace between child elements, such as indentation, is kept as string
 *   children.
 * - A collected element larger than `maxElementSize` fails with a `Limit`
 *   `XmlError`. The size counts characters, not memory: an element with many
 *   small children can take many times its size in memory, so use a lower
 *   limit for untrusted input.
 * - Events that end inside an element, or end an element that was never
 *   started, fail with an `InvalidEvent` `XmlError`.
 * - A path that is empty or contains an invalid name throws when the channel is
 *   created.
 *
 * **Example** (Reading feed items)
 *
 * ```ts import.meta.vitest
 * import { Effect, Stream } from "effect"
 * import { Xml } from "effect/encoding"
 *
 * const feed = `<rss><channel><title>News</title>
 * <item><title>First</title></item>
 * <item><title>Second</title></item>
 * </channel></rss>`
 *
 * const items = await Effect.runPromise(
 *   Stream.make(feed).pipe(
 *     Stream.pipeThroughChannel(Xml.decodeString()),
 *     Stream.pipeThroughChannel(Xml.elements(["rss", "channel", "item"])),
 *     Stream.runCollect
 *   )
 * )
 * items.length // => 2
 * items[1] // => { name: "item", attributes: {}, children: [{ name: "title", attributes: {}, children: ["Second"] }] }
 * ```
 *
 * @see {@link decode} for producing events from bytes
 *
 * @stability experimental
 * @category decoding
 * @since 4.0.6
 */
export declare const elements: <IE = never, Done = unknown>(path: ReadonlyArray<string>, options?: ElementsOptions) => Channel.Channel<Arr.NonEmptyReadonlyArray<Element>, XmlError | IE, Done, Arr.NonEmptyReadonlyArray<Event>, IE, Done>;
/**
 * Creates a channel that writes events as XML text.
 *
 * **Details**
 *
 * - Each input chunk is written as one string.
 * - Text escapes `&`, `<` and `>`. Attribute values are double-quoted and
 *   escape `&`, `<`, `"`, tabs and line breaks. Carriage returns are written
 *   as `&#13;` so that they survive decoding.
 * - Start tags are written completely on their event. Empty elements use
 *   explicit closing tags, such as `<br></br>`, never self-closing tags.
 * - Nothing is added between events, so whitespace comes only from `Text`
 *   events.
 *
 * **Gotchas**
 *
 * Events that do not form one well-formed document fail with an
 * `InvalidEvent` `XmlError`, such as an end tag that does not match the open
 * element, a second root element, non-whitespace text outside the root
 * element, invalid names or characters, `--` in a comment, `?>` in processing
 * instruction data, or a declaration that is not the first event. The stream
 * must end with the root element closed.
 *
 * **Example** (Writing a document)
 *
 * ```ts import.meta.vitest
 * import { Effect, Stream } from "effect"
 * import { Xml } from "effect/encoding"
 *
 * const events: ReadonlyArray<Xml.Event> = [
 *   { _tag: "StartElement", name: "a", attributes: { href: "x?a=1&b=2" } },
 *   { _tag: "Text", text: "1 < 2" },
 *   { _tag: "EndElement", name: "a" }
 * ]
 *
 * const xml = Stream.fromIterable(events).pipe(
 *   Stream.pipeThroughChannel(Xml.encodeString()),
 *   Stream.mkString
 * )
 * await Effect.runPromise(xml) // => '<a href="x?a=1&amp;b=2">1 &lt; 2</a>'
 * ```
 *
 * @see {@link encode} for UTF-8 byte output
 * @see {@link decodeString} for the inverse operation
 *
 * @stability experimental
 * @category encoding
 * @since 4.0.6
 */
export declare const encodeString: <IE = never, Done = unknown>() => Channel.Channel<Arr.NonEmptyReadonlyArray<string>, XmlError | IE, Done, Arr.NonEmptyReadonlyArray<Event>, IE, Done>;
/**
 * Creates a channel that writes events as UTF-8 XML bytes.
 *
 * **Details**
 *
 * Works like `encodeString`, with one byte array per input chunk.
 *
 * **Gotchas**
 *
 * A `Declaration` event naming an encoding other than UTF-8 fails
 * with an `InvalidEvent` `XmlError`.
 *
 * @see {@link encodeString} for text output and the shared gotchas
 *
 * @stability experimental
 * @category encoding
 * @since 4.0.6
 */
export declare const encode: <IE = never, Done = unknown>() => Channel.Channel<Arr.NonEmptyReadonlyArray<Uint8Array>, XmlError | IE, Done, Arr.NonEmptyReadonlyArray<Event>, IE, Done>;
export {};
//# sourceMappingURL=Xml.d.ts.map
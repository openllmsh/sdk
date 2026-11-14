/**
 * Encodes and decodes zip archives as streams in Effect channels.
 *
 * `encode` writes each entry as it arrives and adds the central directory once
 * the input ends; `decode` reads entries in archive order from their local
 * headers. `decode` never buffers an entire entry body, and `encode` only
 * collects deflated bodies with a `size` of at most 64 KiB.
 *
 * Entries are stored or compressed with deflate, the methods every zip tool
 * reads. Compression uses the runtime's `CompressionStream("deflate-raw")`;
 * decompression is implemented here, so that `decode` can find the end of
 * entries whose sizes follow their data. ZIP64 fields are written when sizes,
 * offsets or the entry count need them, and read from local headers and data
 * descriptors.
 * Encryption, other compression methods and archives split across files are
 * not supported.
 *
 * This module is experimental and may receive breaking changes in patch
 * releases.
 *
 * @stability experimental
 * @since 4.0.6
 */
import * as Arr from "../Array.ts";
import * as Cause from "../Cause.ts";
import * as Channel from "../Channel.ts";
import * as Stream from "../Stream.ts";
declare const ZipErrorTypeId = "~effect/encoding/Zip/ZipError";
declare const ZipError_base: new <A extends Record<string, any> = {}>(args: import("../Types.ts").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => Cause.YieldableError & {
    readonly _tag: "ZipError";
} & Readonly<A>;
/**
 * Error raised when a zip archive cannot be encoded or decoded.
 *
 * **Details**
 *
 * The `kind` field identifies the failure:
 *
 * - `InvalidHeader`: a header has an unknown signature or a malformed field, or
 *   an entry has a value that cannot be written.
 * - `InvalidData`: the compressed data of an entry is corrupt.
 * - `Truncated`: the input ended inside an entry or before the central
 *   directory.
 * - `Checksum`: the data of an entry does not match its CRC-32.
 * - `SizeMismatch`: an entry body produced a byte count other than its declared
 *   `size`, or the data of an entry does not match the sizes in the archive.
 * - `Unsupported`: the archive uses a feature this module does not read, such
 *   as encryption or a compression method other than store and deflate.
 * - `BodyConsumed`: an entry body was read after the decoder had moved past it.
 *
 * @stability experimental
 * @category errors
 * @since 4.0.6
 */
export declare class ZipError extends ZipError_base<{
    readonly kind: "InvalidHeader" | "InvalidData" | "Truncated" | "Checksum" | "SizeMismatch" | "Unsupported" | "BodyConsumed";
    readonly message: string;
}> {
    /**
     * Marks this value as a zip error for runtime guards.
     *
     * @stability experimental
     * @since 4.0.6
     */
    readonly [ZipErrorTypeId] = "~effect/encoding/Zip/ZipError";
}
/**
 * Checks whether a value is a `ZipError`.
 *
 * @stability experimental
 * @category guards
 * @since 4.0.6
 */
export declare const isZipError: (u: unknown) => u is ZipError;
/**
 * Kind of object described by a zip entry.
 *
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export type EntryType = "File" | "Directory";
/**
 * Compression method of a zip entry.
 *
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export type Method = "Store" | "Deflate";
/**
 * Metadata of a zip entry.
 *
 * **Details**
 *
 * `path` is the archive path, with `/` separators; directory paths end with
 * `/`. `size` is the uncompressed byte length when it is known before the body:
 * decoded entries whose sizes follow their data have no `size`. `mode` holds
 * Unix permission bits and is written to the central directory, which `decode`
 * does not read, so decoded headers have no `mode`. `mtime` has a resolution of
 * one second when the archive has an extended timestamp and two seconds
 * otherwise.
 *
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export interface Header {
    readonly path: string;
    readonly type: EntryType;
    readonly method: Method;
    readonly mtime: Date;
    readonly size?: number | undefined;
    readonly mode?: number | undefined;
}
/**
 * Zip entry: a header and a stream of the uncompressed body bytes.
 *
 * **Details**
 *
 * `decode` returns these, and `fileStream` builds them. `encode` writes the
 * sizes and CRC-32 of a streamed body in a data descriptor after the data.
 *
 * @see {@link ContentEntry} for entries whose content is held in memory
 *
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export interface Entry<E = never, R = never> {
    readonly header: Header;
    readonly body: Stream.Stream<Uint8Array, E, R>;
    readonly content?: undefined;
}
/**
 * Zip entry whose uncompressed content is held in memory.
 *
 * **Details**
 *
 * `file` and `directory` build these. Because the content is known before the
 * entry is written, `encode` puts its sizes and CRC-32 in the local header and
 * writes no data descriptor, which every zip reader accepts. `content` and
 * `body` exclude each other, so an entry whose body is replaced must drop
 * `content`.
 *
 * @see {@link Entry} for entries whose content is streamed
 *
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export interface ContentEntry {
    readonly header: Header;
    readonly content: Uint8Array;
    readonly body?: undefined;
}
/**
 * Options for the entry constructors.
 *
 * **Details**
 *
 * Unset fields default to an mtime of 1980-01-01T00:00:00Z, the earliest time
 * a zip header can hold, and mode `0o644` (`0o755` for directories). The
 * defaults make archives reproducible.
 *
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export interface EntryOptions {
    readonly mtime?: Date | undefined;
    readonly mode?: number | undefined;
}
/**
 * Options for file entries.
 *
 * **Details**
 *
 * `method` defaults to `"Deflate"`. Use `"Store"` for content that is already
 * compressed, such as images or archives.
 *
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export interface FileOptions extends EntryOptions {
    readonly method?: Method | undefined;
}
/**
 * Options for file entries whose content is streamed.
 *
 * **Details**
 *
 * `size` is the exact byte length of the body. It is required for `Store`,
 * because streaming readers can only find the end of stored data from its
 * size, and optional for `Deflate`, where it is checked against the body.
 *
 * @stability experimental
 * @category models
 * @since 4.0.6
 */
export type FileStreamOptions = EntryOptions & ({
    readonly method?: "Deflate" | undefined;
    readonly size?: number | undefined;
} | {
    readonly method: "Store";
    readonly size: number;
});
/**
 * Creates a file entry from in-memory content.
 *
 * **Details**
 *
 * String content is encoded as UTF-8, and `size` is the byte length of the
 * content. Because the content is known up front, its sizes and CRC-32 are
 * written in the local header, which every zip reader accepts.
 *
 * @see {@link fileStream} for content that is streamed instead of held in memory
 * @see {@link encode} for writing entries to an archive
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.6
 */
export declare const file: (path: string, content: string | Uint8Array, options?: FileOptions) => ContentEntry;
/**
 * Creates a file entry whose content is streamed from `body`.
 *
 * **When to use**
 *
 * Use when the content is too large to hold in memory, or is read from a file
 * or another stream.
 *
 * **Details**
 *
 * `body` is not run until the entry is encoded. Its sizes and CRC-32 are
 * written in a data descriptor after the data.
 *
 * **Gotchas**
 *
 * - A stored entry without `size` fails with an `InvalidHeader` `ZipError`.
 * - When `size` is set, `encode` fails with a `SizeMismatch` `ZipError` if the
 *   body produces fewer or more bytes.
 * - Non-empty stored entries are followed by a data descriptor, which some
 *   streaming readers mishandle. Java's `ZipInputStream` rejects them, and
 *   libarchive reading from a pipe (as `bsdtar` does) ends them at the first
 *   bytes that look like a descriptor, so content can cut the entry short and
 *   add entries. Use `Deflate` or an in-memory `file` for untrusted content
 *   and for those readers.
 *
 * @see {@link file} for in-memory content
 * @see {@link encode} for writing entries to an archive
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.6
 */
export declare const fileStream: <E = never, R = never>(path: string, body: Stream.Stream<Uint8Array, E, R>, options?: FileStreamOptions) => Entry<E, R>;
/**
 * Creates a directory entry.
 *
 * **Details**
 *
 * A trailing `/` is added to a non-empty `path` when missing, as zip tools
 * expect for directories.
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.6
 */
export declare const directory: (path: string, options?: EntryOptions) => ContentEntry;
/**
 * Creates a channel that decodes zip archive bytes into entries.
 *
 * **Details**
 *
 * Entries are read in archive order from their local headers, so archives can
 * be decoded as they arrive, for example from an HTTP response. Each output
 * chunk holds one entry, and each body streams the uncompressed bytes of the
 * entry. Pulling the next entry skips whatever is left of the current body.
 * Stored and deflated entries are read, including ZIP64 sizes and deflated
 * entries whose sizes follow their data in a data descriptor. Every body is
 * checked against its CRC-32 and sizes. Reading stops at the central directory.
 *
 * Paths use the UTF-8 flag when set, and otherwise the first Info-ZIP Unicode
 * path field when it matches the name, as Info-ZIP and 7-Zip do; other paths
 * are read as UTF-8 when valid and as CP437 otherwise. Times are read from the
 * extended timestamp field when present, and otherwise from the DOS time and
 * date, which have no time zone and are read as UTC.
 *
 * **Gotchas**
 *
 * - Read each body before pulling the next entry: a body read afterwards fails
 *   with a `BodyConsumed` `ZipError`. Operators that pull ahead, such as
 *   `Stream.buffer`, therefore can't sit between `decode` and the body reads.
 * - Read bodies while the entry stream runs, for example in `Stream.mapEffect`:
 *   once it has ended, as after `Stream.runCollect`, `Stream.runHead` or
 *   `Stream.take`, every body fails with a `BodyConsumed` `ZipError`.
 * - A body reads the entry's bytes once: running it again continues where the
 *   previous run stopped.
 * - The central directory is not read, so `mode`, comments and entries that
 *   only the central directory lists are not reported. Tools that read the
 *   central directory can see other entries and paths, for example in
 *   archives updated by appending.
 * - Archives that do not start with an entry or a central directory, such as
 *   self-extracting archives, fail with an `InvalidHeader` `ZipError`.
 * - Stored entries whose sizes only follow their data fail with an
 *   `Unsupported` `ZipError`. Python's `zipfile` writes them for stored
 *   entries on unseekable output, and Info-ZIP's `zip` for empty files when
 *   writing to a pipe. Searching for their end would let the content of an
 *   entry forge the entries after it.
 * - A body that grows past its `size` fails with a `SizeMismatch` `ZipError`
 *   before the extra bytes are emitted, so `size` can be checked before reading.
 * - Deflated data can expand about a thousand times, and pulling the next
 *   entry inflates the rest of the current body to find its end. To bound the
 *   work on untrusted archives, check `size`, count the bytes of bodies
 *   without one, and end the stream at an entry that is too large rather than
 *   skip it.
 * - Every `ZipError` ends the archive: later entry and body reads fail with
 *   the same error.
 * - The channel completes only when its input ends: input after the central
 *   directory is read and discarded, so that the upstream done value can be
 *   passed on.
 * - Paths are returned as written in the archive: they can be absolute,
 *   contain `..`, drive letters, control characters or backslashes, which some
 *   tools read as separators, and can repeat. Validate them before writing
 *   entries to disk; `encode` rejects absolute paths, drive letters and
 *   backslashes. Paths with a NUL character, which other tools take as the end
 *   of the name, fail with an `InvalidHeader` `ZipError`.
 *
 * @see {@link encode} for the inverse operation
 *
 * @stability experimental
 * @category decoding
 * @since 4.0.6
 */
export declare const decode: <IE = never, Done = unknown>() => Channel.Channel<Arr.NonEmptyReadonlyArray<Entry<ZipError | IE>>, ZipError | IE, Done, Arr.NonEmptyReadonlyArray<Uint8Array>, IE, Done>;
/**
 * Creates a channel that encodes entries into zip archive bytes.
 *
 * **Details**
 *
 * Each entry is written as soon as it arrives: a local header, the stored or
 * deflated body and, for entries with a streamed `body`, a data descriptor
 * with the CRC-32 and sizes. A `ContentEntry` has them in its local header.
 * The central directory is written once the input ends. Paths are written as
 * UTF-8, with the UTF-8 flag set when they are not ASCII. `mtime`
 * is written both as a DOS time in UTC, which keeps two-second resolution and
 * covers 1980 to 2107, and as an extended timestamp in whole seconds when it
 * falls between 1970 and 2038. ZIP64 fields are added when a size, an offset
 * or the entry count does not fit the classic fields, and to the local header
 * of a deflated entry streamed without a `size` or with one near 4 GiB, so
 * that readers know the width of the sizes after its data.
 *
 * Headers and body chunks below 16 KiB are gathered into output chunks of
 * about 64 KiB, and larger body chunks pass through without copying. Output is
 * handed out before waiting for more entries, but up to 64 KiB of it can be
 * held while a body is pulled. Each body chunk of a streamed `Deflate` entry is
 * a separate compressor job, so larger chunks compress faster. A `Deflate`
 * body with a `size` of at most 64 KiB is instead collected and compressed in
 * one job, and still gets a data descriptor; omit `size` to stream it.
 *
 * **Gotchas**
 *
 * - Deflated entries need `CompressionStream("deflate-raw")`. On a runtime
 *   without it, encoding a deflated entry dies with the runtime's error, as
 *   it does when the compressor fails: check for the API or use `Store`.
 * - Deflated bytes come from the runtime's `CompressionStream`, so they can
 *   differ between runtimes. Archives of stored entries are byte-identical
 *   everywhere.
 * - A body that produces a byte count other than a set `header.size`, or any
 *   bytes for a directory, fails with a `SizeMismatch` `ZipError`.
 * - Directories are always stored, whatever their `method`.
 * - Empty paths, paths starting with `/` or a drive letter such as `C:`, paths
 *   containing `\` or NUL, `File` paths ending with `/`, `Directory` paths not
 *   ending with `/`, and invalid modes, sizes or times fail with an
 *   `InvalidHeader` `ZipError`. Other paths are written as given, including
 *   `..` segments, so validate untrusted paths before encoding them.
 *
 * **Example** (Writing and reading an archive)
 *
 * ```ts import.meta.vitest
 * import { Effect, Stream } from "effect"
 * import { Zip } from "effect/encoding"
 *
 * const archive = Stream.make(
 *   Zip.directory("docs"),
 *   Zip.file("docs/readme.txt", "Hello, zip!")
 * ).pipe(Stream.pipeThroughChannel(Zip.encode()))
 *
 * const listing = archive.pipe(
 *   Stream.pipeThroughChannel(Zip.decode()),
 *   Stream.mapEffect((entry) =>
 *     Stream.mkString(Stream.decodeText(entry.body)).pipe(
 *       Effect.map((text) => `${entry.header.path} ${JSON.stringify(text)}`)
 *     )
 *   ),
 *   Stream.runCollect
 * )
 * await Effect.runPromise(listing) // => ['docs/ ""', 'docs/readme.txt "Hello, zip!"']
 * ```
 *
 * @see {@link decode} for the inverse operation
 * @see {@link file} for building entries from in-memory content
 * @see {@link fileStream} for building entries from streamed content
 *
 * @stability experimental
 * @category encoding
 * @since 4.0.6
 */
export declare const encode: <IE = never, Done = unknown, In extends Entry<any, any> | ContentEntry = Entry | ContentEntry>() => Channel.Channel<Arr.NonEmptyReadonlyArray<Uint8Array>, ZipError | IE | (In extends Entry<infer E, any> ? E : never), Done, Arr.NonEmptyReadonlyArray<In>, IE, Done, In extends Entry<any, infer R> ? R : never>;
export {};
//# sourceMappingURL=Zip.d.ts.map
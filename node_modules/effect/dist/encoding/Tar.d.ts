/**
 * Encodes and decodes tar archives as streams in Effect channels.
 *
 * `decode` streams entry bodies from the archive input; `encode` streams them
 * back into archive bytes. Neither buffers an entire entry body.
 *
 * The decoder reads the formats produced by common tools: v7, USTAR, PAX
 * extended headers, and GNU long names and base-256 numbers. The encoder writes
 * USTAR, adding PAX extended headers for fields that do not fit or for custom
 * metadata. It does not access the file system or compress archives.
 *
 * @stability unstable
 * @since 4.0.5
 */
import * as Arr from "../Array.ts";
import * as Cause from "../Cause.ts";
import * as Channel from "../Channel.ts";
import * as Stream from "../Stream.ts";
import type * as Types from "../Types.ts";
declare const TarErrorTypeId = "~effect/encoding/Tar/TarError";
declare const TarError_base: new <A extends Record<string, any> = {}>(args: Types.VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => Cause.YieldableError & {
    readonly _tag: "TarError";
} & Readonly<A>;
/**
 * Error raised when a tar archive cannot be encoded or decoded.
 *
 * **Details**
 *
 * The `kind` field identifies the failure:
 *
 * - `InvalidHeader`: a header has a bad checksum, a malformed field, or a value
 *   that cannot be written.
 * - `Truncated`: the input ended inside a header or an entry body.
 * - `SizeMismatch`: an entry body produced a byte count other than its declared
 *   `size`.
 * - `Unsupported`: the archive uses a feature this module does not read, such
 *   as GNU sparse files.
 * - `BodyConsumed`: an entry body was read after the decoder had moved past it.
 *
 * @stability unstable
 * @category errors
 * @since 4.0.5
 */
export declare class TarError extends TarError_base<{
    readonly kind: "InvalidHeader" | "Truncated" | "SizeMismatch" | "Unsupported" | "BodyConsumed";
    readonly message: string;
}> {
    /**
     * Marks this value as a tar error for runtime guards.
     *
     * @stability unstable
     * @since 4.0.5
     */
    readonly [TarErrorTypeId] = "~effect/encoding/Tar/TarError";
}
/**
 * Checks whether a value is a `TarError`.
 *
 * @stability unstable
 * @category guards
 * @since 4.0.5
 */
export declare const isTarError: (u: unknown) => u is TarError;
/**
 * Kind of filesystem object described by a tar entry.
 *
 * **Details**
 *
 * `Other` covers every typeflag without a dedicated kind, such as GNU volume
 * labels; the raw flag is kept in `Header.typeflag`.
 *
 * @stability unstable
 * @category models
 * @since 4.0.5
 */
export type EntryType = "File" | "Directory" | "Symlink" | "Hardlink" | "CharDevice" | "BlockDevice" | "Fifo" | "Other";
/**
 * Metadata of a tar entry.
 *
 * **Details**
 *
 * `path` and `linkTarget` are archive paths; hard link targets name another
 * entry of the same archive. `mode` holds the permission bits, including
 * setuid, setgid and sticky; file type bits, as in a `stat` mode, are dropped
 * when decoding and encoding. `pax` holds the PAX extended header records,
 * including those of global headers, that are not reflected in the other
 * fields, such as `SCHILY.xattr.*`, `atime` or the `comment` of `git archive`.
 * `devMajor` and `devMinor` are set for device entries only.
 *
 * @stability unstable
 * @category models
 * @since 4.0.5
 */
export interface Header {
    readonly path: string;
    readonly type: EntryType;
    readonly typeflag: string;
    readonly size: number;
    readonly mode: number;
    readonly uid: number;
    readonly gid: number;
    readonly uname: string;
    readonly gname: string;
    readonly mtime: Date;
    readonly linkTarget?: string | undefined;
    readonly devMajor?: number | undefined;
    readonly devMinor?: number | undefined;
    readonly pax: Readonly<Record<string, string>>;
}
/**
 * Tar entry: a header and a stream of exactly `header.size` body bytes.
 *
 * @stability unstable
 * @category models
 * @since 4.0.5
 */
export interface Entry<E = never, R = never> {
    readonly header: Header;
    readonly body: Stream.Stream<Uint8Array, E, R>;
}
/**
 * Options for the entry constructors.
 *
 * **Details**
 *
 * Unset fields default to mode `0o644` (`0o755` for directories, `0o777` for
 * symlinks), uid and gid `0`, empty user and group names, an mtime at the Unix
 * epoch, and no extra PAX records. The defaults make archives reproducible.
 *
 * @stability unstable
 * @category models
 * @since 4.0.5
 */
export interface EntryOptions {
    readonly mode?: number | undefined;
    readonly uid?: number | undefined;
    readonly gid?: number | undefined;
    readonly uname?: string | undefined;
    readonly gname?: string | undefined;
    readonly mtime?: Date | undefined;
    readonly pax?: Readonly<Record<string, string>> | undefined;
}
/**
 * Creates a regular file entry from in-memory content.
 *
 * **Details**
 *
 * String content is encoded as UTF-8, and `size` is the byte length of the
 * content.
 *
 * @see {@link fileStream} for content that is streamed instead of held in memory
 * @see {@link encode} for writing entries to an archive
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.5
 */
export declare const file: (path: string, content: string | Uint8Array, options?: EntryOptions) => Entry;
/**
 * Creates a regular file entry whose content is streamed from `body`.
 *
 * **When to use**
 *
 * Use when the content is too large to hold in memory, or is read from a file
 * or another stream, and its byte length is known up front.
 *
 * **Details**
 *
 * The defaults match `file`: mode `0o644`, uid and gid `0`, and an mtime at the
 * Unix epoch. `body` is not run until the entry is encoded.
 *
 * **Gotchas**
 *
 * `size` must be the exact byte length of `body`: `encode` fails with a
 * `SizeMismatch` `TarError` when the body produces fewer or more bytes.
 *
 * @see {@link file} for in-memory content
 * @see {@link encode} for writing entries to an archive
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.5
 */
export declare const fileStream: <E = never, R = never>(path: string, size: number, body: Stream.Stream<Uint8Array, E, R>, options?: EntryOptions) => Entry<E, R>;
/**
 * Creates a directory entry.
 *
 * **Details**
 *
 * A trailing `/` is added to a non-empty `path` when missing, as tar tools
 * expect for directories.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.5
 */
export declare const directory: (path: string, options?: EntryOptions) => Entry;
/**
 * Creates a symbolic link entry pointing at `target`.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.5
 */
export declare const symlink: (path: string, target: string, options?: EntryOptions) => Entry;
/**
 * Creates a hard link entry pointing at another entry of the archive.
 *
 * **Details**
 *
 * `target` is the archive path of an entry written earlier in the same
 * archive.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.5
 */
export declare const hardlink: (path: string, target: string, options?: EntryOptions) => Entry;
/**
 * Creates a channel that decodes tar archive bytes into entries.
 *
 * **Details**
 *
 * Each output chunk holds one entry, and each entry body streams exactly
 * `header.size` bytes straight from the input. Pulling the next entry skips
 * whatever is left of the current body, like Go's `tar.Reader`. The decoder
 * reads v7, USTAR, PAX extended headers (applying `path`, `linkpath`, `size`,
 * `uid`, `gid`, `uname`, `gname` and `mtime`), GNU long names and links, and
 * base-256 numbers. The records of a PAX global header apply to every entry
 * that follows, except `path`, `linkpath` and `size`, which describe a single
 * entry. Anything after the end-of-archive marker is ignored.
 *
 * **Gotchas**
 *
 * - Read each body before pulling the next entry: a body read afterwards fails
 *   with a `BodyConsumed` `TarError`. Operators that pull ahead, such as
 *   `Stream.buffer`, therefore can't sit between `decode` and the body reads.
 * - Read bodies while the entry stream runs, for example in `Stream.mapEffect`:
 *   once it has ended, as after `Stream.runCollect`, `Stream.runHead` or
 *   `Stream.take`, every body fails with a `BodyConsumed` `TarError`.
 * - A body reads the entry's bytes once: running it again continues where the
 *   previous run stopped.
 * - Directories, links, devices and FIFOs have no body, and their `size` is
 *   reported as `0`.
 * - Paths and link targets are returned as written in the archive, so they can
 *   be absolute or contain `..`, and a symlink entry can redirect a later entry
 *   outside the target directory. Validate both before writing entries to disk.
 * - Names that are not valid UTF-8 are decoded with replacement characters.
 * - PAX extended headers and GNU long names of more than 1 MiB fail with an
 *   `InvalidHeader` `TarError`.
 * - The channel completes only when its input ends: input after the
 *   end-of-archive marker is read and discarded, so that the upstream done
 *   value can be passed on.
 * - GNU sparse entries fail with an `Unsupported` `TarError`.
 *
 * @see {@link encode} for the inverse operation
 *
 * @stability unstable
 * @category decoding
 * @since 4.0.5
 */
export declare const decode: <IE = never, Done = unknown>() => Channel.Channel<Arr.NonEmptyReadonlyArray<Entry<TarError | IE>>, TarError | IE, Done, Arr.NonEmptyReadonlyArray<Uint8Array>, IE, Done>;
/**
 * Creates a channel that encodes entries into tar archive bytes.
 *
 * **Details**
 *
 * Each entry is written as a USTAR header, with the path split into the USTAR
 * prefix and name fields when it is longer than 100 bytes. A PAX extended
 * header is added only for what USTAR cannot hold: a long or non-ASCII path,
 * link target, user or group name, a size of 8 GiB or more, a uid or gid above
 * `2097151`, an mtime outside the USTAR range, or custom `pax` records. The
 * archive ends with two zero blocks.
 *
 * Headers, padding and body chunks below 16 KiB are gathered into output chunks
 * of up to 64 KiB, and larger body chunks pass through without copying, so
 * bodies stream without being held in memory. Output is handed out before
 * waiting for more entries, but up to 64 KiB of it can be held while a body is
 * pulled.
 *
 * **Gotchas**
 *
 * - A body that produces any byte count other than `header.size` fails with a
 *   `SizeMismatch` `TarError`, so the size must be known before the body is
 *   written.
 * - `header.pax` may contain custom metadata such as `SCHILY.xattr.*`. Keys
 *   `path`, `linkpath`, `size`, `uid`, `gid`, `uname`, `gname` and `mtime` must
 *   be set through the corresponding header fields. These keys and
 *   `GNU.sparse.*` records fail with an `InvalidHeader` `TarError`.
 * - A `File` entry whose path ends with `/` fails with an `InvalidHeader`
 *   `TarError`, because other tools read it as a directory.
 * - Entries other than `File` and `Other` must have `size` 0, and `devMajor`
 *   and `devMinor` must not exceed `2097151`; otherwise encoding fails with an
 *   `InvalidHeader` `TarError`.
 * - mtime is rounded down to whole seconds.
 * - `typeflag` is only written for `Other` entries; every other type writes its
 *   standard flag.
 *
 * @see {@link decode} for the inverse operation
 * @see {@link file} for building entries from in-memory content
 * @see {@link fileStream} for building entries from streamed content
 *
 * @stability unstable
 * @category encoding
 * @since 4.0.5
 */
export declare const encode: <IE = never, Done = unknown, In extends Entry<any, any> = Entry>() => Channel.Channel<Arr.NonEmptyReadonlyArray<Uint8Array>, TarError | IE | (In extends Entry<infer E, any> ? E : never), Done, Arr.NonEmptyReadonlyArray<In>, IE, Done, In extends Entry<any, infer R> ? R : never>;
export {};
//# sourceMappingURL=Tar.d.ts.map
/**
 * Pull-based UDP sockets with scoped native handles.
 *
 * Acquiring a reader opens and binds a socket owned by its scope. Only one
 * reader is open at a time; another acquisition waits interruptibly for it to
 * close. Use `Effect.retry` around a scoped consume loop to open a new socket
 * on each retry.
 *
 * Writes wait while no reader is open, so a send-only client must still
 * acquire a reader.
 *
 * **Example** (Portable request/reply client)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { NetAddress } from "effect/net"
 * import { DatagramSocket } from "effect/socket"
 *
 * const server = NetAddress.inetAddressFromIpStringUnsafe("127.0.0.1", 5353)
 *
 * export const request = (payload: string) =>
 *   Effect.gen(function*() {
 *     const socket = yield* DatagramSocket.DatagramSocket
 *     const reader = yield* socket.reader
 *     const writer = yield* socket.writer
 *     yield* writer.write({ payload, address: server })
 *     const [response] = yield* reader.pull
 *     return response.payload
 *   }).pipe(Effect.scoped)
 * ```
 *
 * @stability experimental
 * @since 4.0.0
 */
import type { NonEmptyReadonlyArray } from "../Array.ts";
import * as Context from "../Context.ts";
import * as Effect from "../Effect.ts";
import * as NetAddress from "../net/NetAddress.ts";
import * as Schema from "../Schema.ts";
import * as Scope from "../Scope.ts";
/**
 * Runtime type identifier attached to `DatagramSocket` services.
 *
 * @stability experimental
 * @category type IDs
 * @since 4.0.0
 */
export declare const TypeId = "~effect/socket/DatagramSocket";
/**
 * Service tag for UDP socket transports.
 *
 * @stability experimental
 * @category services
 * @since 4.0.0
 */
export declare const DatagramSocket: Context.Service<DatagramSocket, DatagramSocket>;
/**
 * A UDP socket with a scoped, exclusive reader. Acquiring `reader` opens and
 * binds a native socket; subsequent acquisitions wait for its scope to close.
 * Acquiring `writer` cannot fail, but writes wait for an open reader.
 *
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export interface DatagramSocket {
    readonly [TypeId]: typeof TypeId;
    readonly reader: Effect.Effect<Reader, DatagramSocketError, Scope.Scope>;
    readonly writer: Effect.Effect<Writer, never, Scope.Scope>;
}
/**
 * A received packet.
 *
 * **Details**
 *
 * The payload is safe to retain. The sender's `address` is parsed on first
 * read and cached.
 *
 * Reply with `writer.write({ payload, address: received })` to reuse the raw
 * sender address without parsing. This requires a datagram from a platform
 * adapter or `makeFromBackingSocket`. For hand-built datagrams or custom
 * readers, use `{ payload, address: received.address }`.
 *
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export interface Datagram {
    readonly payload: Uint8Array;
    readonly address: NetAddress.InetAddress;
}
/**
 * A packet to send.
 *
 * **Details**
 *
 * String payloads are encoded as UTF-8. `address` can be omitted when the
 * socket has a `peer` or is connected. On a connected socket an explicit
 * `InetAddress` fails the write, while a received `Datagram` is allowed and
 * goes out on the connected path.
 *
 * Pass a received `Datagram` as the destination to reply, or as the whole
 * argument to echo it. Both reuse the raw sender address and require a
 * datagram from a platform adapter or `makeFromBackingSocket`. Hand-built
 * datagrams and custom readers must pass an explicit `InetAddress` instead.
 *
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export interface OutgoingDatagram {
    readonly payload: Uint8Array | string;
    readonly address?: NetAddress.InetAddress | Datagram | undefined;
}
/**
 * The receive side of an open native socket.
 *
 * **Details**
 *
 * `pull` returns everything queued since the last pull, or waits for the next
 * packet. After a terminal error, `pull` first returns the queued packets and
 * then fails with the same error until the reader's scope closes. Closing the
 * scope discards the queue and fails every waiting `pull` with
 * `DatagramSocketClosedError`.
 *
 * Concurrent pulls wait in FIFO order. Each incoming packet goes to the
 * oldest waiter; a terminal error fails all waiters.
 *
 * `address` is the bound local address, parsed on first read and cached.
 *
 * `dropped` counts receive-buffer overflow since this reader opened, not
 * kernel or network loss or packets discarded on scope close.
 *
 * `joinMulticast` joins a group until its scope closes; leave failures are
 * ignored. Its `interface` selects where packets arrive (ingress), not the
 * platform's `multicast.interface` for sending (egress).
 *
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export interface Reader {
    readonly pull: Effect.Effect<NonEmptyReadonlyArray<Datagram>, DatagramSocketError>;
    readonly address: NetAddress.InetAddress;
    readonly dropped: () => number;
    readonly joinMulticast: <A extends NetAddress.IpAddress>(options: {
        readonly group: NetAddress.MulticastAddress<A>;
        readonly interface?: NetAddress.MulticastInterface<A> | undefined;
        readonly source?: A | undefined;
    }) => Effect.Effect<void, DatagramSocketError, Scope.Scope>;
}
/**
 * The send side of a `DatagramSocket`. Writes wait until a reader is open, so
 * a send-only client must still acquire a reader.
 *
 * **Details**
 *
 * A write completes when the runtime reports the send's result, and send
 * errors fail it with a `DatagramSocketWriteError` carrying the destination
 * `address`. After a terminal reader error, writes fail with that error until
 * the reader's scope closes, and then wait for the next reader.
 *
 * `writeAll` fails with the first error, without resending. Partial delivery is
 * unspecified. The error has no packet index, and its `address` is absent on Bun.
 *
 * There is no built-in write timeout; use `Effect.timeout`.
 *
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export interface Writer {
    readonly write: (datagram: OutgoingDatagram) => Effect.Effect<void, DatagramSocketError>;
    readonly writeAll: (datagrams: NonEmptyReadonlyArray<OutgoingDatagram>) => Effect.Effect<void, DatagramSocketError>;
}
/**
 * Receive queue options.
 *
 * **Details**
 *
 * The queue is bounded in packets, with no byte cap. `capacity` defaults to
 * 1024 and must be a positive safe integer. The worst-case
 * memory is capacity × 64 KiB, about 64 MiB at the default.
 *
 * When the queue is full, `"dropping"` (the default) discards the incoming
 * packet and `"sliding"` discards the oldest queued one. Both count the
 * packet in `Reader.dropped`.
 *
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export interface ReceiveBufferOptions {
    readonly capacity?: number | undefined;
    readonly strategy?: "dropping" | "sliding" | undefined;
}
/**
 * Creates a `DatagramSocket` from its `reader` and `writer` effects.
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.0
 */
export declare const make: (options: {
    readonly reader: DatagramSocket["reader"];
    readonly writer: DatagramSocket["writer"];
}) => DatagramSocket;
/**
 * A native host and port, parsed on demand.
 *
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export interface BackingAddress {
    readonly host: string;
    readonly port: number;
}
/**
 * Native transport contract used by platform adapters.
 *
 * **Details**
 *
 * `address` is the raw bound address, read once at open. `scopeIds` maps IPv6
 * zone names to scope IDs, for parsing named zones and formatting
 * destinations. `peer` is the default destination, and `connected` marks a
 * natively connected socket, whose sends receive no destination.
 *
 * `send` and `sendMany` hand datagrams to the runtime and call `done` exactly
 * once, synchronously or later, when the runtime reports the result. They must
 * not throw. `sendMany` passes the index of the failing datagram to `done`
 * when the runtime knows it, so core can attach its address.
 *
 * Adapters normalize native errors before passing them to core.
 * Read destination `host` and `port` during the call; do not retain the record.
 *
 * `close` must not throw.
 *
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export interface BackingSocket {
    readonly address: BackingAddress;
    readonly scopeIds?: ReadonlyMap<string, number> | undefined;
    readonly peer?: BackingAddress | undefined;
    readonly connected?: boolean | undefined;
    readonly send: (payload: Uint8Array, destination: BackingAddress | undefined, done: (error?: DatagramSocketError) => void) => void;
    readonly sendMany: (payloads: ReadonlyArray<Uint8Array>, destinations: ReadonlyArray<BackingAddress | undefined>, done: (error?: DatagramSocketError, index?: number) => void) => void;
    readonly joinMulticast: <A extends NetAddress.IpAddress>(options: {
        readonly group: NetAddress.MulticastAddress<A>;
        readonly interface?: NetAddress.MulticastInterface<A> | undefined;
        readonly source?: A | undefined;
    }) => Effect.Effect<() => Effect.Effect<void, never>, DatagramSocketError>;
    readonly close: () => void;
}
/**
 * Callbacks installed before opening the backing socket; packets may arrive
 * synchronously.
 *
 * **Details**
 *
 * `onPacket` queues a received packet. `onReadError` is a terminal receive
 * error and `onClose` reports the native socket closing underneath the
 * reader; both are sticky. `onError` forwards errors with no write left to
 * fail, such as ICMP reports, to the user's `onError` option.
 *
 * Each callback can be passed on its own, for example as a runtime's event
 * listener.
 *
 * @stability experimental
 * @category models
 * @since 4.0.0
 */
export interface BackingEvents {
    readonly onPacket: (payload: Uint8Array, host: string, port: number) => void;
    readonly onReadError: (error: DatagramSocketError) => void;
    readonly onError: (error: DatagramSocketError) => void;
    readonly onClose: () => void;
}
/**
 * The normalized kind of a send or receive failure.
 *
 * @stability experimental
 * @category errors
 * @since 4.0.0
 */
export type IoErrorKind = "MessageTooLarge" | "Unreachable" | "ConnectionRefused" | "PermissionDenied" | "Unknown";
declare const DatagramSocketOpenError_base: Schema.Class<DatagramSocketOpenError, Schema.Struct<{
    readonly _tag: Schema.tag<"DatagramSocketOpenError">;
    readonly kind: Schema.Literals<readonly ["AddressInUse", "AddressNotAvailable", "PermissionDenied", "Unknown"]>;
    readonly cause: Schema.Defect;
}>, import("../Cause.ts").YieldableError>;
/**
 * Opening or binding the native socket, applying its options, or resolving
 * a name failed.
 *
 * @stability experimental
 * @category errors
 * @since 4.0.0
 */
export declare class DatagramSocketOpenError extends DatagramSocketOpenError_base {
}
declare const DatagramSocketReadError_base: Schema.Class<DatagramSocketReadError, Schema.Struct<{
    readonly _tag: Schema.tag<"DatagramSocketReadError">;
    readonly kind: Schema.Literals<readonly ["MessageTooLarge", "Unreachable", "ConnectionRefused", "PermissionDenied", "Unknown"]>;
    readonly cause: Schema.Defect;
}>, import("../Cause.ts").YieldableError>;
/**
 * A receive failed, or an ICMP report arrived with no write left to fail.
 *
 * @stability experimental
 * @category errors
 * @since 4.0.0
 */
export declare class DatagramSocketReadError extends DatagramSocketReadError_base {
}
declare const DatagramSocketWriteError_base: Schema.Class<DatagramSocketWriteError, Schema.Struct<{
    readonly _tag: Schema.tag<"DatagramSocketWriteError">;
    readonly kind: Schema.Literals<readonly ["MessageTooLarge", "Unreachable", "ConnectionRefused", "PermissionDenied", "Unknown"]>;
    readonly address: Schema.optional<Schema.InetAddress>;
    readonly cause: Schema.Defect;
}>, import("../Cause.ts").YieldableError>;
/**
 * A send failed. `address` is the destination when it is known.
 *
 * @stability experimental
 * @category errors
 * @since 4.0.0
 */
export declare class DatagramSocketWriteError extends DatagramSocketWriteError_base {
}
declare const DatagramSocketClosedError_base: Schema.Class<DatagramSocketClosedError, Schema.Struct<{
    readonly _tag: Schema.tag<"DatagramSocketClosedError">;
}>, import("../Cause.ts").YieldableError>;
/**
 * The native socket closed underneath the reader, or the reader's scope
 * closed.
 *
 * @stability experimental
 * @category errors
 * @since 4.0.0
 */
export declare class DatagramSocketClosedError extends DatagramSocketClosedError_base {
}
declare const DatagramSocketUnsupportedError_base: Schema.Class<DatagramSocketUnsupportedError, Schema.Struct<{
    readonly _tag: Schema.tag<"DatagramSocketUnsupportedError">;
    readonly capability: Schema.String;
    readonly runtime: Schema.String;
}>, import("../Cause.ts").YieldableError>;
/**
 * The runtime lacks a capability, such as source-specific multicast on Deno.
 *
 * @stability experimental
 * @category errors
 * @since 4.0.0
 */
export declare class DatagramSocketUnsupportedError extends DatagramSocketUnsupportedError_base {
    /**
     * Names the runtime and the capability it lacks.
     *
     * @stability experimental
     * @since 4.0.0
     */
    get message(): string;
}
/**
 * Schema for the union of `DatagramSocketError` reasons.
 *
 * @stability experimental
 * @category errors
 * @since 4.0.0
 */
export declare const DatagramSocketErrorReason: Schema.Union<readonly [typeof DatagramSocketOpenError, typeof DatagramSocketReadError, typeof DatagramSocketWriteError, typeof DatagramSocketClosedError, typeof DatagramSocketUnsupportedError]>;
/**
 * The union of `DatagramSocketError` reasons.
 *
 * @stability experimental
 * @category errors
 * @since 4.0.0
 */
export type DatagramSocketErrorReason = typeof DatagramSocketErrorReason.Type;
/**
 * Runtime type identifier attached to `DatagramSocketError` values.
 *
 * @stability experimental
 * @category errors
 * @since 4.0.0
 */
export declare const DatagramSocketErrorTypeId = "~effect/socket/DatagramSocket/DatagramSocketError";
/**
 * Returns `true` when a value is a `DatagramSocketError`.
 *
 * @stability experimental
 * @category guards
 * @since 4.0.0
 */
export declare const isDatagramSocketError: (u: unknown) => u is DatagramSocketError;
declare const DatagramSocketError_base: Schema.Class<DatagramSocketError, Schema.TaggedStruct<"DatagramSocketError", {
    readonly _tag: Schema.tag<"DatagramSocketError">;
    readonly reason: Schema.Union<readonly [typeof DatagramSocketOpenError, typeof DatagramSocketReadError, typeof DatagramSocketWriteError, typeof DatagramSocketClosedError, typeof DatagramSocketUnsupportedError]>;
}>, import("../Cause.ts").YieldableError>;
/**
 * The error raised by `DatagramSocket` operations, wrapping a specific
 * reason. Its `cause` and `message` come from the reason.
 *
 * @stability experimental
 * @category errors
 * @since 4.0.0
 */
export declare class DatagramSocketError extends DatagramSocketError_base {
    constructor(props: {
        readonly reason: DatagramSocketErrorReason;
    });
    readonly [DatagramSocketErrorTypeId] = "~effect/socket/DatagramSocket/DatagramSocketError";
    get message(): string;
}
/**
 * Builds a `DatagramSocket` over a backing socket, opening a new socket for
 * each reader acquisition.
 *
 * **Details**
 *
 * `open` receives the event callbacks before the handle exists, so packets can
 * be queued while it opens. Core owns the receive queue and its overflow
 * strategy, reader exclusivity, sticky errors, lazy address parsing, the
 * writer latch and destination formatting. The handle is closed when the
 * reader's scope closes. If acquisition is interrupted while `open` is still
 * running, the interruption returns at once, `open` is left to finish, and
 * the handle it produces is closed. The next reader waits until that open has
 * settled, so two native sockets never exist at once. An adopted `acquire`
 * must therefore finish in bounded time.
 *
 * `open` runs in the reader's scope, with the services of the fiber that
 * built the socket, so an adopted `acquire` can use them and register
 * finalizers that run when the reader closes. Where the fiber acquiring the
 * reader has a service with the same tag, its own takes precedence.
 *
 * Concurrent pulls are served in the order they started waiting.
 *
 * `onError` receives errors with no write left to fail. It runs
 * synchronously, and anything it throws is ignored.
 *
 * Invalid `receiveBuffer.capacity` values cause a defect; use a positive
 * safe integer.
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.0
 */
export declare const makeFromBackingSocket: <R = never>(open: (events: BackingEvents) => Effect.Effect<BackingSocket, DatagramSocketError, R>, options?: {
    readonly receiveBuffer?: ReceiveBufferOptions | undefined;
    readonly onError?: ((error: DatagramSocketError) => void) | undefined;
} | undefined) => Effect.Effect<DatagramSocket, never, Exclude<R, Scope.Scope>>;
export {};
//# sourceMappingURL=DatagramSocket.d.ts.map
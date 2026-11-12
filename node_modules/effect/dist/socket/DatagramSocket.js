import * as Context from "../Context.js";
import * as Effect from "../Effect.js";
import * as Fiber from "../Fiber.js";
import { constVoid } from "../Function.js";
import { args, contA, contAll, exitSucceed, makePrimitive, withFiber } from "../internal/core.js";
import * as Latch from "../Latch.js";
import * as NetAddress from "../net/NetAddress.js";
import * as Predicate from "../Predicate.js";
import * as Schema from "../Schema.js";
import * as Scope from "../Scope.js";
/**
 * Runtime type identifier attached to `DatagramSocket` services.
 *
 * @stability experimental
 * @category type IDs
 * @since 4.0.0
 */
export const TypeId = "~effect/socket/DatagramSocket";
/**
 * Service tag for UDP socket transports.
 *
 * @stability experimental
 * @category services
 * @since 4.0.0
 */
export const DatagramSocket = /*#__PURE__*/Context.Service("effect/socket/DatagramSocket");
/**
 * Creates a `DatagramSocket` from its `reader` and `writer` effects.
 *
 * @stability experimental
 * @category constructors
 * @since 4.0.0
 */
export const make = options => DatagramSocket.of({
  [TypeId]: TypeId,
  reader: options.reader,
  writer: options.writer
});
/**
 * Opening or binding the native socket, applying its options, or resolving
 * a name failed.
 *
 * @stability experimental
 * @category errors
 * @since 4.0.0
 */
export class DatagramSocketOpenError extends /*#__PURE__*/Schema.Error("effect/socket/DatagramSocket/OpenError")({
  _tag: /*#__PURE__*/Schema.tag("DatagramSocketOpenError"),
  kind: /*#__PURE__*/Schema.Literals(["AddressInUse", "AddressNotAvailable", "PermissionDenied", "Unknown"]),
  cause: /*#__PURE__*/Schema.Defect()
}) {}
/**
 * A receive failed, or an ICMP report arrived with no write left to fail.
 *
 * @stability experimental
 * @category errors
 * @since 4.0.0
 */
export class DatagramSocketReadError extends /*#__PURE__*/Schema.Error("effect/socket/DatagramSocket/ReadError")({
  _tag: /*#__PURE__*/Schema.tag("DatagramSocketReadError"),
  kind: /*#__PURE__*/Schema.Literals(["MessageTooLarge", "Unreachable", "ConnectionRefused", "PermissionDenied", "Unknown"]),
  cause: /*#__PURE__*/Schema.Defect()
}) {}
/**
 * A send failed. `address` is the destination when it is known.
 *
 * @stability experimental
 * @category errors
 * @since 4.0.0
 */
export class DatagramSocketWriteError extends /*#__PURE__*/Schema.Error("effect/socket/DatagramSocket/WriteError")({
  _tag: /*#__PURE__*/Schema.tag("DatagramSocketWriteError"),
  kind: /*#__PURE__*/Schema.Literals(["MessageTooLarge", "Unreachable", "ConnectionRefused", "PermissionDenied", "Unknown"]),
  address: /*#__PURE__*/Schema.optional(Schema.InetAddress),
  cause: /*#__PURE__*/Schema.Defect()
}) {}
/**
 * The native socket closed underneath the reader, or the reader's scope
 * closed.
 *
 * @stability experimental
 * @category errors
 * @since 4.0.0
 */
export class DatagramSocketClosedError extends /*#__PURE__*/Schema.Error("effect/socket/DatagramSocket/ClosedError")({
  _tag: /*#__PURE__*/Schema.tag("DatagramSocketClosedError")
}) {}
/**
 * The runtime lacks a capability, such as source-specific multicast on Deno.
 *
 * @stability experimental
 * @category errors
 * @since 4.0.0
 */
export class DatagramSocketUnsupportedError extends /*#__PURE__*/Schema.Error("effect/socket/DatagramSocket/UnsupportedError")({
  _tag: /*#__PURE__*/Schema.tag("DatagramSocketUnsupportedError"),
  capability: Schema.String,
  runtime: Schema.String
}) {
  /**
   * Names the runtime and the capability it lacks.
   *
   * @stability experimental
   * @since 4.0.0
   */
  get message() {
    return `${this.runtime} does not support ${this.capability}`;
  }
}
/**
 * Schema for the union of `DatagramSocketError` reasons.
 *
 * @stability experimental
 * @category errors
 * @since 4.0.0
 */
export const DatagramSocketErrorReason = /*#__PURE__*/Schema.Union([DatagramSocketOpenError, DatagramSocketReadError, DatagramSocketWriteError, DatagramSocketClosedError, DatagramSocketUnsupportedError]);
/**
 * Runtime type identifier attached to `DatagramSocketError` values.
 *
 * @stability experimental
 * @category errors
 * @since 4.0.0
 */
export const DatagramSocketErrorTypeId = "~effect/socket/DatagramSocket/DatagramSocketError";
/**
 * Returns `true` when a value is a `DatagramSocketError`.
 *
 * @stability experimental
 * @category guards
 * @since 4.0.0
 */
export const isDatagramSocketError = u => Predicate.hasProperty(u, DatagramSocketErrorTypeId);
/**
 * The error raised by `DatagramSocket` operations, wrapping a specific
 * reason. Its `cause` and `message` come from the reason.
 *
 * @stability experimental
 * @category errors
 * @since 4.0.0
 */
export class DatagramSocketError extends /*#__PURE__*/Schema.TaggedError(DatagramSocketErrorTypeId)("DatagramSocketError", {
  _tag: /*#__PURE__*/Schema.tag("DatagramSocketError"),
  reason: DatagramSocketErrorReason
}) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props) {
    if ("cause" in props.reason) {
      super({
        ...props,
        cause: props.reason.cause
      });
    } else {
      super(props);
    }
  }
  [DatagramSocketErrorTypeId] = DatagramSocketErrorTypeId;
  get message() {
    return this.reason.message;
  }
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
export const makeFromBackingSocket = (open, options) => withFiber(fiber => {
  const capacity = options?.receiveBuffer?.capacity ?? 1024;
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new RangeError(`DatagramSocket receive buffer capacity must be a positive integer, received ${capacity}`);
  }
  return Effect.succeed(makeFromBackingSocketWithContext(open, fiber.context, capacity, options?.receiveBuffer?.strategy === "sliding", options?.onError));
});
const makeFromBackingSocketWithContext = (open, services, capacity, sliding, onError) => {
  const free = Latch.makeUnsafe(true);
  const latch = Latch.makeUnsafe(false);
  let current;
  const abandon = (state, opening) => {
    state.close();
    // Release reader ownership only after the interrupted open settles.
    opening.addObserver(exit => {
      if (exit._tag === "Success") exit.value.close();
      free.openUnsafe();
    });
  };
  const release = state => {
    state.close();
    current = undefined;
    latch.closeUnsafe();
    free.openUnsafe();
  };
  const reader = Effect.uninterruptibleMask(Effect.fnUntraced(function* (restore) {
    while (!free.closeUnsafe()) yield* restore(free.await);
    const scope = yield* Effect.scope;
    const state = new ReaderState(capacity, sliding, onError);
    // Native opens may be uncancellable. Interrupt only the wait; `abandon`
    // closes any socket returned later.
    const opened = open(state.events).pipe(Effect.updateContext(input => Context.add(Context.merge(services, input), Scope.Scope, scope)));
    const opening = yield* Effect.forkDetach(opened, {
      startImmediately: true
    });
    state.handle = yield* restore(Fiber.join(opening)).pipe(Effect.onError(() => Effect.sync(() => abandon(state, opening))));
    current = state;
    latch.openUnsafe();
    yield* Effect.addFinalizer(() => Effect.sync(() => release(state)));
    return makeReader(state);
  }));
  const write = datagram => withFiber(fiber => {
    const state = current;
    return state === undefined ? latch.whenOpen(write(datagram)) : state.write(datagram, fiber);
  });
  const writeAll = datagrams => withFiber(fiber => {
    const state = current;
    return state === undefined ? latch.whenOpen(writeAll(datagrams)) : state.writeAll(datagrams, fiber);
  });
  const writer = Effect.succeed({
    write,
    writeAll
  });
  return make({
    reader,
    writer
  });
};
const encoder = /*#__PURE__*/new TextEncoder();
const encode = payload => typeof payload === "string" ? encoder.encode(payload) : payload;
const emptyScopeIds = /*#__PURE__*/new Map();
const closedError = () => new DatagramSocketError({
  reason: new DatagramSocketClosedError()
});
// Rejected writes return this sentinel, avoiding per-packet error type checks.
const rejected = {
  host: "",
  port: 0
};
class DatagramImpl {
  payload;
  host;
  port;
  owner;
  #address;
  constructor(payload, host, port, owner) {
    this.payload = payload;
    this.host = host;
    this.port = port;
    this.owner = owner;
  }
  get address() {
    return this.#address ??= NetAddress.inetAddressFromNativeUnsafe(this.host, this.port, this.owner.scopeIds);
  }
  // only for a queued record, which no pull has returned yet
  reuse(payload, host, port) {
    this.payload = payload;
    this.host = host;
    this.port = port;
    this.#address = undefined;
  }
}
const targetOf = datagram => "host" in datagram ? datagram : datagram.address;
class ReaderState {
  capacity;
  sliding;
  listener;
  events = {
    onPacket: (payload, host, port) => this.push(payload, host, port),
    onReadError: error => this.fail(error),
    onError: error => this.report(error),
    onClose: () => this.fail(closedError())
  };
  // set when `open` completes; packets can arrive before that
  handle = undefined;
  failure = undefined;
  // separate from `failure`: after a sticky read error the socket is still
  // open, so ICMP reports still reach `onError`
  closed = false;
  // Sliding overflow turns the full buffer into a ring, oldest at `head`.
  buffer = [];
  head = 0;
  dropped = 0;
  // A single consumer uses the first waiter slot without touching the array.
  waiter = undefined;
  waiters = [];
  unpark = /*#__PURE__*/unpark(this);
  bound = undefined;
  // one-entry cache for `write` to the same explicit address
  lastTarget = undefined;
  lastDestination = undefined;
  rejection = undefined;
  constructor(capacity, sliding, listener) {
    this.capacity = capacity;
    this.sliding = sliding;
    this.listener = listener;
  }
  push(payload, host, port) {
    if (this.failure !== undefined) return;
    if (this.buffer.length >= this.capacity) return this.overflow(payload, host, port);
    const datagram = new DatagramImpl(payload, host, port, this);
    if (this.waiter !== undefined) return this.wake(datagram);
    const buffer = this.buffer;
    buffer[buffer.length] = datagram;
  }
  wake(datagram) {
    const fiber = this.waiter;
    this.promoteWaiter();
    fiber.evaluate(exitSucceed([datagram]));
  }
  overflow(payload, host, port) {
    this.dropped++;
    if (!this.sliding) return;
    const buffer = this.buffer;
    const head = this.head;
    buffer[head].reuse(payload, host, port);
    this.head = head + 1 === buffer.length ? 0 : head + 1;
  }
  take() {
    const buffer = this.buffer;
    const head = this.head;
    this.buffer = [];
    if (head === 0) return buffer;
    this.head = 0;
    const length = buffer.length;
    const batch = new Array(length);
    let j = 0;
    for (let i = head; i < length; i++) batch[j++] = buffer[i];
    for (let i = 0; i < head; i++) batch[j++] = buffer[i];
    return batch;
  }
  park(fiber) {
    if (this.waiter === undefined) this.waiter = fiber;else this.waiters.push(fiber);
  }
  promoteWaiter() {
    this.waiter = this.waiters.length === 0 ? undefined : this.waiters.shift();
  }
  removeWaiter(fiber) {
    if (this.waiter === fiber) return this.promoteWaiter();
    if (this.waiters.length === 0) return;
    const index = this.waiters.indexOf(fiber);
    if (index !== -1) this.waiters.splice(index, 1);
  }
  failWaiters() {
    const waiter = this.waiter;
    if (waiter === undefined) return;
    const failure = this.failure;
    const waiters = this.waiters;
    this.waiter = undefined;
    this.waiters = [];
    waiter.evaluate(failure);
    for (let i = 0; i < waiters.length; i++) waiters[i].evaluate(failure);
  }
  fail(error) {
    if (this.failure !== undefined) return;
    this.failure = Effect.fail(error);
    this.failWaiters();
  }
  close() {
    this.closed = true;
    this.buffer = [];
    this.head = 0;
    this.failure = Effect.fail(closedError());
    this.failWaiters();
    this.handle?.close();
  }
  report(error) {
    const listener = this.listener;
    if (listener === undefined || this.closed) return;
    try {
      listener(error);
    } catch {
      // Listener errors cannot fail native callbacks.
    }
  }
  // packets can arrive before the handle does, so they read this lazily
  get scopeIds() {
    return this.handle?.scopeIds ?? emptyScopeIds;
  }
  get address() {
    return this.bound ??= NetAddress.inetAddressFromNativeUnsafe(this.handle.address.host, this.handle.address.port, this.scopeIds);
  }
  // Synchronous sends avoid parking; async completions resume inline.
  // Ignore completions after interruption.
  write(datagram, fiber) {
    if (this.failure !== undefined) return this.failure;
    const target = targetOf(datagram);
    const destination = this.destination(target);
    if (destination === rejected) return Effect.fail(this.rejection);
    const handle = this.handle;
    const payload = encode(datagram.payload);
    let result;
    let parked = false;
    handle.send(payload, destination, error => {
      if (result !== undefined) return;
      result = error === undefined ? Effect.void : Effect.fail(this.withAddress(error, target));
      if (parked) fiber.evaluate(result);
    });
    if (result !== undefined) return result;
    parked = true;
    return fiber.yieldWith(() => {
      parked = false;
    });
  }
  writeAll(datagrams, fiber) {
    if (this.failure !== undefined) return this.failure;
    const payloads = new Array(datagrams.length);
    const destinations = new Array(datagrams.length);
    for (let i = 0; i < datagrams.length; i++) {
      const datagram = datagrams[i];
      const destination = this.destination(targetOf(datagram));
      if (destination === rejected) return Effect.fail(this.rejection);
      payloads[i] = encode(datagram.payload);
      destinations[i] = destination;
    }
    let result;
    let parked = false;
    this.handle.sendMany(payloads, destinations, (error, index) => {
      if (result !== undefined) return;
      result = error === undefined ? Effect.void : Effect.fail(index === undefined ? error : this.withAddress(error, targetOf(datagrams[index])));
      if (parked) fiber.evaluate(result);
    });
    if (result !== undefined) return result;
    parked = true;
    return fiber.yieldWith(() => {
      parked = false;
    });
  }
  // Returns `rejected` on failure, with the error stored in `rejection`.
  destination(target) {
    const handle = this.handle;
    if (target === undefined) {
      if (handle.connected) return undefined;
      return handle.peer ?? this.reject("DatagramSocket write has no destination and the socket has no peer");
    }
    if (!("_tag" in target)) return handle.connected ? undefined : target;
    if (handle.connected) return this.reject("an explicit address cannot be used on a connected DatagramSocket", target);
    if (target === this.lastTarget) return this.lastDestination;
    const destination = {
      host: NetAddress.formatNativeHost(target, this.scopeIds),
      port: target.port
    };
    this.lastTarget = target;
    this.lastDestination = destination;
    return destination;
  }
  reject(message, address) {
    this.rejection = new DatagramSocketError({
      reason: new DatagramSocketWriteError({
        kind: "Unknown",
        address,
        cause: new Error(message)
      })
    });
    return rejected;
  }
  withAddress(error, target) {
    const reason = error.reason;
    if (reason._tag !== "DatagramSocketWriteError" || reason.address !== undefined) return error;
    const address = this.addressOf(target);
    if (address === undefined) return error;
    return new DatagramSocketError({
      reason: new DatagramSocketWriteError({
        kind: reason.kind,
        address,
        cause: reason.cause
      })
    });
  }
  addressOf(target) {
    try {
      if (target !== undefined) return "_tag" in target ? target : target.address;
      const peer = this.handle.peer;
      return peer === undefined ? undefined : NetAddress.inetAddressFromNativeUnsafe(peer.host, peer.port, this.scopeIds);
    } catch {
      // an unknown IPv6 zone leaves the address out
      return undefined;
    }
  }
}
// Park the fiber itself and resume it inline, avoiding `Effect.callback` allocations.
const makePull = state => withFiber(fiber => {
  if (state.buffer.length !== 0) {
    const batch = state.take();
    const cont = fiber.getCont(contA);
    return cont ? cont[contA](batch, fiber) : fiber.yieldWith(exitSucceed(batch));
  }
  if (state.failure !== undefined) return state.failure;
  state.park(fiber);
  fiber._stack.push(state.unpark);
  return fiber.yieldWith(constVoid);
});
// `contAll` removes interrupted waiters too; after a wake, removal is a no-op.
const unpark = /*#__PURE__*/makePrimitive({
  op: "DatagramSocketUnpark",
  [contAll](fiber) {
    this[args].removeWaiter(fiber);
  }
});
const makeReader = state => ({
  pull: makePull(state),
  get address() {
    return state.address;
  },
  dropped: () => state.dropped,
  joinMulticast: options => Effect.suspend(() => {
    if (state.failure !== undefined) return state.failure;
    return Effect.acquireRelease(state.handle.joinMulticast(options), leave => state.closed ? Effect.void : Effect.ignoreCause(leave()));
  })
});
//# sourceMappingURL=DatagramSocket.js.map
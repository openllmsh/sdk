import {
  decodeChannelEnvelope,
  encodeChannelEnvelope,
  stableChannelId,
} from "@openllmsh/sdk/tunnel/channel-envelope";
import type { TDuplex, TMuxChannel } from "@openllmsh/sdk/tunnel/mux";
import { createChannel } from "@openllmsh/sdk/tunnel/mux";
import type { TPeerLinkFailureCache } from "@openllmsh/sdk/tunnel/peer-link";
import {
  createPeerLinkFailureCache,
  peerLinkFailureReasonOf,
} from "@openllmsh/sdk/tunnel/peer-link";

type TActiveChannel = {
  readonly channelId: string;
  readonly keyId: string;
  readonly channel: TMuxChannel;
  state: "opening" | "open";
  settle: ((channel: TMuxChannel | null) => void) | null;
  readonly opening: Promise<TMuxChannel | null>;
  sink: ((bytes: Uint8Array | null) => void) | null;
  /**
   * Whether `channel_open` carried a device-access grant. A warm / realtime
   * open can cache a grant-less channel while the dpk is still unverified;
   * agent later needs to replace that cache once a grant can be signed.
   */
  openedWithGrant: boolean;
};

export type TRelayMuxDependencies = {
  readonly daemonAdvertisesMux: (keyId: string) => boolean;
  /**
   * True when this key requires a seed-derived device grant on
   * `channel_open` (cloud provisioned OR daemon advertises `seedgate1`).
   */
  readonly needsSeedGate?: (keyId: string) => boolean;
  /**
   * Sign a device grant for `keyId` + `cid`. Returns the base64 envelope,
   * or `null` when the vault is locked. Only called when `needsSeedGate`
   * is true. A `null` result aborts the open (returns null) so a locked
   * vault cannot open a seed-gated channel.
   */
  readonly signGrant?: (keyId: string, cid: string) => Promise<string | null>;
  readonly relaySend: (frame: unknown) => boolean;
  readonly relaySendBinary: (bytes: Uint8Array) => boolean;
  readonly relayBufferedAmount: () => number;
  readonly onRelayDrain: (callback: () => void) => () => void;
  /**
   * Stable browser identity for `stableChannelId` (device id + tab id). Host
   * glue supplies this — the SDK never reads `localStorage` / cookies.
   */
  readonly browserIdentity: () => string;
};

export type TMuxPhase = "idle" | "opening" | "open" | "failed";

export type TMuxChannelState = {
  readonly keyId: string;
  readonly phase: TMuxPhase;
  readonly channelId: string | null;
  readonly lastError: string | null;
  readonly failureCachedUntil: number | null;
};

/**
 * Close reasons that must not stamp the failure cache. Kept in lockstep with
 * RTC's benign set (`rtc-channel.ts` mountMux onClose) so presence-offline
 * and intentional local teardown stay immediately retryable.
 */
const isBenignMuxClose = (reason: string): boolean =>
  reason === "done" ||
  reason === "vault_locked" ||
  reason === "daemon gone" ||
  reason === "reset" ||
  reason === "channel open aborted" ||
  reason === "client closed";

export type TRelayMux = {
  readonly clearMuxFailureForKey: (keyId: string) => void;
  readonly getMuxChannelState: (keyId: string) => TMuxChannelState;
  readonly subscribeMuxState: (listener: () => void) => () => void;
  readonly onRelayBinary: (bytes: Uint8Array) => void;
  readonly onRelayChannelAck: (frame: {
    readonly channel_id: string;
    readonly ok: boolean;
    readonly error?: string;
  }) => void;
  readonly onRelayChannelClose: (frame: {
    readonly channel_id: string;
    readonly reason?: string;
  }) => void;
  readonly getOrOpenMuxChannel: (
    keyId: string,
    deps: TRelayMuxDependencies,
    timeoutMs?: number,
    signal?: AbortSignal,
  ) => Promise<TMuxChannel | null>;
  readonly dropChannelForKey: (keyId: string) => void;
  readonly muxChannelOpenedWithGrant: (keyId: string) => boolean | null;
  readonly dropGrantlessMuxChannelForKey: (keyId: string) => void;
  readonly failAllMuxChannels: (reason: string) => void;
  readonly clearMuxState: () => void;
};

export type TCreateRelayMuxOptions = {
  /**
   * Negative cache for this mux instance's opens. Defaults to a fresh cache so
   * two `createRelayMux()` clients never share failure state. RTC host glue
   * (`lib/stores/rtc-channel.ts`) and `createPeerLink` keep the process-global
   * `peerLinkFailureCache` for the RTC rung — only the mux maps are scoped
   * here. The browser app singleton (`lib/stores/relay-mux.ts`) is still one
   * instance, so in-tab mux failure behaviour matches the old module singleton.
   */
  readonly failureCache?: TPeerLinkFailureCache;
};

/**
 * Per-client relay-mux state. Two clients must not share channel maps — create
 * one instance per client (or one app-wide singleton in host glue).
 */
export const createRelayMux = (
  options: TCreateRelayMuxOptions = {},
): TRelayMux => {
  const failureCache = options.failureCache ?? createPeerLinkFailureCache();
  const channelsByKey = new Map<string, TActiveChannel>();
  const channelsById = new Map<string, TActiveChannel>();
  /**
   * In-flight deterministic-id derivations keyed by daemon key id. Deriving the
   * stable channel id is async, so without this a second synchronous same-key
   * call would slip past the `channelsByKey` dedup before the first call's
   * record is indexed — and the whole point of the stable id is that both
   * derivations produce the SAME id, so they must share one open.
   */
  const pendingDerives = new Map<string, Promise<TMuxChannel | null>>();
  /** UI diagnostics only; peer-link owns retry policy and cache lifetime. */
  const stickyLastError = new Map<string, string>();
  const muxListeners = new Set<() => void>();

  const notifyMux = (): void => {
    for (const listener of muxListeners) {
      try {
        listener();
      } catch {
        // never let a subscriber break the store
      }
    }
  };

  const cacheFailure = (keyId: string, reason?: string): void => {
    const failure = peerLinkFailureReasonOf(
      new Error(reason ?? "relay transport failure"),
    );
    failureCache.set(keyId, "mux", failure);
    if (reason !== undefined && reason.length > 0) {
      stickyLastError.set(keyId, reason);
    }
    notifyMux();
  };

  const failureCached = (keyId: string): boolean =>
    failureCache.has(keyId, "mux");

  const muxFailureCachedUntil = (keyId: string): number | null =>
    failureCache.until(keyId, "mux");

  const clearMuxFailureForKey = (keyId: string): void => {
    failureCache.clear(keyId, "mux");
    stickyLastError.delete(keyId);
    notifyMux();
  };

  const getMuxChannelState = (keyId: string): TMuxChannelState => {
    const failureCachedUntil = muxFailureCachedUntil(keyId);
    const active = channelsByKey.get(keyId);
    if (
      active !== undefined &&
      (active.state === "opening" || active.state === "open")
    ) {
      return {
        keyId,
        phase: active.state,
        channelId: active.channelId,
        lastError: stickyLastError.get(keyId) ?? null,
        failureCachedUntil,
      };
    }
    const sticky = stickyLastError.get(keyId) ?? null;
    if (failureCachedUntil !== null || sticky !== null) {
      return {
        keyId,
        phase: "failed",
        channelId: null,
        lastError: sticky,
        failureCachedUntil,
      };
    }
    return {
      keyId,
      phase: "idle",
      channelId: null,
      lastError: null,
      failureCachedUntil: null,
    };
  };

  const subscribeMuxState = (listener: () => void): (() => void) => {
    muxListeners.add(listener);
    return () => {
      muxListeners.delete(listener);
    };
  };

  const unindex = (channel: TActiveChannel): void => {
    if (channelsByKey.get(channel.keyId) === channel)
      channelsByKey.delete(channel.keyId);
    if (channelsById.get(channel.channelId) === channel)
      channelsById.delete(channel.channelId);
  };

  const makeRelayDuplex = (
    channelId: string,
    setSink: (sink: ((bytes: Uint8Array | null) => void) | null) => void,
    deps: TRelayMuxDependencies,
  ): TDuplex => ({
    send: (bytes) => {
      // channel_open text always precedes the first binary message; WebSocket
      // preserves per-socket order, so relay admission cannot race payload bytes.
      if (!deps.relaySendBinary(encodeChannelEnvelope(channelId, bytes))) {
        // onClose (triggered by close) unindexes + settles + caches.
        channelsById.get(channelId)?.channel.close("relay send failed");
      }
    },
    bufferedAmount: deps.relayBufferedAmount,
    highWaterMark: 1024 * 1024,
    onDrain: deps.onRelayDrain,
    onBytes: (callback) => setSink(callback),
    close: () => {
      setSink(null);
      deps.relaySend({
        type: "channel_close",
        channel_id: channelId,
        reason: "done",
      });
    },
  });

  const onRelayBinary = (bytes: Uint8Array): void => {
    const envelope = decodeChannelEnvelope(bytes);
    if (!envelope.ok) return;
    const channel = channelsById.get(envelope.channelId);
    if (channel === undefined) return;
    const payload = envelope.payload;
    if (payload.byteLength < 9) {
      channel.channel.close("protocol_error");
      return;
    }
    try {
      channel.sink?.(payload);
    } catch {
      // Binary garbage must never destabilize the independent JSON control plane.
    }
  };

  const onRelayChannelAck = (frame: {
    readonly channel_id: string;
    readonly ok: boolean;
    readonly error?: string;
  }): void => {
    const channel = channelsById.get(frame.channel_id);
    if (channel === undefined) return;
    if (frame.ok) {
      channel.state = "open";
      stickyLastError.delete(channel.keyId);
      const settle = channel.settle;
      channel.settle = null;
      settle?.(channel.channel);
      notifyMux();
      return;
    }
    // Non-benign error → onClose caches; teardown routed through close().
    channel.channel.close(frame.error ?? "channel refused");
  };

  const onRelayChannelClose = (frame: {
    readonly channel_id: string;
    /** Open-vocabulary reason from a forward-compatible relay peer. */
    readonly reason?: string;
  }): void => {
    channelsById
      .get(frame.channel_id)
      ?.channel.close(frame.reason ?? "channel closed");
  };

  const openMuxChannel = (
    keyId: string,
    channelId: string,
    deps: TRelayMuxDependencies,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<TMuxChannel | null> => {
    let resolveOpening!: (channel: TMuxChannel | null) => void;
    const opening = new Promise<TMuxChannel | null>((resolve) => {
      resolveOpening = resolve;
    });
    const timer = setTimeout(
      () => {
        // onClose caches + settles; "channel open timed out" is non-benign.
        channelsById.get(channelId)?.channel.close("channel open timed out");
      },
      Math.max(0, timeoutMs),
    );
    let removeAbortListener: (() => void) | undefined;
    const settle = (result: TMuxChannel | null): void => {
      clearTimeout(timer);
      removeAbortListener?.();
      resolveOpening(result);
    };
    // Channel-local close (protocol_error, peer_gone, host close, ack-nack,
    // timeout) all route here — the single teardown. It unindexes, settles the
    // pending open with null, and caches non-benign failures so a dead channel
    // is never reused. Benign reasons stay immediately retryable.
    let record!: TActiveChannel;
    let sink: ((bytes: Uint8Array | null) => void) | null = null;
    const channel = createChannel({
      duplex: makeRelayDuplex(
        channelId,
        (next) => {
          sink = next;
          if (record !== undefined) record.sink = next;
        },
        deps,
      ),
      side: "consumer",
      onClose: (reason) => {
        if (record === undefined) return;
        unindex(record);
        const pending = record.settle;
        record.settle = null;
        if (pending !== null) settle(null);
        // vault_locked is immediately retryable (no failure cache) but still sticky
        // so the UI can show "unlock to connect" after teardown.
        if (reason === "vault_locked") {
          stickyLastError.set(keyId, reason);
          notifyMux();
        } else if (!isBenignMuxClose(reason)) {
          cacheFailure(keyId, reason);
        } else {
          notifyMux();
        }
      },
    });
    record = {
      channelId,
      keyId,
      channel,
      state: "opening",
      settle,
      opening,
      sink,
      openedWithGrant: false,
    };
    channelsByKey.set(keyId, record);
    channelsById.set(channelId, record);
    if (signal !== undefined) {
      const abort = (): void => channel.close("channel open aborted");
      signal.addEventListener("abort", abort, { once: true });
      removeAbortListener = (): void =>
        signal.removeEventListener("abort", abort);
      if (signal.aborted) abort();
    }
    notifyMux();

    const sendOpen = (grant: string | undefined): void => {
      record.openedWithGrant = grant !== undefined;
      if (
        !deps.relaySend({
          type: "channel_open",
          channel_id: channelId,
          key_id: keyId,
          ...(grant !== undefined ? { grant } : {}),
        })
      ) {
        channel.close("relay send failed");
      }
    };

    // Seed-gated path: prefer a signed grant before sending channel_open.
    // Without a control-key signer, still send a grant-less open so
    // non-gated kinds (realtime) keep working; the daemon's per-kind
    // seedgate rejects agent/RTC that require a grant.
    if (deps.needsSeedGate?.(keyId) === true) {
      const sign = deps.signGrant;
      if (sign === undefined) {
        sendOpen(undefined);
        return opening;
      }
      void sign(keyId, channelId)
        .then((grant) => {
          if (channelsById.get(channelId) !== record) return;
          if (grant === null) {
            sendOpen(undefined);
            return;
          }
          sendOpen(grant);
        })
        .catch((error: unknown) => {
          // Signer threw (cache drift, unknown daemon pubkey, …). For agent
          // the open will still fail at the daemon; surface the reason on
          // the channel so the UI can distinguish unverified / not-verified.
          if (channelsById.get(channelId) !== record) return;
          const reason =
            error instanceof Error && error.message.length > 0
              ? error.message
              : "vault_locked";
          // device_not_verified: fall through to a grant-less open so
          // non-agent kinds (realtime / tunnel) keep working; the daemon's
          // per-kind seedgate still rejects agent without a verified dpk.
          // browser_unverified / device_identity_changed: fail closed — the
          // browser cannot usefully open, or the pin has rotated under us.
          if (
            reason === "device_identity_changed" ||
            reason === "browser_unverified"
          ) {
            channel.close(reason);
            return;
          }
          sendOpen(undefined);
        });
      return opening;
    }

    sendOpen(undefined);
    return opening;
  };

  const getOrOpenMuxChannel = (
    keyId: string,
    deps: TRelayMuxDependencies,
    timeoutMs = 15_000,
    signal?: AbortSignal,
  ): Promise<TMuxChannel | null> => {
    if (signal?.aborted) return Promise.resolve(null);
    if (!deps.daemonAdvertisesMux(keyId) || failureCached(keyId)) {
      return Promise.resolve(null);
    }
    const existing = channelsByKey.get(keyId);
    if (existing !== undefined) {
      return existing.state === "opening"
        ? existing.opening
        : Promise.resolve(existing.state === "open" ? existing.channel : null);
    }
    const pending = pendingDerives.get(keyId);
    if (pending !== undefined) return pending;

    // Deterministic channel identity: a relay-socket reconnect in this tab
    // re-derives the SAME id for its (browser device, tab → daemon key) tuple,
    // while another tab gets an independent channel. The relay authenticates the
    // socket server-side and already trusts the channelId's owner, so `keyId`
    // (globally unique, user-scoped server-side) stands in for both identity
    // args. The composite preserves device identity without using the tunnel
    // identity delimiter within a value.
    const opening = Promise.resolve()
      .then(() => stableChannelId(keyId, keyId, deps.browserIdentity(), 0))
      .then((channelId) => {
        // A same-key open may have won the race while this derivation was in
        // flight — re-check before indexing a second record.
        const winner = channelsByKey.get(keyId);
        if (winner !== undefined) return winner.opening;
        return openMuxChannel(keyId, channelId, deps, timeoutMs, signal);
      })
      .catch(() => null);
    pendingDerives.set(keyId, opening);
    void opening.finally(() => {
      if (pendingDerives.get(keyId) === opening) pendingDerives.delete(keyId);
    });
    return opening;
  };

  const dropChannelForKey = (keyId: string): void => {
    clearMuxFailureForKey(keyId);
    channelsByKey.get(keyId)?.channel.close("daemon gone");
  };

  /**
   * Whether the cached mux channel for `keyId` was opened with a device-access
   * grant. `null` when nothing is cached.
   */
  const muxChannelOpenedWithGrant = (keyId: string): boolean | null => {
    const existing = channelsByKey.get(keyId);
    if (existing === undefined) return null;
    return existing.openedWithGrant;
  };

  /**
   * Drop a cached grant-less channel so the next open can send a grant. No-op
   * when nothing is cached or the channel already carried a grant. Used by the
   * agent path once a verified dpk is available; non-agent kinds leave
   * grant-less channels alone.
   *
   * The channel is shared across kinds (tunnel / realtime / agent). Close only
   * when idle — active streams or an in-flight `channel_open` leave it alone so
   * a concurrent non-agent stream is not torn down under the agent dial.
   */
  const dropGrantlessMuxChannelForKey = (keyId: string): void => {
    const existing = channelsByKey.get(keyId);
    if (existing === undefined || existing.openedWithGrant) return;
    if (
      existing.state === "opening" ||
      existing.channel.openStreamCount() > 0
    ) {
      return;
    }
    clearMuxFailureForKey(keyId);
    // "reset" is benign — immediately retryable, no failure cache.
    existing.channel.close("reset");
  };

  const failAllMuxChannels = (reason: string): void => {
    for (const channel of [...channelsByKey.values()])
      channel.channel.close(reason);
  };

  const clearMuxState = (): void => {
    failAllMuxChannels("relay socket closed");
    channelsByKey.clear();
    channelsById.clear();
    pendingDerives.clear();
    failureCache.clearPath("mux");
    stickyLastError.clear();
    notifyMux();
  };

  return {
    clearMuxFailureForKey,
    getMuxChannelState,
    subscribeMuxState,
    onRelayBinary,
    onRelayChannelAck,
    onRelayChannelClose,
    getOrOpenMuxChannel,
    dropChannelForKey,
    muxChannelOpenedWithGrant,
    dropGrantlessMuxChannelForKey,
    failAllMuxChannels,
    clearMuxState,
  };
};

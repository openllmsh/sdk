/**
 * Client device tunnel — composition over `@openllmsh/sdk/tunnel`.
 *
 * Holds the RTC → relay-mux open ladder and re-exports the consumer relay-mux
 * open path. Hosts inject relay send, grants, caps, RTC channel resolution and
 * browser identity; the SDK never touches WebSocket/RTC globals itself.
 */

import type { TMuxChannel } from "@openllmsh/sdk/tunnel/mux";
import { isStreamResetError } from "@openllmsh/sdk/tunnel/stream-reset-error";
import type { TRelayMuxDependencies } from "./relay-mux";
import { dropChannelForKey, getOrOpenMuxChannel } from "./relay-mux";

export type {
  TMuxChannelState,
  TMuxPhase,
  TRelayMuxDependencies,
} from "./relay-mux";
export {
  clearMuxFailureForKey,
  clearMuxState,
  dropChannelForKey,
  dropGrantlessMuxChannelForKey,
  failAllMuxChannels,
  getMuxChannelState,
  getOrOpenMuxChannel,
  muxChannelOpenedWithGrant,
  onRelayBinary,
  onRelayChannelAck,
  onRelayChannelClose,
  subscribeMuxState,
} from "./relay-mux";

/** Shared open budget for a session open across RTC + mux rungs. */
export const SESSION_OPEN_TIMEOUT_MS = 15_000;
/** Shorter probe budget for the RTC rung only. */
export const RTC_SESSION_OPEN_TIMEOUT_MS = 6_000;

const DAEMON_OPEN_VERDICTS = [
  "pty_unsupported",
  "sessions_disabled",
  "cli_not_installed",
  "session_not_found",
  "session_busy",
  "overloaded",
  "spawn_failed",
  "unauthorized",
  "agent_unavailable",
  "agent_busy",
  "newer consumer",
] as const;

/**
 * Whether a failed session open should be retried on the next rung (path
 * failure, not a daemon verdict on the request).
 */
export const isTransportFailure = (error: unknown): boolean => {
  if (isStreamResetError(error)) {
    switch (error.code) {
      case "pty_unsupported":
      case "sessions_disabled":
      case "cli_not_installed":
      case "session_not_found":
      case "session_busy":
      case "overloaded":
      case "spawn_failed":
      case "unauthorized":
      case "agent_unavailable":
      case "agent_busy":
      case "realtime_unsupported":
      case "realtime_busy":
      case "realtime_refused":
      case "realtime_policy_refused":
        return false;
      default:
        break;
    }
  }
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return !DAEMON_OPEN_VERDICTS.some((verdict) => message.includes(verdict));
};

export type TResolvedMuxChannel = {
  readonly channel: TMuxChannel;
  readonly path: "rtc" | "mux";
};

export type TSessionLadderDeps = {
  readonly resolveMuxChannel: (
    keyId: string,
  ) => Promise<TResolvedMuxChannel | null>;
  readonly markRtcFailure: (keyId: string) => void;
  readonly dropRelayMux: (keyId: string) => void;
  readonly rtcMayArrive: (keyId: string) => boolean;
  readonly callerSignal?: AbortSignal;
  readonly now?: () => number;
  readonly onDebug?: (scope: string, event: string, data: unknown) => void;
  readonly transportUnavailableError?: (keyId: string) => Error;
};

const defaultUnavailable = (keyId: string): Error =>
  new Error(
    keyId.length > 0
      ? `device transport unavailable for ${keyId}`
      : "device transport unavailable",
  );

/**
 * Run a session open down the transport ladder, failing RTC over to relay mux.
 * Behaviour matches the historical `lib/stores/daemon-store` implementation.
 */
export const openOverMuxLadder = async <R>(
  keyId: string,
  attempt: (
    channel: TMuxChannel,
    timeoutMs: number,
    path: "rtc" | "mux",
  ) => Promise<R>,
  deps: TSessionLadderDeps,
): Promise<R> => {
  const resolve = deps.resolveMuxChannel;
  const poison = deps.markRtcFailure;
  const dropMux = deps.dropRelayMux;
  const rtcPending = deps.rtcMayArrive;
  const callerSignal = deps.callerSignal;
  const now = deps.now ?? Date.now;
  const dbg = deps.onDebug ?? (() => {});
  const unavailable = deps.transportUnavailableError ?? defaultUnavailable;

  let resolved = await resolve(keyId);
  if (resolved === null) throw unavailable(keyId);

  const deadline = now() + SESSION_OPEN_TIMEOUT_MS;
  const remaining = (): number => Math.max(0, deadline - now());

  for (let pass = 0; pass < 4; pass += 1) {
    const tried = resolved.channel;
    const isRtc = resolved.path === "rtc";
    const budget = isRtc
      ? Math.min(RTC_SESSION_OPEN_TIMEOUT_MS, remaining())
      : remaining();
    dbg("ladder", "rung", {
      key: keyId,
      pass,
      path: resolved.path,
      budget_ms: budget,
      alone: !isRtc,
      rtc_may_arrive: rtcPending(keyId),
    });
    try {
      const result = await attempt(resolved.channel, budget, resolved.path);
      dbg("ladder", "opened", { key: keyId, pass, path: resolved.path });
      return result;
    } catch (error: unknown) {
      const why = error instanceof Error ? error.message : String(error);
      dbg("ladder", "rung failed", {
        key: keyId,
        pass,
        path: resolved.path,
        err: why,
        failover: isTransportFailure(error),
      });
      if (callerSignal?.aborted === true) {
        dbg("ladder", "caller aborted — not a rung verdict", {
          key: keyId,
          pass,
          path: resolved.path,
        });
        throw error;
      }
      if (!isTransportFailure(error)) throw error;
      if (isRtc) {
        poison(keyId);
      } else {
        dropMux(keyId);
      }
      if (remaining() === 0) throw error;
      const next = await resolve(keyId);
      if (next === null) throw error;
      if (next.channel === tried) throw error;
      dbg("ladder", "switching rung", {
        key: keyId,
        from: resolved.path,
        to: next.path,
        remaining_ms: remaining(),
      });
      resolved = next;
    }
  }
  throw unavailable(keyId);
};

export type TClientDevice = {
  readonly deviceId: string;
  /**
   * Open (or reuse) a relay-mux channel to this device. RTC upgrade stays with
   * the host's `resolveMuxChannel` used by {@link openOverLadder}.
   */
  readonly openMux: (options?: {
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
  }) => Promise<TMuxChannel | null>;
  /** RTC → mux ladder; host supplies channel resolution via the devices host. */
  readonly openOverLadder: <R>(
    attempt: (
      channel: TMuxChannel,
      timeoutMs: number,
      path: "rtc" | "mux",
    ) => Promise<R>,
    overrides?: Partial<TSessionLadderDeps>,
  ) => Promise<R>;
  readonly close: () => void;
};

export type TClientDevicesHost = {
  readonly mux: TRelayMuxDependencies;
  readonly ladder: TSessionLadderDeps;
};

export type TClientDevices = {
  readonly open: (deviceId: string) => TClientDevice;
};

export const createClientDevices = (
  host: TClientDevicesHost,
): TClientDevices => ({
  open: (deviceId: string): TClientDevice => ({
    deviceId,
    openMux: (options = {}): Promise<TMuxChannel | null> =>
      getOrOpenMuxChannel(
        deviceId,
        host.mux,
        options.timeoutMs,
        options.signal,
      ),
    openOverLadder: <R>(
      attempt: (
        channel: TMuxChannel,
        timeoutMs: number,
        path: "rtc" | "mux",
      ) => Promise<R>,
      overrides: Partial<TSessionLadderDeps> = {},
    ): Promise<R> =>
      openOverMuxLadder(deviceId, attempt, {
        ...host.ladder,
        ...overrides,
      }),
    close: (): void => {
      dropChannelForKey(deviceId);
    },
  }),
});

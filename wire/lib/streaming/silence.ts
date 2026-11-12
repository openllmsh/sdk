import { UpstreamStalledError } from "./upstream-error";

/**
 * Pre-commit silence budget for STREAMING hops only.
 *
 * Measures inactivity on raw upstream bytes (any byte resets the timer —
 * keepalive comments, pings, empty chunks, reasoning deltas). Applied to:
 *   1. waiting for response headers on a streaming fetch, and
 *   2. gaps between body bytes before the first chunk is forwarded to the
 *      client (`release()` disarms once the hop commits).
 *
 * Non-streaming requests get no short timeout — they legitimately send
 * nothing until the full JSON body is ready.
 *
 * Overridable via `OPENLLM_STREAM_SILENCE_TIMEOUT_MS` (same pattern as
 * `OPENLLM_STREAM_DEADLINE_MS`). A non-positive override disables the guard.
 */
export const DEFAULT_STREAM_SILENCE_TIMEOUT_MS = 120_000;

export const streamSilenceTimeoutMs = (): number => {
  const raw = process.env.OPENLLM_STREAM_SILENCE_TIMEOUT_MS;
  if (raw === undefined || raw === "") return DEFAULT_STREAM_SILENCE_TIMEOUT_MS;
  const override = Number(raw);
  if (!Number.isFinite(override)) return DEFAULT_STREAM_SILENCE_TIMEOUT_MS;
  return override;
};

const STALL_ABORT_REASON = "openllm-upstream-stalled";

export const isSilenceStallAbort = (err: unknown): boolean => {
  if (err === STALL_ABORT_REASON) return true;
  if (err instanceof Error) {
    if (err.message === STALL_ABORT_REASON) return true;
    if (err.cause !== undefined) return isSilenceStallAbort(err.cause);
  }
  if (typeof DOMException !== "undefined" && err instanceof DOMException) {
    return err.message === STALL_ABORT_REASON || err.name === "TimeoutError";
  }
  return false;
};

export type TStreamingHeadersGuard = {
  readonly signal: AbortSignal;
  /** True when the silence headers timer fired and the caller did not abort. */
  readonly didStall: () => boolean;
  /** Clear the headers timer once the Response headers have arrived. */
  readonly clear: () => void;
};

/**
 * AbortSignal that fires if response headers take longer than
 * `silenceTimeoutMs`. Cleared as soon as headers arrive so it cannot
 * abort the body later. Caller abort still wins.
 */
export const withStreamingHeadersTimeout = (
  caller: AbortSignal,
  silenceTimeoutMs: number,
): TStreamingHeadersGuard => {
  if (!(silenceTimeoutMs > 0)) {
    return {
      signal: caller,
      didStall: () => false,
      clear: () => {},
    };
  }
  const stall = new AbortController();
  let stalled = false;
  const timer = setTimeout(() => {
    stalled = true;
    stall.abort(STALL_ABORT_REASON);
  }, silenceTimeoutMs);
  const clear = (): void => {
    clearTimeout(timer);
  };
  if (caller.aborted) {
    clear();
    stall.abort(caller.reason);
  } else {
    caller.addEventListener(
      "abort",
      () => {
        clear();
        stall.abort(caller.reason);
      },
      { once: true },
    );
  }
  return {
    signal: stall.signal,
    didStall: () => stalled && !caller.aborted,
    clear,
  };
};

export type TByteSilenceGuard = {
  readonly stream: ReadableStream<Uint8Array>;
  /**
   * Disarm the silence timer. Call once the hop commits (first chunk is
   * about to be forwarded to the client) so mid-stream quiet no longer
   * walks the fallback chain.
   */
  readonly release: () => void;
};

/**
 * Wrap a raw upstream byte stream: any inactivity gap longer than
 * `silenceTimeoutMs` before `release()` errors the stream with
 * {@link UpstreamStalledError}. Any upstream byte resets the timer.
 */
export const withByteSilenceGuard = (
  source: ReadableStream<Uint8Array>,
  options: {
    readonly silenceTimeoutMs: number;
  },
): TByteSilenceGuard => {
  if (!(options.silenceTimeoutMs > 0)) {
    return { stream: source, release: () => {} };
  }
  const reader = source.getReader();
  let released = false;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const STALL: unique symbol = Symbol("upstream-silence");
  let stallReject: ((reason: typeof STALL) => void) | null = null;
  let stallPromise: Promise<typeof STALL> | null = null;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const armTimer = (): void => {
    clearTimer();
    if (released || finished) return;
    stallPromise = new Promise<typeof STALL>((resolve) => {
      stallReject = resolve;
      timer = setTimeout(() => {
        timer = null;
        resolve(STALL);
      }, options.silenceTimeoutMs);
    });
  };

  const release = (): void => {
    released = true;
    clearTimer();
    stallReject = null;
    stallPromise = null;
  };

  armTimer();

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) {
        controller.close();
        return;
      }
      if (released) {
        const read = await reader.read();
        if (read.done) {
          finished = true;
          clearTimer();
          controller.close();
          return;
        }
        controller.enqueue(read.value);
        return;
      }
      const read = reader.read();
      read.catch(() => {});
      if (stallPromise === null) armTimer();
      const race = stallPromise;
      let result: Awaited<typeof read> | typeof STALL;
      try {
        result =
          race === null
            ? await read
            : await Promise.race([read, race]);
      } catch (err) {
        finished = true;
        clearTimer();
        throw err;
      }
      if (result === STALL) {
        finished = true;
        clearTimer();
        reader.cancel(STALL_ABORT_REASON).catch(() => {});
        controller.error(
          new UpstreamStalledError(
            "upstream stalled before producing output",
          ),
        );
        return;
      }
      if (result.done) {
        finished = true;
        clearTimer();
        controller.close();
        return;
      }
      // Any byte — keepalive comment, ping, empty chunk — counts as alive.
      if (result.value.byteLength > 0 && !released) {
        armTimer();
      }
      controller.enqueue(result.value);
    },
    cancel(reason) {
      finished = true;
      clearTimer();
      reader.cancel(reason).catch(() => {});
    },
  });

  return { stream, release };
};

/** Envelope used when a streaming headers wait stalls. */
export const upstreamStalledEnvelope = (
  message = "upstream stalled before producing output",
): {
  readonly error: {
    readonly message: string;
    readonly type: "upstream_stalled";
    readonly code: "upstream_stalled";
  };
} => ({
  error: {
    message,
    type: "upstream_stalled",
    code: "upstream_stalled",
  },
});

import { UpstreamStalledError } from "./upstream-error";

/**
 * Pre-commit silence budgets for STREAMING hops only.
 *
 * Two clocks, both measured on raw upstream bytes (any enqueued chunk —
 * including empty ones, keepalive comments, and pings — counts as alive):
 *
 *   1. **First-byte** (`OPENLLM_STREAM_FIRST_BYTE_TIMEOUT_MS`, default 300s)
 *      — waiting for response headers, and the gap before the first body
 *      byte. Near-cap prefills (hundreds of thousands of tokens) can
 *      legitimately take minutes with no keepalive; this budget is the
 *      one that must accommodate them. See `peek.ts`.
 *   2. **Gap** (`OPENLLM_STREAM_SILENCE_TIMEOUT_MS`, default 120s) — after
 *      any byte has arrived, until `release()` (hop commit). A provider
 *      that went silent mid-prefill after talking once is treated as
 *      stalled.
 *
 * Non-streaming requests get no short timeout — they legitimately send
 * nothing until the full JSON body is ready. A non-positive override
 * disables that budget.
 */
export const DEFAULT_STREAM_FIRST_BYTE_TIMEOUT_MS = 300_000;
export const DEFAULT_STREAM_SILENCE_TIMEOUT_MS = 120_000;

const readTimeoutMs = (envName: string, fallback: number): number => {
  const raw = process.env[envName];
  if (raw === undefined || raw === "") return fallback;
  const override = Number(raw);
  if (!Number.isFinite(override)) return fallback;
  return override;
};

export const streamFirstByteTimeoutMs = (): number =>
  readTimeoutMs(
    "OPENLLM_STREAM_FIRST_BYTE_TIMEOUT_MS",
    DEFAULT_STREAM_FIRST_BYTE_TIMEOUT_MS,
  );

export const streamSilenceTimeoutMs = (): number =>
  readTimeoutMs(
    "OPENLLM_STREAM_SILENCE_TIMEOUT_MS",
    DEFAULT_STREAM_SILENCE_TIMEOUT_MS,
  );

/**
 * Whether a hop should apply the streaming silence budgets on its
 * upstream fetch. ChatGPT's Codex endpoint always streams even when the
 * client asked for JSON, so the gate is `alwaysStreams || clientWantsStream`
 * — not the client flag alone.
 */
export const streamingHopNeedsSilence = (opts: {
  readonly upstreamAlwaysStreams: boolean;
  readonly clientWantsStream: boolean;
}): boolean => opts.upstreamAlwaysStreams || opts.clientWantsStream;

/**
 * Absolute deadline for the combined headers + first-body-byte budget.
 * Pass the remaining time into the body silence guard so the two waits
 * share one first-byte window instead of stacking to ~2×.
 */
export const firstByteDeadlineAt = (firstByteTimeoutMs: number): number =>
  Date.now() + Math.max(0, firstByteTimeoutMs);

export const remainingTimeoutMs = (deadlineAt: number): number =>
  Math.max(0, deadlineAt - Date.now());

const STALL_ABORT_REASON = "openllm-upstream-stalled";

export type TStreamingHeadersGuard = {
  readonly signal: AbortSignal;
  /** True when the first-byte headers timer fired and the caller did not abort. */
  readonly didStall: () => boolean;
  /** Clear the headers timer once the Response headers have arrived. */
  readonly clear: () => void;
};

/**
 * AbortSignal that fires if response headers take longer than
 * `firstByteTimeoutMs`. Cleared as soon as headers arrive so it cannot
 * abort the body later. Caller abort still wins.
 */
export const withStreamingHeadersTimeout = (
  caller: AbortSignal,
  firstByteTimeoutMs: number,
): TStreamingHeadersGuard => {
  if (!(firstByteTimeoutMs > 0)) {
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
  }, firstByteTimeoutMs);
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

export type TByteSilenceGuardOptions = {
  /** Budget waiting for the first body byte (default 300s). */
  readonly firstByteTimeoutMs: number;
  /** Budget for gaps after any byte until `release()` (default 120s). */
  readonly gapTimeoutMs: number;
};

/**
 * Wrap a raw upstream byte stream with the two-budget silence policy.
 * Errors the stream with {@link UpstreamStalledError} on a trip before
 * `release()`.
 */
export const withByteSilenceGuard = (
  source: ReadableStream<Uint8Array>,
  options: TByteSilenceGuardOptions,
): TByteSilenceGuard => {
  const firstMs = options.firstByteTimeoutMs;
  const gapMs = options.gapTimeoutMs;
  if (!(firstMs > 0) && !(gapMs > 0)) {
    return { stream: source, release: () => {} };
  }
  const reader = source.getReader();
  let released = false;
  let finished = false;
  let sawByte = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const STALL: unique symbol = Symbol("upstream-silence");
  const RELEASED: unique symbol = Symbol("upstream-silence-released");
  type TRace = typeof STALL | typeof RELEASED;
  let settleRace: ((reason: TRace) => void) | null = null;
  let racePromise: Promise<TRace> | null = null;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const currentBudgetMs = (): number => (sawByte ? gapMs : firstMs);

  const armTimer = (): void => {
    clearTimer();
    if (released || finished) return;
    const budget = currentBudgetMs();
    if (!(budget > 0)) {
      racePromise = null;
      settleRace = null;
      return;
    }
    racePromise = new Promise<TRace>((resolve) => {
      settleRace = resolve;
      timer = setTimeout(() => {
        timer = null;
        resolve(STALL);
      }, budget);
    });
  };

  const release = (): void => {
    released = true;
    clearTimer();
    const settle = settleRace;
    settleRace = null;
    racePromise = null;
    // Resolve any in-flight race so a late STALL is not observed as a stall.
    if (settle !== null) settle(RELEASED);
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
      if (racePromise === null) armTimer();
      const race = racePromise;
      let result: Awaited<typeof read> | TRace;
      try {
        result = race === null ? await read : await Promise.race([read, race]);
      } catch (err) {
        finished = true;
        clearTimer();
        throw err;
      }
      if (result === RELEASED || (result === STALL && released)) {
        // Commit raced the timer: wait for the outstanding read without stalling.
        result = await read;
      }
      if (result === STALL) {
        finished = true;
        clearTimer();
        reader.cancel(STALL_ABORT_REASON).catch(() => {});
        controller.error(
          new UpstreamStalledError("upstream stalled before producing output"),
        );
        return;
      }
      if (result.done) {
        finished = true;
        clearTimer();
        controller.close();
        return;
      }
      // Any enqueued chunk — including empty — counts as alive.
      sawByte = true;
      if (!released) {
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

/** Envelope used when a streaming headers / body wait stalls. */
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

/** Shared HTTP status for a pre-commit upstream stall (cloud + daemon). */
export const UPSTREAM_STALLED_HTTP_STATUS = 504;

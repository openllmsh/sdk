/**
 * `/v1/chat/completions` convenience on the client. Stream and non-stream both
 * use authenticated `request` so signal / headers / timeout behave the same and
 * the caller always gets a live `Response` (SSE body or JSON body).
 */

import type { TClientHttp } from "./http";

/** Default non-stream request ceiling — matches `openapi/call.ts` `REQUEST_TIMEOUT_MS`. */
export const DEFAULT_CHAT_TIMEOUT_MS = 120_000;

export type TChatCompletionCreateBody = {
  readonly model: string;
  readonly messages: ReadonlyArray<unknown>;
  readonly stream?: boolean;
  readonly [key: string]: unknown;
};

export type TChatCompletions = {
  /**
   * Create a chat completion. Always returns the raw `Response` — when
   * `body.stream === true` the body is an SSE stream; otherwise JSON.
   * Honours `signal` and merges `headers` via `Headers`.
   *
   * Timeouts:
   * - non-stream: `timeoutMs` defaults to {@link DEFAULT_CHAT_TIMEOUT_MS} and
   *   covers the whole request (headers + body), matching `callOperation`.
   * - stream: no default timeout (a long SSE must outlive 2 minutes). When the
   *   caller passes `timeoutMs`, it applies only until response headers /
   *   first byte arrive — never to the body. Matches the pre-SDK browser SSE
   *   and CLI `-p` paths, which passed only the caller's signal (or none).
   */
  readonly create: (
    body: TChatCompletionCreateBody,
    options?: {
      readonly signal?: AbortSignal;
      readonly headers?: HeadersInit;
      readonly timeoutMs?: number;
    },
  ) => Promise<Response>;
};

export type TClientChat = {
  readonly completions: TChatCompletions;
};

const mergeHeaders = (base: HeadersInit, extra?: HeadersInit): Headers => {
  const headers = new Headers(base);
  if (extra !== undefined) {
    new Headers(extra).forEach((value, key) => {
      headers.set(key, value);
    });
  }
  return headers;
};

type TResolvedRequestSignal = {
  readonly signal: AbortSignal | undefined;
  /** Clear a connect-only timer once headers have arrived (or the fetch failed). */
  readonly release: () => void;
};

/**
 * Build the fetch abort signal.
 * - non-stream: default {@link DEFAULT_CHAT_TIMEOUT_MS} on the whole request.
 * - stream: caller's signal only by default; optional `timeoutMs` is
 *   connect/first-byte only (released after `fetch` resolves).
 */
const resolveRequestSignal = (
  streaming: boolean,
  timeoutMs: number | undefined,
  caller: AbortSignal | undefined,
): TResolvedRequestSignal => {
  if (streaming) {
    if (timeoutMs === undefined) {
      return { signal: caller, release: (): void => {} };
    }
    // Connect/first-byte only: clear the timer once headers arrive so the SSE
    // body is never cut by timeoutMs. The caller's signal stays linked through
    // AbortSignal.any and can still abort the body after release().
    const connect = new AbortController();
    const timer = setTimeout((): void => {
      connect.abort(
        new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        ),
      );
    }, timeoutMs);
    const signal =
      caller !== undefined
        ? AbortSignal.any([caller, connect.signal])
        : connect.signal;
    return {
      signal,
      release: (): void => {
        clearTimeout(timer);
      },
    };
  }
  const timeout = AbortSignal.timeout(timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS);
  return {
    signal: caller !== undefined ? AbortSignal.any([caller, timeout]) : timeout,
    release: (): void => {},
  };
};

export const createClientChat = (http: TClientHttp): TClientChat => ({
  completions: {
    create: async (body, options = {}): Promise<Response> => {
      const streaming = body.stream === true;
      const { signal, release } = resolveRequestSignal(
        streaming,
        options.timeoutMs,
        options.signal,
      );
      try {
        const response = await http.request("/v1/chat/completions", {
          method: "POST",
          headers: mergeHeaders(
            {
              "content-type": "application/json",
              ...(streaming ? { accept: "text/event-stream" } : {}),
            },
            options.headers,
          ),
          body: JSON.stringify(body),
          ...(signal !== undefined ? { signal } : {}),
        });
        // Headers (and first byte for HTTP/1.1) are in — drop a stream
        // connect timeout so reading the SSE body is not aborted.
        release();
        return response;
      } catch (error) {
        release();
        throw error;
      }
    },
  },
});

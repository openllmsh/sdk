/**
 * `/v1/chat/completions` convenience on the client. Stream and non-stream both
 * use authenticated `request` so signal / headers / timeout behave the same and
 * the caller always gets a live `Response` (SSE body or JSON body).
 */

import type { TClientHttp } from "./http";

/** Default request ceiling — matches `openapi/call.ts` `REQUEST_TIMEOUT_MS`. */
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
   * Honours `signal`, merges `headers` via `Headers`, and applies
   * `timeoutMs` (default {@link DEFAULT_CHAT_TIMEOUT_MS}) on both paths.
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

const resolveSignal = (
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
): AbortSignal => {
  const timeout = AbortSignal.timeout(timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS);
  return signal !== undefined ? AbortSignal.any([signal, timeout]) : timeout;
};

export const createClientChat = (http: TClientHttp): TClientChat => ({
  completions: {
    create: async (body, options = {}): Promise<Response> => {
      const streaming = body.stream === true;
      return http.request("/v1/chat/completions", {
        method: "POST",
        headers: mergeHeaders(
          {
            "content-type": "application/json",
            ...(streaming ? { accept: "text/event-stream" } : {}),
          },
          options.headers,
        ),
        body: JSON.stringify(body),
        signal: resolveSignal(options.timeoutMs, options.signal),
      });
    },
  },
});

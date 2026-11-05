/**
 * `/v1/chat/completions` convenience on the client. Non-stream calls go
 * through `callOperation`; stream calls use authenticated `request` so the
 * SSE body stays a live ReadableStream.
 */

import type { TSdkResponse } from "@openllmsh/sdk/openapi";
import type { TClientHttp } from "./http";

export type TChatCompletionCreateBody = {
  readonly model: string;
  readonly messages: ReadonlyArray<unknown>;
  readonly stream?: boolean;
  readonly [key: string]: unknown;
};

export type TChatCompletions = {
  /**
   * Create a chat completion. When `body.stream === true`, returns the raw
   * `Response` (caller consumes SSE). Otherwise returns a parsed
   * `TSdkResponse` from `callOperation`.
   */
  readonly create: (
    body: TChatCompletionCreateBody,
    options?: {
      readonly signal?: AbortSignal;
      readonly headers?: HeadersInit;
      readonly timeoutMs?: number;
    },
  ) => Promise<Response | TSdkResponse>;
};

export type TClientChat = {
  readonly completions: TChatCompletions;
};

export const createClientChat = (http: TClientHttp): TClientChat => ({
  completions: {
    create: async (body, options = {}): Promise<Response | TSdkResponse> => {
      if (body.stream === true) {
        return http.request("/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "text/event-stream",
            ...(options.headers ?? {}),
          },
          body: JSON.stringify(body),
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        });
      }
      return http.call(
        "v1ChatCompletions.chatCompletions",
        { body },
        {
          ...(options.timeoutMs !== undefined
            ? { timeoutMs: options.timeoutMs }
            : {}),
        },
      );
    },
  },
});

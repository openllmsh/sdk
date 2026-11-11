/**
 * Client HTTP surface — one path through `openapi/call.ts` `callOperation`,
 * plus an authenticated raw `request` for streaming / non-operation URLs.
 */

import type {
  TApiOperation,
  THttpClientOptions,
  TSdkResponse,
} from "@openllmsh/sdk/openapi";
import { API_OPERATIONS, callOperation } from "@openllmsh/sdk/openapi";
import { canonicalApiOrigin } from "@openllmsh/sdk/protocol/canonical-origin";

export type TClientHttpOptions = {
  readonly origin: string;
  readonly apiKey: string;
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
};

export type TClientHttp = {
  /**
   * Typed OpenAPI call. `op` may be a `TApiOperation` or its `id`
   * (e.g. `v1ChatCompletions.chatCompletions`).
   */
  readonly call: (
    op: TApiOperation | string,
    args?: Record<string, unknown>,
    options?: THttpClientOptions,
  ) => Promise<TSdkResponse>;
  /**
   * Authenticated raw fetch against `origin`. `path` may be absolute under
   * the origin (`/v1/...`) or a full URL. Used for SSE streams and paths
   * that are not (yet) in the operations table.
   */
  readonly request: (path: string, init?: RequestInit) => Promise<Response>;
};

const resolveOp = (op: TApiOperation | string): TApiOperation => {
  if (typeof op !== "string") return op;
  const found = API_OPERATIONS.find((candidate) => candidate.id === op);
  if (found === undefined) {
    throw new Error(`unknown OpenAPI operation id "${op}"`);
  }
  return found;
};

export const createClientHttp = (options: TClientHttpOptions): TClientHttp => {
  const baseUrl = canonicalApiOrigin(options.origin);
  const config = { baseUrl, apiKey: options.apiKey };

  return {
    call: async (
      op: TApiOperation | string,
      args: Record<string, unknown> = {},
      callOptions: THttpClientOptions = {},
    ): Promise<TSdkResponse> =>
      callOperation(config, resolveOp(op), args, {
        ...callOptions,
        fetch: callOptions.fetch ?? options.fetch,
      }),
    request: (path: string, init: RequestInit = {}): Promise<Response> => {
      const url =
        path.startsWith("http://") || path.startsWith("https://")
          ? path
          : `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
      const headers = new Headers(init.headers);
      if (!headers.has("authorization") && options.apiKey.length > 0) {
        headers.set("authorization", `Bearer ${options.apiKey}`);
      }
      return options.fetch(url, { ...init, headers });
    },
  };
};

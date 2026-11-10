import type { TChatParams, TModelInfo } from "./chat";
import { chatTextStream } from "./chat";
import type { TConnectConfig } from "./config";
import { connectConfigFromEnv } from "./config";
import { errorFromResponse, OpenLLMError } from "./errors";
import type {
  TConnection,
  TPendingConnect,
  TStartConnectReturnType,
} from "./oauth";
import {
  fetchAsConnection,
  finishConnect,
  REFRESH_SKEW_MS,
  refreshConnection,
  startConnect,
} from "./oauth";
import type { TConnectionStore } from "./store";

export type CreateConnectParams = {
  /** Defaults to `connectConfigFromEnv()` (the `OPENLLM_*` variables). */
  readonly config?: TConnectConfig;
  readonly store: TConnectionStore;
};

/** One of your users, connected: call OpenLLM as them. */
export type TConnectedUser = {
  /** The OpenLLM user id. */
  readonly userId: string;
  /**
   * `fetch` against OpenLLM (`/v1/...`) with auth set and the token refreshed
   * and stored for you. Answers as-is, non-2xx included.
   */
  readonly fetch: (path: string, init?: RequestInit) => Promise<Response>;
  /** Like `fetch`, but throws `OpenLLMError` on non-2xx. */
  readonly request: (path: string, init?: RequestInit) => Promise<Response>;
  readonly chat: {
    /** Streamed reply as text deltas. */
    readonly stream: (
      params: TChatParams,
      init?: Pick<RequestInit, "signal">,
    ) => Promise<ReadableStream<string>>;
    /** The whole reply text. */
    readonly complete: (
      params: TChatParams,
      init?: Pick<RequestInit, "signal">,
    ) => Promise<string>;
  };
  /** Every model this account can run (`/v1/models`). */
  readonly models: () => Promise<readonly TModelInfo[]>;
  /** Revoke this connection on OpenLLM and forget it here. */
  readonly disconnect: () => Promise<void>;
};

export type TConnect = {
  readonly config: TConnectConfig;
  readonly store: TConnectionStore;
  /** Begin: redirect the browser to `url`, keep the rest until the callback. */
  readonly start: () => Promise<TStartConnectReturnType>;
  /**
   * The callback: exchange the code, open the key, store the connection under
   * `userKey`. A user who connected before keeps their stored key.
   */
  readonly finish: (input: {
    readonly userKey: string;
    readonly code: string;
    readonly pending: TPendingConnect;
    readonly state: string | null;
  }) => Promise<TConnectedUser>;
  /** The stored connection for `userKey`, or `null` when not connected. */
  readonly user: (userKey: string) => Promise<TConnectedUser | null>;
};

const JSON_HEADERS = { "content-type": "application/json" } as const;

export const createConnect = (params: CreateConnectParams): TConnect => {
  // `params.config` is read on first use too: a factory that reads env at
  // import time must not throw while the module is only being loaded.
  let configCache: TConnectConfig | undefined;
  const config = (): TConnectConfig => {
    configCache ??= params.config ?? connectConfigFromEnv();
    return configCache;
  };
  const { store } = params;

  // One refresh per user at a time: refresh tokens rotate on every use, and
  // two refreshes with the same token revoke the user's whole token family.
  // This serializes within one process; an app running several instances
  // should also serialize per user (a row lock around `store.save`).
  const refreshing = new Map<string, Promise<TConnection>>();
  const refreshOnce = (
    userKey: string,
    current: TConnection,
  ): Promise<TConnection> => {
    const inflight = refreshing.get(userKey);
    if (inflight) return inflight;
    const run = (async (): Promise<TConnection> => {
      // Another request may have refreshed and stored already.
      const latest = (await store.load(userKey)) ?? current;
      const next = await refreshConnection(config(), latest);
      if (next !== latest) await store.save(userKey, next);
      return next;
    })().finally(() => refreshing.delete(userKey));
    refreshing.set(userKey, run);
    return run;
  };

  // Only a revoked key is forgotten: any other refusal keeps the stored
  // connection, because its key can't be collected again.
  const forgetIfRevoked = async (
    userKey: string,
    err: unknown,
  ): Promise<void> => {
    if (err instanceof OpenLLMError && err.keyRevoked)
      await store.clear(userKey);
  };

  const bind = (userKey: string, initial: TConnection): TConnectedUser => {
    let current = initial;

    const fresh = async (): Promise<TConnection> => {
      if (current.expiresAt - Date.now() > REFRESH_SKEW_MS) return current;
      try {
        current = await refreshOnce(userKey, current);
        return current;
      } catch (err) {
        await forgetIfRevoked(userKey, err);
        throw err;
      }
    };

    const doFetch = async (
      path: string,
      init?: RequestInit,
    ): Promise<Response> =>
      fetchAsConnection(config(), await fresh(), path, init);

    const request = async (
      path: string,
      init?: RequestInit,
    ): Promise<Response> => {
      const res = await doFetch(path, init);
      if (res.ok) return res;
      const err = await errorFromResponse(res);
      await forgetIfRevoked(userKey, err);
      throw err;
    };

    const chatRequest = (
      body: TChatParams,
      stream: boolean,
      init?: Pick<RequestInit, "signal">,
    ): Promise<Response> =>
      request("/v1/chat/completions", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ ...body, stream }),
        signal: init?.signal,
      });

    return {
      get userId(): string {
        return current.userId;
      },
      fetch: doFetch,
      request,
      chat: {
        stream: async (body, init) => {
          const res = await chatRequest(body, true, init);
          if (!res.body)
            throw new OpenLLMError(
              502,
              "openllm_error",
              "OpenLLM sent no stream",
            );
          return chatTextStream(res.body);
        },
        complete: async (body, init) => {
          const res = await chatRequest(body, false, init);
          const json = (await res.json()) as {
            choices?: { message?: { content?: unknown } }[];
          };
          const content = json.choices?.[0]?.message?.content;
          return typeof content === "string" ? content : "";
        },
      },
      models: async () => {
        const res = await request("/v1/models");
        const json = (await res.json()) as { data?: TModelInfo[] };
        return json.data ?? [];
      },
      disconnect: async () => {
        try {
          const res = await doFetch("/api/connect/grants/revoke", {
            method: "POST",
          });
          if (!res.ok && res.status !== 404) {
            const err = await errorFromResponse(res);
            // Already gone on OpenLLM's side: nothing left to revoke.
            if (!err.needsReconnect) throw err;
          }
        } catch (err) {
          if (!(err instanceof OpenLLMError && err.needsReconnect)) throw err;
        } finally {
          await store.clear(userKey);
        }
      },
    };
  };

  return {
    get config(): TConnectConfig {
      return config();
    },
    store,
    start: () => startConnect(config()),
    finish: async ({ userKey, code, pending, state }) => {
      if (state === null || state !== pending.state)
        throw new OpenLLMError(
          400,
          "state_mismatch",
          "The callback state doesn't match",
        );
      const connection = await finishConnect(config(), {
        code,
        codeVerifier: pending.codeVerifier,
        previous: await store.load(userKey),
      });
      await store.save(userKey, connection);
      return bind(userKey, connection);
    },
    user: async (userKey) => {
      const stored = await store.load(userKey);
      return stored === null ? null : bind(userKey, stored);
    },
  };
};

/**
 * `@openllmsh/sdk/client` — thin, I/O-injected composition facade over the SDK
 * layers. Vault session and HTTP are live; device tunnel follows.
 */

import type { TClientChat } from "./chat";
import { createClientChat } from "./chat";
import type { TClientHttp } from "./http";
import { createClientHttp } from "./http";
import type { TCreateClientOptions } from "./types";
import type { TClientVault } from "./vault";
import { createClientVault } from "./vault";

export type {
  TChatCompletionCreateBody,
  TChatCompletions,
  TClientChat,
} from "./chat";
export { createClientChat } from "./chat";
export type { TClientHttp, TClientHttpOptions } from "./http";
export { createClientHttp } from "./http";
export type {
  TClientTransport,
  TCreateClientOptions,
  TRtcFactory,
  TWebSocketConstructor,
} from "./types";
export type {
  TClientVault,
  TCreateClientVaultOptions,
  TDekBorrow,
} from "./vault";
export { createClientVault } from "./vault";

export type TOpenllmClient = {
  readonly origin: string;
  readonly apiKey: string;
  readonly transport: TCreateClientOptions["transport"];
  readonly vault: TClientVault;
  readonly http: TClientHttp;
  readonly chat: TClientChat;
  /** Optional `dek_for_key` carried from create options for a later unlock. */
  readonly dekForKey: string | undefined;
  /** Zero vault material. Idempotent. */
  readonly close: () => void;
};

const normalizeOrigin = (origin: string): string => origin.replace(/\/+$/, "");

/**
 * Build a client. Sync on purpose — unwrapping a DEK from `dek_for_key` is
 * async and lives on `client.vault.unlockFromApiKey`. Hosts inject `fetch`,
 * `WebSocket`, and an optional RTC factory.
 */
export const createClient = (options: TCreateClientOptions): TOpenllmClient => {
  const origin = normalizeOrigin(options.origin);
  const vault = createClientVault({
    apiKey: options.apiKey,
    ...(options.dek !== undefined ? { dek: options.dek } : {}),
  });
  const http = createClientHttp({
    origin,
    apiKey: options.apiKey,
    fetch: options.transport.fetch,
  });
  const chat = createClientChat(http);

  return {
    origin,
    apiKey: options.apiKey,
    transport: options.transport,
    vault,
    http,
    chat,
    dekForKey: options.dekForKey,
    close: (): void => {
      vault.close();
    },
  };
};

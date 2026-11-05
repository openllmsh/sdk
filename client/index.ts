/**
 * `@openllmsh/sdk/client` — thin, I/O-injected composition facade over the SDK
 * layers. Vault session, HTTP, and device tunnel (mux ladder + relay-mux).
 */

import type { TClientChat } from "./chat";
import { createClientChat } from "./chat";
import type { TClientDevices, TClientDevicesHost } from "./devices";
import { createClientDevices } from "./devices";
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
export type {
  TClientDevice,
  TClientDevices,
  TClientDevicesHost,
  TMuxChannelState,
  TMuxPhase,
  TRelayMuxDependencies,
  TResolvedMuxChannel,
  TSessionLadderDeps,
} from "./devices";
export {
  clearMuxFailureForKey,
  clearMuxState,
  createClientDevices,
  dropChannelForKey,
  dropGrantlessMuxChannelForKey,
  failAllMuxChannels,
  getMuxChannelState,
  getOrOpenMuxChannel,
  isTransportFailure,
  muxChannelOpenedWithGrant,
  onRelayBinary,
  onRelayChannelAck,
  onRelayChannelClose,
  openOverMuxLadder,
  RTC_SESSION_OPEN_TIMEOUT_MS,
  SESSION_OPEN_TIMEOUT_MS,
  subscribeMuxState,
} from "./devices";
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
  /**
   * Device tunnel facade. Bound when `createClient` is given `devices` host
   * deps (relay send, grants, ladder resolution). Otherwise `open` throws.
   */
  readonly devices: TClientDevices;
  /** Optional `dek_for_key` carried from create options for a later unlock. */
  readonly dekForKey: string | undefined;
  /** Zero vault material. Idempotent. */
  readonly close: () => void;
};

const unboundDevices: TClientDevices = {
  open: (): never => {
    throw new Error(
      "createClient was not given devices host deps — pass options.devices",
    );
  },
};

const normalizeOrigin = (origin: string): string => origin.replace(/\/+$/, "");

/**
 * Build a client. Sync on purpose — unwrapping a DEK from `dek_for_key` is
 * async and lives on `client.vault.unlockFromApiKey`. Hosts inject `fetch`,
 * `WebSocket`, an optional RTC factory, and optional device-tunnel host deps.
 */
export const createClient = (
  options: TCreateClientOptions & {
    readonly devices?: TClientDevicesHost;
  },
): TOpenllmClient => {
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
  const devices =
    options.devices !== undefined
      ? createClientDevices(options.devices)
      : unboundDevices;

  return {
    origin,
    apiKey: options.apiKey,
    transport: options.transport,
    vault,
    http,
    chat,
    devices,
    dekForKey: options.dekForKey,
    close: (): void => {
      vault.close();
    },
  };
};

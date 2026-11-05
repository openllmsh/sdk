/**
 * Host-injected I/O seams for `@openllmsh/sdk/client`. The SDK stays sans-I/O;
 * browser hosts pass globals, CLI/daemon hosts pass Bun / werift equivalents.
 */

/** Minimal WebSocket constructor shape (browser `WebSocket` or a polyfill). */
export type TWebSocketConstructor = {
  new (url: string, protocols?: string | string[]): WebSocket;
  readonly CONNECTING: number;
  readonly OPEN: number;
  readonly CLOSING: number;
  readonly CLOSED: number;
};

/**
 * RTC peer-connection factory. Concrete options stay with the tunnel layer;
 * the client only needs a constructor-like callable the host supplies.
 */
export type TRtcFactory = (config?: RTCConfiguration) => RTCPeerConnection;

export type TClientTransport = {
  readonly fetch: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  readonly websocket: TWebSocketConstructor;
  readonly rtc?: TRtcFactory;
};

export type TCreateClientOptions = {
  /** Cloud origin, e.g. `https://openllm.sh`. Trailing slashes are stripped. */
  readonly origin: string;
  /**
   * `sk-llm-…` API key. May be empty while a CLI-auth claim is still opening
   * the sealed key; vault methods that need a DEK or key id then fail clearly.
   */
  readonly apiKey: string;
  readonly transport: TClientTransport;
  /**
   * Optional already-unwrapped DEK (browser host glue after PIN/passkey unlock).
   * The client copies the bytes and zeros its copy on {@link TOpenllmClient.close}.
   */
  readonly dek?: Uint8Array;
  /**
   * Optional `dek_for_key` column. When set with a valid `apiKey`, the vault
   * session unwraps the DEK during {@link import("./vault").TClientVault.unlockFromApiKey}
   * (callers invoke that explicitly — `createClient` stays sync).
   */
  readonly dekForKey?: string;
};

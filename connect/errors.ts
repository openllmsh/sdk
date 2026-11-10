/**
 * Every code OpenLLM answers a connected app with. The server owns them
 * (`packages/api/auth/connector-auth.ts`, `handlers/connect.ts`); this list is
 * what an app can branch on.
 */
export const CONNECT_ERROR_CODES = [
  // /v1 and revoke: the token + key pair was refused.
  "connector_auth",
  "connector_reconnect",
  "connector_opaque_token",
  "connector_unavailable",
  "rate_limited",
  // key pickup at the callback.
  "already_picked_up",
  "no_pending_grant",
  "grant_expired",
  "pkce_mismatch",
  "client_disabled",
  // token endpoint.
  "invalid_grant",
  // the SDK's own.
  "state_mismatch",
  "access_denied",
  "not_connected",
  "token_error",
  "token_expired",
  "openllm_error",
] as const;

export type TConnectErrorCode = (typeof CONNECT_ERROR_CODES)[number];

const RECONNECT: ReadonlySet<string> = new Set([
  "connector_reconnect",
  "connector_auth",
  "invalid_grant",
  "grant_expired",
  "no_pending_grant",
  "not_connected",
  "token_expired",
]);

const RETRYABLE: ReadonlySet<string> = new Set([
  "connector_unavailable",
  "rate_limited",
]);

/** OpenLLM said no; `code` says why. */
export class OpenLLMError extends Error {
  readonly status: number;
  /** A `TConnectErrorCode`, or a code a newer server added. */
  readonly code: string;
  /** Seconds to wait, when the server said (`retry-after`). */
  readonly retryAfter: number | null;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "OpenLLMError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }

  /**
   * Send the user through connect again. Keep the stored connection unless
   * `keyRevoked`: its `apiKey` can be collected only once, and reconnecting
   * an active grant keeps it and takes fresh tokens.
   */
  get needsReconnect(): boolean {
    return RECONNECT.has(this.code);
  }

  /**
   * OpenLLM revoked this connection's key (the user disconnected or reset
   * their vault): the stored connection is dead and safe to forget.
   */
  get keyRevoked(): boolean {
    return this.code === "connector_reconnect";
  }

  /** Try the same call again later (`retryAfter` seconds when known). */
  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }
}

export const isOpenLLMError = (value: unknown): value is OpenLLMError =>
  value instanceof OpenLLMError;

type TErrorBody = {
  readonly error?:
    | { readonly code?: string; readonly message?: string }
    | string;
  readonly error_description?: string;
};

/** Read an OpenLLM (or OAuth token endpoint) error response. */
export const errorFromResponse = async (
  res: Response,
): Promise<OpenLLMError> => {
  const body = (await res.json().catch(() => ({}))) as TErrorBody;
  const retry = Number(res.headers.get("retry-after"));
  const retryAfter = Number.isFinite(retry) && retry > 0 ? retry : null;
  if (typeof body.error === "string")
    return new OpenLLMError(
      res.status,
      body.error,
      body.error_description ?? `OpenLLM answered ${res.status}`,
      retryAfter,
    );
  return new OpenLLMError(
    res.status,
    body.error?.code ?? "openllm_error",
    body.error?.message ?? `OpenLLM answered ${res.status}`,
    retryAfter,
  );
};

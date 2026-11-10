import {
  fromB64,
  fromB64Url,
  toB64,
  toB64Url,
  zero,
} from "@openllmsh/sdk/vault/crypto";
import type { TConnectorSealed } from "@openllmsh/sdk/vault/public-key-seal";
import { openSealed } from "@openllmsh/sdk/vault/public-key-seal";
import type { TConnectConfig } from "./config";
import { errorFromResponse, OpenLLMError } from "./errors";

/** One user's connection. Store it per user; it is a credential. */
export type TConnection = {
  /** The OpenLLM user id (the token's `sub`). */
  readonly userId: string;
  /** The connection's own `sk-llm-…` key, sent as `X-OpenLLM-Key`. */
  readonly apiKey: string;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  /** Unix ms when `accessToken` expires (tokens live about an hour). */
  readonly expiresAt: number;
};

/** Kept between `start` and `finish` (a short-lived httpOnly cookie). */
export type TPendingConnect = {
  readonly state: string;
  readonly codeVerifier: string;
};

export type TStartConnectReturnType = TPendingConnect & {
  readonly url: string;
};

type TTokens = Pick<TConnection, "accessToken" | "refreshToken" | "expiresAt">;

/** Refresh this long before the access token expires. */
export const REFRESH_SKEW_MS = 60_000;

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);
const randomToken = (bytes: number): string =>
  toB64Url(crypto.getRandomValues(new Uint8Array(bytes)));

const jwtSub = (token: string): string => {
  const part = token.split(".")[1];
  if (part === undefined)
    throw new OpenLLMError(
      401,
      "connector_opaque_token",
      "The access token is not a JWT: send `resource` on authorize and token",
    );
  const json = new TextDecoder().decode(fromB64Url(part));
  const sub = (JSON.parse(json) as { sub?: unknown }).sub;
  if (typeof sub !== "string")
    throw new OpenLLMError(
      401,
      "connector_auth",
      "The access token has no sub",
    );
  return sub;
};

/**
 * Where to send the user, plus the `state` and `codeVerifier` to keep until the
 * callback. PKCE S256; `prompt=consent` so OpenLLM shows its consent screen,
 * which is where the user's key is made for you.
 */
export const startConnect = async (
  config: TConnectConfig,
): Promise<TStartConnectReturnType> => {
  const codeVerifier = randomToken(48);
  const challenge = toB64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", utf8(codeVerifier) as BufferSource),
    ),
  );
  const state = randomToken(24);
  const url = new URL(`${config.issuer}/oauth2/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "openid offline_access",
    resource: config.resource,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    prompt: "consent",
  }).toString();
  return { url: url.toString(), state, codeVerifier };
};

const tokenRequest = async (
  config: TConnectConfig,
  params: Record<string, string>,
): Promise<TTokens> => {
  const basic = btoa(
    `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`,
  );
  const res = await fetch(`${config.issuer}/oauth2/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({ ...params, resource: config.resource }),
  });
  if (!res.ok) throw await errorFromResponse(res);
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof body.access_token !== "string")
    throw new OpenLLMError(
      res.status,
      "token_error",
      "The token endpoint sent no access token",
    );
  return {
    accessToken: body.access_token,
    refreshToken:
      typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresAt:
      Date.now() +
      (typeof body.expires_in === "number" ? body.expires_in : 3600) * 1000,
  };
};

const importPrivateKey = async (
  pkcs8B64: string,
): Promise<{ privateKey: CryptoKey; publicKeyB64: string }> => {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    fromB64(pkcs8B64) as BufferSource,
    { name: "X25519" },
    true,
    ["deriveBits"],
  );
  // The recipient public key (base64 SPKI, as OpenLLM holds it) is bound
  // into the seal's HKDF info, so derive it from the private key.
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x },
    { name: "X25519" },
    true,
    [],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", publicKey));
  return { privateKey, publicKeyB64: toB64(spki) };
};

/** Open the sealed key OpenLLM made for this connection. */
export const openConnectionKey = async (input: {
  readonly config: Pick<TConnectConfig, "clientId" | "privateKey">;
  readonly sealed: TConnectorSealed;
  readonly userId: string;
  readonly grantId: string;
}): Promise<string> => {
  const { privateKey, publicKeyB64 } = await importPrivateKey(
    input.config.privateKey,
  );
  const plain = await openSealed(
    {
      clientId: input.config.clientId,
      userId: input.userId,
      grantId: input.grantId,
      recipientPublicKeyB64: publicKeyB64,
    },
    input.sealed,
    privateKey,
  );
  try {
    return new TextDecoder().decode(plain);
  } finally {
    zero(plain);
  }
};

/**
 * Exchange the callback's `code`, collect the connection's key (once) and open
 * it. When the user was already connected the key can't be collected again:
 * pass `previous` (the connection you stored for them) and it is kept with the
 * fresh tokens. Without a matching `previous` that throws `already_picked_up`.
 */
export const finishConnect = async (
  config: TConnectConfig,
  input: {
    readonly code: string;
    readonly codeVerifier: string;
    readonly previous?: TConnection | null;
  },
): Promise<TConnection> => {
  const tokens = await tokenRequest(config, {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: config.redirectUri,
    code_verifier: input.codeVerifier,
  });
  const userId = jwtSub(tokens.accessToken);
  const res = await fetch(`${config.apiOrigin}/api/connect/grants/pickup`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokens.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ code_verifier: input.codeVerifier }),
  });
  if (!res.ok) {
    const err = await errorFromResponse(res);
    const previous = input.previous;
    if (
      err.code === "already_picked_up" &&
      previous &&
      previous.userId === userId
    )
      return { ...previous, ...tokens };
    throw err;
  }
  const picked = (await res.json()) as { sealed: string; grant_id: string };
  const apiKey = await openConnectionKey({
    config,
    sealed: JSON.parse(picked.sealed) as TConnectorSealed,
    userId,
    grantId: picked.grant_id,
  });
  return { userId, apiKey, ...tokens };
};

/** The connection with a fresh access token (refreshed a minute early). */
export const refreshConnection = async (
  config: TConnectConfig,
  connection: TConnection,
): Promise<TConnection> => {
  if (connection.expiresAt - Date.now() > REFRESH_SKEW_MS) return connection;
  if (connection.refreshToken === null)
    throw new OpenLLMError(
      401,
      "connector_reconnect",
      "The access token expired and there is no refresh token: connect again",
    );
  const tokens = await tokenRequest(config, {
    grant_type: "refresh_token",
    refresh_token: connection.refreshToken,
  });
  return {
    ...connection,
    ...tokens,
    refreshToken: tokens.refreshToken ?? connection.refreshToken,
  };
};

/** `fetch` against OpenLLM as this connection; both auth headers set. */
export const fetchAsConnection = (
  config: Pick<TConnectConfig, "apiOrigin">,
  connection: Pick<TConnection, "accessToken" | "apiKey">,
  path: string,
  init: RequestInit = {},
): Promise<Response> => {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${connection.accessToken}`);
  headers.set("x-openllm-key", connection.apiKey);
  return fetch(`${config.apiOrigin}${path}`, { ...init, headers });
};

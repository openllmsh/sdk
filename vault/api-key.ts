import {
  isOpenllmApiKeySyntax,
  OPENLLM_API_KEY_ID_BYTES,
  OPENLLM_API_KEY_PREFIX,
  OPENLLM_API_KEY_SECRET_BYTES,
} from "@openllmsh/sdk/protocol";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  fromB64,
  fromB64Url,
  hkdfSha256,
  randomBytes,
  toB64,
  toB64Url,
} from "./crypto";
import { sealVaultText } from "./vault-item";
import { joinSealed, splitSealed } from "./wrapped";

const DEK_BYTES = 32;
const HKDF_INFO = "api-key-v1";
const NONCE_BYTES = 12;

export { OPENLLM_API_KEY_PREFIX as API_KEY_PREFIX };

/**
 * `sk-llm-{id}.{secret}` parser. The id is the api_keys row primary
 * key (base64url, no padding); the secret is 32 random bytes
 * base64url-encoded. Returns null on any shape mismatch — the proxy
 * auth path treats null as "no key supplied".
 */
export const parseApiKey = (
  raw: string,
): { readonly id: string; readonly secret: Uint8Array } | null => {
  if (!isOpenllmApiKeySyntax(raw)) return null;
  const rest = raw.slice(OPENLLM_API_KEY_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot <= 0 || dot === rest.length - 1) return null;
  const id = rest.slice(0, dot);
  try {
    const secret = fromB64Url(rest.slice(dot + 1));
    if (secret.length !== OPENLLM_API_KEY_SECRET_BYTES) return null;
    return { id, secret };
  } catch {
    return null;
  }
};

/**
 * Derive the per-key AES wrap key from the secret half of the
 * `sk-llm-...` token. Same on both sides of the handshake — the
 * browser uses it to wrap the DEK at mint time, the server uses it
 * to unwrap on every request.
 */
export const deriveApiWrapKey = (
  apiKeySecret: Uint8Array,
  apiKeyId: string,
): Promise<Uint8Array> => {
  return hkdfSha256(apiKeySecret, fromB64Url(apiKeyId), HKDF_INFO, 32);
};

/**
 * Unwrap a `dek_for_key` row column. The stored layout is
 * `IV (12) || ciphertext+tag`, base64-encoded.
 *
 * Unversioned on purpose, unlike the phrase and PIN wraps: this key comes from
 * HKDF over the API-key secret, which has no cost parameters to re-tune, so
 * there is nothing a stamp could ever select between.
 */
export const unwrapDekForKey = async (
  dekForKeyB64: string,
  apiWrapKey: Uint8Array,
): Promise<Uint8Array> => {
  const { nonce, ciphertext } = splitSealed(
    fromB64(dekForKeyB64),
    "dek_for_key blob",
  );
  const dek = await aesGcmDecrypt(apiWrapKey, nonce, ciphertext);
  // This runs on the proxy hot path for every `/v1/*` request. A DEK of the
  // wrong size would otherwise surface several frames later as an opaque
  // WebCrypto key-length error on whichever credential happened to decrypt first.
  if (dek.length !== DEK_BYTES) {
    dek.fill(0);
    throw new Error("dek_for_key did not contain a 32-byte key");
  }
  return dek;
};

export type TMintedApiKey = {
  /** Body for `POST /api/keys` — server persists row keyed by id. */
  readonly row: {
    readonly id: string;
    readonly dek_for_key: string;
    readonly secret_ciphertext: string;
    readonly secret_nonce: string;
    readonly vault_version: number;
  };
  /**
   * The `sk-llm-{id}.{secret}` string shown ONCE. The server never
   * sees this in plaintext; an AES-GCM(sk-llm, DEK) copy ships with
   * the row so the dashboard can re-display it when the vault is
   * unlocked.
   */
  readonly sk_llm: string;
};

const newApiKeyId = (): string =>
  toB64Url(randomBytes(OPENLLM_API_KEY_ID_BYTES));

/**
 * Mint a new API key client-side. The browser:
 *   1. picks `(api_key_id, api_key_secret)`,
 *   2. derives `api_wrap_key = HKDF(secret, id)`,
 *   3. wraps the user's DEK under it,
 *   4. ALSO encrypts the full sk-llm string under the user's DEK so
 *      the dashboard can re-display it when unlocked,
 *   5. POSTs `{ id, dek_for_key, secret_ciphertext, secret_nonce,
 *      vault_version }` to `/api/keys`,
 *   6. shows `sk-llm-{id}.{secret_b64url}` once.
 */
export const mintApiKey = async (
  dek: Uint8Array,
  vaultVersion: number,
): Promise<TMintedApiKey> => {
  const apiKeyId = newApiKeyId();
  const apiKeySecret = randomBytes(OPENLLM_API_KEY_SECRET_BYTES);
  const wrapKey = await deriveApiWrapKey(apiKeySecret, apiKeyId);
  try {
    const nonce = randomBytes(NONCE_BYTES);
    const ct = await aesGcmEncrypt(wrapKey, nonce, dek);
    const dekForKey = joinSealed(nonce, ct);
    const skLlm = `${OPENLLM_API_KEY_PREFIX}${apiKeyId}.${toB64Url(apiKeySecret)}`;
    // Wrap the full token under the `keys` branch so the dashboard can
    // re-display it later. Distinct from `dek_for_key` (still under the
    // API-key wrap key — the server needs the root).
    const sealedSecret = await sealVaultText(dek, { branch: "keys" }, skLlm);
    return {
      row: {
        id: apiKeyId,
        dek_for_key: toB64(dekForKey),
        secret_ciphertext: sealedSecret.ciphertext,
        secret_nonce: sealedSecret.nonce,
        vault_version: vaultVersion,
      },
      sk_llm: skLlm,
    };
  } finally {
    wrapKey.fill(0);
  }
};

/** The secret columns of an `api_keys` row re-wrapped under a new DEK. */
export type TRewrappedApiKey = {
  readonly dek_for_key: string;
  readonly secret_ciphertext: string;
  readonly secret_nonce: string;
};

/**
 * Re-wrap an existing API key for a new DEK (the seed-only vault's one-time
 * migration, docs/plans/seed-only-vault.md). The browser opens the key's
 * `secret_ciphertext` with the OLD DEK to get the `sk-llm` token, then calls
 * this with the NEW DEK: the token itself is unchanged, so every daemon and
 * client holding it keeps working. Never zeroes its inputs.
 */
export const rewrapApiKey = async (
  skLlm: string,
  newDek: Uint8Array,
): Promise<TRewrappedApiKey> => {
  if (newDek.length !== DEK_BYTES) throw new Error("DEK must be 32 bytes");
  const parsed = parseApiKey(skLlm);
  if (parsed === null) throw new Error("not an OpenLLM API key");
  const wrapKey = await deriveApiWrapKey(parsed.secret, parsed.id);
  try {
    const nonce = randomBytes(NONCE_BYTES);
    const dekForKey = joinSealed(
      nonce,
      await aesGcmEncrypt(wrapKey, nonce, newDek),
    );
    const sealedSecret = await sealVaultText(newDek, { branch: "keys" }, skLlm);
    return {
      dek_for_key: toB64(dekForKey),
      secret_ciphertext: sealedSecret.ciphertext,
      secret_nonce: sealedSecret.nonce,
    };
  } finally {
    wrapKey.fill(0);
    parsed.secret.fill(0);
  }
};

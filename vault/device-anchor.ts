/**
 * Browser side of the device trust anchor (`@openllmsh/sdk/tunnel`
 * `device-anchor.ts` holds the wire formats; the daemon computes the same
 * values with node:crypto).
 *
 * Everything here starts from the account control SEED
 * (`./device-control.ts`, phrase-derived — never the DEK), so a compromised
 * cloud can compute none of it:
 *
 * - {@link deriveDevicePairSecret} — `HKDF-SHA256(seed, utf8(key_id),
 *   "openllm-pair-v1", 32)`; one secret per API key.
 * - {@link buildDeviceAnchor} / {@link buildAnchoredApiKey} — the
 *   `sk-llm-<id>.<secret>.<anchor>` string the install / setup command
 *   carries. The anchor never leaves the device it is pasted on.
 * - {@link verifyDpkProof} — check the `device_sessions.dpk_proof` a daemon
 *   publishes before trusting its `pubkey` (`dpk`) for grants, Noise or RTC.
 * - {@link signDeviceSessionsDisable} — the control-signed remote DISABLE
 *   (`set_device_sessions`). Sets `OPENLLM_DEVICE_SESSIONS=0`; the trust
 *   anchor stays. There is no remote enable — turn sessions back on with
 *   `openllm daemon device enable`, the desktop loopback flag flip, or
 *   install / update / login when there is no anchor yet.
 */
import type { TDeviceSessionsDisableFields } from "@openllmsh/sdk/tunnel";
import {
  buildDeviceSessionsDisableMessage,
  buildDpkProofMessage,
  DEVICE_PAIR_HKDF_INFO,
  DEVICE_SESSIONS_DISABLE_VERSION,
  encodeDeviceAnchor,
  encodeDeviceSessionsDisable,
  isDpkProofSyntax,
} from "@openllmsh/sdk/tunnel";
import { parseApiKey } from "./api-key";
import { fromB64Url, hkdfSha256, randomBytes, toB64Url, zero } from "./crypto";
import {
  deviceAccessPublicKeySpkiB64,
  rawFromSpkiB64,
  signDeviceGrant,
} from "./device-access";

const PAIR_SECRET_BYTES = 32;
const COMMAND_NONCE_BYTES = 16;

const subtle = (): SubtleCrypto => globalThis.crypto.subtle;

const requireKeyId = (keyId: string): void => {
  if (keyId.length === 0) throw new Error("device anchor requires a key_id");
};

/**
 * The per-key pair secret: `HKDF-SHA256(ikm = control seed, salt =
 * utf8(key_id), info = "openllm-pair-v1", 32)`. Caller zeroes it.
 */
export const deriveDevicePairSecret = (
  seed: Uint8Array,
  keyId: string,
): Promise<Uint8Array> => {
  requireKeyId(keyId);
  return hkdfSha256(
    seed,
    new TextEncoder().encode(keyId),
    DEVICE_PAIR_HKDF_INFO,
    PAIR_SECRET_BYTES,
  );
};

/** The anchor for `keyId`: base64url(control pubkey raw || pair secret). */
export const buildDeviceAnchor = async (
  seed: Uint8Array,
  keyId: string,
): Promise<string> => {
  const raw = rawFromSpkiB64(await deviceAccessPublicKeySpkiB64(seed));
  if (raw === null) throw new Error("control public key is malformed");
  const pairSecret = await deriveDevicePairSecret(seed, keyId);
  try {
    return encodeDeviceAnchor(raw, pairSecret);
  } finally {
    zero(pairSecret);
  }
};

/**
 * `sk-llm-<id>.<secret>.<anchor>` for a full plaintext key. Build it locally
 * and put it ONLY in a command the user copies (install / `openllm login`);
 * never send it to the cloud, store it, or show it in a key listing.
 */
export const buildAnchoredApiKey = async (
  apiKey: string,
  seed: Uint8Array,
): Promise<string> => {
  const parsed = parseApiKey(apiKey);
  if (parsed === null) throw new Error("not a full sk-llm API key");
  zero(parsed.secret);
  return `${apiKey}.${await buildDeviceAnchor(seed, parsed.id)}`;
};

const hmacKey = (secret: Uint8Array): Promise<CryptoKey> =>
  subtle().importKey(
    "raw",
    secret.slice() as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

/** `HMAC-SHA256(pairSecret, buildDpkProofMessage(keyId, dpk))`, base64url. */
export const computeDpkProof = async (
  pairSecret: Uint8Array,
  keyId: string,
  dpk: string,
): Promise<string> => {
  const key = await hmacKey(pairSecret);
  const mac = await subtle().sign(
    "HMAC",
    key,
    buildDpkProofMessage(keyId, dpk) as BufferSource,
  );
  return toB64Url(new Uint8Array(mac));
};

export type TVerifyDpkProofParams = {
  /** This browser's control seed. */
  readonly seed: Uint8Array;
  /** The api key row the daemon runs on (the grant `key_id`). */
  readonly keyId: string;
  /** `DaemonStatus.pubkey` as received. */
  readonly dpk: string;
  /** `DaemonStatus.device_sessions.dpk_proof` as received. */
  readonly proof: string;
};

/**
 * True only when the daemon holding the anchor for `keyId` vouched for `dpk`.
 * Constant-time (WebCrypto HMAC verify). Never throws.
 */
export const verifyDpkProof = async (
  params: TVerifyDpkProofParams,
): Promise<boolean> => {
  if (params.keyId.length === 0 || params.dpk.length === 0) return false;
  if (!isDpkProofSyntax(params.proof)) return false;
  let pairSecret: Uint8Array | null = null;
  try {
    pairSecret = await deriveDevicePairSecret(params.seed, params.keyId);
    const key = await hmacKey(pairSecret);
    const mac = fromB64Url(params.proof);
    return await subtle().verify(
      "HMAC",
      key,
      mac as BufferSource,
      buildDpkProofMessage(params.keyId, params.dpk) as BufferSource,
    );
  } catch {
    return false;
  } finally {
    if (pairSecret !== null) zero(pairSecret);
  }
};

export type TSignDeviceSessionsDisableParams = {
  readonly keyId: string;
  /** Defaults to `Date.now()`. */
  readonly ts?: number;
  /** Defaults to 16 random bytes, base64url. */
  readonly nonce?: string;
};

/**
 * Sign `{ v: 1, key_id, ts, nonce }` with the control seed. Returns the base64
 * envelope for the `set_device_sessions` command payload (disable-only).
 */
export const signDeviceSessionsDisable = async (
  seed: Uint8Array,
  params: TSignDeviceSessionsDisableParams,
): Promise<string> => {
  requireKeyId(params.keyId);
  const fields: TDeviceSessionsDisableFields = {
    v: DEVICE_SESSIONS_DISABLE_VERSION,
    key_id: params.keyId,
    ts: params.ts ?? Date.now(),
    nonce: params.nonce ?? toB64Url(randomBytes(COMMAND_NONCE_BYTES)),
  };
  const sig = await signDeviceGrant(
    seed,
    buildDeviceSessionsDisableMessage(fields),
  );
  return encodeDeviceSessionsDisable({ ...fields, sig });
};

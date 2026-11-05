/**
 * Ed25519 primitives for device grants: SPKI encoding plus sign / verify.
 * The SIGNING seed is the account device-control key
 * (`./device-control.ts`), derived from the recovery phrase — never from the
 * DEK, which the cloud can unwrap from `dek_for_key` on any `sk-llm` request.
 * Pure bytes-in/bytes-out — runs identically in the browser, Bun, and Node
 * (mirrors `crypto.ts` style).
 *
 * `@noble/ed25519` v3 `*Async` functions use WebCrypto SHA-512
 * automatically (`crypto.subtle.digest`) — no `hashes.sha512` wiring
 * is needed as long as we stay on the async API.
 */
import { getPublicKeyAsync, signAsync, verifyAsync } from "@noble/ed25519";
import { fromB64, toB64 } from "./crypto";

/**
 * DER SPKI prefix for an Ed25519 public key
 * (SEQUENCE > AlgorithmIdentifier(id-Ed25519) > BIT STRING header).
 */
export const ED25519_SPKI_PREFIX: Uint8Array = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

const ED25519_RAW_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;
const ED25519_SPKI_B64_LENGTH = 60;
const ED25519_SIGNATURE_B64_LENGTH = 88;

/** Ed25519 public key as base64(SPKI DER) — importable by node:crypto. */
export const deviceAccessPublicKeySpkiB64 = async (
  seed: Uint8Array,
): Promise<string> => {
  const raw = await getPublicKeyAsync(seed);
  const spki = new Uint8Array(ED25519_SPKI_PREFIX.length + raw.length);
  spki.set(ED25519_SPKI_PREFIX, 0);
  spki.set(raw, ED25519_SPKI_PREFIX.length);
  return toB64(spki);
};

/** Extract the 32-byte raw key from base64(SPKI DER); null if malformed. */
export const rawFromSpkiB64 = (spkiB64: string): Uint8Array | null => {
  if (spkiB64.length > ED25519_SPKI_B64_LENGTH) return null;
  let spki: Uint8Array;
  try {
    spki = fromB64(spkiB64);
  } catch {
    return null;
  }
  if (spki.length !== ED25519_SPKI_PREFIX.length + ED25519_RAW_KEY_BYTES) {
    return null;
  }
  for (let i = 0; i < ED25519_SPKI_PREFIX.length; i++) {
    if (spki[i] !== ED25519_SPKI_PREFIX[i]) return null;
  }
  return spki.slice(ED25519_SPKI_PREFIX.length);
};

/** Sign canonical device-grant bytes; returns base64 signature. */
export const signDeviceGrant = async (
  seed: Uint8Array,
  message: Uint8Array,
): Promise<string> => {
  return toB64(await signAsync(message, seed));
};

/**
 * Verify a device-grant signature against a base64(SPKI) public key.
 * Returns false on ANY failure (malformed key, bad base64, noble
 * throw) — never throws.
 */
export const verifyDeviceGrant = async (
  pubSpkiB64: string,
  message: Uint8Array,
  sigB64: string,
): Promise<boolean> => {
  const raw = rawFromSpkiB64(pubSpkiB64);
  if (raw === null || sigB64.length > ED25519_SIGNATURE_B64_LENGTH) {
    return false;
  }
  try {
    const signature = fromB64(sigB64);
    if (signature.length !== ED25519_SIGNATURE_BYTES) return false;
    return await verifyAsync(signature, message, raw);
  } catch {
    return false;
  }
};

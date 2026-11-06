import {
  CURRENT_KDF_VERSION,
  deriveWrapKey,
  requireKdfVersion,
} from "./argon2";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  fromB64,
  randomBytes,
  toB64,
  zero,
} from "./crypto";
import { decodeKdfWrapped, encodeKdfWrapped } from "./wrapped";

const PIN_SALT_BYTES = 16;
const PIN_NONCE_BYTES = 12;
const DEK_BYTES = 32;

/**
 * Client-only PIN layer that wraps the DEK for `localStorage` storage,
 * so users don't have to retype their recovery phrase every tab. The
 * server never sees the PIN or the PIN-wrapped blob — losing the PIN
 * is recoverable by re-running `unlockDek` with the recovery phrase
 * and calling `wrapDekWithPin` with a fresh PIN.
 *
 * Reuses the same Argon2id params as the phrase path (`./argon2.ts`), and
 * carries the same version stamp in `wrapped_b64` (`./wrapped.ts`) for the
 * same reason: PINs have a tiny keyspace (10K / 1M for 4 / 6 digits), so KDF
 * cost is the only meaningful brute-force defense — and a KDF cost that can
 * never be raised without destroying every blob is one that can never be
 * raised at all.
 */
export type TPinWrappedDek = {
  readonly pin_salt_b64: string;
  /** `v<n>:<base64>` — see `./wrapped.ts`. Not plain base64. */
  readonly wrapped_b64: string;
};

/**
 * Strip everything that isn't an ASCII digit. Mirrors
 * `normalizePhrase` discipline — UI inputs don't need to pre-clean.
 */
export const normalizePin = (input: string): string => {
  return input.replace(/\D/g, "");
};

export const wrapDekWithPin = async (
  dek: Uint8Array,
  pin: string,
): Promise<TPinWrappedDek> => {
  const pinSalt = randomBytes(PIN_SALT_BYTES);
  const pinKey = await deriveWrapKey(normalizePin(pin), pinSalt);
  try {
    const nonce = randomBytes(PIN_NONCE_BYTES);
    const ciphertext = await aesGcmEncrypt(pinKey, nonce, dek);
    return {
      pin_salt_b64: toB64(pinSalt),
      wrapped_b64: encodeKdfWrapped(nonce, ciphertext),
    };
  } finally {
    zero(pinKey);
  }
};

export const unwrapDekWithPin = async (
  blob: TPinWrappedDek,
  pin: string,
): Promise<Uint8Array> => {
  const pinSalt = fromB64(blob.pin_salt_b64);
  const decoded = decodeKdfWrapped(blob.wrapped_b64, "pin blob");
  const version = requireKdfVersion(decoded.version);
  const pinKey = await deriveWrapKey(normalizePin(pin), pinSalt, version);
  try {
    const dek = await aesGcmDecrypt(pinKey, decoded.nonce, decoded.ciphertext);
    if (dek.length !== DEK_BYTES) {
      zero(dek);
      throw new Error("pin blob did not contain a 32-byte key");
    }
    return dek;
  } finally {
    zero(pinKey);
  }
};

/**
 * `true` when a blob is wrapped under KDF parameters older than the current
 * ones — the caller holds a live DEK and can re-wrap it under the same PIN to
 * upgrade the blob in place.
 *
 * Cheap to act on and worth acting on: unlike the server-side `wrapped_dek`,
 * the PIN blob is entirely client-owned, so a raised KDF cost reaches an
 * existing device on its next unlock instead of waiting for a rotation.
 */
export const pinBlobNeedsRewrap = (blob: TPinWrappedDek): boolean =>
  decodeKdfWrapped(blob.wrapped_b64, "pin blob").version < CURRENT_KDF_VERSION;

/**
 * The vault seed under a PIN — this browser's PIN unlock in the seed-only
 * vault (docs/plans/seed-only-vault.md). Same Argon2id cost and version stamp
 * as the DEK blob; the AAD keeps a seed blob and a DEK blob from ever being
 * passed off as each other.
 */
export type TPinWrappedSeed = TPinWrappedDek;

const PIN_SEED_AAD = new TextEncoder().encode("openllm-vault-seed-pin-v1");
const SEED_BYTES = 16;

export const wrapSeedWithPin = async (
  seed: Uint8Array,
  pin: string,
): Promise<TPinWrappedSeed> => {
  if (seed.length !== SEED_BYTES)
    throw new Error("vault seed must be 16 bytes");
  const pinSalt = randomBytes(PIN_SALT_BYTES);
  const pinKey = await deriveWrapKey(normalizePin(pin), pinSalt);
  try {
    const nonce = randomBytes(PIN_NONCE_BYTES);
    const ciphertext = await aesGcmEncrypt(pinKey, nonce, seed, PIN_SEED_AAD);
    return {
      pin_salt_b64: toB64(pinSalt),
      wrapped_b64: encodeKdfWrapped(nonce, ciphertext),
    };
  } finally {
    zero(pinKey);
  }
};

/** Throws on a wrong PIN (auth tag) or a blob that isn't a seed blob. */
export const unwrapSeedWithPin = async (
  blob: TPinWrappedSeed,
  pin: string,
): Promise<Uint8Array> => {
  const pinSalt = fromB64(blob.pin_salt_b64);
  const decoded = decodeKdfWrapped(blob.wrapped_b64, "pin seed blob");
  const version = requireKdfVersion(decoded.version);
  const pinKey = await deriveWrapKey(normalizePin(pin), pinSalt, version);
  try {
    const seed = await aesGcmDecrypt(
      pinKey,
      decoded.nonce,
      decoded.ciphertext,
      PIN_SEED_AAD,
    );
    if (seed.length !== SEED_BYTES) {
      zero(seed);
      throw new Error("pin seed blob did not contain a vault seed");
    }
    return seed;
  } finally {
    zero(pinKey);
  }
};

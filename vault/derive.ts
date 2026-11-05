import { deriveWrapKey, requireKdfVersion } from "./argon2";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  fromB64,
  randomBytes,
  toB64,
  zero,
} from "./crypto";
import { normalizePhrase } from "./phrase";
import { decodeKdfWrapped, encodeKdfWrapped } from "./wrapped";

const WRAP_NONCE_BYTES = 12;
const WRAP_SALT_BYTES = 16;
const DEK_BYTES = 32;

export type TInitialVault = {
  readonly dek: Uint8Array;
  readonly wrap_salt_b64: string;
  /** `v<n>:<base64>` — see `./wrapped.ts`. Not plain base64. */
  readonly wrapped_dek: string;
};

/**
 * Build a fresh vault from a recovery phrase. Runs the full
 * Argon2id + AES-GCM-wrap pipeline; intended for the vault
 * dialogs' commit + reset-begin transitions. Caller keeps the returned
 * `dek` in memory and POSTs the two base64 fields to
 * `/api/vault/{commit,reset/begin}`.
 */
export const buildVault = async (phrase: string): Promise<TInitialVault> => {
  const wrapSalt = randomBytes(WRAP_SALT_BYTES);
  const dek = randomBytes(DEK_BYTES);
  const wrapKey = await deriveWrapKey(normalizePhrase(phrase), wrapSalt);
  try {
    const nonce = randomBytes(WRAP_NONCE_BYTES);
    const ciphertext = await aesGcmEncrypt(wrapKey, nonce, dek);
    return {
      dek,
      wrap_salt_b64: toB64(wrapSalt),
      wrapped_dek: encodeKdfWrapped(nonce, ciphertext),
    };
  } finally {
    zero(wrapKey);
  }
};

/**
 * Stage 2 variant — called after `/api/vault/begin` has already
 * persisted `wrap_salt`. We need the same `wrap_salt` (so wrap_key
 * is stable across the two steps) but produce a fresh DEK and
 * wrapped_dek for `/api/vault/commit`.
 */
export const buildVaultWithSalt = async (
  phrase: string,
  wrapSaltB64: string,
): Promise<{
  readonly dek: Uint8Array;
  readonly wrapped_dek: string;
}> => {
  const wrapSalt = fromB64(wrapSaltB64);
  const dek = randomBytes(DEK_BYTES);
  const wrapKey = await deriveWrapKey(normalizePhrase(phrase), wrapSalt);
  try {
    const nonce = randomBytes(WRAP_NONCE_BYTES);
    const ciphertext = await aesGcmEncrypt(wrapKey, nonce, dek);
    return {
      dek,
      wrapped_dek: encodeKdfWrapped(nonce, ciphertext),
    };
  } finally {
    zero(wrapKey);
  }
};

/**
 * Unlock an existing vault — used on every page that needs to add
 * credentials or mint API keys. Returns the DEK in memory; the
 * caller is responsible for `zero()`-ing it on logout / page unload.
 *
 * The KDF version comes from the BLOB, never from what this build considers
 * current — deriving an old wrap with new parameters produces a key that
 * fails the auth tag, which the UI can only report as "wrong phrase".
 */
export const unlockDek = async (
  phrase: string,
  wrapSaltB64: string,
  wrappedDekB64: string,
): Promise<Uint8Array> => {
  const wrapSalt = fromB64(wrapSaltB64);
  const decoded = decodeKdfWrapped(wrappedDekB64, "wrapped_dek");
  // Throws on a version this build doesn't know, BEFORE spending ~64 MiB and
  // a second of Argon2id on parameters that cannot be right.
  const version = requireKdfVersion(decoded.version);
  const wrapKey = await deriveWrapKey(
    normalizePhrase(phrase),
    wrapSalt,
    version,
  );
  try {
    const dek = await aesGcmDecrypt(wrapKey, decoded.nonce, decoded.ciphertext);
    // A wrong phrase fails the auth tag above, so reaching here with the wrong
    // length means the blob itself is malformed. Saying so beats letting the
    // first AES call downstream throw about a key size nobody chose.
    if (dek.length !== DEK_BYTES) {
      zero(dek);
      throw new Error("wrapped_dek did not contain a 32-byte key");
    }
    return dek;
  } finally {
    zero(wrapKey);
  }
};

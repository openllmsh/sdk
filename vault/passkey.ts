import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  fromB64,
  hkdfSha256,
  randomBytes,
  toB64,
  zero,
} from "./crypto";
import { joinSealed, splitSealed } from "./wrapped";

/**
 * The third DEK wrapper, beside the recovery phrase (`./derive.ts`) and the PIN
 * (`./pin.ts`): a passkey's WebAuthn PRF output.
 *
 * Pure bytes-in/bytes-out, like every other module here — no WebAuthn import.
 * The ceremony that PRODUCES the PRF output is browser glue
 * (`lib/vault/passkey-ceremony.ts`); this file only turns 32 bytes the
 * authenticator returned into a wrap key and seals the DEK under it.
 *
 * Why HKDF and not Argon2id: the PRF output is the authenticator's
 * HMAC-SHA-256 over a per-credential salt, keyed by a secret that never leaves
 * the authenticator — 256 bits of entropy. A slow KDF buys nothing against a
 * search that cannot be mounted, so unlock is instant. The PIN needs Argon2id
 * because its keyspace is 10^4–10^6; this one is 2^256.
 *
 * Why the blob can live on the SERVER (`user_passkeys.wrapped_dek`) when the
 * PIN blob never may (`docs/plans/vault-pin-unlock.md` §2): without the
 * authenticator there is no PRF output, and without the PRF output the blob is
 * as opaque as `users.wrapped_dek` is without the phrase. A database leak hands
 * an attacker ciphertext and a public salt, nothing to guess.
 *
 * The blob is BOUND to the public facts its row is filed under — the
 * credential id and the vault generation — as AES-GCM additional data. A row
 * relabelled with another `vault_version` (a stale wrap passed off as current)
 * or moved under another credential id fails its auth tag instead of handing
 * back a DEK the session would then stamp with the wrong generation.
 */

export const PASSKEY_HKDF_INFO = "openllm-vault-passkey-v1";
/** `prf.eval.first` input — random per credential, public, stored on the row. */
export const PASSKEY_PRF_SALT_BYTES = 32;
/** The WebAuthn PRF extension always yields a 32-byte HMAC-SHA-256 output. */
const PRF_OUTPUT_BYTES = 32;
const NONCE_BYTES = 12;
const DEK_BYTES = 32;

/** What a passkey wrap is bound to — see the module comment. */
export type TPasskeyBinding = {
  /** base64url credential id, exactly as stored in `user_passkeys.id`. */
  readonly credentialId: string;
  /** The `users.vault_version` the wrapped DEK belongs to. */
  readonly vaultVersion: number;
};

/** A fresh `prf.eval.first` salt for a credential being enrolled. */
export const newPasskeyPrfSalt = (): Uint8Array =>
  randomBytes(PASSKEY_PRF_SALT_BYTES);

/**
 * HKDF info for the recovery phrase sealed under a passkey
 * (`user_passkeys.sealed_phrase`, docs/plans/vault-phrase-sync.md). A separate
 * info from {@link PASSKEY_HKDF_INFO}, so the phrase key and the DEK wrap key
 * are independent although one PRF evaluation feeds both.
 */
export const PASSKEY_PHRASE_HKDF_INFO = "openllm-vault-passkey-phrase-v1";

const bindingAad = (
  binding: TPasskeyBinding,
  info: string = PASSKEY_HKDF_INFO,
): Uint8Array =>
  new TextEncoder().encode(
    `${info}|${binding.credentialId}|${binding.vaultVersion}`,
  );

const requireLength = (
  bytes: Uint8Array,
  length: number,
  label: string,
): void => {
  if (bytes.length !== length) {
    throw new Error(`${label} must be ${length} bytes`);
  }
};

/**
 * `HKDF-SHA256(prfOutput, salt = prfSalt, info = PASSKEY_HKDF_INFO, 32)`.
 *
 * The salt is the same bytes the authenticator was asked to evaluate, so the
 * wrap key is tied to this credential's salt twice over: once inside the
 * authenticator's HMAC, once here.
 */
const derivePasskeyWrapKey = (
  prfOutput: Uint8Array,
  prfSalt: Uint8Array,
  info: string = PASSKEY_HKDF_INFO,
): Promise<Uint8Array> => {
  requireLength(prfOutput, PRF_OUTPUT_BYTES, "PRF output");
  requireLength(prfSalt, PASSKEY_PRF_SALT_BYTES, "PRF salt");
  return hkdfSha256(prfOutput, prfSalt, info, 32);
};

/**
 * Seal `dek` under a passkey's PRF output. Returns base64 `IV || ct+tag` — the
 * shared layout (`./wrapped.ts`), without a `v<n>:` KDF stamp because there is
 * no Argon2 parameter set to record; the HKDF info string carries the version.
 *
 * Never zeroes its inputs: the caller owns the DEK and the PRF output, and
 * zeroes them in its own `finally`.
 */
export const wrapDekWithPrf = async (
  dek: Uint8Array,
  prfOutput: Uint8Array,
  prfSalt: Uint8Array,
  binding: TPasskeyBinding,
): Promise<string> => {
  requireLength(dek, DEK_BYTES, "DEK");
  const wrapKey = await derivePasskeyWrapKey(prfOutput, prfSalt);
  try {
    const nonce = randomBytes(NONCE_BYTES);
    const ciphertext = await aesGcmEncrypt(
      wrapKey,
      nonce,
      dek,
      bindingAad(binding),
    );
    return toB64(joinSealed(nonce, ciphertext));
  } finally {
    zero(wrapKey);
  }
};

/**
 * Open a passkey wrap. Throws on a bad auth tag — a different PRF output (the
 * wrong credential, or an authenticator whose PRF value diverged), another
 * salt, or a row whose binding was changed. Callers degrade to PIN / phrase.
 */
export const unwrapDekWithPrf = async (
  wrappedB64: string,
  prfOutput: Uint8Array,
  prfSalt: Uint8Array,
  binding: TPasskeyBinding,
): Promise<Uint8Array> => {
  const { nonce, ciphertext } = splitSealed(
    fromB64(wrappedB64),
    "passkey wrap",
  );
  const wrapKey = await derivePasskeyWrapKey(prfOutput, prfSalt);
  try {
    const dek = await aesGcmDecrypt(
      wrapKey,
      nonce,
      ciphertext,
      bindingAad(binding),
    );
    if (dek.length !== DEK_BYTES) {
      zero(dek);
      throw new Error("passkey wrap did not contain a 32-byte key");
    }
    return dek;
  } finally {
    zero(wrapKey);
  }
};

/**
 * Seal the recovery phrase under a passkey's PRF output, for
 * `user_passkeys.sealed_phrase` (docs/plans/vault-phrase-sync.md).
 *
 * Why the PRF and never the DEK: the server holds the DEK transiently on every
 * `sk-llm` request (`dek_for_key`), so a server-side copy under the DEK would
 * be one the server can open — and the phrase is more than the DEK, it also
 * derives the device-control seed the server must never reach. The PRF output
 * never leaves the browser.
 *
 * Same layout and binding as {@link wrapDekWithPrf}, under
 * {@link PASSKEY_PHRASE_HKDF_INFO}. The phrase is stored normalised (trimmed,
 * as `sealPhraseKeep` does). Never zeroes its inputs.
 */
export const sealPhraseWithPrf = async (
  phrase: string,
  prfOutput: Uint8Array,
  prfSalt: Uint8Array,
  binding: TPasskeyBinding,
): Promise<string> => {
  const plaintext = new TextEncoder().encode(phrase.trim());
  if (plaintext.length === 0) throw new Error("phrase must not be empty");
  const key = await derivePasskeyWrapKey(
    prfOutput,
    prfSalt,
    PASSKEY_PHRASE_HKDF_INFO,
  );
  try {
    const nonce = randomBytes(NONCE_BYTES);
    const ciphertext = await aesGcmEncrypt(
      key,
      nonce,
      plaintext,
      bindingAad(binding, PASSKEY_PHRASE_HKDF_INFO),
    );
    return toB64(joinSealed(nonce, ciphertext));
  } finally {
    zero(key);
    zero(plaintext);
  }
};

/**
 * Open a {@link sealPhraseWithPrf} copy. Throws on a bad auth tag — another
 * credential's PRF, a diverged PRF value, another vault generation, or a DEK
 * wrap passed off as a phrase copy (the info strings differ).
 */
export const openPhraseWithPrf = async (
  sealedB64: string,
  prfOutput: Uint8Array,
  prfSalt: Uint8Array,
  binding: TPasskeyBinding,
): Promise<string> => {
  const { nonce, ciphertext } = splitSealed(
    fromB64(sealedB64),
    "passkey phrase",
  );
  const key = await derivePasskeyWrapKey(
    prfOutput,
    prfSalt,
    PASSKEY_PHRASE_HKDF_INFO,
  );
  try {
    const plaintext = await aesGcmDecrypt(
      key,
      nonce,
      ciphertext,
      bindingAad(binding, PASSKEY_PHRASE_HKDF_INFO),
    );
    try {
      return new TextDecoder().decode(plaintext);
    } finally {
      zero(plaintext);
    }
  } finally {
    zero(key);
  }
};

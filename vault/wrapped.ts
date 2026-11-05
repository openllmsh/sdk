import type { TKdfVersion } from "./argon2";
import { CURRENT_KDF_VERSION, LEGACY_KDF_VERSION } from "./argon2";
import { fromB64, toB64 } from "./crypto";

/**
 * The on-disk shape of everything this package seals with AES-GCM.
 *
 * One layout, written down once, because it was previously written down three
 * times (`derive.ts`, `pin.ts`, `api-key.ts`) with three copies of the same
 * off-by-one-able join/split and three slightly different error strings.
 */

const NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;

/** `IV (12) || ciphertext+tag`. */
export const joinSealed = (
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): Uint8Array => {
  const out = new Uint8Array(nonce.length + ciphertext.length);
  out.set(nonce, 0);
  out.set(ciphertext, nonce.length);
  return out;
};

export const splitSealed = (
  sealed: Uint8Array,
  label: string,
): { readonly nonce: Uint8Array; readonly ciphertext: Uint8Array } => {
  if (sealed.length < NONCE_BYTES + GCM_TAG_BYTES) {
    throw new Error(`${label} too short to contain IV + ciphertext + tag`);
  }
  return {
    nonce: sealed.slice(0, NONCE_BYTES),
    ciphertext: sealed.slice(NONCE_BYTES),
  };
};

/**
 * A blob whose key came from a KDF, encoded so it says which KDF parameters
 * produced it: `v<n>:<base64(IV || ciphertext+tag)>`.
 *
 * The stamp is the whole point. Without it, re-tuning Argon2id is
 * indistinguishable from destroying every vault, because nothing on disk
 * records what the bytes were derived with (see `./argon2.ts`).
 *
 * `:` and `v` are outside the base64 alphabet, so a value either carries the
 * prefix or it doesn't — there is no ambiguity and no length coupling. A bare
 * base64 value is a pre-stamp blob and means {@link LEGACY_KDF_VERSION}.
 */
const STAMP_PATTERN = /^v(\d{1,3}):(.*)$/s;

export type TKdfWrapped = {
  readonly version: number;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
};

export const encodeKdfWrapped = (
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  version: TKdfVersion = CURRENT_KDF_VERSION,
): string => `v${version}:${toB64(joinSealed(nonce, ciphertext))}`;

/**
 * Read a wrapped blob and the version it declares. The version is returned
 * unvalidated — `kdfParamsFor` is what rejects one this build can't derive,
 * so the failure names the real problem instead of surfacing as a bad auth tag.
 */
export const decodeKdfWrapped = (value: string, label: string): TKdfWrapped => {
  const stamped = STAMP_PATTERN.exec(value);
  const version =
    stamped === null ? LEGACY_KDF_VERSION : Number.parseInt(stamped[1], 10);
  const payload = stamped === null ? value : stamped[2];
  return { version, ...splitSealed(fromB64(payload), label) };
};

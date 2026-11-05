/**
 * Pure WebCrypto primitives shared by every vault flow. Runs in any
 * runtime that exposes `globalThis.crypto.subtle` — browser, Node 24+,
 * Edge, Bun. Nothing in this file is server- or browser-specific;
 * everything is bytes-in/bytes-out.
 *
 * Wire / on-disk encoding is base64 (`toB64` / `fromB64`) — keeps the
 * existing text-column infrastructure (drizzle, neon HTTP driver,
 * migrations) carrying the blobs without a bytea customType.
 */

const subtle = (): SubtleCrypto => {
  const s = globalThis.crypto?.subtle;
  if (s === undefined) {
    throw new Error("WebCrypto SubtleCrypto is not available in this runtime");
  }
  return s;
};

export const randomBytes = (length: number): Uint8Array => {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
};

export const toB64 = (bytes: Uint8Array): string => {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i] as number);
  }
  return btoa(bin);
};

export const fromB64 = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export const toB64Url = (bytes: Uint8Array): string => {
  return toB64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

export const fromB64Url = (b64url: string): Uint8Array => {
  const pad =
    b64url.length % 4 === 0 ? "" : "=".repeat(4 - (b64url.length % 4));
  return fromB64(b64url.replace(/-/g, "+").replace(/_/g, "/") + pad);
};

/**
 * A standalone copy of a view's bytes — what `importKey`/`deriveBits` need,
 * since a `Uint8Array` may be a window onto a larger buffer.
 *
 * Returned as a `Uint8Array` rather than a bare `ArrayBuffer` so the caller
 * can `zero()` it. Every caller here does: the copy holds the same key
 * material as its source, and a source that is faithfully zeroed while an
 * unzeroed duplicate lingers is the hygiene contract at the bottom of this
 * file quietly not being kept.
 */
const copyOf = (bytes: Uint8Array): Uint8Array =>
  new Uint8Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );

const importAesGcmKey = async (keyBytes: Uint8Array): Promise<CryptoKey> => {
  // WebCrypto copies key data into the CryptoKey during import, so wiping our
  // copy afterwards leaves the key usable and the bytes gone.
  const copy = copyOf(keyBytes);
  try {
    return await subtle().importKey(
      "raw",
      copy as BufferSource,
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    zero(copy);
  }
};

const gcmParams = (
  nonce: Uint8Array,
  additionalData: Uint8Array | undefined,
): AesGcmParams =>
  additionalData === undefined
    ? { name: "AES-GCM", iv: nonce as BufferSource }
    : {
        name: "AES-GCM",
        iv: nonce as BufferSource,
        additionalData: additionalData as BufferSource,
      };

/**
 * AES-256-GCM encrypt. `nonce` MUST be 12 bytes. The auth tag is
 * appended to the ciphertext by WebCrypto — `aesGcmDecrypt` expects
 * the same shape. Reusing a (key, nonce) pair across two encrypts
 * is a critical failure; callers must pass `randomBytes(12)` fresh
 * each call.
 *
 * `additionalData` (optional AAD) is authenticated but not encrypted:
 * the ciphertext only opens under the exact same bytes. Used to bind a
 * blob to the public facts it is filed under (see `./passkey.ts`).
 */
export const aesGcmEncrypt = async (
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  additionalData?: Uint8Array,
): Promise<Uint8Array> => {
  if (key.length !== 32) throw new Error("AES-GCM key must be 32 bytes");
  if (nonce.length !== 12) throw new Error("AES-GCM nonce must be 12 bytes");
  const cryptoKey = await importAesGcmKey(key);
  const ct = await subtle().encrypt(
    gcmParams(nonce, additionalData),
    cryptoKey,
    plaintext as BufferSource,
  );
  return new Uint8Array(ct);
};

export const aesGcmDecrypt = async (
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  additionalData?: Uint8Array,
): Promise<Uint8Array> => {
  if (key.length !== 32) throw new Error("AES-GCM key must be 32 bytes");
  if (nonce.length !== 12) throw new Error("AES-GCM nonce must be 12 bytes");
  const cryptoKey = await importAesGcmKey(key);
  const pt = await subtle().decrypt(
    gcmParams(nonce, additionalData),
    cryptoKey,
    ciphertext as BufferSource,
  );
  return new Uint8Array(pt);
};

/**
 * HKDF-SHA256. Used to derive `api_wrap_key` from a 32-byte
 * `api_key_secret` plus the public `api_key_id` as salt. Input is
 * already high-entropy so HKDF (not Argon2) is the correct choice.
 */
export const hkdfSha256 = async (
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
  bytes: number,
): Promise<Uint8Array> => {
  const ikmCopy = copyOf(ikm);
  let key: CryptoKey;
  try {
    key = await subtle().importKey(
      "raw",
      ikmCopy as BufferSource,
      "HKDF",
      false,
      ["deriveBits"],
    );
  } finally {
    zero(ikmCopy);
  }
  // The salt is public (it's the api_key_id), so its copy needs no wipe.
  const out = await subtle().deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: copyOf(salt) as BufferSource,
      info: new TextEncoder().encode(info),
    },
    key,
    bytes * 8,
  );
  return new Uint8Array(out);
};

/**
 * Best-effort overwrite of sensitive bytes. JS engines may have
 * already copied the buffer elsewhere; this is hygiene, not a
 * guarantee. Pair with `finally{}` blocks at the end of any function
 * that touches a DEK or plaintext credential.
 */
export const zero = (bytes: Uint8Array): void => {
  bytes.fill(0);
};

/**
 * A uniform integer in `[0, max)` from the CSPRNG.
 *
 * Rejection-sampled rather than `% max`, which skews toward the low end when
 * `max` doesn't divide 2^32. Used where `Math.random()` would do the job but
 * shouldn't be within reach of anything cryptographic — a UI helper that
 * migrates into key material later is a real way to end up with a predictable
 * secret, and the cost of never having that conversation is one function.
 */
export const randomInt = (max: number): number => {
  if (!Number.isInteger(max) || max <= 0) {
    throw new Error("randomInt: max must be a positive integer");
  }
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  let n: number;
  do {
    globalThis.crypto.getRandomValues(buf);
    n = buf[0] as number;
  } while (n >= limit);
  return n % max;
};

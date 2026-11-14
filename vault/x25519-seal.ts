/**
 * The one ephemeral-X25519 + HKDF-SHA-256 + AES-256-GCM seal behind
 * `public-key-seal.ts`, `cli-auth-seal.ts` and `routebox-seal.ts`.
 *
 * Callers differ only in their domain string, associated data and the
 * encoding of the recipient / ephemeral public key (`spki` DER or `raw`
 * 32 bytes); the key derivation and ciphertext layout are shared, so every
 * wire format stays exactly as each seal documents it.
 */

import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  fromB64,
  hkdfSha256,
  randomBytes,
  toB64,
  zero,
} from "./crypto";

export type TX25519KeyFormat = "spki" | "raw";

export type TX25519Sealed = {
  readonly v: 1;
  readonly epk: string;
  readonly nonce: string;
  readonly ct: string;
};

/** The HKDF + ECDH half: both sides derive the same 32-byte AES key. */
export const deriveX25519SealKey = async (params: {
  readonly domain: string;
  readonly privateKey: CryptoKey;
  readonly peerKeyBytes: Uint8Array;
  readonly peerFormat: TX25519KeyFormat;
  readonly epkB64: string;
  readonly recipientB64: string;
}): Promise<Uint8Array> => {
  const peer = await crypto.subtle.importKey(
    params.peerFormat,
    params.peerKeyBytes as BufferSource,
    { name: "X25519" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "X25519", public: peer },
      params.privateKey,
      256,
    ),
  );
  try {
    // JSON array framing makes the public-key boundaries unambiguous.
    return await hkdfSha256(
      shared,
      new Uint8Array(0),
      JSON.stringify([params.domain, params.epkB64, params.recipientB64]),
      32,
    );
  } finally {
    zero(shared);
  }
};

/** Seal `plaintext` to `recipientB64`; the caller keeps ownership of it. */
export const sealX25519 = async (params: {
  readonly domain: string;
  readonly recipientB64: string;
  readonly recipientBytes: Uint8Array;
  readonly format: TX25519KeyFormat;
  readonly aad: Uint8Array;
  readonly plaintext: Uint8Array;
}): Promise<TX25519Sealed> => {
  const eph = (await crypto.subtle.generateKey({ name: "X25519" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const epk = toB64(
    new Uint8Array(await crypto.subtle.exportKey(params.format, eph.publicKey)),
  );
  const key = await deriveX25519SealKey({
    domain: params.domain,
    privateKey: eph.privateKey,
    peerKeyBytes: params.recipientBytes,
    peerFormat: params.format,
    epkB64: epk,
    recipientB64: params.recipientB64,
  });
  const copy = new Uint8Array(params.plaintext);
  try {
    const nonce = randomBytes(12);
    return {
      v: 1,
      epk,
      nonce: toB64(nonce),
      ct: toB64(await aesGcmEncrypt(key, nonce, copy, params.aad)),
    };
  } finally {
    zero(key);
    zero(copy);
  }
};

/** Open an envelope; the caller owns the returned plaintext and wipes it. */
export const openX25519 = async (params: {
  readonly domain: string;
  readonly privateKey: CryptoKey;
  readonly recipientB64: string;
  readonly epkBytes: Uint8Array;
  readonly epkB64: string;
  readonly format: TX25519KeyFormat;
  readonly aad: Uint8Array;
  readonly nonce: Uint8Array;
  readonly ct: Uint8Array;
}): Promise<Uint8Array> => {
  const key = await deriveX25519SealKey({
    domain: params.domain,
    privateKey: params.privateKey,
    peerKeyBytes: params.epkBytes,
    peerFormat: params.format,
    epkB64: params.epkB64,
    recipientB64: params.recipientB64,
  });
  try {
    return await aesGcmDecrypt(key, params.nonce, params.ct, params.aad);
  } finally {
    zero(key);
  }
};

/** Strict canonical-base64 decode shared by the SPKI-format seals. */
export const decodeCanonicalB64 = (value: unknown): Uint8Array => {
  if (
    typeof value !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw new Error("Invalid sealed envelope encoding");
  const bytes = fromB64(value);
  if (toB64(bytes) !== value)
    throw new Error("Invalid sealed envelope encoding");
  return bytes;
};

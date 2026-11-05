/**
 * X25519 sealed-box for daemon credentials (browser ↔ daemon).
 *
 * Wire: `base64(JSON{ epk, iv, ct })` where `epk` is the ephemeral X25519
 * public key (SPKI DER, base64), `iv` is a 12-byte AES-GCM nonce, and `ct` is
 * ciphertext‖tag. Scheme: ephemeral X25519 → ECDH → HKDF-SHA256(salt = ∅,
 * info = "openllm-cred-seal-v1", 32 bytes) → AES-256-GCM.
 *
 * Byte-identical with the historical `lib/daemon-seal.ts` /
 * `packages/cli/daemon/src/keypair.ts` sealed-box so cloud-relayed blobs stay
 * interoperable.
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
import type { TX25519Keypair } from "./handoff";
import { generateX25519Keypair } from "./handoff";

export const CRED_SEAL_HKDF_INFO = "openllm-cred-seal-v1";

/** Ephemeral X25519 pair used as an RTC answer seal recipient. */
export type TEphKeypair = TX25519Keypair;

export const generateEphKeypair = generateX25519Keypair;

const deriveCredKey = async (
  privateKey: CryptoKey,
  peerSpkiB64: string,
): Promise<Uint8Array> => {
  const peer = await crypto.subtle.importKey(
    "spki",
    fromB64(peerSpkiB64) as BufferSource,
    { name: "X25519" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "X25519", public: peer },
      privateKey,
      256,
    ),
  );
  try {
    return await hkdfSha256(shared, new Uint8Array(0), CRED_SEAL_HKDF_INFO, 32);
  } finally {
    zero(shared);
  }
};

/** Seal `plaintext` to a recipient's X25519 public key (SPKI DER, base64). */
export const sealToDaemon = async (
  recipientPubB64SpkiDer: string,
  plaintext: string,
): Promise<string> => {
  const subtle = globalThis.crypto.subtle;
  const recipient = await subtle.importKey(
    "spki",
    fromB64(recipientPubB64SpkiDer) as BufferSource,
    { name: "X25519" },
    false,
    [],
  );
  // Ephemeral keypair — extractable so we can publish its public key as `epk`.
  const eph = (await subtle.generateKey({ name: "X25519" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const shared = new Uint8Array(
    await subtle.deriveBits(
      { name: "X25519", public: recipient },
      eph.privateKey,
      256,
    ),
  );
  let key: Uint8Array;
  try {
    key = await hkdfSha256(shared, new Uint8Array(0), CRED_SEAL_HKDF_INFO, 32);
  } finally {
    zero(shared);
  }
  try {
    const iv = randomBytes(12);
    const ct = await aesGcmEncrypt(
      key,
      iv,
      new TextEncoder().encode(plaintext),
    );
    const epk = new Uint8Array(await subtle.exportKey("spki", eph.publicKey));
    const packed = { epk: toB64(epk), iv: toB64(iv), ct: toB64(ct) };
    return toB64(new TextEncoder().encode(JSON.stringify(packed)));
  } finally {
    zero(key);
  }
};

/**
 * Open a cred-seal blob with any X25519 private key (daemon identity or eph).
 * Null on any failure.
 */
export const openCredSealed = async (
  sealedB64: string,
  privateKey: CryptoKey,
): Promise<string | null> => {
  try {
    const packed: unknown = JSON.parse(
      new TextDecoder().decode(fromB64(sealedB64)),
    );
    if (packed === null || typeof packed !== "object") return null;
    const { epk, iv, ct } = packed as {
      epk?: unknown;
      iv?: unknown;
      ct?: unknown;
    };
    if (
      typeof epk !== "string" ||
      typeof iv !== "string" ||
      typeof ct !== "string"
    ) {
      return null;
    }
    const key = await deriveCredKey(privateKey, epk);
    try {
      const plain = await aesGcmDecrypt(key, fromB64(iv), fromB64(ct));
      return new TextDecoder().decode(plain);
    } finally {
      zero(key);
    }
  } catch {
    return null;
  }
};

/**
 * Open a sealed blob with an in-memory ephemeral private key (RTC answer path).
 * Alias of {@link openCredSealed}.
 */
export const openSealedFromEph = (
  sealedB64: string,
  ephPrivateKey: CryptoKey,
): Promise<string | null> => openCredSealed(sealedB64, ephPrivateKey);

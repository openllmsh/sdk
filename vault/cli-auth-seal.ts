/**
 * Seal an ordinary `sk-llm` API key to a CLI caller's ephemeral X25519
 * public key during OpenLLM CLI OAuth login handover
 * (`docs/plan/2026-11-01-cli-install-onboarding.md` §2).
 *
 * Same envelope shape as the connector seal, but a distinct domain and AAD
 * so connector and CLI ciphertext are not interchangeable. The server is a
 * mailbox: it stores only the JSON envelope.
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
import {
  generateResumableX25519Keypair,
  generateX25519Keypair,
  importX25519PrivateKey,
} from "./handoff";

export const CLI_AUTH_SEAL_DOMAIN = "openllm-cli-auth-seal-v1";

export type TCliAuthSealBinding = {
  readonly userId: string;
  readonly authorizationId: string;
  /** Recipient (CLI) X25519 public key, base64 SPKI DER. */
  readonly recipientPublicKeyB64: string;
};

export type TCliAuthSealed = {
  readonly v: 1;
  readonly epk: string;
  readonly nonce: string;
  readonly ct: string;
};

const aad = (binding: TCliAuthSealBinding): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify([
      CLI_AUTH_SEAL_DOMAIN,
      binding.userId,
      binding.authorizationId,
      binding.recipientPublicKeyB64,
    ]),
  );

const decode = (value: unknown): Uint8Array => {
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

const deriveKey = async (
  privateKey: CryptoKey,
  peerB64: string,
  epk: string,
  recipient: string,
): Promise<Uint8Array> => {
  const peer = await crypto.subtle.importKey(
    "spki",
    decode(peerB64) as BufferSource,
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
    return await hkdfSha256(
      shared,
      new Uint8Array(0),
      JSON.stringify([CLI_AUTH_SEAL_DOMAIN, epk, recipient]),
      32,
    );
  } finally {
    zero(shared);
  }
};

/** Caller retains ownership of plaintext; the temporary copy is wiped. */
export const sealCliAuth = async (
  binding: TCliAuthSealBinding,
  plaintext: Uint8Array,
): Promise<TCliAuthSealed> => {
  const eph = await generateX25519Keypair();
  const key = await deriveKey(
    eph.privateKey,
    binding.recipientPublicKeyB64,
    eph.publicKeyB64,
    binding.recipientPublicKeyB64,
  );
  const copy = new Uint8Array(plaintext);
  try {
    const nonce = randomBytes(12);
    return {
      v: 1,
      epk: eph.publicKeyB64,
      nonce: toB64(nonce),
      ct: toB64(await aesGcmEncrypt(key, nonce, copy, aad(binding))),
    };
  } finally {
    zero(key);
    zero(copy);
  }
};

/** Caller owns the returned plaintext and must wipe it when finished. */
export const openCliAuth = async (
  binding: TCliAuthSealBinding,
  sealed: TCliAuthSealed,
  privateKey: CryptoKey,
): Promise<Uint8Array> => {
  if (typeof sealed !== "object" || sealed === null || sealed.v !== 1)
    throw new Error("Invalid sealed envelope");
  const nonce = decode(sealed.nonce);
  const ct = decode(sealed.ct);
  if (nonce.length !== 12 || ct.length < 16 || typeof sealed.epk !== "string")
    throw new Error("Invalid sealed envelope");
  const key = await deriveKey(
    privateKey,
    sealed.epk,
    sealed.epk,
    binding.recipientPublicKeyB64,
  );
  try {
    return await aesGcmDecrypt(key, nonce, ct, aad(binding));
  } finally {
    zero(key);
  }
};

/** Alias kept for CLI call-site parity with the old `cli-auth-crypto` names. */
export const generateCliAuthKeypair = generateX25519Keypair;
/** Alias kept for CLI call-site parity with the old `cli-auth-crypto` names. */
export const openCliAuthSealed = openCliAuth;
export const importCliAuthPrivateKey = importX25519PrivateKey;
export const generateResumableCliAuthKeypair = generateResumableX25519Keypair;
export type TCliAuthKeypair = TX25519Keypair;

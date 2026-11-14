/**
 * Seal a routing box's unlock to the one-time token its current boot made.
 *
 * The box generates a fresh X25519 keypair on every boot and keeps the
 * private half in RAM (`/run`, tmpfs). The browser seals to the public half:
 * an ephemeral X25519 exchange, HKDF-SHA-256 and AES-256-GCM, the same
 * construction as `public-key-seal.ts`, so the box can open it with Python's
 * `cryptography` (cloud-init's own dependency) and no OpenLLM binary change.
 *
 * The associated data binds the envelope to the user, box, the box's API key
 * id, boot generation, boot public key and challenge, so an envelope sealed for one
 * boot can't be replayed into another, and the server, which only stores and
 * forwards the ciphertext, can't redirect it.
 *
 * Deliberately NOT re-exported from `vault/index.ts` (the `openllm` binary
 * imports that barrel). Import by subpath:
 * `@openllmsh/sdk/vault/routing-box-seal`.
 *
 * The box side mirrors `openRoutingBoxEnvelope` in
 * `packages/api/lib/routing-box/cloud-init.ts` (Python).
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

export const ROUTING_BOX_SEAL_DOMAIN = "openllm-routing-box-seal-v1";

export type TRoutingBoxSealBinding = {
  readonly userId: string;
  readonly boxId: string;
  /** The box's API key; its home key derives from this key's anchor. */
  readonly keyId: string;
  readonly bootGeneration: number;
  /** The boot's X25519 public key, base64 of the raw 32 bytes. */
  readonly bootPubkeyB64: string;
  /** The boot's 32-byte challenge, base64. */
  readonly challengeB64: string;
};

export type TRoutingBoxEnvelope = {
  readonly v: 1;
  /** Ephemeral X25519 public key, base64 of the raw 32 bytes. */
  readonly epk: string;
  readonly nonce: string;
  readonly ct: string;
};

/**
 * What the box receives on every boot: `home_key` opens its encrypted home,
 * and `api_key` is the box's ANCHORED `sk-llm` key (so its daemon pins the
 * control key, which WebRTC needs). Sent every time, so a box that failed
 * before installing it recovers on its next boot.
 */
export type TRoutingBoxUnlock = {
  readonly home_key: string;
  readonly api_key: string;
};

const encoder = new TextEncoder();

/** Canonical associated data; the Python side builds the same bytes. */
export const routingBoxSealAad = (
  binding: TRoutingBoxSealBinding,
): Uint8Array =>
  encoder.encode(
    JSON.stringify([
      ROUTING_BOX_SEAL_DOMAIN,
      binding.userId,
      binding.boxId,
      binding.keyId,
      binding.bootGeneration,
      binding.bootPubkeyB64,
      binding.challengeB64,
    ]),
  );

const raw32 = (b64: string, what: string): Uint8Array => {
  const bytes = fromB64(b64);
  if (bytes.length !== 32 || toB64(bytes) !== b64) {
    throw new Error(`${what} must be base64 of 32 bytes`);
  }
  return bytes;
};

const deriveKey = async (
  privateKey: CryptoKey,
  peerRaw: Uint8Array,
  epkB64: string,
  recipientB64: string,
): Promise<Uint8Array> => {
  const peer = await crypto.subtle.importKey(
    "raw",
    peerRaw as BufferSource,
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
      JSON.stringify([ROUTING_BOX_SEAL_DOMAIN, epkB64, recipientB64]),
      32,
    );
  } finally {
    zero(shared);
  }
};

/** Seal `unlock` to the boot in `binding`. */
export const sealRoutingBoxUnlock = async (
  binding: TRoutingBoxSealBinding,
  unlock: TRoutingBoxUnlock,
): Promise<TRoutingBoxEnvelope> => {
  raw32(binding.challengeB64, "challenge");
  const recipient = raw32(binding.bootPubkeyB64, "boot public key");
  const eph = (await crypto.subtle.generateKey({ name: "X25519" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const epkB64 = toB64(
    new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey)),
  );
  const key = await deriveKey(
    eph.privateKey,
    recipient,
    epkB64,
    binding.bootPubkeyB64,
  );
  const plaintext = encoder.encode(JSON.stringify(unlock));
  try {
    const nonce = randomBytes(12);
    return {
      v: 1,
      epk: epkB64,
      nonce: toB64(nonce),
      ct: toB64(
        await aesGcmEncrypt(key, nonce, plaintext, routingBoxSealAad(binding)),
      ),
    };
  } finally {
    zero(key);
    zero(plaintext);
  }
};

/** Open an envelope with the boot's private key (tests; the box uses Python). */
export const openRoutingBoxUnlock = async (
  binding: TRoutingBoxSealBinding,
  envelope: TRoutingBoxEnvelope,
  bootPrivateKey: CryptoKey,
): Promise<TRoutingBoxUnlock> => {
  if (envelope.v !== 1) throw new Error("unknown envelope version");
  const key = await deriveKey(
    bootPrivateKey,
    raw32(envelope.epk, "ephemeral key"),
    envelope.epk,
    binding.bootPubkeyB64,
  );
  try {
    const plaintext = await aesGcmDecrypt(
      key,
      fromB64(envelope.nonce),
      fromB64(envelope.ct),
      routingBoxSealAad(binding),
    );
    try {
      return JSON.parse(
        new TextDecoder().decode(plaintext),
      ) as TRoutingBoxUnlock;
    } finally {
      zero(plaintext);
    }
  } finally {
    zero(key);
  }
};

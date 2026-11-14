/**
 * Seal a Routebox's unlock to the one-time token its current boot made.
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
 * `@openllmsh/sdk/vault/routebox-seal`.
 *
 * The box side mirrors `open_unlock` in
 * `packages/api/lib/routebox/box-agent.ts` (Python).
 */

import { fromB64, toB64, zero } from "./crypto";
import { openX25519, sealX25519 } from "./x25519-seal";

export const ROUTEBOX_SEAL_DOMAIN = "openllm-routebox-seal-v1";

export type TRouteboxSealBinding = {
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

export type TRouteboxEnvelope = {
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
export type TRouteboxUnlock = {
  readonly home_key: string;
  readonly api_key: string;
};

const encoder = new TextEncoder();

/** Canonical associated data; the Python side builds the same bytes. */
export const routeboxSealAad = (binding: TRouteboxSealBinding): Uint8Array =>
  encoder.encode(
    JSON.stringify([
      ROUTEBOX_SEAL_DOMAIN,
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

/** Seal `unlock` to the boot in `binding`. */
export const sealRouteboxUnlock = async (
  binding: TRouteboxSealBinding,
  unlock: TRouteboxUnlock,
): Promise<TRouteboxEnvelope> => {
  raw32(binding.challengeB64, "challenge");
  const plaintext = encoder.encode(JSON.stringify(unlock));
  try {
    return await sealX25519({
      domain: ROUTEBOX_SEAL_DOMAIN,
      recipientB64: binding.bootPubkeyB64,
      recipientBytes: raw32(binding.bootPubkeyB64, "boot public key"),
      format: "raw",
      aad: routeboxSealAad(binding),
      plaintext,
    });
  } finally {
    zero(plaintext);
  }
};

/** Open an envelope with the boot's private key (tests; the box uses Python). */
export const openRouteboxUnlock = async (
  binding: TRouteboxSealBinding,
  envelope: TRouteboxEnvelope,
  bootPrivateKey: CryptoKey,
): Promise<TRouteboxUnlock> => {
  if (envelope.v !== 1) throw new Error("unknown envelope version");
  const plaintext = await openX25519({
    domain: ROUTEBOX_SEAL_DOMAIN,
    privateKey: bootPrivateKey,
    recipientB64: binding.bootPubkeyB64,
    epkBytes: raw32(envelope.epk, "ephemeral key"),
    epkB64: envelope.epk,
    format: "raw",
    aad: routeboxSealAad(binding),
    nonce: fromB64(envelope.nonce),
    ct: fromB64(envelope.ct),
  });
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("home_key" in parsed) ||
      !("api_key" in parsed) ||
      typeof parsed.home_key !== "string" ||
      typeof parsed.api_key !== "string"
    ) {
      throw new Error("malformed routebox unlock payload");
    }
    return { home_key: parsed.home_key, api_key: parsed.api_key };
  } finally {
    zero(plaintext);
  }
};

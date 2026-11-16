/**
 * Seal a Routebox's unlock to the one-time token its current boot made, and
 * check the boot's proof that it is the box this vault set up.
 *
 * The box generates a fresh X25519 keypair on every boot and keeps the
 * private half in RAM (`/run`, tmpfs). The browser seals to the public half:
 * an ephemeral X25519 exchange, HKDF-SHA-256 and AES-256-GCM, the same
 * construction as `public-key-seal.ts`, so the box can open it with Python's
 * `cryptography` (cloud-init's own dependency) and no OpenLLM binary change.
 *
 * Every boot is unlocked in two phases:
 *
 * 1. `home`: only the home key. The box opens its encrypted home and answers
 *    with a PROOF: an Ed25519 signature, by the identity key kept inside that
 *    home, over this boot (`routeboxProofMessage`), or `fresh` when the home
 *    holds no identity yet (a new box, or a machine re-imaged under it).
 * 2. `key`: the box's API key, sealed only once the proof verifies against
 *    the identity the vault derives (`deriveRouteboxIdentityPublicKey`). A
 *    `fresh` box gets it, with the identity seed to keep, only when the user
 *    set it up on purpose. So a machine that merely claims the box's IP (a
 *    re-image, or a boot key written into the database) never receives a key
 *    that carries the vault.
 *
 * The associated data binds each envelope to the phase, user, box, boot
 * generation, boot public key and challenge, so an envelope sealed for one
 * boot or phase can't be replayed into another, and the server, which only
 * stores and forwards the ciphertext, can't redirect it.
 *
 * Deliberately NOT re-exported from `vault/index.ts` (the `openllm` binary
 * imports that barrel). Import by subpath:
 * `@openllmsh/sdk/vault/routebox-seal`.
 *
 * The box side mirrors `open_unlock` and `prove` in
 * `packages/api/lib/routebox/box-agent.ts` (Python).
 */

import { signAsync, verifyAsync } from "@noble/ed25519";
import { fromB64, toB64, zero } from "./crypto";
import type { TRouteboxUnlockPhase } from "./routebox-unlock-phase";
import { openX25519, sealX25519 } from "./x25519-seal";

export const ROUTEBOX_SEAL_DOMAIN = "openllm-routebox-seal-v1";
export const ROUTEBOX_PROOF_DOMAIN = "openllm-routebox-proof-v1";

export type { TRouteboxUnlockPhase };

export type TRouteboxSealBinding = {
  readonly userId: string;
  readonly boxId: string;
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

/** The `home` phase: opens the box's encrypted home, nothing more. */
export type TRouteboxHomeUnlock = { readonly home_key: string };

/**
 * The `key` phase: the box's ANCHORED `sk-llm` key (so its daemon pins the
 * control key, which WebRTC needs), and, only when the box is being set up,
 * the identity seed it keeps inside its home from then on.
 */
export type TRouteboxKeyUnlock = {
  readonly api_key: string;
  readonly identity_seed?: string;
};

export type TRouteboxUnlockFor<TPhase extends TRouteboxUnlockPhase> =
  TPhase extends "home" ? TRouteboxHomeUnlock : TRouteboxKeyUnlock;

const encoder = new TextEncoder();

/** Canonical associated data; the Python side builds the same bytes. */
export const routeboxSealAad = (
  phase: TRouteboxUnlockPhase,
  binding: TRouteboxSealBinding,
): Uint8Array =>
  encoder.encode(
    JSON.stringify([
      ROUTEBOX_SEAL_DOMAIN,
      phase,
      binding.userId,
      binding.boxId,
      binding.bootGeneration,
      binding.bootPubkeyB64,
      binding.challengeB64,
    ]),
  );

/** What the box signs to prove its identity for this boot; Python builds the same bytes. */
export const routeboxProofMessage = (
  binding: TRouteboxSealBinding,
): Uint8Array =>
  encoder.encode(
    JSON.stringify([
      ROUTEBOX_PROOF_DOMAIN,
      binding.userId,
      binding.boxId,
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

/**
 * Does `signatureB64` prove this boot holds the identity whose public key is
 * `identityPublicKeyB64`? Any malformed input is simply "no".
 */
export const verifyRouteboxProof = async (
  binding: TRouteboxSealBinding,
  signatureB64: string,
  identityPublicKeyB64: string,
): Promise<boolean> => {
  try {
    const signature = fromB64(signatureB64);
    if (signature.length !== 64) return false;
    return await verifyAsync(
      signature,
      routeboxProofMessage(binding),
      raw32(identityPublicKeyB64, "identity public key"),
    );
  } catch {
    return false;
  }
};

/** Sign a proof with the identity seed (tests; the box signs in Python). */
export const signRouteboxProof = async (
  binding: TRouteboxSealBinding,
  identitySeed: Uint8Array,
): Promise<string> =>
  toB64(await signAsync(routeboxProofMessage(binding), identitySeed));

/** Seal one phase of the unlock to the boot in `binding`. */
export const sealRouteboxUnlock = async <TPhase extends TRouteboxUnlockPhase>(
  phase: TPhase,
  binding: TRouteboxSealBinding,
  unlock: TRouteboxUnlockFor<TPhase>,
): Promise<TRouteboxEnvelope> => {
  raw32(binding.challengeB64, "challenge");
  const plaintext = encoder.encode(JSON.stringify(unlock));
  try {
    return await sealX25519({
      domain: ROUTEBOX_SEAL_DOMAIN,
      recipientB64: binding.bootPubkeyB64,
      recipientBytes: raw32(binding.bootPubkeyB64, "boot public key"),
      format: "raw",
      aad: routeboxSealAad(phase, binding),
      plaintext,
    });
  } finally {
    zero(plaintext);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parsePhase = (
  phase: TRouteboxUnlockPhase,
  parsed: unknown,
): TRouteboxHomeUnlock | TRouteboxKeyUnlock => {
  if (!isRecord(parsed)) throw new Error("malformed routebox unlock payload");
  if (phase === "home") {
    if (typeof parsed.home_key !== "string" || "api_key" in parsed) {
      throw new Error("malformed routebox home unlock");
    }
    return { home_key: parsed.home_key };
  }
  if (
    typeof parsed.api_key !== "string" ||
    "home_key" in parsed ||
    (parsed.identity_seed !== undefined &&
      typeof parsed.identity_seed !== "string")
  ) {
    throw new Error("malformed routebox key unlock");
  }
  return typeof parsed.identity_seed === "string"
    ? { api_key: parsed.api_key, identity_seed: parsed.identity_seed }
    : { api_key: parsed.api_key };
};

/** Open an envelope with the boot's private key (tests; the box uses Python). */
export const openRouteboxUnlock = async <TPhase extends TRouteboxUnlockPhase>(
  phase: TPhase,
  binding: TRouteboxSealBinding,
  envelope: TRouteboxEnvelope,
  bootPrivateKey: CryptoKey,
): Promise<TRouteboxUnlockFor<TPhase>> => {
  if (envelope.v !== 1) throw new Error("unknown envelope version");
  const plaintext = await openX25519({
    domain: ROUTEBOX_SEAL_DOMAIN,
    privateKey: bootPrivateKey,
    recipientB64: binding.bootPubkeyB64,
    epkBytes: raw32(envelope.epk, "ephemeral key"),
    epkB64: envelope.epk,
    format: "raw",
    aad: routeboxSealAad(phase, binding),
    nonce: fromB64(envelope.nonce),
    ct: fromB64(envelope.ct),
  });
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    return parsePhase(phase, parsed) as TRouteboxUnlockFor<TPhase>;
  } finally {
    zero(plaintext);
  }
};

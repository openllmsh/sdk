/**
 * Seal an ordinary `sk-llm` API key to a CLI caller's ephemeral X25519
 * public key during OpenLLM CLI OAuth login handover
 * (`docs/plan/2026-11-01-cli-install-onboarding.md` §2).
 *
 * Same envelope shape as the connector seal, but a distinct domain and AAD
 * so connector and CLI ciphertext are not interchangeable. The server is a
 * mailbox: it stores only the JSON envelope.
 */

import type { TX25519Keypair } from "./handoff";
import {
  generateResumableX25519Keypair,
  generateX25519Keypair,
  importX25519PrivateKey,
} from "./handoff";
import { decodeCanonicalB64, openX25519, sealX25519 } from "./x25519-seal";

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

/** Caller retains ownership of plaintext; the temporary copy is wiped. */
export const sealCliAuth = async (
  binding: TCliAuthSealBinding,
  plaintext: Uint8Array,
): Promise<TCliAuthSealed> =>
  sealX25519({
    domain: CLI_AUTH_SEAL_DOMAIN,
    recipientB64: binding.recipientPublicKeyB64,
    recipientBytes: decodeCanonicalB64(binding.recipientPublicKeyB64),
    format: "spki",
    aad: aad(binding),
    plaintext,
  });

/** Caller owns the returned plaintext and must wipe it when finished. */
export const openCliAuth = async (
  binding: TCliAuthSealBinding,
  sealed: TCliAuthSealed,
  privateKey: CryptoKey,
): Promise<Uint8Array> => {
  if (typeof sealed !== "object" || sealed === null || sealed.v !== 1)
    throw new Error("Invalid sealed envelope");
  const nonce = decodeCanonicalB64(sealed.nonce);
  const ct = decodeCanonicalB64(sealed.ct);
  if (nonce.length !== 12 || ct.length < 16 || typeof sealed.epk !== "string")
    throw new Error("Invalid sealed envelope");
  return openX25519({
    domain: CLI_AUTH_SEAL_DOMAIN,
    privateKey,
    recipientB64: binding.recipientPublicKeyB64,
    epkBytes: decodeCanonicalB64(sealed.epk),
    epkB64: sealed.epk,
    format: "spki",
    aad: aad(binding),
    nonce,
    ct,
  });
};

/** Alias kept for CLI call-site parity with the old `cli-auth-crypto` names. */
export const generateCliAuthKeypair = generateX25519Keypair;
/** Alias kept for CLI call-site parity with the old `cli-auth-crypto` names. */
export const openCliAuthSealed = openCliAuth;
export const importCliAuthPrivateKey = importX25519PrivateKey;
export const generateResumableCliAuthKeypair = generateResumableX25519Keypair;
export type TCliAuthKeypair = TX25519Keypair;

/**
 * The Routebox's keys, all derived from the account's device-control seed and
 * the machine's GalaxyGate SUBJECT id (stable for the machine's life, across
 * deployments, resets and re-claims):
 *
 * - the box's API key id (10 bytes, the normal key-id encoding),
 * - the box's API key secret (32 bytes),
 * - the home key that opens its encrypted home (LUKS),
 * - the box's identity: an Ed25519 seed the box keeps inside that home, with
 *   which it proves on every later boot that it is the machine this vault set
 *   up (`routebox-seal.ts`, the proof).
 *
 * all also depend on the box's reset epoch (see `saltOf`).
 *
 * Each is `HKDF-SHA256(seed, utf8(subject id), <own info>, n)`, so they never
 * coincide. The device-control seed is itself `HKDF(vault seed)`, held by an
 * unlocked browser and by nothing else: no API key, daemon or server. So any
 * deployment, given the same user's phrase, rebuilds the same `sk-llm` and the
 * same home key — the key already on the box keeps working after a takeover.
 * Different subject or seed, different keys; a vault rotation changes the seed
 * and so everything.
 *
 * Deliberately NOT re-exported from `vault/index.ts`: the `openllm` binary
 * imports that barrel, and a box only ever receives these keys. Import by
 * subpath: `@openllmsh/sdk/vault/routebox-key`.
 */
import {
  OPENLLM_API_KEY_ID_BYTES,
  OPENLLM_API_KEY_SECRET_BYTES,
} from "@openllmsh/sdk/protocol";
import type { TMintedApiKey } from "./api-key";
import { mintApiKeyFrom } from "./api-key";
import { getPublicKeyAsync } from "@noble/ed25519";
import { hkdfSha256, toB64, toB64Url, zero } from "./crypto";
import { DEVICE_CONTROL_SEED_BYTES } from "./device-control";

export const ROUTEBOX_HOME_HKDF_INFO = "openllm-routebox-home-v2";
export const ROUTEBOX_KEY_ID_HKDF_INFO = "openllm-routebox-key-id-v1";
export const ROUTEBOX_KEY_SECRET_HKDF_INFO = "openllm-routebox-key-secret-v1";
export const ROUTEBOX_IDENTITY_HKDF_INFO = "openllm-routebox-identity-v1";

/**
 * The salt: the subject id and the box's reset epoch. A Reset increments the
 * epoch, so it derives a NEW key id, secret and home key (an old `sk-llm` is
 * never re-minted); a takeover reads the epoch from the machine's name and so
 * rebuilds the same ones.
 */
const saltOf = (subjectId: string, epoch: number): Uint8Array => {
  if (!Number.isInteger(epoch) || epoch < 0) {
    throw new Error("Routebox reset epoch must be a non-negative integer");
  }
  return new TextEncoder().encode(`${subjectId}|e${epoch}`);
};

const derive = async (
  controlSeed: Uint8Array,
  subjectId: string,
  epoch: number,
  info: string,
  length: number,
): Promise<Uint8Array> => {
  if (controlSeed.length !== DEVICE_CONTROL_SEED_BYTES) {
    throw new Error("invalid device-control seed length");
  }
  if (subjectId.length === 0)
    throw new Error("Routebox key needs a subject id");
  return hkdfSha256(controlSeed, saltOf(subjectId, epoch), info, length);
};

/** Derive the box's home key; the caller must zero the returned bytes. */
export const deriveRouteboxHomeKey = (
  controlSeed: Uint8Array,
  subjectId: string,
  epoch: number,
): Promise<Uint8Array> =>
  derive(controlSeed, subjectId, epoch, ROUTEBOX_HOME_HKDF_INFO, 32);

/** The box's API key id, in the ordinary base64url key-id encoding. */
export const deriveRouteboxKeyId = async (
  controlSeed: Uint8Array,
  subjectId: string,
  epoch: number,
): Promise<string> => {
  const bytes = await derive(
    controlSeed,
    subjectId,
    epoch,
    ROUTEBOX_KEY_ID_HKDF_INFO,
    OPENLLM_API_KEY_ID_BYTES,
  );
  try {
    return toB64Url(bytes);
  } finally {
    zero(bytes);
  }
};

/** The box's API key secret; the caller must zero the returned bytes. */
export const deriveRouteboxKeySecret = (
  controlSeed: Uint8Array,
  subjectId: string,
  epoch: number,
): Promise<Uint8Array> =>
  derive(
    controlSeed,
    subjectId,
    epoch,
    ROUTEBOX_KEY_SECRET_HKDF_INFO,
    OPENLLM_API_KEY_SECRET_BYTES,
  );

/**
 * Mint the box's API key deterministically: a normal `api_keys` row whose id
 * and `sk-llm` string are the same every time for this seed and machine (only
 * the DEK-wrap nonces are random).
 */
export const mintRouteboxApiKey = async (
  dek: Uint8Array,
  vaultVersion: number,
  controlSeed: Uint8Array,
  subjectId: string,
  epoch: number,
): Promise<TMintedApiKey> => {
  const id = await deriveRouteboxKeyId(controlSeed, subjectId, epoch);
  const secret = await deriveRouteboxKeySecret(controlSeed, subjectId, epoch);
  try {
    return await mintApiKeyFrom(dek, vaultVersion, id, secret);
  } finally {
    zero(secret);
  }
};

/**
 * The box's identity seed (an Ed25519 private key, RFC 8032 seed form). Sent
 * to the box once, when it is set up, and kept only inside its encrypted home;
 * the caller must zero the returned bytes.
 */
export const deriveRouteboxIdentitySeed = (
  controlSeed: Uint8Array,
  subjectId: string,
  epoch: number,
): Promise<Uint8Array> =>
  derive(controlSeed, subjectId, epoch, ROUTEBOX_IDENTITY_HKDF_INFO, 32);

/** The identity's public key (base64 of the raw 32 bytes): what a proof must verify against. */
export const deriveRouteboxIdentityPublicKey = async (
  controlSeed: Uint8Array,
  subjectId: string,
  epoch: number,
): Promise<string> => {
  const seed = await deriveRouteboxIdentitySeed(controlSeed, subjectId, epoch);
  try {
    return toB64(await getPublicKeyAsync(seed));
  } finally {
    zero(seed);
  }
};

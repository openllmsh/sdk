/**
 * The Routebox's keys, all derived from the account's device-control seed and
 * the machine's GalaxyGate SUBJECT id (stable for the machine's life, across
 * deployments, resets and re-claims):
 *
 * - the box's API key id (10 bytes, the normal key-id encoding),
 * - the box's API key secret (32 bytes),
 * - the home key that opens its encrypted home (LUKS).
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
import { hkdfSha256, toB64Url, zero } from "./crypto";
import { DEVICE_CONTROL_SEED_BYTES } from "./device-control";

export const ROUTEBOX_HOME_HKDF_INFO = "openllm-routebox-home-v2";
export const ROUTEBOX_KEY_ID_HKDF_INFO = "openllm-routebox-key-id-v1";
export const ROUTEBOX_KEY_SECRET_HKDF_INFO = "openllm-routebox-key-secret-v1";

const derive = async (
  controlSeed: Uint8Array,
  subjectId: string,
  info: string,
  length: number,
): Promise<Uint8Array> => {
  if (controlSeed.length !== DEVICE_CONTROL_SEED_BYTES) {
    throw new Error("invalid device-control seed length");
  }
  if (subjectId.length === 0)
    throw new Error("Routebox key needs a subject id");
  return hkdfSha256(
    controlSeed,
    new TextEncoder().encode(subjectId),
    info,
    length,
  );
};

/** Derive the box's home key; the caller must zero the returned bytes. */
export const deriveRouteboxHomeKey = (
  controlSeed: Uint8Array,
  subjectId: string,
): Promise<Uint8Array> =>
  derive(controlSeed, subjectId, ROUTEBOX_HOME_HKDF_INFO, 32);

/** The box's API key id, in the ordinary base64url key-id encoding. */
export const deriveRouteboxKeyId = async (
  controlSeed: Uint8Array,
  subjectId: string,
): Promise<string> => {
  const bytes = await derive(
    controlSeed,
    subjectId,
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
): Promise<Uint8Array> =>
  derive(
    controlSeed,
    subjectId,
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
): Promise<TMintedApiKey> => {
  const id = await deriveRouteboxKeyId(controlSeed, subjectId);
  const secret = await deriveRouteboxKeySecret(controlSeed, subjectId);
  try {
    return await mintApiKeyFrom(dek, vaultVersion, id, secret);
  } finally {
    zero(secret);
  }
};

/**
 * The routing box's home key: what opens its encrypted home (LUKS).
 *
 * Derived from the box API key's DEVICE ANCHOR secret — the per-key pair
 * secret `HKDF(device-control seed, key id)` (`device-anchor.ts`) that every
 * anchored device already holds — under its own label, so the home key and the
 * anchor's other uses never coincide. The device-control seed is itself
 * `HKDF(vault seed)`, held by an unlocked browser and by nothing else: no API
 * key, daemon or server. So the home key is deterministic from the recovery
 * phrase, stored nowhere, re-derivable by the owner's browser after every
 * reboot, different for every key, and gone with a vault rotation. A box that
 * is reset or replaced gets a new key, so a new home key; deleting the key is
 * the revocation.
 *
 * Deliberately NOT re-exported from `vault/index.ts`: the `openllm` binary
 * imports that barrel, and a box only ever receives this key. Import it by
 * subpath: `@openllmsh/sdk/vault/routing-box-key`.
 */
import { hkdfSha256, zero } from "./crypto";
import { deriveDevicePairSecret } from "./device-anchor";
import { DEVICE_CONTROL_SEED_BYTES } from "./device-control";

export const ROUTING_BOX_HOME_HKDF_INFO = "openllm-routing-box-home-v1";

/** Derive the box's home key; the caller must zero the returned bytes. */
export const deriveRoutingBoxHomeKey = async (
  controlSeed: Uint8Array,
  keyId: string,
): Promise<Uint8Array> => {
  if (controlSeed.length !== DEVICE_CONTROL_SEED_BYTES) {
    throw new Error("invalid device-control seed length");
  }
  const pairSecret = await deriveDevicePairSecret(controlSeed, keyId);
  try {
    return await hkdfSha256(
      pairSecret,
      new Uint8Array(0),
      ROUTING_BOX_HOME_HKDF_INFO,
      32,
    );
  } finally {
    zero(pairSecret);
  }
};

/**
 * The routing box's storage key: what opens its encrypted home.
 *
 * Derived from the account's DEVICE-CONTROL SEED (`device-control.ts`,
 * itself `HKDF(vault seed)`), which an unlocked browser holds and nothing
 * else ever does: no API key, no daemon, no server. Not from the DEK, which
 * every API key carries and the server unwraps per request. So the key is
 * deterministic from the recovery phrase, stored nowhere, re-derivable by the
 * owner's browser after every reboot, and gone with a vault rotation.
 *
 * A fresh nonce and epoch per box (and per reset) make every box's key
 * independent: revoking one never weakens another.
 *
 * Deliberately NOT re-exported from `vault/index.ts`: the `openllm` binary
 * imports that barrel, and a routing box only ever receives this key, so
 * keeping it out keeps the binary unchanged. Import it by subpath:
 * `@openllmsh/sdk/vault/routing-box-key`.
 */
import { hkdfSha256 } from "./crypto";
import { DEVICE_CONTROL_SEED_BYTES } from "./device-control";

export type TRoutingBoxKeyBinding = {
  readonly nonce: Uint8Array;
  readonly userId: string;
  readonly vaultKeyId: string;
  readonly boxId: string;
  readonly epoch: number;
};

/**
 * Derive the box's storage key from the device-control seed; the caller must
 * zero the returned bytes.
 */
export const deriveRoutingBoxKey = (
  controlSeed: Uint8Array,
  binding: TRoutingBoxKeyBinding,
): Promise<Uint8Array> => {
  if (controlSeed.length !== DEVICE_CONTROL_SEED_BYTES) {
    throw new Error("invalid device-control seed length");
  }
  if (binding.nonce.length !== 32)
    throw new Error("invalid routing box nonce length");
  if (!Number.isSafeInteger(binding.epoch) || binding.epoch < 0) {
    throw new Error("invalid routing box key epoch");
  }
  return hkdfSha256(
    controlSeed,
    binding.nonce,
    JSON.stringify([
      "openllm-routing-box-store-v1",
      binding.userId,
      binding.vaultKeyId,
      binding.boxId,
      binding.epoch,
    ]),
    32,
  );
};

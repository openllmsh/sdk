/**
 * Deliberately NOT re-exported from `vault/index.ts`: the `openllm` binary
 * imports that barrel, and a routing box only ever receives this key, so
 * keeping it out keeps the binary unchanged. Import it by subpath:
 * `@openllmsh/sdk/vault/routing-box-key`.
 */
import { hkdfSha256 } from "./crypto";
import { SEED_BYTES } from "./seed";

export type TRoutingBoxKeyBinding = {
  readonly nonce: Uint8Array;
  readonly userId: string;
  readonly vaultKeyId: string;
  readonly boxId: string;
  readonly epoch: number;
};

/** Derive the box's storage key; the caller must zero the returned bytes. */
export const deriveRoutingBoxKey = (
  seed: Uint8Array,
  binding: TRoutingBoxKeyBinding,
): Promise<Uint8Array> => {
  if (seed.length !== SEED_BYTES) throw new Error("invalid vault seed length");
  if (binding.nonce.length !== 32)
    throw new Error("invalid routing box nonce length");
  if (!Number.isSafeInteger(binding.epoch) || binding.epoch < 0) {
    throw new Error("invalid routing box key epoch");
  }
  return hkdfSha256(
    seed,
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

/**
 * The account DEVICE-CONTROL key: one Ed25519 key per recovery phrase.
 *
 * It signs device grants (`./device-access.ts` sign/verify), daemon-key
 * attestations (`./daemon-attest.ts`) and control-key rotation statements
 * (`@openllmsh/sdk/tunnel` `device-control.ts`). Daemons pin its PUBLIC key.
 *
 * Why the phrase and not the DEK: the server unwraps the DEK from
 * `dek_for_key` on every `sk-llm` request, so anything derived from the DEK is
 * something a compromised cloud can compute. The phrase never reaches the
 * server, and this key is never wrapped for an API key — the cloud only ever
 * sees its public half.
 *
 * Why HKDF and not Argon2id: the phrase carries 128 bits of BIP39 entropy, so
 * a slow KDF buys nothing against a search that cannot be mounted. HKDF also
 * keeps the derivation free of any server-supplied input (`wrap_salt` comes
 * from the cloud) and of the KDF version stamp — the same phrase always yields
 * the same key, on every browser.
 *
 * Callers derive ONLY from a phrase they have already proven (a successful
 * `unlockDek`, or an accepted handoff), so a typo can never mint a plausible
 * foreign key. `mnemonicToEntropy` additionally rejects a bad checksum.
 */

import type { TDeviceControlRotationFields } from "@openllmsh/sdk/tunnel";
import {
  buildDeviceControlRotationMessage,
  DEVICE_CONTROL_ROTATION_VERSION,
  decodeDeviceControlRotation,
  encodeDeviceControlRotation,
} from "@openllmsh/sdk/tunnel";
import { mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { hkdfSha256, zero } from "./crypto";
import {
  deviceAccessPublicKeySpkiB64,
  signDeviceGrant,
  verifyDeviceGrant,
} from "./device-access";
import { normalizePhrase } from "./phrase";

/** HKDF info for the control seed. Distinct from every DEK-side label. */
export const DEVICE_CONTROL_HKDF_INFO = "openllm-device-control-v1";
/** Fixed public HKDF salt — a constant, so no server input touches the key. */
export const DEVICE_CONTROL_HKDF_SALT = "openllm-device-control-salt-v1";
/** HKDF info for the at-rest "control keep" outer wrap (under the DEK). */
export const DEVICE_CONTROL_KEEP_HKDF_INFO = "openllm-device-control-keep-v1";

const SEED_BYTES = 32;

/**
 * `HKDF-SHA256(ikm = BIP39 entropy(phrase), salt = DEVICE_CONTROL_HKDF_SALT,
 * info = DEVICE_CONTROL_HKDF_INFO, 32)` — the Ed25519 private seed.
 *
 * Takes the phrase and nothing else: there is deliberately no DEK parameter
 * and no overload that accepts one. Throws on an invalid mnemonic.
 */
export const deriveDeviceControlSeed = async (
  phrase: string,
): Promise<Uint8Array> => {
  const entropy = mnemonicToEntropy(normalizePhrase(phrase), wordlist);
  try {
    return await hkdfSha256(
      entropy,
      new TextEncoder().encode(DEVICE_CONTROL_HKDF_SALT),
      DEVICE_CONTROL_HKDF_INFO,
      SEED_BYTES,
    );
  } finally {
    zero(entropy);
  }
};

/** The control public key as base64(SPKI DER) — the value daemons pin. */
export const deviceControlPublicKeySpkiB64 = (
  seed: Uint8Array,
): Promise<string> => deviceAccessPublicKeySpkiB64(seed);

/**
 * Outer wrap key for the browser-local control keep:
 * `HKDF(dek, salt = utf8(userId), info = DEVICE_CONTROL_KEEP_HKDF_INFO, 32)`.
 *
 * This is the ONLY place the DEK meets the control key, and it runs one way:
 * the DEK helps LOCK an already-derived seed at rest (alongside a
 * non-extractable per-browser key the server cannot reach), it never produces
 * one. A server holding the DEK but not that browser key still cannot open
 * the keep.
 */
export const controlKeepOuterKey = (
  dek: Uint8Array,
  userId: string,
): Promise<Uint8Array> => {
  if (userId.length === 0) {
    throw new Error("control keep requires a non-empty userId");
  }
  return hkdfSha256(
    dek,
    new TextEncoder().encode(userId),
    DEVICE_CONTROL_KEEP_HKDF_INFO,
    SEED_BYTES,
  );
};

/** Inputs of a rotation: `old` / `new` control pubkeys, `cv` = new generation. */
export type TDeviceControlRotationInput = Omit<
  TDeviceControlRotationFields,
  "v"
>;

/**
 * Sign a rotation statement with the OLD control seed, vouching for `new`.
 * Returns the base64 wire encoding the daemon walks
 * (`bootstrap.device_access_rotations`). Throws when `oldSeed` does not
 * belong to `input.old` — a statement that cannot verify is a bug, not data.
 */
export const signDeviceControlRotation = async (
  oldSeed: Uint8Array,
  input: TDeviceControlRotationInput,
): Promise<string> => {
  if (!Number.isInteger(input.cv) || input.cv < 1) {
    throw new Error("rotation requires cv >= 1");
  }
  if (input.old === input.new) {
    throw new Error("rotation requires distinct old and new keys");
  }
  if ((await deviceControlPublicKeySpkiB64(oldSeed)) !== input.old) {
    throw new Error("rotation signer does not match the old control key");
  }
  const fields: TDeviceControlRotationFields = {
    v: DEVICE_CONTROL_ROTATION_VERSION,
    old: input.old,
    new: input.new,
    cv: input.cv,
  };
  const sig = await signDeviceGrant(
    oldSeed,
    buildDeviceControlRotationMessage(fields),
  );
  return encodeDeviceControlRotation({ ...fields, sig });
};

/**
 * Verify one encoded rotation statement: well-formed, `old` / `new` equal to
 * what the caller expects, signed by `old`. Never throws. `cv` is returned so
 * the caller can enforce monotonicity against its own state.
 */
export const verifyDeviceControlRotation = async (
  encoded: string,
  expect: { readonly old: string; readonly new: string },
): Promise<
  { readonly ok: true; readonly cv: number } | { readonly ok: false }
> => {
  const statement = decodeDeviceControlRotation(encoded);
  if (statement === null) return { ok: false };
  if (statement.old !== expect.old || statement.new !== expect.new) {
    return { ok: false };
  }
  const ok = await verifyDeviceGrant(
    statement.old,
    buildDeviceControlRotationMessage(statement),
    statement.sig,
  );
  return ok ? { ok: true, cv: statement.cv } : { ok: false };
};

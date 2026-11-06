import {
  entropyToMnemonic,
  mnemonicToEntropy,
  validateMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  fromB64,
  hkdfSha256,
  randomBytes,
  toB64,
  toB64Url,
  zero,
} from "./crypto";
import { normalizePhrase, PHRASE_WORD_COUNT } from "./phrase";

/**
 * The vault seed — the ONE per-user vault secret (docs/plans/seed-only-vault.md).
 *
 * The seed is the 16 bytes of BIP39 entropy behind the 12-word recovery
 * phrase. Everything else is derived from it in process, never stored for the
 * account:
 *
 *   - the vault key (DEK) — {@link deriveVaultDek};
 *   - the public vault key id the server checks a seed against —
 *     {@link deriveVaultKeyId};
 *   - the device-control seed (`./device-control.ts`).
 *
 * HKDF, not Argon2id: 128 bits of entropy can't be searched, and every input
 * is fixed (constant salt and info), so no server-supplied value can steer the
 * key — the same argument as `./device-control.ts`.
 *
 * The seed is stored only under an unlock method: a passkey's PRF output
 * ({@link sealSeedWithPrf}, `user_passkeys.sealed_seed` + a local cache) or a
 * PIN (`./pin.ts`, this browser only).
 */

/** BIP39 entropy for a 12-word phrase. */
export const SEED_BYTES = 16;

/** Fixed public HKDF salt for every key derived from the seed. */
export const VAULT_SEED_HKDF_SALT = "openllm-vault-seed-salt-v1";
/** HKDF info for the vault key (DEK). */
export const VAULT_DEK_HKDF_INFO = "openllm-vault-dek-v1";
/** HKDF info for the public vault key id. */
export const VAULT_KEY_ID_HKDF_INFO = "openllm-vault-key-id-v1";
/** HKDF info for the key that seals the seed under a passkey's PRF output. */
export const PASSKEY_SEED_HKDF_INFO = "openllm-vault-passkey-seed-v1";

const DEK_BYTES = 32;
const KEY_ID_BYTES = 16;
const PRF_OUTPUT_BYTES = 32;
const PRF_SALT_BYTES = 32;
const NONCE_BYTES = 12;

const requireSeed = (seed: Uint8Array): void => {
  if (seed.length !== SEED_BYTES) {
    throw new Error(`vault seed must be ${SEED_BYTES} bytes`);
  }
};

const saltBytes = (): Uint8Array =>
  new TextEncoder().encode(VAULT_SEED_HKDF_SALT);

/** A fresh random seed, for a new vault or a rotation. */
export const newSeed = (): Uint8Array => randomBytes(SEED_BYTES);

/**
 * The seed behind a typed or pasted phrase (normalised first). Throws on an
 * invalid mnemonic — check {@link isValidSeedPhrase} to report it nicely.
 */
export const seedFromPhrase = (phrase: string): Uint8Array => {
  if (!isValidSeedPhrase(phrase)) throw new Error("invalid recovery phrase");
  const seed = mnemonicToEntropy(normalizePhrase(phrase), wordlist);
  requireSeed(seed);
  return seed;
};

export const isValidSeedPhrase = (phrase: string): boolean => {
  const normalized = normalizePhrase(phrase);
  // A valid 24-word mnemonic is still not a 16-byte seed.
  return (
    normalized.split(" ").length === PHRASE_WORD_COUNT &&
    validateMnemonic(normalized, wordlist)
  );
};

/** The 12-word phrase for a seed — what the user writes down. */
export const seedToPhrase = (seed: Uint8Array): string => {
  requireSeed(seed);
  return entropyToMnemonic(seed, wordlist);
};

/** The vault key (DEK) for a seed. The caller zeroes it. */
export const deriveVaultDek = (seed: Uint8Array): Promise<Uint8Array> => {
  requireSeed(seed);
  return hkdfSha256(seed, saltBytes(), VAULT_DEK_HKDF_INFO, DEK_BYTES);
};

/**
 * The public vault key id for a seed, base64url. Stored as
 * `users.vault_key_id`: the server's check that a typed phrase or a handed-off
 * seed belongs to this vault. Reveals nothing about the seed (HKDF output
 * under a separate info).
 */
export const deriveVaultKeyId = async (seed: Uint8Array): Promise<string> => {
  requireSeed(seed);
  const id = await hkdfSha256(
    seed,
    saltBytes(),
    VAULT_KEY_ID_HKDF_INFO,
    KEY_ID_BYTES,
  );
  return toB64Url(id);
};

/** What a passkey-sealed seed is bound to. */
export type TSeedPasskeyBinding = {
  /** base64url credential id, exactly as stored in `user_passkeys.id`. */
  readonly credentialId: string;
  /**
   * The vault key id of the sealed seed. Changes exactly when the seed does
   * (rotation, reset), so a version bump that keeps the seed (the one-time
   * migration) never invalidates a passkey row.
   */
  readonly vaultKeyId: string;
};

const bindingAad = (binding: TSeedPasskeyBinding): Uint8Array =>
  new TextEncoder().encode(
    `${PASSKEY_SEED_HKDF_INFO}|${binding.credentialId}|${binding.vaultKeyId}`,
  );

const passkeySeedKey = (
  prfOutput: Uint8Array,
  prfSalt: Uint8Array,
): Promise<Uint8Array> => {
  if (prfOutput.length !== PRF_OUTPUT_BYTES) {
    throw new Error(`PRF output must be ${PRF_OUTPUT_BYTES} bytes`);
  }
  if (prfSalt.length !== PRF_SALT_BYTES) {
    throw new Error(`PRF salt must be ${PRF_SALT_BYTES} bytes`);
  }
  return hkdfSha256(prfOutput, prfSalt, PASSKEY_SEED_HKDF_INFO, 32);
};

/**
 * Seal the seed under a passkey's PRF output: base64 `IV || ct+tag`. The PRF
 * output never leaves the browser, so the server can store this but never
 * open it. Never zeroes its inputs.
 */
export const sealSeedWithPrf = async (
  seed: Uint8Array,
  prfOutput: Uint8Array,
  prfSalt: Uint8Array,
  binding: TSeedPasskeyBinding,
): Promise<string> => {
  requireSeed(seed);
  const key = await passkeySeedKey(prfOutput, prfSalt);
  try {
    const nonce = randomBytes(NONCE_BYTES);
    const ciphertext = await aesGcmEncrypt(
      key,
      nonce,
      seed,
      bindingAad(binding),
    );
    const out = new Uint8Array(nonce.length + ciphertext.length);
    out.set(nonce, 0);
    out.set(ciphertext, nonce.length);
    return toB64(out);
  } finally {
    zero(key);
  }
};

/**
 * Open a {@link sealSeedWithPrf} copy. Throws on a bad auth tag: another
 * credential, another seed's key id, or a diverged PRF value.
 */
export const openSeedWithPrf = async (
  sealedB64: string,
  prfOutput: Uint8Array,
  prfSalt: Uint8Array,
  binding: TSeedPasskeyBinding,
): Promise<Uint8Array> => {
  const sealed = fromB64(sealedB64);
  if (sealed.length <= NONCE_BYTES) throw new Error("sealed seed is too short");
  const key = await passkeySeedKey(prfOutput, prfSalt);
  try {
    const seed = await aesGcmDecrypt(
      key,
      sealed.subarray(0, NONCE_BYTES),
      sealed.subarray(NONCE_BYTES),
      bindingAad(binding),
    );
    if (seed.length !== SEED_BYTES) {
      zero(seed);
      throw new Error("sealed seed did not contain a vault seed");
    }
    return seed;
  } finally {
    zero(key);
  }
};

/**
 * The vault key tree (docs/plans/seed-only-vault.md §2a). Each branch key is
 * HKDF from the vault root key (the DEK) under a fixed label; each leaf is
 * HKDF from its branch under the item's stable id. A parent derives all its
 * children, a child never its parent or siblings, and nothing is stored.
 *
 * A full-access holder of the root (the browser after unlock, every default
 * API key) derives every branch, so by default every key reads what any other
 * wrote — today's behaviour. Leaf ids must never depend on which key wrote the
 * item (a memory's space is its scope, a chat's leaf is its session id).
 */
export const VAULT_BRANCHES = [
  "credentials",
  "memory",
  "chats",
  "apps",
  "teams",
  "keys",
] as const;

export type TVaultBranch = (typeof VAULT_BRANCHES)[number];

/** HKDF info prefix for a branch; the branch name follows. */
export const VAULT_BRANCH_HKDF_INFO = "openllm-vault-branch-v1";
/** HKDF info prefix for a leaf; the branch and the leaf id follow. */
export const VAULT_LEAF_HKDF_INFO = "openllm-vault-leaf-v1";

const requireKey = (key: Uint8Array, label: string): void => {
  if (key.length !== DEK_BYTES) throw new Error(`${label} must be 32 bytes`);
};

/** A branch key from the vault root key (the DEK). The caller zeroes it. */
export const deriveBranchKey = async (
  rootKey: Uint8Array,
  branch: TVaultBranch,
): Promise<Uint8Array> => {
  requireKey(rootKey, "vault root key");
  return hkdfSha256(
    rootKey,
    saltBytes(),
    JSON.stringify([VAULT_BRANCH_HKDF_INFO, branch]),
    DEK_BYTES,
  );
};

/**
 * A leaf key from its branch key and the item's stable id (session id, memory
 * space). JSON-encoded info, so no id can collide with another branch's.
 * The caller zeroes it.
 */
export const deriveLeafKey = async (
  branchKey: Uint8Array,
  branch: TVaultBranch,
  leafId: string,
): Promise<Uint8Array> => {
  requireKey(branchKey, "branch key");
  if (leafId.length === 0) throw new Error("leaf id must not be empty");
  return hkdfSha256(
    branchKey,
    saltBytes(),
    JSON.stringify([VAULT_LEAF_HKDF_INFO, branch, leafId]),
    DEK_BYTES,
  );
};

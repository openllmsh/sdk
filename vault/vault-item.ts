import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  fromB64,
  randomBytes,
  toB64,
  zero,
} from "./crypto";
import type { TVaultBranch } from "./seed";
import { deriveBranchKey, deriveLeafKey } from "./seed";

/**
 * Vault data encrypted under the key tree (docs/plans/seed-only-vault.md §2a).
 *
 * Every item says which key it was sealed under, in its nonce:
 *
 *   - `k1:<base64 nonce>` — under the branch key, or the leaf key when the
 *     item names a leaf, derived from the vault root key;
 *   - a bare `<base64 nonce>` — legacy, sealed directly under the root key.
 *     Read-only, and only until the 1-week sunset; nothing writes it any more.
 *
 * Self-describing on purpose: a caller says only WHAT it is reading
 * ({@link TVaultItemRef}), never which format the user is in, so items of both
 * formats can sit side by side (mid-migration, or a server write racing a
 * browser one) and every holder of the root key reads them all — by default
 * every key reads what any other wrote.
 */

/** Which part of the tree an item belongs to. */
export type TVaultItemRef = {
  readonly branch: TVaultBranch;
  /** Stable id of the item's leaf (session id, memory scope); none = branch key. */
  readonly leaf?: string;
};

export type TEncryptedVaultItem = {
  readonly ciphertext: string;
  readonly nonce: string;
};

/** Nonce prefix of an item sealed under the key tree. */
export const VAULT_ITEM_TAG = "k1:";

const NONCE_BYTES = 12;

const itemKey = async (
  rootKey: Uint8Array,
  ref: TVaultItemRef,
): Promise<Uint8Array> => {
  const branch = await deriveBranchKey(rootKey, ref.branch);
  if (ref.leaf === undefined) return branch;
  try {
    return await deriveLeafKey(branch, ref.branch, ref.leaf);
  } finally {
    zero(branch);
  }
};

/** `true` when an item was sealed under the key tree, not the bare root. */
export const isTreeSealed = (nonce: string): boolean =>
  nonce.startsWith(VAULT_ITEM_TAG);

/**
 * Seal bytes for the vault at `ref`, from the root key. Never zeroes its
 * inputs. Always the tree format.
 */
export const sealVaultBytes = async (
  rootKey: Uint8Array,
  ref: TVaultItemRef,
  plaintext: Uint8Array,
): Promise<TEncryptedVaultItem> => {
  const key = await itemKey(rootKey, ref);
  try {
    const nonce = randomBytes(NONCE_BYTES);
    const ct = await aesGcmEncrypt(key, nonce, plaintext);
    return { ciphertext: toB64(ct), nonce: `${VAULT_ITEM_TAG}${toB64(nonce)}` };
  } finally {
    zero(key);
  }
};

/**
 * Open an item of either format from the root key. Throws on a wrong key or
 * a tampered item (auth tag). The caller zeroes the result if it is secret.
 */
export const openVaultBytes = async (
  rootKey: Uint8Array,
  ref: TVaultItemRef,
  item: TEncryptedVaultItem,
): Promise<Uint8Array> => {
  if (!isTreeSealed(item.nonce)) {
    // Legacy: sealed directly under the root key (removed at the sunset).
    return aesGcmDecrypt(
      rootKey,
      fromB64(item.nonce),
      fromB64(item.ciphertext),
    );
  }
  const key = await itemKey(rootKey, ref);
  try {
    return await aesGcmDecrypt(
      key,
      fromB64(item.nonce.slice(VAULT_ITEM_TAG.length)),
      fromB64(item.ciphertext),
    );
  } finally {
    zero(key);
  }
};

/** {@link sealVaultBytes} for a string. */
export const sealVaultText = (
  rootKey: Uint8Array,
  ref: TVaultItemRef,
  plaintext: string,
): Promise<TEncryptedVaultItem> =>
  sealVaultBytes(rootKey, ref, new TextEncoder().encode(plaintext));

/** {@link openVaultBytes} for a string. */
export const openVaultText = async (
  rootKey: Uint8Array,
  ref: TVaultItemRef,
  item: TEncryptedVaultItem,
): Promise<string> => {
  const bytes = await openVaultBytes(rootKey, ref, item);
  try {
    return new TextDecoder().decode(bytes);
  } finally {
    zero(bytes);
  }
};

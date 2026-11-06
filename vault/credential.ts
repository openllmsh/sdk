import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  fromB64,
  randomBytes,
  toB64,
} from "./crypto";

const NONCE_BYTES = 12;

export type TEncryptedCredential = {
  readonly ciphertext: string;
  readonly nonce: string;
};

/**
 * Encrypt a credential plaintext under the user's DEK (root key).
 *
 * @deprecated Seal vault data with {@link sealVaultText} /
 *   {@link sealVaultBytes} from `./vault-item` under the matching branch
 *   (`credentials`, `memory`, `chats`, `apps`, `keys`, `teams`). Kept for
 *   legacy-path tests and the one-week read sunset of untagged rows.
 */
export const encryptCredential = async (
  dek: Uint8Array,
  plaintext: string,
): Promise<TEncryptedCredential> => {
  const nonce = randomBytes(NONCE_BYTES);
  const ct = await aesGcmEncrypt(
    dek,
    nonce,
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: toB64(ct), nonce: toB64(nonce) };
};

/**
 * Decrypt a credential row sealed directly under the DEK.
 *
 * @deprecated Open vault data with {@link openVaultText} /
 *   {@link openVaultBytes} from `./vault-item` (handles both tree-tagged
 *   and legacy untagged items). Kept for legacy-path tests.
 */
export const decryptCredential = async (
  dek: Uint8Array,
  ciphertextB64: string,
  nonceB64: string,
): Promise<string> => {
  const pt = await aesGcmDecrypt(
    dek,
    fromB64(nonceB64),
    fromB64(ciphertextB64),
  );
  return new TextDecoder().decode(pt);
};

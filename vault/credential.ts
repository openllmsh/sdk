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
 * Encrypt a credential plaintext under the user's DEK. Output is a
 * `{ciphertext, nonce}` pair of base64 strings ready to be POSTed
 * to `/api/credentials`. The plaintext shape is provider-specific —
 * a raw `api_key` string for most providers, `JSON.stringify(aws)`
 * for Bedrock, `JSON.stringify(oauth)` for OAuth providers.
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
 * Decrypt a credential row. Used by the vault reset flow
 * (`components/vault/vault-rotate-dialog.tsx`) when
 * the user opts to re-encrypt existing credentials under a new DEK,
 * and by any future browser-side "view raw credential" affordance.
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

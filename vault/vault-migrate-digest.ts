/**
 * Digest of a vault row's ciphertext fields for the one-time seed-vault
 * migration (docs/plans/seed-only-vault.md §4). The browser and the server
 * must compute the same value: SHA-256 over the fields joined by `\n`
 * (null → empty string), returned as standard base64.
 */

import { toB64 } from "./crypto";

const subtle = (): SubtleCrypto => {
  const s = globalThis.crypto?.subtle;
  if (s === undefined) {
    throw new Error("WebCrypto SubtleCrypto is not available in this runtime");
  }
  return s;
};

/**
 * SHA-256 of `fields` joined by `"\n"` (`null` → `""`), as standard base64.
 */
export const vaultMigrateDigest = async (
  fields: ReadonlyArray<string | null | undefined>,
): Promise<string> => {
  const joined = fields.map((f) => (f == null ? "" : f)).join("\n");
  const digest = new Uint8Array(
    await subtle().digest("SHA-256", new TextEncoder().encode(joined)),
  );
  return toB64(digest);
};

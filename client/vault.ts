/**
 * Client vault session — composition over `@openllmsh/sdk/vault`.
 *
 * Holds an optional DEK (from an injected unlock, or unwrapped from
 * `sk-llm` + `dek_for_key`) and exposes seal / credential / CLI-auth helpers.
 * No new crypto: every method calls an existing vault primitive. `close()`
 * zeros the DEK (and any retained API-key secret bytes).
 */

import type {
  TCliAuthKeypair,
  TCliAuthSealBinding,
  TCliAuthSealed,
  TConnectorSealBinding,
  TConnectorSealed,
  TEncryptedCredential,
  TMintedApiKey,
} from "@openllmsh/sdk/vault";
import {
  decryptCredential,
  deriveApiWrapKey,
  encryptCredential,
  generateCliAuthKeypair,
  generateResumableCliAuthKeypair,
  importCliAuthPrivateKey,
  mintApiKey,
  openCliAuth,
  parseApiKey,
  sealToDaemon,
  sealToPublicKey,
  unwrapDekForKey,
  zero,
} from "@openllmsh/sdk/vault";

export type TDekBorrow<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false };

export type TClientVault = {
  /** Public id half of the configured `sk-llm` key, or null if missing/invalid. */
  readonly keyId: string | null;
  /** True when a DEK is held in memory. */
  readonly isUnlocked: () => boolean;
  /**
   * Unwrap `dek_for_key` with the configured API key and adopt the DEK.
   * Replaces any previously held DEK (prior bytes are zeroed).
   */
  readonly unlockFromApiKey: (dekForKeyB64: string) => Promise<void>;
  /**
   * Adopt an already-unwrapped DEK (browser host glue after PIN/passkey unlock).
   * Copies the bytes; the caller retains ownership of `dek` and may zero it.
   */
  readonly adoptDek: (dek: Uint8Array) => void;
  /**
   * Run `fn` against a PRIVATE COPY of the DEK, and `zero()` that copy when
   * `fn` settles. Returns `{ ok: false }` (without calling `fn`) when locked.
   */
  readonly withDek: <T>(
    fn: (dek: Uint8Array) => T | Promise<T>,
  ) => Promise<TDekBorrow<T>>;
  readonly encryptCredential: (
    plaintext: string,
  ) => Promise<TEncryptedCredential>;
  readonly decryptCredential: (
    ciphertextB64: string,
    nonceB64: string,
  ) => Promise<string>;
  /**
   * X25519 sealed-box to a device/daemon SPKI pubkey — today's `sealToDaemon`
   * (local_key / oauth code flows). Proposal name: `sealToDevice`.
   */
  readonly sealToDevice: (
    recipientPubSpkiB64: string,
    plaintext: string,
  ) => Promise<string>;
  readonly sealToPublicKey: (
    binding: TConnectorSealBinding,
    plaintext: Uint8Array,
  ) => Promise<TConnectorSealed>;
  readonly openCliAuth: (
    binding: TCliAuthSealBinding,
    sealed: TCliAuthSealed,
    privateKey: CryptoKey,
  ) => Promise<Uint8Array>;
  readonly generateCliAuthKeypair: () => Promise<TCliAuthKeypair>;
  readonly generateResumableCliAuthKeypair: () => Promise<
    TCliAuthKeypair & { readonly privateKeyPkcs8B64: string }
  >;
  readonly importCliAuthPrivateKey: (pkcs8B64: string) => Promise<CryptoKey>;
  readonly mintApiKey: (vaultVersion: number) => Promise<TMintedApiKey>;
  /**
   * Borrow a private copy of the API-key secret. The copy is `zero()`ed when
   * `fn` settles. Returns `{ ok: false }` when no valid key was configured.
   */
  readonly withApiKeySecret: <T>(
    fn: (secret: Uint8Array, id: string) => T | Promise<T>,
  ) => Promise<TDekBorrow<T>>;
  /** Zero the held DEK (and any retained API-key secret). Idempotent. */
  readonly close: () => void;
};

export type TCreateClientVaultOptions = {
  readonly apiKey: string;
  readonly dek?: Uint8Array;
};

const lockedError = (op: string): Error =>
  new Error(`vault session is locked — cannot ${op}`);

/**
 * Build a vault session. Does not unwrap `dek_for_key` on its own — call
 * {@link TClientVault.unlockFromApiKey} when the blob is available. A DEK
 * passed here is copied.
 */
export const createClientVault = (
  options: TCreateClientVaultOptions,
): TClientVault => {
  let dek: Uint8Array | null =
    options.dek !== undefined ? new Uint8Array(options.dek) : null;
  let apiKeySecret: Uint8Array | null = null;

  const parsed = parseApiKey(options.apiKey);
  if (parsed !== null) {
    apiKeySecret = new Uint8Array(parsed.secret);
  }
  const keyId = parsed?.id ?? null;

  const clearDek = (): void => {
    if (dek !== null) {
      zero(dek);
      dek = null;
    }
  };

  const clearSecret = (): void => {
    if (apiKeySecret !== null) {
      zero(apiKeySecret);
      apiKeySecret = null;
    }
  };

  const withDek = async <T>(
    fn: (d: Uint8Array) => T | Promise<T>,
  ): Promise<TDekBorrow<T>> => {
    if (dek === null) return { ok: false };
    const copy = new Uint8Array(dek);
    try {
      const value = await fn(copy);
      return { ok: true, value };
    } finally {
      zero(copy);
    }
  };

  const withApiKeySecret = async <T>(
    fn: (secret: Uint8Array, id: string) => T | Promise<T>,
  ): Promise<TDekBorrow<T>> => {
    if (parsed === null || apiKeySecret === null) return { ok: false };
    const copy = new Uint8Array(apiKeySecret);
    try {
      const value = await fn(copy, parsed.id);
      return { ok: true, value };
    } finally {
      zero(copy);
    }
  };

  const vault: TClientVault = {
    keyId,
    isUnlocked: (): boolean => dek !== null,
    unlockFromApiKey: async (dekForKeyB64: string): Promise<void> => {
      if (parsed === null || apiKeySecret === null) {
        throw new Error("vault session has no valid sk-llm API key to unwrap");
      }
      const wrapKey = await deriveApiWrapKey(apiKeySecret, parsed.id);
      try {
        const next = await unwrapDekForKey(dekForKeyB64, wrapKey);
        clearDek();
        dek = next;
      } finally {
        zero(wrapKey);
      }
    },
    adoptDek: (next: Uint8Array): void => {
      clearDek();
      dek = new Uint8Array(next);
    },
    withDek,
    encryptCredential: async (
      plaintext: string,
    ): Promise<TEncryptedCredential> => {
      const borrowed = await withDek((d) => encryptCredential(d, plaintext));
      if (!borrowed.ok) throw lockedError("encrypt a credential");
      return borrowed.value;
    },
    decryptCredential: async (
      ciphertextB64: string,
      nonceB64: string,
    ): Promise<string> => {
      const borrowed = await withDek((d) =>
        decryptCredential(d, ciphertextB64, nonceB64),
      );
      if (!borrowed.ok) throw lockedError("decrypt a credential");
      return borrowed.value;
    },
    sealToDevice: (
      recipientPubSpkiB64: string,
      plaintext: string,
    ): Promise<string> => sealToDaemon(recipientPubSpkiB64, plaintext),
    sealToPublicKey: (
      binding: TConnectorSealBinding,
      plaintext: Uint8Array,
    ): Promise<TConnectorSealed> => sealToPublicKey(binding, plaintext),
    openCliAuth: (
      binding: TCliAuthSealBinding,
      sealed: TCliAuthSealed,
      privateKey: CryptoKey,
    ): Promise<Uint8Array> => openCliAuth(binding, sealed, privateKey),
    generateCliAuthKeypair: (): Promise<TCliAuthKeypair> =>
      generateCliAuthKeypair(),
    generateResumableCliAuthKeypair: (): Promise<
      TCliAuthKeypair & { readonly privateKeyPkcs8B64: string }
    > => generateResumableCliAuthKeypair(),
    importCliAuthPrivateKey: (pkcs8B64: string): Promise<CryptoKey> =>
      importCliAuthPrivateKey(pkcs8B64),
    mintApiKey: async (vaultVersion: number): Promise<TMintedApiKey> => {
      const borrowed = await withDek((d) => mintApiKey(d, vaultVersion));
      if (!borrowed.ok) throw lockedError("mint an API key");
      return borrowed.value;
    },
    withApiKeySecret,
    close: (): void => {
      clearDek();
      clearSecret();
    },
  };

  return vault;
};

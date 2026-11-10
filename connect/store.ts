import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  fromB64,
  randomBytes,
  toB64,
} from "@openllmsh/sdk/vault/crypto";
import type { TConnection } from "./oauth";

/**
 * Where your app keeps each user's connection. `key` is YOUR user id (or
 * session id) — whatever identifies the person in your app. The values are
 * credentials: keep them server-side and encrypted at rest
 * (`encryptedConnectionStore` does that over any string storage).
 */
export type TConnectionStore = {
  readonly load: (key: string) => Promise<TConnection | null>;
  readonly save: (key: string, connection: TConnection) => Promise<void>;
  readonly clear: (key: string) => Promise<void>;
};

/** Plain string storage: a DB column, Redis, a file, KV. */
export type TStringStore = {
  readonly get: (key: string) => Promise<string | null>;
  readonly set: (key: string, value: string) => Promise<void>;
  readonly delete: (key: string) => Promise<void>;
};

const SEAL_VERSION = "v1";

const keyBytes = (secretB64: string): Uint8Array => {
  let bytes: Uint8Array;
  try {
    bytes = fromB64(secretB64);
  } catch {
    bytes = new Uint8Array(0);
  }
  if (bytes.length !== 32)
    throw new Error("The connection secret must be 32 bytes, base64");
  return bytes;
};

const aadFor = (key: string): Uint8Array =>
  new TextEncoder().encode(`openllm-connection:${SEAL_VERSION}:${key}`);

/**
 * A `TConnectionStore` over string storage, AES-256-GCM under a 32-byte
 * secret (base64, e.g. `openssl rand -base64 32`). Each value is bound to its
 * key, so one user's row can't be swapped into another's.
 */
export const encryptedConnectionStore = (
  storage: TStringStore,
  secretB64: string,
): TConnectionStore => {
  // Resolved on first use, not at construction: an app that imports this
  // module must still build and boot before its secret is configured.
  let secret: Uint8Array | undefined;
  const secretKey = (): Uint8Array => (secret ??= keyBytes(secretB64));
  return {
    load: async (key) => {
      const raw = await storage.get(key);
      if (raw === null) return null;
      const [version, nonce, ct] = raw.split(".");
      if (version !== SEAL_VERSION || nonce === undefined || ct === undefined)
        return null;
      // Outside the try: a bad secret is a config error and must surface,
      // not read as "not connected".
      const keyBytesForLoad = secretKey();
      try {
        const plain = await aesGcmDecrypt(
          keyBytesForLoad,
          fromB64(nonce),
          fromB64(ct),
          aadFor(key),
        );
        return JSON.parse(new TextDecoder().decode(plain)) as TConnection;
      } catch {
        return null;
      }
    },
    save: async (key, connection) => {
      const nonce = randomBytes(12);
      const ct = await aesGcmEncrypt(
        secretKey(),
        nonce,
        new TextEncoder().encode(JSON.stringify(connection)),
        aadFor(key),
      );
      await storage.set(key, `${SEAL_VERSION}.${toB64(nonce)}.${toB64(ct)}`);
    },
    clear: (key) => storage.delete(key),
  };
};

/** In-memory string storage: tests and single-process demos only. */
export const memoryStringStore = (): TStringStore => {
  const map = new Map<string, string>();
  return {
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => {
      map.set(key, value);
    },
    delete: async (key) => {
      map.delete(key);
    },
  };
};

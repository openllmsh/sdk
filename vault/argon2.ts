import { argon2id } from "hash-wasm";

export type TArgon2Params = {
  readonly parallelism: number;
  readonly iterations: number;
  readonly memorySize: number;
  readonly hashLength: number;
};

/**
 * Every set of Argon2id parameters this build knows how to derive with,
 * keyed by the version stamped into the blob that was wrapped with them.
 *
 * READ THIS BEFORE TOUCHING A PARAMETER. Changing any value changes the
 * derived `wrap_key`, which makes every AES-GCM auth tag produced under the
 * old value fail. Because the design is zero-knowledge there is no
 * server-side escape hatch: editing a row here in place would ship as an
 * instant, PERMANENT lock-out of every existing vault — the correct recovery
 * phrase included — and every provider credential in them.
 *
 * So parameters are append-only. To re-tune:
 *
 *   1. add a NEW version key with the new numbers, leaving every existing
 *      entry byte-identical forever;
 *   2. bump {@link CURRENT_KDF_VERSION} so fresh wraps use it;
 *   3. leave the old entries in place — they are the only way the blobs
 *      already on disk can ever be opened again.
 *
 * Version 1 is the original, and is also what an UNSTAMPED blob means: every
 * blob written before stamping existed was produced with exactly these
 * numbers. See `./wrapped.ts` for the on-disk encoding.
 *
 * v1 — conservative-but-tolerable on mobile browsers in 2026:
 *   memorySize  64 MiB    — high enough to make GPU attacks expensive
 *   iterations  3         — recommended baseline
 *   parallelism 1         — single-thread to keep WASM portable
 *   hashLength  32 bytes  — direct AES-GCM key
 */
export const KDF_PARAMS_BY_VERSION = {
  1: {
    parallelism: 1,
    iterations: 3,
    memorySize: 64 * 1024,
    hashLength: 32,
  },
} as const satisfies Record<number, TArgon2Params>;

export type TKdfVersion = keyof typeof KDF_PARAMS_BY_VERSION;

/** The version fresh wraps are produced under. */
export const CURRENT_KDF_VERSION: TKdfVersion = 1;

/**
 * The version an unstamped blob is from. Not a guess — stamping was
 * introduced alongside version 2's *possibility*, so everything unstamped
 * predates it and was necessarily derived with v1 parameters.
 */
export const LEGACY_KDF_VERSION: TKdfVersion = 1;

export const isKdfVersion = (n: number): n is TKdfVersion =>
  Object.hasOwn(KDF_PARAMS_BY_VERSION, n);

/**
 * Narrow a declared version to one this build can derive, or fail loudly.
 *
 * A blob stamped with a version this build doesn't carry means the browser is
 * older than the vault — an app-update problem with a clear answer, not the
 * silent "wrong password" an unknown-params derivation would masquerade as.
 */
export const requireKdfVersion = (version: number): TKdfVersion => {
  if (!isKdfVersion(version)) {
    throw new Error(
      `vault blob was wrapped with unknown KDF version ${version} — this build is too old to open it`,
    );
  }
  return version;
};

export const kdfParamsFor = (version: number): TArgon2Params =>
  KDF_PARAMS_BY_VERSION[requireKdfVersion(version)];

/**
 * Derive a 32-byte wrap key from a secret (recovery phrase or PIN) and a salt.
 *
 * `version` MUST be the version the blob being opened declares — never
 * "whatever is current". Passing the current version to an old blob is the
 * brick this module exists to prevent. Lazy-loaded WASM (~50 KB); the first
 * call pays the cold start.
 */
export const deriveWrapKey = async (
  secret: string,
  saltBytes: Uint8Array,
  version: TKdfVersion = CURRENT_KDF_VERSION,
): Promise<Uint8Array> => {
  const params = kdfParamsFor(version);
  const hash = await argon2id({
    password: secret,
    salt: saltBytes,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memorySize,
    hashLength: params.hashLength,
    outputType: "binary",
  });
  return hash;
};

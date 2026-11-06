/**
 * Device handoff: an unlocked device seals the DEK (and, when it holds one,
 * the recovery phrase) to a NEW device's ephemeral X25519 key, so the new
 * device unlocks without the phrase being typed. The server relays only the
 * public keys and the ciphertext. Design: `docs/plans/vault-device-handoff.md`.
 *
 * Construction:
 *   shared = X25519(approver_eph, requester_pub)
 *   key    = HKDF-SHA256(shared, salt = utf8(request_id), info = binding, 32)
 *   sealed = AES-256-GCM(key, nonce, JSON{ v, user_id, request_id,
 *                                          vault_version, dek, phrase? })
 * where `binding` names the account, the request, the vault generation and
 * BOTH public keys, so a ciphertext moved onto any other request, account,
 * generation or key pair derives a different key and fails its auth tag.
 *
 * Pure WebCrypto, bytes-in/bytes-out — runs in the browser and in Bun alike,
 * like the rest of this package. X25519 is the same primitive the browser
 * already relies on for daemon sealing (`./cred-seal.ts`).
 */
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  fromB64,
  hkdfSha256,
  randomBytes,
  toB64,
  zero,
} from "./crypto";
import { unlockDek } from "./derive";
import {
  deriveVaultDek,
  deriveVaultKeyId,
  SEED_BYTES,
  seedToPhrase,
} from "./seed";

export const HANDOFF_HKDF_INFO = "openllm-vault-handoff-v1";
export const HANDOFF_CODE_INFO = "openllm-vault-handoff-code-v1";
/** Digits in the verification code both screens show. */
export const HANDOFF_CODE_DIGITS = 6;

const NONCE_BYTES = 12;
/** v2 carries the vault seed only; v1 (DEK + phrase) is refused. */
const PAYLOAD_VERSION = 2;

const subtle = (): SubtleCrypto => {
  const s = globalThis.crypto?.subtle;
  if (s === undefined) {
    throw new Error("WebCrypto SubtleCrypto is not available in this runtime");
  }
  return s;
};

/** An X25519 key pair whose private half cannot leave this runtime. */
export type TX25519Keypair = {
  /** SPKI DER, base64. */
  readonly publicKeyB64: string;
  /** Non-extractable; held in memory only. */
  readonly privateKey: CryptoKey;
};

/**
 * Mint an ephemeral X25519 key pair. `generateKey`'s extractable flag covers
 * both halves, so the public SPKI is exported first and the private half is
 * re-imported non-extractable: nothing on this page can read its bytes back.
 */
export const generateX25519Keypair = async (): Promise<TX25519Keypair> => {
  const pair = (await subtle().generateKey({ name: "X25519" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const spki = new Uint8Array(await subtle().exportKey("spki", pair.publicKey));
  const pkcs8 = new Uint8Array(
    await subtle().exportKey("pkcs8", pair.privateKey),
  );
  try {
    const privateKey = await importX25519PrivateKey(toB64(pkcs8));
    return { publicKeyB64: toB64(spki), privateKey };
  } finally {
    zero(pkcs8);
  }
};

/** Re-import a PKCS#8 X25519 private key as non-extractable. */
export const importX25519PrivateKey = async (
  pkcs8B64: string,
): Promise<CryptoKey> => {
  const pkcs8 = fromB64(pkcs8B64);
  try {
    return await subtle().importKey(
      "pkcs8",
      pkcs8 as BufferSource,
      { name: "X25519" },
      false,
      ["deriveBits"],
    );
  } finally {
    zero(pkcs8);
  }
};

/**
 * X25519 key pair for resume flows: the private half is also returned as
 * PKCS#8 base64 so the caller can persist it (0600) and re-import later. The
 * in-memory key stays non-extractable.
 */
export const generateResumableX25519Keypair = async (): Promise<
  TX25519Keypair & { readonly privateKeyPkcs8B64: string }
> => {
  const pair = (await subtle().generateKey({ name: "X25519" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const spki = new Uint8Array(await subtle().exportKey("spki", pair.publicKey));
  const pkcs8 = new Uint8Array(
    await subtle().exportKey("pkcs8", pair.privateKey),
  );
  try {
    const privateKeyPkcs8B64 = toB64(pkcs8);
    return {
      publicKeyB64: toB64(spki),
      privateKey: await importX25519PrivateKey(privateKeyPkcs8B64),
      privateKeyPkcs8B64,
    };
  } finally {
    zero(pkcs8);
  }
};

/** What the ciphertext is bound to. Every field is checked on open. */
export type THandoffBinding = {
  readonly userId: string;
  readonly requestId: string;
  readonly vaultVersion: number;
  /** The new device's public key, SPKI DER base64. */
  readonly requesterPublicKeyB64: string;
};

/**
 * What travels: the vault seed, and nothing else — the new device derives the
 * vault key (and the device-control key) from it, exactly as an unlock does
 * (docs/plans/seed-only-vault.md).
 */
export type THandoffPayload = {
  readonly seed: Uint8Array;
};

/** The wire form of a sealed handoff — three base64 strings. */
export type TSealedHandoff = {
  /** The approver's ephemeral X25519 public key, SPKI DER base64. */
  readonly approver_pubkey: string;
  readonly nonce: string;
  /** AES-GCM ciphertext with its 16-byte tag appended. */
  readonly ciphertext: string;
};

/**
 * HKDF `info`: a JSON array, so no field can bleed into its neighbour the
 * way a separator-joined string could (`"a|b" + "c"` vs `"a" + "b|c"`).
 */
const bindingInfo = (
  binding: THandoffBinding,
  approverPublicKeyB64: string,
): string =>
  JSON.stringify([
    HANDOFF_HKDF_INFO,
    binding.userId,
    binding.requestId,
    binding.vaultVersion,
    binding.requesterPublicKeyB64,
    approverPublicKeyB64,
  ]);

const importX25519Public = (spkiB64: string): Promise<CryptoKey> =>
  subtle().importKey(
    "spki",
    fromB64(spkiB64) as BufferSource,
    { name: "X25519" },
    false,
    [],
  );

const deriveHandoffKey = async (
  privateKey: CryptoKey,
  peerPublicKeyB64: string,
  binding: THandoffBinding,
  approverPublicKeyB64: string,
): Promise<Uint8Array> => {
  const peer = await importX25519Public(peerPublicKeyB64);
  const shared = new Uint8Array(
    await subtle().deriveBits(
      { name: "X25519", public: peer },
      privateKey,
      256,
    ),
  );
  try {
    return await hkdfSha256(
      shared,
      new TextEncoder().encode(binding.requestId),
      bindingInfo(binding, approverPublicKeyB64),
      32,
    );
  } finally {
    zero(shared);
  }
};

/**
 * Seal the vault seed to the requester. Run on the APPROVING device. The
 * caller keeps ownership of `payload.seed` — it is copied into the plaintext,
 * and the plaintext buffer is zeroed here.
 */
export const sealHandoff = async (
  binding: THandoffBinding,
  payload: THandoffPayload,
): Promise<TSealedHandoff> => {
  if (payload.seed.length !== SEED_BYTES) {
    throw new Error(`handoff seed must be ${SEED_BYTES} bytes`);
  }
  const eph = await generateX25519Keypair();
  const key = await deriveHandoffKey(
    eph.privateKey,
    binding.requesterPublicKeyB64,
    binding,
    eph.publicKeyB64,
  );
  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      v: PAYLOAD_VERSION,
      user_id: binding.userId,
      request_id: binding.requestId,
      vault_version: binding.vaultVersion,
      seed: toB64(payload.seed),
    }),
  );
  try {
    const nonce = randomBytes(NONCE_BYTES);
    const ciphertext = await aesGcmEncrypt(key, nonce, plaintext);
    return {
      approver_pubkey: eph.publicKeyB64,
      nonce: toB64(nonce),
      ciphertext: toB64(ciphertext),
    };
  } finally {
    zero(key);
    zero(plaintext);
  }
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Open a sealed handoff with the requester's private key. Run on the NEW
 * device. Throws on any failure — a wrong key, a tampered byte, a ciphertext
 * bound to another request/account/generation, or a malformed payload. The
 * caller owns (and must eventually `zero()`) the seed.
 */
export const openHandoff = async (
  binding: THandoffBinding,
  sealed: TSealedHandoff,
  requesterPrivateKey: CryptoKey,
): Promise<THandoffPayload> => {
  const key = await deriveHandoffKey(
    requesterPrivateKey,
    sealed.approver_pubkey,
    binding,
    sealed.approver_pubkey,
  );
  let plaintext: Uint8Array;
  try {
    plaintext = await aesGcmDecrypt(
      key,
      fromB64(sealed.nonce),
      fromB64(sealed.ciphertext),
    );
  } finally {
    zero(key);
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    if (
      !isRecord(parsed) ||
      parsed.v !== PAYLOAD_VERSION ||
      parsed.user_id !== binding.userId ||
      parsed.request_id !== binding.requestId ||
      parsed.vault_version !== binding.vaultVersion ||
      typeof parsed.seed !== "string"
    ) {
      throw new Error("handoff payload does not match its binding");
    }
    const seed = fromB64(parsed.seed);
    if (seed.length !== SEED_BYTES) {
      zero(seed);
      throw new Error("handoff payload did not contain a vault seed");
    }
    return { seed };
  } finally {
    zero(plaintext);
  }
};

/**
 * What the new device checks a handed-off seed against — the server-side
 * anchor of the account's vault, by its format:
 *
 *   - `seed`: the public `users.vault_key_id` — the seed must derive it;
 *   - `legacy` (until the sunset): `wrap_salt` + `wrapped_dek` — the seed's
 *     phrase must open them, and the vault key is the one inside.
 *
 * Neither anchor can be swapped by a session-cookie holder without a full,
 * visible vault reset, so a seed that matches is this vault's seed.
 */
export type THandoffAnchor =
  | { readonly kind: "seed"; readonly vaultKeyId: string }
  | {
      readonly kind: "legacy";
      readonly wrapSaltB64: string;
      readonly wrappedDekB64: string;
    };

/** An opened handoff the new device may install. The caller zeroes both. */
export type TAcceptedHandoff = {
  readonly seed: Uint8Array;
  readonly dek: Uint8Array;
};

/**
 * Check an opened seed against the vault's anchor before the session gets it,
 * and return the vault key it opens. Throws (the seed zeroed) when the seed
 * belongs to another vault — an approval from somebody who does not hold this
 * one.
 */
export const acceptHandoff = async (
  opened: THandoffPayload,
  anchor: THandoffAnchor,
): Promise<TAcceptedHandoff> => {
  const { seed } = opened;
  try {
    if (anchor.kind === "seed") {
      if ((await deriveVaultKeyId(seed)) !== anchor.vaultKeyId) {
        throw new Error("handoff seed does not match this vault");
      }
      return { seed, dek: await deriveVaultDek(seed) };
    }
    let dek: Uint8Array;
    try {
      dek = await unlockDek(
        seedToPhrase(seed),
        anchor.wrapSaltB64,
        anchor.wrappedDekB64,
      );
    } catch {
      throw new Error("handoff seed does not open this vault");
    }
    return { seed, dek };
  } catch (err) {
    zero(seed);
    throw err;
  }
};

/**
 * The six-digit code both screens show. Derived from the request id AND the
 * requester's public key: the key is posted before the server picks the id,
 * so a client cannot grind a key pair whose code matches someone else's —
 * each attempt costs a (rate-limited) new request.
 */
export const handoffVerificationCode = async (
  requestId: string,
  requesterPublicKeyB64: string,
): Promise<string> => {
  const enc = new TextEncoder();
  const label = enc.encode(HANDOFF_CODE_INFO);
  const id = enc.encode(requestId);
  const pub = fromB64(requesterPublicKeyB64);
  const input = new Uint8Array(label.length + 1 + id.length + 1 + pub.length);
  input.set(label, 0);
  input.set(id, label.length + 1);
  input.set(pub, label.length + 1 + id.length + 1);
  const digest = new Uint8Array(
    await subtle().digest("SHA-256", input as BufferSource),
  );
  const n =
    (((digest[0] as number) << 24) |
      ((digest[1] as number) << 16) |
      ((digest[2] as number) << 8) |
      (digest[3] as number)) >>>
    0;
  return (n % 10 ** HANDOFF_CODE_DIGITS)
    .toString()
    .padStart(HANDOFF_CODE_DIGITS, "0");
};

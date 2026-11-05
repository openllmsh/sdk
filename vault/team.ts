/**
 * User-held team encryption (docs/plan/2026-10-26-teams.md §9).
 *
 * Key graph (one-way only — a team key never opens personal material):
 *
 *   personal DEK  ──seal──►  team_members.sealed_team_key  (T)
 *   invite secret ─HKDF(auth info)──►  auth (base64url)  ──sha256──►  token_hash
 *   invite secret ─HKDF(wrap info)──►  wrap key  ──seal──►  team_invites.wrapped_team_key (T)
 *   T             ─HKDF──►  K_mem     ──seal──►  embeddings.content (team rows)
 *   T             ─HKDF──►  K_cred    ──seal──►  team share credential (inner)
 *                                                   ▲
 *                                      server K_srv wraps that as outer layer
 *
 * Domain separation:
 *   - invite auth info: {@link TEAM_INVITE_AUTH_HKDF_INFO} (browser-only → server)
 *   - invite wrap info: {@link TEAM_INVITE_HKDF_INFO} (browser-only; never sent)
 *   - memory content info: {@link TEAM_MEM_HKDF_INFO}
 *   - credential content info: {@link TEAM_CRED_HKDF_INFO}
 *
 * The raw fragment secret and the wrap key never leave the browser. Only the
 * derived `auth` value is posted; the server stores `sha256(auth)` as
 * `token_hash` and cannot unwrap T from anything it sees or stores.
 *
 * API-key share credentials use a two-layer envelope: the browser seals the
 * plaintext under K_cred with AAD binding (team_id, share_id, provider,
 * key_version); the server then wraps that ciphertext under a per-share
 * K_srv (HMAC of the host signing secret). Neither layer alone opens the
 * credential. Callers `zero()` T, K_mem, and K_cred after use.
 *
 * Personal-row paths must never receive T, K_mem, or K_cred; team-row paths
 * must never receive the personal DEK.
 */

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
import { joinSealed, splitSealed } from "./wrapped";

const NONCE_BYTES = 12;
const TEAM_KEY_BYTES = 32;

/** HKDF info for the invite-fragment wrap of T (browser-only). */
export const TEAM_INVITE_HKDF_INFO = "openllm-team-invite-v1";

/**
 * HKDF info for the invite auth token posted to the server.
 * Distinct from {@link TEAM_INVITE_HKDF_INFO} so seeing `auth` never yields
 * the wrap key.
 */
export const TEAM_INVITE_AUTH_HKDF_INFO = "openllm-team-invite-auth-v1";

/** HKDF info for the team-memory content key derived from T. */
export const TEAM_MEM_HKDF_INFO = "openllm-team-mem-v1";

/**
 * HKDF info for the team-credential content key derived from T.
 * Distinct from {@link TEAM_MEM_HKDF_INFO} so K_mem never opens share
 * credentials and K_cred never opens team memories.
 */
export const TEAM_CRED_HKDF_INFO = "openllm-team-cred-v1";

/** Fresh random team root key T. Caller owns and must eventually `zero()` it. */
export const generateTeamKey = (): Uint8Array => randomBytes(TEAM_KEY_BYTES);

/**
 * Seal T under a member's personal DEK → `IV || ct` bytes for
 * `team_members.sealed_team_key`.
 */
export const sealTeamKey = async (
  dek: Uint8Array,
  teamKey: Uint8Array,
): Promise<Uint8Array> => {
  const nonce = randomBytes(NONCE_BYTES);
  const ct = await aesGcmEncrypt(dek, nonce, teamKey);
  return joinSealed(nonce, ct);
};

/** Open a `sealed_team_key` blob under the personal DEK. Caller zeros T. */
export const openTeamKey = async (
  dek: Uint8Array,
  sealed: Uint8Array,
): Promise<Uint8Array> => {
  const { nonce, ciphertext } = splitSealed(sealed, "sealed_team_key");
  return aesGcmDecrypt(dek, nonce, ciphertext);
};

const inviteSalt = (inviteId: string): Uint8Array =>
  new TextEncoder().encode(inviteId);

/**
 * Derive the invite auth token posted to the server:
 * HKDF(secret, salt=invite_id, info=openllm-team-invite-auth-v1) → base64url.
 * The raw fragment secret never leaves the browser.
 */
export const deriveTeamInviteAuth = async (
  inviteSecret: string,
  inviteId: string,
): Promise<string> => {
  const ikm = new TextEncoder().encode(inviteSecret);
  try {
    const authBytes = await hkdfSha256(
      ikm,
      inviteSalt(inviteId),
      TEAM_INVITE_AUTH_HKDF_INFO,
      TEAM_KEY_BYTES,
    );
    try {
      return toB64Url(authBytes);
    } finally {
      zero(authBytes);
    }
  } finally {
    zero(ikm);
  }
};

/**
 * Derive the invite wrap key: HKDF(invite_secret, salt=invite_id,
 * info=openllm-team-invite-v1). Caller zeros the returned key. Never send
 * this key or the raw secret to the server.
 */
export const deriveTeamInviteWrapKey = async (
  inviteSecret: string,
  inviteId: string,
): Promise<Uint8Array> => {
  const ikm = new TextEncoder().encode(inviteSecret);
  try {
    return await hkdfSha256(
      ikm,
      inviteSalt(inviteId),
      TEAM_INVITE_HKDF_INFO,
      TEAM_KEY_BYTES,
    );
  } finally {
    zero(ikm);
  }
};

/** Wrap T under the invite secret for storage on `team_invites`. */
export const wrapTeamKeyForInvite = async (
  inviteSecret: string,
  inviteId: string,
  teamKey: Uint8Array,
): Promise<Uint8Array> => {
  const wrapKey = await deriveTeamInviteWrapKey(inviteSecret, inviteId);
  try {
    const nonce = randomBytes(NONCE_BYTES);
    const ct = await aesGcmEncrypt(wrapKey, nonce, teamKey);
    return joinSealed(nonce, ct);
  } finally {
    zero(wrapKey);
  }
};

/** Unwrap T from an invite's `wrapped_team_key`. Caller zeros T. */
export const unwrapTeamKeyFromInvite = async (
  inviteSecret: string,
  inviteId: string,
  wrapped: Uint8Array,
): Promise<Uint8Array> => {
  const wrapKey = await deriveTeamInviteWrapKey(inviteSecret, inviteId);
  try {
    const { nonce, ciphertext } = splitSealed(wrapped, "wrapped_team_key");
    return await aesGcmDecrypt(wrapKey, nonce, ciphertext);
  } finally {
    zero(wrapKey);
  }
};

/**
 * Derive K_mem = HKDF(T, salt=empty, info=openllm-team-mem-v1).
 * Memory code receives ONLY this key for team rows. Caller zeros it.
 */
export const deriveTeamMemKey = async (
  teamKey: Uint8Array,
): Promise<Uint8Array> =>
  hkdfSha256(teamKey, new Uint8Array(0), TEAM_MEM_HKDF_INFO, TEAM_KEY_BYTES);

export type TEncryptedTeamMemory = {
  readonly ciphertext: string;
  readonly nonce: string;
};

/** Encrypt memory content under K_mem (same wire shape as credentials). */
export const encryptTeamMemory = async (
  memKey: Uint8Array,
  plaintext: string,
): Promise<TEncryptedTeamMemory> => {
  const nonce = randomBytes(NONCE_BYTES);
  const ct = await aesGcmEncrypt(
    memKey,
    nonce,
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: toB64(ct), nonce: toB64(nonce) };
};

/** Decrypt a team memory row under K_mem. */
export const decryptTeamMemory = async (
  memKey: Uint8Array,
  ciphertextB64: string,
  nonceB64: string,
): Promise<string> => {
  const pt = await aesGcmDecrypt(
    memKey,
    fromB64(nonceB64),
    fromB64(ciphertextB64),
  );
  return new TextDecoder().decode(pt);
};

/**
 * Derive K_cred = HKDF(T, salt=empty, info=openllm-team-cred-v1).
 * Credential-share code receives ONLY this key for the inner envelope.
 * Caller zeros it.
 */
export const deriveTeamCredKey = async (
  teamKey: Uint8Array,
): Promise<Uint8Array> =>
  hkdfSha256(teamKey, new Uint8Array(0), TEAM_CRED_HKDF_INFO, TEAM_KEY_BYTES);

/**
 * Public facts the inner credential ciphertext is bound to as AES-GCM AAD.
 * A row relabelled under another team/share/provider/key_version fails its
 * auth tag instead of handing back a key for the wrong share.
 */
export type TTeamCredBinding = {
  readonly teamId: string;
  readonly shareId: string;
  readonly provider: string;
  readonly keyVersion: number;
};

const teamCredAad = (binding: TTeamCredBinding): Uint8Array =>
  new TextEncoder().encode(
    `${TEAM_CRED_HKDF_INFO}|${binding.teamId}|${binding.shareId}|${binding.provider}|${binding.keyVersion}`,
  );

export type TEncryptedTeamCredential = {
  readonly ciphertext: string;
  readonly nonce: string;
};

/**
 * Encrypt a credential plaintext under K_cred with AAD binding.
 * Returns the same wire shape as personal credentials (`ciphertext`/`nonce`
 * base64). The browser posts this as the inner layer; the server wraps it
 * under K_srv before storage.
 */
export const encryptTeamCredential = async (
  credKey: Uint8Array,
  plaintext: string,
  binding: TTeamCredBinding,
): Promise<TEncryptedTeamCredential> => {
  const nonce = randomBytes(NONCE_BYTES);
  const ct = await aesGcmEncrypt(
    credKey,
    nonce,
    new TextEncoder().encode(plaintext),
    teamCredAad(binding),
  );
  return { ciphertext: toB64(ct), nonce: toB64(nonce) };
};

/** Decrypt an inner team-credential layer under K_cred + the same AAD. */
export const decryptTeamCredential = async (
  credKey: Uint8Array,
  ciphertextB64: string,
  nonceB64: string,
  binding: TTeamCredBinding,
): Promise<string> => {
  const pt = await aesGcmDecrypt(
    credKey,
    fromB64(nonceB64),
    fromB64(ciphertextB64),
    teamCredAad(binding),
  );
  return new TextDecoder().decode(pt);
};

/**
 * Pack an inner `{ciphertext, nonce}` pair into `IV || ct` bytes for the
 * server's outer wrap. Inverse of {@link unpackTeamCredInner}.
 */
export const packTeamCredInner = (
  sealed: TEncryptedTeamCredential,
): Uint8Array => joinSealed(fromB64(sealed.nonce), fromB64(sealed.ciphertext));

/** Unpack `IV || ct` bytes back to the inner `{ciphertext, nonce}` pair. */
export const unpackTeamCredInner = (
  packed: Uint8Array,
): TEncryptedTeamCredential => {
  const { nonce, ciphertext } = splitSealed(packed, "team_cred_inner");
  return { ciphertext: toB64(ciphertext), nonce: toB64(nonce) };
};

/** Browser/API helpers: b64 ↔ sealed bytes. */
export const sealedTeamKeyToB64 = (sealed: Uint8Array): string => toB64(sealed);

export const sealedTeamKeyFromB64 = (b64: string): Uint8Array => fromB64(b64);

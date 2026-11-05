/**
 * Control-key attestation of a daemon's X25519 pubkey (`dpk`).
 *
 * After the install-time trust anchor, attestations are a cache/distribution
 * aid — never the sole trust root. They MUST bind `key_id` and are only
 * written after the browser verifies the daemon's `dpk` proof (or a
 * loopback/local confirmation). The cloud can deny service by swapping
 * rows, but cannot forge a verifying attestation.
 *
 * Rotation carry-forward (`pf`): an anchored daemon keeps proving its `dpk`
 * with the pair secret derived from the seed it was installed under, so after
 * a phrase rotation that proof no longer verifies under the new seed. The
 * rotate flow — old seed still in hand — verifies the proof with the OLD pair
 * secret and signs a new-key attestation that names the exact proof string
 * it checked (`pf`). A browser that sees a failing proof accepts an
 * attestation ONLY when it binds that same proof; any other attestation is
 * refused (`lib/vault/daemon-attestation-cache.ts`).
 */
import {
  decodeB64Json,
  encodeB64Json,
  labelledMessage,
} from "@openllmsh/sdk/tunnel";
import {
  rawFromSpkiB64,
  signDeviceGrant,
  verifyDeviceGrant,
} from "./device-access";

export const DAEMON_ATTEST_LABEL = "openllm-daemon-attest-v1";
export const DAEMON_ATTEST_VERSION = 1 as const;
/** Soft wire cap — matches the design's ≤ 1024 chars envelope. */
export const DAEMON_ATTEST_B64_MAX = 1024;

export type TDaemonAttestationFields = {
  readonly v: 1;
  readonly user_id: string;
  /** API key id this dpk is bound to — closes cross-key attestation swaps. */
  readonly key_id: string;
  /** Daemon X25519 SPKI, base64. */
  readonly dpk: string;
  /** `users.vault_version` (control version) at signing time. */
  readonly cv: number;
  /** ms since epoch at signing time. */
  readonly ts: number;
  /**
   * Rotation carry-forward only: the daemon's dpk proof the signer verified
   * under the PREVIOUS control seed. Absent on ordinary attestations.
   */
  readonly pf?: string;
};

/** Max length of a carried proof (`pf`) — a base64url HMAC is 43 chars. */
const DAEMON_ATTEST_PF_MAX = 64;

export type TDaemonAttestationEnvelope = TDaemonAttestationFields & {
  readonly sig: string;
};

/**
 * Canonical signed bytes: `utf8(LABEL) || 0x00 || utf8(json)`.
 * Fixed key order `v, user_id, key_id, dpk, cv, ts[, pf]` — `pf` only when
 * present, so ordinary attestations keep their original bytes.
 */
export const buildDaemonAttestMessage = (
  fields: TDaemonAttestationFields,
): Uint8Array =>
  labelledMessage(
    DAEMON_ATTEST_LABEL,
    JSON.stringify({
      v: fields.v,
      user_id: fields.user_id,
      key_id: fields.key_id,
      dpk: fields.dpk,
      cv: fields.cv,
      ts: fields.ts,
      ...(fields.pf === undefined ? {} : { pf: fields.pf }),
    }),
  );

export const encodeDaemonAttestation = (
  envelope: TDaemonAttestationEnvelope,
): string =>
  encodeB64Json(
    envelope,
    DAEMON_ATTEST_B64_MAX,
    "daemon attestation exceeds DAEMON_ATTEST_B64_MAX",
  );

export const decodeDaemonAttestation = (
  b64: string,
): TDaemonAttestationEnvelope | null => {
  const o = decodeB64Json(b64, DAEMON_ATTEST_B64_MAX);
  if (o === null) return null;
  if (o.v !== DAEMON_ATTEST_VERSION) return null;
  if (typeof o.user_id !== "string" || o.user_id.length === 0) return null;
  if (typeof o.key_id !== "string" || o.key_id.length === 0) return null;
  if (typeof o.dpk !== "string" || o.dpk.length === 0) return null;
  if (typeof o.cv !== "number" || !Number.isInteger(o.cv) || o.cv < 1) {
    return null;
  }
  if (
    typeof o.ts !== "number" ||
    !Number.isFinite(o.ts) ||
    !Number.isInteger(o.ts) ||
    o.ts <= 0
  ) {
    return null;
  }
  if (typeof o.sig !== "string" || o.sig.length === 0) return null;
  if (
    o.pf !== undefined &&
    (typeof o.pf !== "string" ||
      o.pf.length === 0 ||
      o.pf.length > DAEMON_ATTEST_PF_MAX)
  ) {
    return null;
  }
  return {
    v: DAEMON_ATTEST_VERSION,
    user_id: o.user_id,
    key_id: o.key_id,
    dpk: o.dpk,
    cv: o.cv,
    ts: o.ts,
    ...(typeof o.pf === "string" ? { pf: o.pf } : {}),
    sig: o.sig,
  };
};

export type TSignDaemonAttestationParams = {
  readonly seed: Uint8Array;
  readonly userId: string;
  readonly keyId: string;
  readonly dpk: string;
  readonly cv: number;
  readonly ts?: number;
  /** Rotation carry-forward: the proof verified under the previous seed. */
  readonly carriedProof?: string;
};

/** Sign a daemon attestation; returns the base64 envelope. */
export const signDaemonAttestation = async (
  params: TSignDaemonAttestationParams,
): Promise<string> => {
  if (params.userId.length === 0) {
    throw new Error("daemon attestation requires a non-empty userId");
  }
  if (params.keyId.length === 0) {
    throw new Error("daemon attestation requires a non-empty keyId");
  }
  if (params.dpk.length === 0) {
    throw new Error("daemon attestation requires a non-empty dpk");
  }
  if (!Number.isInteger(params.cv) || params.cv < 1) {
    throw new Error("daemon attestation requires cv >= 1");
  }
  if (
    params.carriedProof !== undefined &&
    (params.carriedProof.length === 0 ||
      params.carriedProof.length > DAEMON_ATTEST_PF_MAX)
  ) {
    throw new Error("daemon attestation carried proof is malformed");
  }
  const fields: TDaemonAttestationFields = {
    v: 1,
    user_id: params.userId,
    key_id: params.keyId,
    dpk: params.dpk,
    cv: params.cv,
    ts: params.ts ?? Date.now(),
    ...(params.carriedProof === undefined ? {} : { pf: params.carriedProof }),
  };
  const msg = buildDaemonAttestMessage(fields);
  const sig = await signDeviceGrant(params.seed, msg);
  return encodeDaemonAttestation({ ...fields, sig });
};

export type TVerifyDaemonAttestationParams = {
  /** Browser's own derived control public key (SPKI base64). */
  readonly controlPubkey: string;
  readonly attestation: string;
  /** Expected user id — must equal the envelope's. */
  readonly userId: string;
  /** Expected API key id — must equal the envelope's. */
  readonly keyId: string;
  /** Expected dpk — must equal the envelope's. */
  readonly dpk: string;
  /** Expected control/vault version — must equal the envelope's `cv`. */
  readonly cv: number;
  /**
   * When set, the envelope MUST carry exactly this proof as `pf` (rotation
   * carry-forward). When unset, `pf` is neither required nor checked.
   */
  readonly carriedProof?: string;
};

/**
 * Verify an attestation against the browser's own control public key.
 * Never throws — returns false on any failure (malformed, wrong binding,
 * bad signature).
 */
export const verifyDaemonAttestation = async (
  params: TVerifyDaemonAttestationParams,
): Promise<boolean> => {
  if (rawFromSpkiB64(params.controlPubkey) === null) return false;
  const envelope = decodeDaemonAttestation(params.attestation);
  if (envelope === null) return false;
  if (envelope.user_id !== params.userId) return false;
  if (envelope.key_id !== params.keyId) return false;
  if (envelope.dpk !== params.dpk) return false;
  if (envelope.cv !== params.cv) return false;
  if (
    params.carriedProof !== undefined &&
    envelope.pf !== params.carriedProof
  ) {
    return false;
  }
  const msg = buildDaemonAttestMessage({
    v: envelope.v,
    user_id: envelope.user_id,
    key_id: envelope.key_id,
    dpk: envelope.dpk,
    cv: envelope.cv,
    ts: envelope.ts,
    ...(envelope.pf === undefined ? {} : { pf: envelope.pf }),
  });
  return verifyDeviceGrant(params.controlPubkey, msg, envelope.sig);
};

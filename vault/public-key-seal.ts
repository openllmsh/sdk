import { decodeCanonicalB64, openX25519, sealX25519 } from "./x25519-seal";

const DOMAIN = "openllm-connector-seal-v1";

export type TConnectorSealBinding = {
  readonly clientId: string;
  readonly userId: string;
  readonly grantId: string;
  /** Recipient X25519 public key, base64 SPKI DER. */
  readonly recipientPublicKeyB64: string;
};

export type TConnectorSealed = {
  readonly v: 1;
  readonly epk: string;
  readonly nonce: string;
  readonly ct: string;
};

const aad = (binding: TConnectorSealBinding): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify([DOMAIN, binding.clientId, binding.userId, binding.grantId]),
  );

/** Caller retains ownership of plaintext; the temporary copy is wiped. */
export const sealToPublicKey = async (
  binding: TConnectorSealBinding,
  plaintext: Uint8Array,
): Promise<TConnectorSealed> =>
  sealX25519({
    domain: DOMAIN,
    recipientB64: binding.recipientPublicKeyB64,
    recipientBytes: decodeCanonicalB64(binding.recipientPublicKeyB64),
    format: "spki",
    aad: aad(binding),
    plaintext,
  });

/** Caller owns the returned plaintext and must wipe it when finished. */
export const openSealed = async (
  binding: TConnectorSealBinding,
  sealed: TConnectorSealed,
  privateKey: CryptoKey,
): Promise<Uint8Array> => {
  if (typeof sealed !== "object" || sealed === null || sealed.v !== 1)
    throw new Error("Invalid sealed envelope");
  const nonce = decodeCanonicalB64(sealed.nonce);
  const ct = decodeCanonicalB64(sealed.ct);
  if (nonce.length !== 12 || ct.length < 16 || typeof sealed.epk !== "string")
    throw new Error("Invalid sealed envelope");
  return openX25519({
    domain: DOMAIN,
    privateKey,
    recipientB64: binding.recipientPublicKeyB64,
    epkBytes: decodeCanonicalB64(sealed.epk),
    epkB64: sealed.epk,
    format: "spki",
    aad: aad(binding),
    nonce,
    ct,
  });
};

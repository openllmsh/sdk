/**
 * The public syntax of OpenLLM keys minted by the vault.
 *
 * A key is `sk-llm-` plus a 10-byte base64url identifier (14 characters), a
 * literal dot, and a 32-byte base64url secret (43 characters). This is only a
 * local shape check; callers must still authenticate the key with the gateway.
 */
export const OPENLLM_API_KEY_PREFIX = "sk-llm-";
export const OPENLLM_API_KEY_ID_BYTES = 10;
export const OPENLLM_API_KEY_SECRET_BYTES = 32;
export const OPENLLM_API_KEY_ID_LENGTH = 14;
export const OPENLLM_API_KEY_SECRET_LENGTH = 43;

export type TCredentialGateMode = "human" | "machine";

export type TCredentialGateTerminal = {
  readonly isInteractive: () => boolean;
  readonly promptForKey: () => string | null;
  readonly write: (message: string) => void;
};

const BASE64URL = "[A-Za-z0-9_-]";

export const openllmApiKeyPattern = new RegExp(
  `^${OPENLLM_API_KEY_PREFIX}${BASE64URL}{${OPENLLM_API_KEY_ID_LENGTH}}\\.${BASE64URL}{${OPENLLM_API_KEY_SECRET_LENGTH}}$`,
);

/** Returns whether a value has the exact syntax of a minted OpenLLM API key. */
export const isOpenllmApiKeySyntax = (value: string): boolean =>
  openllmApiKeyPattern.test(value);

/** Normalize nullable configuration input before applying the public syntax. */
export const isUsableOpenllmApiKey = (
  value: string | null | undefined,
): boolean =>
  value !== null && value !== undefined && isOpenllmApiKeySyntax(value.trim());

/**
 * A device trust anchor (`@openllmsh/sdk/tunnel` `device-anchor.ts`) is base64url,
 * unpadded, of 64 bytes: the account control public key (32) then the
 * per-key pair secret (32).
 */
export const OPENLLM_DEVICE_ANCHOR_LENGTH = 86;

const deviceAnchorPattern = new RegExp(
  `^${BASE64URL}{${OPENLLM_DEVICE_ANCHOR_LENGTH}}$`,
);

/** Returns whether a value has the exact syntax of a device trust anchor. */
export const isOpenllmDeviceAnchorSyntax = (value: string): boolean =>
  deviceAnchorPattern.test(value);

export type TSplitAnchoredApiKey = {
  /** `sk-llm-<id>.<secret>` — the ONLY part ever used as a bearer. */
  readonly key: string;
  /** The device trust anchor, or null for a bare key. Never leaves the box. */
  readonly anchor: string | null;
};

/**
 * Split `sk-llm-<id>.<secret>[.<anchor>]` on the LAST dot. The secret is
 * fixed-length base64url (no dot), so the split is unambiguous. Returns null
 * unless the input is a bare key or a key plus a well-formed anchor.
 */
export const splitAnchoredApiKey = (
  raw: string,
): TSplitAnchoredApiKey | null => {
  const value = raw.trim();
  if (isOpenllmApiKeySyntax(value)) return { key: value, anchor: null };
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const key = value.slice(0, dot);
  const anchor = value.slice(dot + 1);
  if (!isOpenllmApiKeySyntax(key) || !isOpenllmDeviceAnchorSyntax(anchor)) {
    return null;
  }
  return { key, anchor };
};

/**
 * True when `raw` starts like an OpenLLM key but carries anything after the
 * secret (`sk-llm-<id>.<secret>.<…>`). The cloud refuses such a bearer
 * outright — a device anchor must never authenticate, be stored or be logged.
 */
export const hasOpenllmApiKeySuffix = (raw: string): boolean => {
  const value = raw.trim();
  if (!value.startsWith(OPENLLM_API_KEY_PREFIX)) return false;
  const rest = value.slice(OPENLLM_API_KEY_PREFIX.length);
  const first = rest.indexOf(".");
  return first >= 0 && rest.indexOf(".", first + 1) >= 0;
};

/**
 * The bearer a configured key value may be sent as, or `null` when it must
 * not be sent at all. A well-formed anchored key yields its bare key; a key
 * with a MALFORMED suffix (truncated / wrong-charset anchor, extra dots) is
 * refused outright rather than passed through — it would leak whatever the
 * suffix holds to the cloud as part of the bearer. Anything else is returned
 * as-is for the caller's own syntax check.
 */
export const bearerApiKeyOf = (raw: string): string | null => {
  const split = splitAnchoredApiKey(raw);
  if (split !== null) return split.key;
  return hasOpenllmApiKeySuffix(raw) ? null : raw;
};

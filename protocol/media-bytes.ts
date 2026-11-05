/**
 * Runtime-agnostic base64 decoder that returns raw bytes.
 */
export const base64ToBytes = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
};

/**
 * Normalize a content-type header value to its media type token.
 */
export const normalizeContentType = (
  raw: string | null | undefined,
  fallback: string,
): string => {
  if (raw === null || raw === undefined) {
    return fallback;
  }

  const normalized = raw.split(";", 1)[0].trim().toLowerCase();
  return normalized === "" ? fallback : normalized;
};

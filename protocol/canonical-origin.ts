/**
 * The origin the SDK actually sends requests to.
 *
 * The production apex `https://openllm.sh` answers every request with a
 * redirect to `https://www.openllm.sh`. `fetch` follows it but, per the Fetch
 * spec, drops the `Authorization` header on a cross-origin redirect — so a
 * call made against the apex reaches `www` with no credentials and fails as
 * `401 Not authenticated`, indistinguishable from a bad key. Every origin the
 * SDK fetches from goes through here.
 *
 * Only the exact production apex host is rewritten; localhost, preview
 * deployments and self-hosted origins pass through unchanged. Identifiers that
 * are compared exactly rather than fetched (the OAuth `resource` audience, the
 * issuer) must NOT go through here.
 *
 * Dependency-free on purpose: `connect` imports this file alone, never the
 * protocol barrel.
 */

/** The apex host that redirects, and the host it redirects to. */
export const OPENLLM_APEX_HOST = "openllm.sh";
export const OPENLLM_WWW_HOST = "www.openllm.sh";

/** Strip trailing slashes and rewrite the production apex host to `www`. */
export const canonicalApiOrigin = (origin: string): string => {
  const trimmed = origin.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if (url.hostname !== OPENLLM_APEX_HOST) return trimmed;
  url.hostname = OPENLLM_WWW_HOST;
  return url.toString().replace(/\/+$/, "");
};

import {
  isForbiddenResolvedAddress,
  preflightRemoteEndpoint,
} from "./url-locality";

/**
 * Resolve a syntactically non-local URL and accept it only when every DNS
 * answer is globally routable. Node-only: it imports `node:dns/promises`, so it
 * lives outside the package index (`@openllmsh/sdk/protocol/url-locality-dns`) to
 * keep edge/browser bundles that import the protocol root free of `node:dns`.
 *
 * This validation must be invoked directly before each hosted fetch. Standard
 * Fetch (undici / Bun) does not expose a portable DNS-pin primitive that
 * connects to the resolved address while preserving Host + TLS SNI, so the
 * established defence is: preflight DNS here, then `redirect: "manual"` with
 * revalidation of every Location before the next hop. A true
 * connect-to-resolved-IP path would require a custom dispatcher and is out of
 * scope for the portable fetch surface this codebase targets.
 */
export const isSafeRemoteEndpoint = async (url: string): Promise<boolean> => {
  const preflight = preflightRemoteEndpoint(url);
  if ("safe" in preflight) return preflight.safe;
  try {
    const dns = await import("node:dns/promises");
    const answers = await dns.lookup(preflight.resolve, {
      all: true,
      verbatim: true,
    });
    return (
      answers.length > 0 &&
      answers.every((answer) => !isForbiddenResolvedAddress(answer.address))
    );
  } catch {
    // A failed lookup cannot establish that an upstream is safe: fail closed.
    return false;
  }
};

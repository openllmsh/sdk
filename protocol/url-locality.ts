/**
 * Classifiers and validation for custom upstream URLs.
 *
 * `isLocalEndpoint` is intentionally a pure, synchronous classifier: browser
 * routing and daemon-local code need to answer whether a literal URL names the
 * local network without doing DNS. Hosted code must use
 * `isSafeRemoteEndpoint` immediately before connecting; it resolves public
 * names and rejects answers in non-public address space.
 */

/** `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`. */
const isRfc1918 = (o: ReadonlyArray<number>): boolean => {
  const [a, b] = o as [number, number, number, number];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
};

const parseIpv4 = (host: string): ReadonlyArray<number> | null => {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: Array<number> = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
};

/**
 * Remove trailing slashes and an optional trailing `/v1` segment.
 */
const normalizeHostRoot = (raw: string): string => {
  const hostRoot = raw.replace(/\/+$/, "");
  return hostRoot.replace(/\/v1$/, "");
};

/**
 * Same as `normalizeHostRoot`, plus optional `/v1beta` stripping for image
 * endpoints that may use Google-compatible discovery paths.
 */
const normalizeHostRootForImage = (raw: string): string =>
  raw
    .replace(/\/+$/, "")
    .replace(/\/v1beta$/, "")
    .replace(/\/v1$/, "");

/**
 * Options for custom base URL normalization.
 */
type TNormalizeBaseUrlOptions = {
  readonly trimWhitespace?: boolean;
};

/**
 * Normalize a user-pasted custom base URL for OpenAI-style custom endpoints.
 */
export const normalizeBaseUrl = (
  raw: string,
  options: TNormalizeBaseUrlOptions = {},
): string => {
  const normalized = options.trimWhitespace === true ? raw.trim() : raw;
  return normalizeHostRoot(normalized);
};

/**
 * Normalize a user-pasted custom base URL for image-style custom endpoints.
 */
export const normalizeImageBaseUrl = (
  raw: string,
  options: TNormalizeBaseUrlOptions = {},
): string => {
  const normalized = options.trimWhitespace === true ? raw.trim() : raw;
  return normalizeHostRootForImage(normalized);
};

/**
 * WHATWG URL keeps IPv6 brackets in `hostname`. Lower-case it and remove the
 * single root-label dot that denotes the same DNS name (`localhost.`).
 */
const normalizeHost = (raw: string): string => {
  const lower = raw.trim().toLowerCase();
  const bare =
    lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
  return bare.endsWith(".") ? bare.slice(0, -1) : bare;
};

const isLocalIpv4 = (o: ReadonlyArray<number>): boolean => {
  const [a, b] = o as [number, number, number, number];
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  return isRfc1918(o);
};

const isForbiddenIpv4 = (o: ReadonlyArray<number>): boolean => {
  const [a, b, c] = o as [number, number, number, number];
  if (isLocalIpv4(o)) return true;
  // Carrier-grade NAT, benchmark, documentation, multicast, and reserved
  // ranges are not public Internet targets and must not be SSRF destinations.
  // Match the reserved blocks exactly — do not over-block neighbouring
  // public space under the same /16 (e.g. 192.0.1.0/24 is public, only
  // 192.0.0.0/24 and 192.0.2.0/24 are reserved; likewise 198.51.100.0/24,
  // not 198.51.0.0/16).
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF Protocol Assignments
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 192.88.99.0/24 6to4 anycast (deprecated)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET-3
  return a >= 224; // multicast + reserved
};

const isLocalIpv6 = (host: string): boolean => {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (mapped !== null) {
    const embedded = parseIpv4(mapped[1] as string);
    return embedded !== null && isLocalIpv4(embedded);
  }
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (mappedHex !== null) {
    const hi = Number.parseInt(mappedHex[1] as string, 16);
    const lo = Number.parseInt(mappedHex[2] as string, 16);
    return isLocalIpv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
  }
  if (host === "::1" || host === "::") return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return true;
  return false;
};

/**
 * Expand a textual IPv6 address (no brackets, no dotted v4 tail) into 8
 * hextets. Returns null when the form is unparseable.
 */
const parseIpv6Hextets = (host: string): ReadonlyArray<number> | null => {
  if (host.includes(".")) return null;
  const sides = host.split("::");
  if (sides.length > 2) return null;
  const parseSide = (side: string): Array<number> | null => {
    if (side.length === 0) return [];
    const parts = side.split(":");
    const out: Array<number> = [];
    for (const part of parts) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      out.push(Number.parseInt(part, 16));
    }
    return out;
  };
  if (sides.length === 1) {
    const all = parseSide(sides[0] as string);
    return all !== null && all.length === 8 ? all : null;
  }
  const left = parseSide(sides[0] as string);
  const right = parseSide(sides[1] as string);
  if (left === null || right === null) return null;
  const fill = 8 - left.length - right.length;
  if (fill < 1) return null;
  return [...left, ...Array.from({ length: fill }, () => 0), ...right];
};

const ipv4FromHextetPair = (hi: number, lo: number): ReadonlyArray<number> => [
  hi >> 8,
  hi & 0xff,
  lo >> 8,
  lo & 0xff,
];

const isForbiddenIpv6 = (host: string): boolean => {
  if (isLocalIpv6(host)) return true;
  // IPv4-mapped dotted form (::ffff:a.b.c.d) — apply the v4 policy to the
  // embedded address (CGNAT / docs / multicast, not only RFC1918).
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (mapped !== null) {
    const embedded = parseIpv4(mapped[1] as string);
    return embedded !== null && isForbiddenIpv4(embedded);
  }
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (mappedHex !== null) {
    const hi = Number.parseInt(mappedHex[1] as string, 16);
    const lo = Number.parseInt(mappedHex[2] as string, 16);
    return isForbiddenIpv4(ipv4FromHextetPair(hi, lo));
  }
  // IPv4-compatible addresses are obsolete, but still permit a textual v4
  // tail in some resolvers. Treat them conservatively.
  if (/^::(?:[0-9a-f]{1,4}:)?[0-9a-f]+:[0-9a-f]+$/.test(host)) return true;
  // IPv6 documentation space (2001:db8::/32) is reserved.
  if (host.startsWith("2001:db8:")) return true;
  // 6to4 (2002::/16) is a deprecated transition mechanism — never a safe
  // hosted SSRF target even when the embedded v4 looks public.
  if (host.startsWith("2002:")) return true;

  const hextets = parseIpv6Hextets(host);
  if (hextets === null) {
    // Fail closed on multicast / NAT64 textual prefixes we couldn't expand.
    if (/^ff[0-9a-f]{0,2}:/.test(host)) return true;
    if (host.startsWith("64:ff9b:")) return true;
    return false;
  }
  const first = hextets[0] as number;
  // Multicast ff00::/8.
  if ((first & 0xff00) === 0xff00) return true;
  // NAT64 well-known prefix 64:ff9b::/96 — last 32 bits are the embedded v4.
  if (
    first === 0x64 &&
    hextets[1] === 0xff9b &&
    hextets[2] === 0 &&
    hextets[3] === 0 &&
    hextets[4] === 0 &&
    hextets[5] === 0
  ) {
    return isForbiddenIpv4(
      ipv4FromHextetPair(hextets[6] as number, hextets[7] as number),
    );
  }
  return false;
};

/** True when `host` names local/private/link-local network space. */
export const isLocalHostname = (rawHost: string): boolean => {
  const host = normalizeHost(rawHost);
  if (host.length === 0) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "local" || host.endsWith(".local")) return true;
  const v4 = parseIpv4(host);
  if (v4 !== null) return isLocalIpv4(v4);
  if (host.includes(":")) return isLocalIpv6(host);
  return false;
};

/**
 * True when `url` is unparseable, or its literal host is loopback / private /
 * link-local / mDNS. This intentionally does not resolve DNS.
 */
export const isLocalEndpoint = (url: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  return isLocalHostname(parsed.hostname);
};

export const isForbiddenResolvedAddress = (address: string): boolean => {
  const normalized = normalizeHost(address);
  const v4 = parseIpv4(normalized);
  if (v4 !== null) return isForbiddenIpv4(v4);
  return normalized.includes(":") ? isForbiddenIpv6(normalized) : true;
};

/**
 * The DNS-free half of `isSafeRemoteEndpoint` (in `url-locality-dns.ts`):
 * a verdict when the URL alone decides it, otherwise the hostname to resolve.
 * Kept here so this module stays importable from edge/browser bundles.
 */
export const preflightRemoteEndpoint = (
  url: string,
): { readonly safe: boolean } | { readonly resolve: string } => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { safe: false };
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return { safe: false };
  }
  if (isLocalHostname(parsed.hostname)) return { safe: false };
  const literal = normalizeHost(parsed.hostname);
  if (parseIpv4(literal) !== null || literal.includes(":")) {
    return { safe: !isForbiddenResolvedAddress(literal) };
  }
  return { resolve: literal };
};

/** Error code every refusal path returns, so clients can branch on it. */
export const LOCAL_ENDPOINT_ERROR_CODE = "local_endpoint_requires_daemon";

export const localEndpointMessage = (url: string): string =>
  `"${url}" points at a local or private network address. The hosted gateway runs on Vercel — its localhost is not your machine, so it can never reach this endpoint. Local models (Ollama, LM Studio, llama.cpp) are served by the OpenLLM daemon running on your own machine; register and use them with the daemon running and the request never leaves the box.`;

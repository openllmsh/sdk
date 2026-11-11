import { Schema as S } from "effect";

/**
 * Which client a gateway request came from — recorded on every
 * `public.requests` row (`client_kind` + `client_host`) so usage can be split
 * by Claude Code vs Codex vs the desktop app vs a website, and which site.
 *
 * Derived from headers the caller already sends, in this order:
 *
 *  1. a browser `Origin` (or `Referer`) of ANOTHER website → that website and
 *     its host. First, because a page cannot forge its `Origin` but can set
 *     any header CORS lets through — so a site can't count itself as Claude
 *     Code by sending the header below;
 *  2. an explicit `x-openllm-client` header naming one of these kinds (clients
 *     we control can say who they are instead of being guessed from a UA);
 *  3. a user agent we recognise (`claude-cli/…`, `codex_cli_rs/…`, the desktop
 *     shell's `OpenLLMNative/…` suffix, our own CLI's `OpenLLM/…`);
 *  4. a browser `Origin` / `Referer` of our own site → our website;
 *  5. otherwise `other`.
 *
 * Pure and dependency-light: the cloud derives it for requests it serves, and
 * the daemon derives it for hops it walks locally and reports it on the usage
 * record (`DaemonRecordRequest.client_kind` / `client_host`), where the cloud
 * re-checks it with {@link normalizeClientOrigin}.
 */
export const CLIENT_KINDS = [
  "claude_code",
  "codex",
  "opencode",
  "openllm_cli",
  "openllm_desktop",
  "openllm_web",
  "website",
  "other",
] as const;
export type TClientKind = (typeof CLIENT_KINDS)[number];
export const ClientKind = S.Literals(CLIENT_KINDS);

/** The header a client we control sets to name itself. */
export const CLIENT_KIND_HEADER = "x-openllm-client";

/** Longest DNS name; a reported host above it is not a host. */
export const CLIENT_HOST_MAX_LENGTH = 253;

export type TClientOrigin = {
  readonly kind: TClientKind;
  /** The website's hostname — set only when `kind` is `website`. */
  readonly host: string | null;
};

/** Human labels, shared by the overview and the public usage index. */
export const CLIENT_KIND_LABELS: Readonly<Record<TClientKind, string>> = {
  claude_code: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  openllm_cli: "OpenLLM CLI",
  openllm_desktop: "OpenLLM desktop app",
  openllm_web: "OpenLLM website",
  website: "Other websites",
  other: "Other clients",
};

const isClientKind = (value: string): value is TClientKind =>
  (CLIENT_KINDS as ReadonlyArray<string>).includes(value);

/**
 * Kinds a caller may claim through {@link CLIENT_KIND_HEADER}. `website` is
 * not one of them: a website is identified by its browser-set `Origin`, which
 * a page cannot forge, never by a header it chooses.
 */
const isClaimableKind = (value: string): value is TClientKind =>
  isClientKind(value) && value !== "website";

/** Our own site: `openllm.sh` and every subdomain of it. */
const OWN_ROOT_DOMAIN = "openllm.sh";

const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** A bare, lower-case hostname, or null when the value is not one. */
export const normalizeClientHost = (value: string): string | null => {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  return HOSTNAME_PATTERN.test(host) ? host : null;
};

/** Hostname of an http(s) URL; null for any other scheme or a bad value. */
const webHostOf = (value: string | null): string | null => {
  if (value === null || value.length === 0 || value === "null") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return normalizeClientHost(url.hostname);
  } catch {
    return null;
  }
};

/**
 * A loopback name is never evidence of being our site: on the daemon (and on a
 * local dev cloud) the request's own host is `127.0.0.1` / `localhost`, and a
 * developer's page on `localhost:5173` would otherwise match it.
 */
const isLoopbackHost = (host: string): boolean =>
  host === "localhost" ||
  host.endsWith(".localhost") ||
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
  host === "0.0.0.0";

const isOwnHost = (host: string, selfHost: string | null): boolean =>
  (selfHost !== null && host === selfHost && !isLoopbackHost(selfHost)) ||
  host === OWN_ROOT_DOMAIN ||
  host.endsWith(`.${OWN_ROOT_DOMAIN}`);

const kindFromUserAgent = (userAgent: string): TClientKind | null => {
  const ua = userAgent.trim().toLowerCase();
  if (ua.length === 0) return null;
  // The desktop shell appends `OpenLLMNative/<version>` to WKWebView's UA
  // (`packages/native/src-tauri/src/lib.rs`), so this test comes before the
  // browser Origin check: the app loads our own site.
  if (ua.includes("openllmnative/")) return "openllm_desktop";
  if (ua.startsWith("claude-cli/") || ua.startsWith("claude-code/"))
    return "claude_code";
  if (
    ua.startsWith("codex_") ||
    ua.startsWith("codex-") ||
    ua.startsWith("codex/")
  )
    return "codex";
  if (ua.startsWith("opencode/") || ua.startsWith("opencode "))
    return "opencode";
  if (ua.startsWith("openllm/")) return "openllm_cli";
  return null;
};

export type TClientOriginHints = {
  readonly userAgent: string | null;
  readonly origin: string | null;
  readonly referer: string | null;
  /** The value of {@link CLIENT_KIND_HEADER}, when sent. */
  readonly clientKind: string | null;
  /** The host the request was addressed to: a same-origin page is our site. */
  readonly selfHost: string | null;
};

/** Classify one request from its client-identifying headers. */
export const deriveClientOrigin = (
  hints: TClientOriginHints,
): TClientOrigin => {
  const host = webHostOf(hints.origin) ?? webHostOf(hints.referer);
  const selfHost =
    hints.selfHost === null ? null : normalizeClientHost(hints.selfHost);
  const ownSite = host !== null && isOwnHost(host, selfHost);
  if (host !== null && !ownSite) return { kind: "website", host };

  const claimed = hints.clientKind?.trim().toLowerCase() ?? "";
  if (isClaimableKind(claimed)) return { kind: claimed, host: null };

  const fromAgent =
    hints.userAgent === null ? null : kindFromUserAgent(hints.userAgent);
  if (fromAgent !== null) return { kind: fromAgent, host: null };

  if (ownSite) return { kind: "openllm_web", host: null };
  return { kind: "other", host: null };
};

/** {@link deriveClientOrigin} over a request's headers and URL. */
export const clientOriginOfRequest = (request: Request): TClientOrigin => {
  let selfHost: string | null = null;
  try {
    selfHost = new URL(request.url).hostname;
  } catch {
    selfHost = null;
  }
  const headers = request.headers;
  return deriveClientOrigin({
    userAgent: headers.get("user-agent"),
    origin: headers.get("origin"),
    referer: headers.get("referer"),
    clientKind: headers.get(CLIENT_KIND_HEADER),
    selfHost,
  });
};

/**
 * Re-check a client origin someone else reported (a daemon's usage record).
 * An unknown kind is dropped (null), and a host survives only on a `website`
 * row and only as a valid hostname — a website with no usable host stays a
 * website, just unnamed, and one of our own hosts is our website.
 */
export const normalizeClientOrigin = (
  kind: string | null | undefined,
  host: string | null | undefined,
): TClientOrigin | null => {
  if (kind === null || kind === undefined || !isClientKind(kind)) return null;
  if (kind !== "website") return { kind, host: null };
  const normalized =
    host === null || host === undefined ? null : normalizeClientHost(host);
  if (normalized !== null && isOwnHost(normalized, null))
    return { kind: "openllm_web", host: null };
  return { kind, host: normalized };
};

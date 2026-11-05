import { Schema as S } from "effect";

/** Immutable `detail` sentinel for an indeterminate daemon status probe. */
export const STATUS_CHECK_FAILED_DETAIL = "status check failed";

/**
 * Typed observation of a subscription provider. Optional on the wire so old
 * daemons and persisted blobs remain valid; consumers must run
 * {@link normalizeProviderConnection} rather than reading `status` alone.
 */
export const DaemonProviderObservation = S.Literals([
  "connected",
  "signed_out",
  "disconnected",
  "unknown",
]);
export type TDaemonProviderObservation = S.Schema.Type<
  typeof DaemonProviderObservation
>;

export const DaemonProviderReasonCode = S.Literals([
  "probe_timeout",
  "probe_failed",
  "keychain_unavailable",
  "store_unreadable",
  "cli_unavailable",
  /** Host CLI is a shebang script whose interpreter is missing on the spawn PATH. */
  "cli_runtime_missing",
  "credential_absent",
]);
export type TDaemonProviderReasonCode = S.Schema.Type<
  typeof DaemonProviderReasonCode
>;

export type TDaemonProviderObservationResult = {
  readonly observation: TDaemonProviderObservation;
  readonly reason_code?: TDaemonProviderReasonCode;
};

/**
 * Why an `auth` hop cooldown was armed from a native refresh, not a vendor
 * 401. Distinct from {@link DaemonProviderReasonCode} so it never rewrites
 * `status` / `observation`.
 */
export const AuthRefreshCooldownReason = S.Literals([
  "refresh_abandoned",
  "refresh_failed",
]);
export type TAuthRefreshCooldownReason = S.Schema.Type<
  typeof AuthRefreshCooldownReason
>;

/**
 * Visibility-only: a live local hop cooldown with reason `auth` for this
 * provider. Does not change `status` / `observation` / the connection
 * `reason_code`. Optional `reason_code` here is the refresh-local cause.
 */
export const DaemonProviderUpstreamAuthCooldown = S.Struct({
  until_ms: S.Number,
  model_id: S.String,
  reason_code: S.optional(AuthRefreshCooldownReason),
});
export type TDaemonProviderUpstreamAuthCooldown = S.Schema.Type<
  typeof DaemonProviderUpstreamAuthCooldown
>;

const OBSERVATIONS = new Set<string>(DaemonProviderObservation.literals);
const REASONS = new Set<string>(DaemonProviderReasonCode.literals);

export type TNormalizedProviderConnection = {
  readonly observation: TDaemonProviderObservation;
  readonly reason_code: TDaemonProviderReasonCode | undefined;
  readonly pending: boolean;
  readonly signed_out: boolean;
  /** Proven currently-session connected with no in-flight login. */
  readonly serviceable: boolean;
};

export type TProviderConnectionInput = {
  readonly status?: unknown;
  readonly connected?: unknown;
  readonly observation?: unknown;
  readonly reason_code?: unknown;
  readonly pending_auth?: unknown;
  readonly cli_installed?: unknown;
  readonly detail?: unknown;
};

const isPendingAuth = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  return typeof value === "object";
};

const inferReason = (
  conn: TProviderConnectionInput,
): TDaemonProviderReasonCode | undefined => {
  if (typeof conn.reason_code === "string" && REASONS.has(conn.reason_code)) {
    return conn.reason_code as TDaemonProviderReasonCode;
  }
  const detail =
    typeof conn.detail === "string" ? conn.detail.toLowerCase() : "";
  if (detail.includes("keychain")) return "keychain_unavailable";
  if (
    detail.includes("unreadable") ||
    detail.includes("eacces") ||
    detail.includes("permission denied") ||
    detail.includes("parse")
  ) {
    return "store_unreadable";
  }
  if (
    conn.detail === STATUS_CHECK_FAILED_DETAIL ||
    detail.includes("timeout") ||
    detail.includes("timed out")
  ) {
    return "probe_timeout";
  }
  if (
    detail.includes("runtime") &&
    (detail.includes("missing") || detail.includes("not on the daemon path"))
  ) {
    return "cli_runtime_missing";
  }
  if (detail.includes("not installed") || conn.cli_installed === false) {
    return "cli_unavailable";
  }
  if (
    detail.includes("not signed in") ||
    detail.includes("no stored credential") ||
    (detail.includes("credential") && detail.includes("absent"))
  ) {
    return "credential_absent";
  }
  return undefined;
};

const inferObservation = (
  conn: TProviderConnectionInput,
  pending: boolean,
  signedOut: boolean,
): TDaemonProviderObservation => {
  if (signedOut) return "signed_out";
  if (
    typeof conn.observation === "string" &&
    OBSERVATIONS.has(conn.observation)
  ) {
    return conn.observation as TDaemonProviderObservation;
  }
  if (conn.status === "connected") return "connected";
  if (conn.status === "disconnected") {
    const reason = inferReason(conn);
    if (
      reason === "probe_timeout" ||
      reason === "probe_failed" ||
      reason === "keychain_unavailable" ||
      reason === "store_unreadable" ||
      reason === "cli_unavailable" ||
      reason === "cli_runtime_missing"
    ) {
      return "unknown";
    }
    return "disconnected";
  }
  if (conn.connected === true) return "connected";
  if (conn.connected === false) {
    const reason = inferReason(conn);
    if (
      reason === "probe_timeout" ||
      reason === "probe_failed" ||
      reason === "keychain_unavailable" ||
      reason === "store_unreadable" ||
      reason === "cli_unavailable" ||
      reason === "cli_runtime_missing"
    ) {
      return "unknown";
    }
    return "disconnected";
  }
  if (pending) return "unknown";
  return "unknown";
};

/**
 * One canonical projection of a provider connection blob. Typed fields win;
 * legacy `status` / `connected` / `detail` are the compatibility fallback.
 *
 * Precedence: `signed_out` always wins. `pending_auth` is never serviceable.
 * `unknown` never becomes logout and never counts as proven connected.
 */
export const normalizeProviderConnection = (
  conn: TProviderConnectionInput,
): TNormalizedProviderConnection => {
  const pending = isPendingAuth(conn.pending_auth);
  const signedOut =
    conn.status === "signed_out" || conn.observation === "signed_out";
  const observation = inferObservation(conn, pending, signedOut);
  const reason_code = inferReason(conn);
  const serviceable = !signedOut && !pending && observation === "connected";
  return {
    observation: signedOut ? "signed_out" : observation,
    reason_code,
    pending,
    signed_out: signedOut,
    serviceable,
  };
};

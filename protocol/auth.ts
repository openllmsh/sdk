import { Schema as S } from "effect";
import { DaemonProviderReasonCode } from "./provider-status";

// ─── Subscription auth lifecycle (daemon ↔ relay ↔ dashboard) ─────────
//
// Explicit login / session events. Distinct from `CommandState` /
// `command_lifecycle` (those are the command RECEIPT — enqueue finished,
// not "Connected"). Success is `auth.login.succeeded`, not a status
// snapshot with `connected: true`. Cancel is `auth.login.failed` with
// `code: "user_cancelled"`, never a sixth event.
//
// `flow_id` is the relay-minted command id (the `command.id` / inflight
// routing key). The browser's enqueue `req_id` is a separate correlation id
// carried on `command_lifecycle` alongside that command id — do not collapse
// the two. `auth.session.lost` has no flow: it is the falling edge of a
// previously-connected provider.
//
// See `docs/audit/2026-08-21-subscription-auth-login-trigger-finalize.md` §6.

export const AuthLoginFailedCode = S.Literals([
  "not_installed",
  "spawn_denied",
  /** The isolated credential store wasn't ready; no vendor CLI was spawned. */
  "store_unavailable",
  "prompt_timeout",
  "cli_crash",
  "poll_expired",
  "relay_disconnected",
  "user_cancelled",
]);
export type TAuthLoginFailedCode = S.Schema.Type<typeof AuthLoginFailedCode>;

export const AuthLoginMode = S.Literals([
  "browser",
  "device_code",
  "paste_code",
]);
export type TAuthLoginMode = S.Schema.Type<typeof AuthLoginMode>;

/**
 * Bounded, non-secret diagnostic of why a session read as disconnected.
 * Mapped from free-form `conn.detail` at the falling edge — never forward
 * the raw detail string onto the wire or into email.
 */
export const AuthSessionLostDiagnosticCode = S.Literals([
  "credential_absent",
  "cli_unavailable",
  "store_unreadable",
  "keychain_unavailable",
  "probe_timeout",
  "vendor_revoked_unknown",
  "unclassified",
]);
export type TAuthSessionLostDiagnosticCode = S.Schema.Type<
  typeof AuthSessionLostDiagnosticCode
>;

/** After the vendor CLI spawn succeeded.
 *  `slug` stays open `S.String` for forward-compat; the closed vocab is
 *  `SubscriptionProviderSlug` in `./subscription-provider`. */
export const AuthLoginStarted = S.Struct({
  event: S.Literal("auth.login.started"),
  flow_id: S.String,
  key_id: S.String,
  slug: S.String,
  mode: AuthLoginMode,
});
export type TAuthLoginStarted = S.Schema.Type<typeof AuthLoginStarted>;

/** Origin-only payload: verification URL + optional device/paste code. */
export const AuthLoginPrompt = S.Struct({
  event: S.Literal("auth.login.prompt"),
  flow_id: S.String,
  key_id: S.String,
  slug: S.String,
  url: S.String,
  code: S.optional(S.String),
  mode: AuthLoginMode,
});
export type TAuthLoginPrompt = S.Schema.Type<typeof AuthLoginPrompt>;

/** Credential readable for THIS flow. */
export const AuthLoginSucceeded = S.Struct({
  event: S.Literal("auth.login.succeeded"),
  flow_id: S.String,
  key_id: S.String,
  slug: S.String,
  account_hash: S.optional(S.String),
});
export type TAuthLoginSucceeded = S.Schema.Type<typeof AuthLoginSucceeded>;

/**
 * Terminal failure. There is no `auth.login.cancelled` event — cancel is
 * this variant with `code: "user_cancelled"`.
 */
export const AuthLoginFailed = S.Struct({
  event: S.Literal("auth.login.failed"),
  flow_id: S.String,
  key_id: S.String,
  slug: S.String,
  code: AuthLoginFailedCode,
  message: S.String,
  retryable: S.Boolean,
  /** Closed prep/terminal cause when known (e.g. `keychain_unavailable`). */
  reason_code: S.optional(DaemonProviderReasonCode),
});
export type TAuthLoginFailed = S.Schema.Type<typeof AuthLoginFailed>;

/** Falling edge after a prior connected. Not a login attempt — no `flow_id`. */
export const AuthSessionLost = S.Struct({
  event: S.Literal("auth.session.lost"),
  key_id: S.String,
  slug: S.String,
  account_hash: S.optional(S.String),
  diagnostic_code: S.optional(AuthSessionLostDiagnosticCode),
});
export type TAuthSessionLost = S.Schema.Type<typeof AuthSessionLost>;

/**
 * Consecutive indeterminate probes after a last-known `connected`. Not a
 * session-loss assertion — consumers must not treat this as
 * `auth.session.lost` (no cloud POST, no email).
 */
export const AuthLivenessDegraded = S.Struct({
  event: S.Literal("auth.liveness.degraded"),
  key_id: S.String,
  slug: S.String,
  consecutive_unknown: S.Number,
  reason_code: S.optional(DaemonProviderReasonCode),
});
export type TAuthLivenessDegraded = S.Schema.Type<typeof AuthLivenessDegraded>;

/** Discriminated on `event`. */
export const AuthEvent = S.Union([
  AuthLoginStarted,
  AuthLoginPrompt,
  AuthLoginSucceeded,
  AuthLoginFailed,
  AuthSessionLost,
  AuthLivenessDegraded,
]);
export type TAuthEvent = S.Schema.Type<typeof AuthEvent>;

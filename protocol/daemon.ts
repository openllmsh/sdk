import { Schema as S } from "effect";
import { AuthSessionLostDiagnosticCode } from "./auth";
import { CLIENT_HOST_MAX_LENGTH } from "./client-origin";
import type { TContextOverflowStrategy } from "./config";
import {
  ContextOverflowStrategy,
  FallbackGroup,
  ModelFallbackBinding,
} from "./config";
import { CooldownReason } from "./cooldown-reason";
import { DaemonReportingPolicy } from "./doctor-report-policy";
import { ExecutionSelection } from "./execution-selection";
import { AUTH_OPERATIONS, AUTH_RELAY_WAIT_MAX_MS } from "./local-auth";
import {
  DeviceAccessPinReport,
  DeviceSessionsReport,
} from "./local-device-control";
import { LocalKeyProviderSlug } from "./local-provider";
import {
  ModelSettingDefinitions,
  ModelSettingsOverrides,
} from "./model-settings";
import {
  ModelAudioSupport,
  ModelCaps,
  ModelCapsDefaultRule,
  ProviderModelList,
  SubscriptionMeter,
} from "./models";
import {
  DaemonProviderObservation,
  DaemonProviderReasonCode,
  DaemonProviderUpstreamAuthCooldown,
} from "./provider-status";
import { ProviderUsageSnapshot } from "./provider-usage";
import { ReplaySessionId } from "./replay-session";
import { RequestStatus } from "./stats";
import { SubscriptionProviderSlug } from "./subscription-provider";
import { TEAM_GRANT_B64_MAX } from "./team-grant";
import { VendorCliInstall } from "./vendor-cli-install";

// ─── GET /api/daemon/bootstrap (daemon → cloud) ──────────────────────
//
// One snapshot with everything the local pipeline needs to resolve a
// chain + price-free dispatch: the model catalog, the provider prefixes,
// and the authenticated user's fallback config. Pulled at boot and
// refreshed on a TTL so the daemon stays in lockstep with cloud config
// without recompiling.

export const DaemonCatalogEntry = S.Struct({
  settings: S.optional(ModelSettingDefinitions),
  model_id: S.String,
  provider: S.String,
  provider_model_id: S.String,
  input_token_limit: S.NullOr(S.Number),
  output_token_limit: S.NullOr(S.Number),
  subscription_meter: S.optional(SubscriptionMeter),
  /**
   * Catalog capabilities for this model. Optional so older clouds keep
   * bootstrapping newer daemons. Absent / empty = unknown (never treated
   * as known-non-vision). The walker vision gate reads this on each hop.
   *
   * Open string array: unknown future literals (e.g. `image_editing`,
   * `realtime`) must not fail the whole bootstrap. Older compiled daemons
   * still decode a closed `ModelCapability` set — cloud encoders should
   * send {@link toBootstrapSafeCapabilities} until those binaries are
   * replaced.
   */
  capabilities: S.optional(S.Array(S.String)),
  /** Catalog-declared final outbound-body constraints for this model. */
  caps: S.optional(ModelCaps),
  /**
   * Catalog-declared audio support (input/output formats, voices,
   * realtime ops). The daemon's audio walker currently re-derives these
   * from the provider slug while the catalog already declares them per
   * model, so the card is the correction channel.
   *
   * Optional, like `caps`: an older cloud omits it and a newer daemon
   * reads absent as UNKNOWN, keeping today's provider-derived defaults.
   * Delivered over the AUTHENTICATED bootstrap, never the signed plan —
   * that payload covers only plan/pmids/origin, so anything appended
   * there would be caller-controllable and unsigned.
   */
  audio_support: S.optional(ModelAudioSupport),
  /** Optional so older clouds keep bootstrapping newer daemons. */
  strip_subagent_isolation: S.optional(S.Boolean),
});
export type TDaemonCatalogEntry = S.Schema.Type<typeof DaemonCatalogEntry>;

export const DaemonBootstrap = S.Struct({
  catalog: S.Array(DaemonCatalogEntry),
  provider_prefixes: S.Array(S.String),
  /**
   * Catalog-owned caps DEFAULTS for models with no catalog row. The
   * daemon runs the SAME `resolveDefaultModelCaps` matcher the cloud
   * does, so an un-catalogued id resolves identically on both paths and
   * the two cannot drift.
   *
   * Optional: an older cloud omits it and the daemon simply resolves no
   * defaults (absent = unknown = permissive, today's behaviour). Rules
   * are DATA on the authenticated bootstrap — never the signed plan.
   */
  caps_defaults: S.optional(S.Array(ModelCapsDefaultRule)),
  user_fallback_groups: S.Array(FallbackGroup),
  user_model_fallback_bindings: S.Array(ModelFallbackBinding),
  model_settings: S.optional(ModelSettingsOverrides),
  /** Per-user context-window overflow routing preference. Absent means the
   * historical hop-to-larger-context behaviour. */
  context_overflow_strategy: S.optional(ContextOverflowStrategy),
  /**
   * Per-user HMAC key the daemon uses to VERIFY the plan `/api/daemon/plan`
   * returns (the cloud signs with the same key). Lets the daemon reject
   * a plan forged by another local process. Null when the cloud has no
   * signing secret configured (dev) — the daemon then accepts unsigned
   * plans. See `docs/proposals/coreless-daemon-passthrough.md` §9.
   */
  plan_signing_key: S.optional(S.NullOr(S.String)),
  /**
   * Authenticated account id for this bootstrap. Optional/additive so older
   * clouds keep bootstrapping; newer daemons use it to compare relay-stamped
   * `peer_user_id` on `channel_open` (cross-user → require a team grant).
   */
  user_id: S.optional(S.String),
  /**
   * Per-contributor HMAC key for verifying team device grants (same key
   * origin uses to sign for this user). Null/absent when
   * `NEON_AUTH_COOKIE_SECRET` is unset — team device routing is then off
   * (`team_device_unavailable`); the daemon refuses team traffic.
   * See `docs/plan/2026-10-26-teams.md` §16.2.
   */
  team_grant_key: S.optional(S.NullOr(S.String)),
  /**
   * The daemon binary version the cloud currently publishes (bare semver, no
   * leading `v` — matches the daemon's compiled `DAEMON_VERSION`). The daemon
   * compares it against its own and SELF-UPDATES when they differ (converge to
   * published — the cloud is the source of truth, so republishing an older tag
   * rolls daemons back). Null/absent when no release is published yet (or the
   * cloud is too old to advertise it) — the daemon then never self-updates.
   * See `packages/cli/daemon/src/self-update.ts`.
   */
  latest_version: S.optional(S.NullOr(S.String)),
  /**
   * The `openllmc` CLI version the cloud currently publishes (bare semver, no
   * leading `v`). The daemon converges the INSTALLED CLI binary at
   * `~/.openllm/bin/openllmc` to it on the same auto-update tick (and under
   * the same opt-out toggle) as its own self-update — one flow, one toggle.
   * The daemon never installs the CLI: an absent binary is skipped. Null/
   * absent when no CLI release is published yet (or the cloud is too old to
   * advertise it) — the daemon then never touches the CLI.
   * One binary is both CLI and daemon now, so this is the release the daemon
   * converges `~/.openllm/bin/openllm` to. See
   * `packages/cli/daemon/src/updater.ts`.
   */
  latest_cli_version: S.optional(S.NullOr(S.String)),
  /**
   * The cloud's resolved `ACTIVE_SUB_METHOD` global preference — a named
   * execution variant (`stream-json` / `sdk-facade` / `acp` / `app-server` /
   * `msp` / `agent-sdk`, optionally `-capture`) or `handrolled`; see
   * `./execution-selection`. Null = no preference: each hop uses its
   * provider's registry default. Sampled once per request from the cached
   * bootstrap snapshot.
   */
  execution_selection: S.optional(S.NullOr(ExecutionSelection)),
  /**
   * Per-provider overrides layered on top of `execution_selection`
   * (`provider:method` entries of the same env). String-keyed so a newer
   * cloud advertising a slug this daemon predates never fails bootstrap
   * decode.
   */
  execution_selections: S.optional(
    S.NullOr(S.Record(S.String, ExecutionSelection)),
  ),
  /**
   * Cloud-controlled toggle for the daemon's SIGNED-PLAN CACHE
   * (`DAEMON_PLAN_CACHE` on the cloud, default ON — an explicit `0`/`false`
   * disables): when true, a `/v1/*` request that reaches the daemon
   * directly may be served against the most recent
   * cloud-signed plan tuple for the same model alias within a short TTL,
   * skipping the per-request cloud round trip. The signature is still
   * verified per request (the cached tuple is exactly what the cloud
   * signed); staleness is bounded by the TTL. False → the daemon requires
   * a plan on every request; ABSENT (a cloud predating the field) → the
   * daemon also keeps the cache off (the cloud is the one authority). See
   * docs/proposals/sub-method-simplified-execution.md §4.
   */
  plan_cache: S.optional(S.Boolean),
  /**
   * The user's FLEET subscription servers: for each subscription provider
   * connected on some ONLINE daemon of this user, the serving daemon's
   * key id. Computed cloud-side from `api_key_activity` presence + status
   * (serve-by-default policy — every online device qualifies). A consuming
   * daemon with no local credential for a subscription hop tunnels the
   * request to `key_id` over the relay
   * (`docs/features/sub-tunnel-and-chat-sessions.md` §1). String-keyed
   * provider so newer slugs never fail an older daemon's decode; optional
   * so older clouds keep bootstrapping newer daemons.
   */
  fleet_subscriptions: S.optional(
    S.Array(
      S.Struct({
        provider: S.String,
        key_id: S.String,
        /** Serving daemon X25519 SPKI, absent for pre-pubkey peers. */
        pubkey: S.optional(S.String),
      }),
    ),
  ),
  /**
   * SPKI DER (base64) of the account DEVICE-CONTROL public key (Ed25519,
   * derived in the browser from the recovery phrase — never from the DEK, so
   * the cloud cannot sign with it). The daemon first-use pins it UNANCHORED
   * (tunnel only), follows signed rotations, and anchors only from a local
   * root (install anchor / loopback); it verifies
   * browser-signed device grants against it. The
   * field name is historical: before `device_access_kind: "control"` it carried
   * a per-key DEK-derived key ("legacy"). Null when the key is un-provisioned or
   * the caller is session-only / watcher (no owning key). Optional so older
   * clouds keep bootstrapping newer daemons.
   */
  device_access_pubkey: S.optional(S.NullOr(S.String.check(S.isMaxLength(64)))),
  /**
   * `"control"` when {@link device_access_pubkey} is the account control key.
   * Absent = legacy per-key value (the daemon then never upgrades a pin to it
   * and refuses agent sessions with `device_not_anchored`).
   */
  device_access_kind: S.optional(S.Literal("control")),
  /**
   * The control key's generation (`users.device_control_version`, the vault
   * generation it was derived under). A signed rotation must carry a greater
   * `cv` than the daemon's pinned version. Null/absent when unknown.
   */
  device_access_version: S.optional(S.NullOr(S.Number.check(S.isInt()))),
  /**
   * Control-key rotation statements, oldest first (base64 JSON, signed by the
   * PREVIOUS control key — see `@openllmsh/sdk/tunnel` `device-control.ts`). The
   * daemon walks the chain from its own pin to {@link device_access_pubkey}.
   * The cloud cannot forge a step: each is signed by a key only a browser
   * holding the recovery phrase ever derived.
   */
  device_access_rotations: S.optional(
    S.Array(S.String.check(S.isMaxLength(1024))).check(S.isMaxLength(8)),
  ),
  /**
   * Optional reporting policy. Absent on old clouds = off. Expired or
   * `enabled: false` means no upload. See `doctor-report-policy.ts`.
   */
  reporting_policy: S.optional(DaemonReportingPolicy),
  /**
   * Revision of the authenticating key's access policy (models, routes,
   * caps). The daemon drops every cached plan when it changes, so a plan
   * cached under an older policy is never replayed. Null for a session
   * caller with no key. When absent, retain the daemon's known revision.
   */
  key_policy_rev: S.optional(S.NullOr(S.String)),
});
export type TDaemonBootstrap = S.Schema.Type<typeof DaemonBootstrap>;

/**
 * Wire contracts for the local daemon ⇄ cloud control plane and for the
 * daemon's own localhost control surface.
 *
 * Compliance note: the only daemon→cloud payloads are config pulls and
 * the metadata-only request row below. No subscription token and no
 * prompt/completion content ever crosses this boundary.
 */

// ─── POST /api/daemon/requests (daemon → cloud) ──────────────────────
//
// One `public.requests` row for a subscription hop the daemon ran
// locally. `user_id` / `key_id` are deliberately ABSENT: the cloud
// derives both from the authenticating `sk-llm-...` key, so a daemon can
// only ever record rows for its own owner.
//
// No `cost_usd` either — the daemon reports only TOKEN COUNTS; the cloud
// is the single pricing source of truth and computes cost from these
// tokens in `daemonRecordHandler` (`costFor`). Keeping cost off the wire
// is why no pricing table is duplicated onto the daemon.
const HOLD_NONCE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/i;
const HoldNonce = S.String.check(S.isPattern(HOLD_NONCE_PATTERN));

export const DaemonRecordRequest = S.Struct({
  model: S.String,
  provider: S.String,
  status: RequestStatus,
  /** Canonical prompt tokens — INCLUDES the two cache fields below. */
  tokens_in: S.Number,
  tokens_out: S.Number,
  // The cache split of `tokens_in`. Optional so a daemon built before this
  // field existed still records (its rows just price as all-fresh input, the
  // prior behaviour). Still no `cost_usd`: the cloud prices these tokens.
  cached_tokens: S.optional(S.Number),
  cache_creation_tokens: S.optional(S.Number),
  latency_ms: S.Number,
  idempotency_key: S.optional(S.NullOr(S.String)),
  error: S.optional(S.NullOr(S.String)),
  endpoint: S.optional(S.NullOr(S.String)),
  /** Obscured vendor-account identity of the credential that SERVED this
   *  hop — the same `sha256("openllm-account-v1:<provider>:<id>")` digest
   *  the status frame reports, computed from the token that ran the
   *  request. Lets the usage-calibration estimator attribute this row's
   *  cost to the right meter series when a provider has several accounts.
   *  Optional so daemons predating the field still record (the cloud
   *  stores null → the estimator's conservative null pool). */
  account_hash: S.optional(S.String),
  /**
   * Which client sent the request the daemon walked (`deriveClientOrigin`
   * over the inbound headers), and a website's hostname. The cloud re-checks
   * both (`normalizeClientOrigin`) before storing them on the row. Optional:
   * daemons predating the fields record a NULL client.
   */
  client_kind: S.optional(S.String.check(S.isMaxLength(64))),
  client_host: S.optional(
    S.String.check(S.isMaxLength(CLIENT_HOST_MAX_LENGTH)),
  ),
  /**
   * Origin-signed team grant echoed on team hops so the cloud attributes
   * the row to the consumer and settles `team_usage_counters`. Same-user
   * records omit it. Bounded like the mux forward header.
   */
  team_grant: S.optional(S.String.check(S.isMaxLength(TEAM_GRANT_B64_MAX))),
  /**
   * Cap hold this request ran under. Only the hold's TERMINAL record carries
   * it; that record settles the hold at `tokens_in + tokens_out` (may be 0).
   * Accepted only from the device key the hold is bound to.
   */
  hold_nonce: S.optional(HoldNonce),
  /**
   * With `hold_nonce`: tokens reported by this request's earlier attempts
   * (retries, sibling accounts, fallbacks), added to this record's tokens.
   */
  hold_prior_tokens: S.optional(
    S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(0)),
  ),
  /**
   * With `hold_nonce`: sends of this request with no usage evidence. The
   * cloud charges each one the hold's full reservation.
   */
  hold_unknown_attempts: S.optional(
    S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(0)),
  ),
  cooldown_reason: S.optional(CooldownReason),
  /** Reset instant for reset-aware TTL cap; optional so old daemons omit. */
  reset_at_ms: S.optional(S.Number),
}).check(
  // A successful hop never cools — a `cooldown_reason` on a `success` record
  // is malformed, so reject it at the schema boundary rather than let the
  // handler mark a cooldown for a model that just served cleanly.
  S.makeFilter(
    (record: TDaemonRecordRequest) =>
      record.status !== "success" || record.cooldown_reason === undefined,
    { message: "cooldown_reason is only valid on a non-success record" },
  ),
);
export type TDaemonRecordRequest = S.Schema.Type<typeof DaemonRecordRequest>;

// ─── POST /api/daemon/models (daemon → cloud) ────────────────────────
//
// The daemon writer for `public.model_cache` (live-provider-model-catalog
// proposal §4): the live model lists the daemon's CONNECTED delegates
// report from their vendors' own list endpoints. Metadata only — model
// ids + optional display/context data, never a credential. `user_id` is
// deliberately ABSENT (derived from the authenticating `sk-llm-...` key,
// same posture as `DaemonRecordRequest`), and the handler restricts
// `provider` to the subscription set so a daemon can never overwrite the
// cloud-owned API-key rows.
export const DaemonModelReportEntry = S.Struct({
  provider: S.String.check(S.isMaxLength(64)),
  // Same per-list bound as `ProviderModelList` (defense-in-depth on
  // this authenticated write path).
  models: ProviderModelList,
  /** Vendor CLI version (bare semver) that OBSERVED this list. Some
   *  vendors gate model visibility by client version (Codex does), so
   *  the cloud uses this to refuse a write that would replace a fresh
   *  row produced by a NEWER CLI on another device. Optional so daemons
   *  built before the field still report (their writes stay permissive). */
  cli_version: S.optional(S.String.check(S.isMaxLength(64))),
});
export type TDaemonModelReportEntry = S.Schema.Type<
  typeof DaemonModelReportEntry
>;

export const DaemonModelReport = S.Struct({
  // One entry per subscription (oauth) provider — the closed set is small;
  // 32 leaves headroom without allowing a bloated report.
  entries: S.Array(DaemonModelReportEntry).check(S.isMaxLength(32)),
  /**
   * Device-discovered local model-server lists, keyed by `local_*` /
   * `local_port_*` provider. Separate from `entries` so an oauth-only
   * maxItems(32) bound cannot crowd out local rows (and vice versa).
   * Absent on older daemons.
   */
  local_entries: S.optional(
    S.Array(DaemonModelReportEntry).check(S.isMaxLength(64)),
  ),
});
export type TDaemonModelReport = S.Schema.Type<typeof DaemonModelReport>;

/** Probe outcome for one local model server on the daemon's machine. */
export const LocalServerStatus = S.Literals(["ok", "needs_key", "unreachable"]);
export type TLocalServerStatus = S.Schema.Type<typeof LocalServerStatus>;

/**
 * Live local-server discovery state pushed on `DaemonStatus` (no keys —
 * only `has_key`). Also the result shape of a `local_rescan` command.
 */
export const LocalServerState = S.Struct({
  /** Preset slug (`local_ollama`, …) or `local_port_<port>` fallback. */
  slug: S.String.check(S.isMinLength(1), S.isMaxLength(64)),
  port: S.Number.check(
    S.isInt(),
    S.isGreaterThanOrEqualTo(1),
    S.isLessThanOrEqualTo(65535),
  ),
  base_url: S.String.check(S.isMinLength(1), S.isMaxLength(512)),
  status: LocalServerStatus,
  has_key: S.Boolean,
  models: ProviderModelList,
});
export type TLocalServerState = S.Schema.Type<typeof LocalServerState>;

// ─── Daemon control relay (cloud ⇄ daemon over the WebSocket relay) ──
//
// The daemon dials OUT and holds ONE WebSocket to the relay (it fetches the
// channel via `GET /api/daemon/channel`); the dashboard enqueues control
// commands via its own watcher socket (or `POST /api/daemon/cmd` as a
// fallback). Commands, acks and status all ride relay frames (see
// `packages/schema/relay.ts`); the relay writes `api_key_activity` so presence
// is server-side, no `x-openllm-daemon` header. See
// `docs/proposals/daemon-relay-websocket-push.md`.

export type { TSubscriptionProviderSlug } from "./subscription-provider";
export { SubscriptionProviderSlug } from "./subscription-provider";

// ─── POST /api/daemon/session-lost (daemon → cloud) ──────────────────
//
// An authenticated daemon reports a confirmed subscription session loss. The
// cloud derives the user and source key from the bearer token; neither belongs
// in this body.
export const DaemonSessionLost = S.Struct({
  slug: SubscriptionProviderSlug,
  account_hash: S.optional(S.String),
  /** Bounded, non-secret classifier of `conn.detail` — never the raw string. */
  diagnostic_code: S.optional(AuthSessionLostDiagnosticCode),
});
export type TDaemonSessionLost = S.Schema.Type<typeof DaemonSessionLost>;

export const DaemonQuotaStatusReached = S.Struct({
  slug: SubscriptionProviderSlug,
  status: S.Literals(["allowed_warning", "rejected"]),
  account_hash: S.optional(S.String),
  plan: S.optional(S.String),
  /**
   * Sustaining quota-window reset epoch (unix ms). Optional so older daemons
   * omit it; cloud then falls back to account:status + 24h cooldown.
   */
  reset_at_ms: S.optional(S.Number),
  /**
   * The quota snapshot that produced this transition — display-only, it lets
   * the email list every limit with its usage and reset. Optional so older
   * daemons omit it. The cloud decodes it apart from the fields above and
   * falls back to the plain notice when it is missing, undecodable, not a
   * quota snapshot, or disagrees with `status`.
   */
  usage: S.optional(ProviderUsageSnapshot),
});
export type TDaemonQuotaStatusReached = S.Schema.Type<
  typeof DaemonQuotaStatusReached
>;

/** Optional user-visible device-session label (open frames + presence). */
export const SessionTitleField = S.String.check(S.isMaxLength(80));
export type TSessionTitleField = S.Schema.Type<typeof SessionTitleField>;

/**
 * CLIs the device PTY surface can host: OpenLLM session clients with local
 * history + resume wiring (Claude / Codex / Grok / OpenCode / Hermes), plus a
 * direct login shell. Keep `SubscriptionProviderSlug` for credentials/usage;
 * session frames use this set, while the local-session list uses its narrower
 * canonical set. Kimi and Cursor stay subscription-only for now.
 */
export const DeviceSessionCli = S.Literals([
  "claude_code",
  "chatgpt",
  "grok",
  "opencode",
  "hermes",
  "shell",
]);
export type TDeviceSessionCli = S.Schema.Type<typeof DeviceSessionCli>;

/**
 * CLIs for which `openllm -d <client>` (skip approvals) is meaningful.
 * Canonical set — the picker, session-host, and any consumer import THIS
 * rather than re-declaring their own membership list.
 */
export const DANGEROUS_SESSION_CLIS: ReadonlySet<TDeviceSessionCli> = new Set([
  "claude_code",
  "chatgpt",
  "grok",
  "hermes",
]);

/** CLIs with a local history reader on the daemon (v1). Canonical set. */
export const LISTABLE_SESSION_CLIS: ReadonlySet<TDeviceSessionCli> = new Set([
  "claude_code",
  "chatgpt",
  "grok",
  "opencode",
  "hermes",
]);

export const supportsDangerousSession = (cli: string): boolean =>
  (DANGEROUS_SESSION_CLIS as ReadonlySet<string>).has(cli);

export const isListableSessionCli = (cli: string): boolean =>
  (LISTABLE_SESSION_CLIS as ReadonlySet<string>).has(cli);

/**
 * One row from the daemon's local session index (vendor history +
 * `~/.openllm/run/<client>/<pid>/live.json` + in-memory device PTYs).
 * Used by `list_local_sessions` so the picker can attach / cold-resume
 * without scanning disk in the browser.
 */
export const LocalCliSession = S.Struct({
  /** Vendor session id when known; otherwise a synthetic live-run key. */
  id: S.String.check(S.isMinLength(1), S.isMaxLength(128)),
  title: SessionTitleField,
  cwd: S.NullOr(S.String.check(S.isMaxLength(1024))),
  updated_at_ms: S.Number,
  cli: DeviceSessionCli,
  live: S.Boolean,
  /** Where the live process is hosted, when `live`. */
  host: S.optional(S.NullOr(S.Literals(["local", "device"]))),
  /** OpenLLM device session id when the PTY is already hosted by the daemon. */
  openllm_session_id: S.optional(S.NullOr(S.String.check(S.isMaxLength(64)))),
  /** True when the browser can `mode:"attach"` without spawning a second CLI. */
  attachable: S.Boolean,
});
export type TLocalCliSession = S.Schema.Type<typeof LocalCliSession>;

/** Payload for `list_local_sessions`. */
export const ListLocalSessionsPayload = S.Struct({
  cli: DeviceSessionCli,
  /** Max rows (default 30 server-side; hard cap 100). */
  limit: S.optional(
    S.Number.check(
      S.isInt(),
      S.isGreaterThanOrEqualTo(1),
      S.isLessThanOrEqualTo(100),
    ),
  ),
});
export type TListLocalSessionsPayload = S.Schema.Type<
  typeof ListLocalSessionsPayload
>;

/** Result blob for `list_local_sessions` (command ack / lifecycle.result). */
export const ListLocalSessionsResult = S.Struct({
  sessions: S.Array(LocalCliSession),
});
export type TListLocalSessionsResult = S.Schema.Type<
  typeof ListLocalSessionsResult
>;

/**
 * Result blob for `refresh_models_due` (command ack / lifecycle.result).
 * Always rides a `done` lifecycle — automatic discovery never surfaces as
 * a user-facing command error. `attempted: false` + `reported: 0` is a
 * quiet TTL/credential skip; `reported: 0` + `failed: true` is a total
 * failure. The dashboard refetches `/v1/models` on `reported > 0`
 * (including partial writes) and also on quiet skips (`failed === false`)
 * so a cached query can pick up a catalog another trigger already POSTed.
 */
export const RefreshModelsDueResult = S.Struct({
  attempted: S.Boolean,
  reported: S.Number,
  failed: S.Boolean,
  error: S.optional(S.String),
});
export type TRefreshModelsDueResult = S.Schema.Type<
  typeof RefreshModelsDueResult
>;

/** Terminal exit reason retained for a dead but resumable device session. */
export const SessionExitReason = S.Literals([
  "evicted",
  "reaped",
  "done",
  "killed",
]);
export type TSessionExitReason = S.Schema.Type<typeof SessionExitReason>;

// Opaque base64 blob (an X25519 sealed box / SPKI public key) — decrypted or
// parsed by the recipient, never executed. Padding restricted to at most two
// '=' characters only at the end (valid base64 format).
const Base64Blob = S.String.check(S.isPattern(/^[A-Za-z0-9+/]+={0,2}$/));

/** The closed set of install-time gateway modes: which base URL a client
 *  setup bakes — the local daemon (`local`, the default) or the cloud
 *  origin. ONE schema for every wire field and TS union that carries it. */
export const GatewayMode = S.Literals(["local", "cloud"]);
export type TGatewayMode = S.Schema.Type<typeof GatewayMode>;

/** Device-local account slot of a subscription provider (multi-account,
 *  `docs/plan/multi-account-subscriptions.md`). Absent ⇒ 0, today's single
 *  account. Old daemons strip the field on decode and act on account 0, so
 *  senders must only set it when the daemon advertises
 *  `features.multi_account`. */
export const AccountIndex = S.Number.check(
  S.isInt(),
  S.isGreaterThanOrEqualTo(0),
  S.isLessThanOrEqualTo(1023),
);
export type TAccountIndex = S.Schema.Type<typeof AccountIndex>;

const ProviderPayload = S.Struct({
  slug: SubscriptionProviderSlug,
  account_index: S.optional(AccountIndex),
});
/** Add an account slot; the daemon allocates the index and returns it. */
const AddAccountPayload = S.Struct({
  slug: SubscriptionProviderSlug,
  label: S.optional(S.String.check(S.isMaxLength(64))),
});
/** Remove an account slot (n >= 1; account 0 is only logged out). */
const RemoveAccountPayload = S.Struct({
  slug: SubscriptionProviderSlug,
  account_index: AccountIndex.check(S.isGreaterThanOrEqualTo(1)),
});
/** Pin an account first in routing, or clear the pin with `null`. */
const PinAccountPayload = S.Struct({
  slug: SubscriptionProviderSlug,
  account_index: S.NullOr(AccountIndex),
});
/** Cancel an in-flight connect. `flow_id` is optional so old senders keep
 *  working; when present the daemon binds the signal to that owner and
 *  rejects mismatches. Extra field is additive — old decoders ignore it. */
const CancelConnectPayload = S.Struct({
  slug: SubscriptionProviderSlug,
  account_index: S.optional(AccountIndex),
  flow_id: S.optional(S.String),
});
/** A remote-Claude headless-login code submission: the X25519-sealed OAuth
 *  authorization code the user pasted from the hosted callback page. Opened on
 *  the target daemon and written to the waiting `claude auth login` stdin. The
 *  code is single-use + PKCE-bound (useless without the daemon's in-process
 *  verifier); sealed so the cloud relays it blind. See
 *  `docs/proposals/headless-claude-login-paste-back.md`. */
const SubmitLoginCodePayload = S.Struct({
  slug: SubscriptionProviderSlug,
  account_index: S.optional(AccountIndex),
  sealed: Base64Blob,
});
/** Set or clear a per-port API key for a local model server. `sealed` is an
 *  X25519 sealed box to the daemon's pubkey (same posture as
 *  `submit_login_code`); an empty sealed blob clears the stored key. */
const SetLocalKeyPayload = S.Struct({
  port: S.Number.check(
    S.isInt(),
    S.isGreaterThanOrEqualTo(1),
    S.isLessThanOrEqualTo(65535),
  ),
  sealed: S.Union([Base64Blob, S.Literal("")]),
});
/** Add, replace or remove one `local_key` provider key slot. `sealed` is an
 *  X25519 sealed box of the API key to the daemon's pubkey; the relay and
 *  cloud never see plaintext. `account_index` absent ⇒ allocate a new slot
 *  (lowest free index). Present + empty `sealed` ⇒ remove that slot. Present
 *  + non-empty ⇒ replace that slot's key. */
const SetProviderKeyPayload = S.Struct({
  slug: LocalKeyProviderSlug,
  account_index: S.optional(AccountIndex),
  sealed: S.Union([Base64Blob, S.Literal("")]),
  label: S.optional(S.String.check(S.isMaxLength(64))),
});
/** Team ids name the daemon's `team-keys/<id>.json`, so the wire admits only
 *  a path-safe id (the cloud mints UUIDs). */
export const TEAM_KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const TeamKeyId = S.String.check(S.isPattern(TEAM_KEY_ID_PATTERN));
const SetTeamKeyPayload = S.Struct({
  team_id: TeamKeyId,
  epoch: S.Int.check(S.isGreaterThanOrEqualTo(0)),
  sealed: Base64Blob,
});
const DeleteTeamKeyPayload = S.Struct({ team_id: TeamKeyId });
const SetAutoUpdatePayload = S.Struct({ enabled: S.Boolean });
/** Disable device sessions remotely: `statement` is the base64 envelope of
 *  `{ v: 1, key_id, ts, nonce, sig }` signed by the account control key
 *  (`@openllmsh/sdk/vault` `signDeviceSessionsDisable`). Disable-only — there is no
 *  remote enable. The daemon verifies against its ANCHORED pin and sets
 *  `OPENLLM_DEVICE_SESSIONS=0` (the trust anchor stays); the cloud only
 *  relays and cannot forge one. */
const SetDeviceSessionsPayload = S.Struct({
  statement: S.String.check(
    S.isMinLength(1),
    S.isMaxLength(1024),
    S.isPattern(/^[A-Za-z0-9+/]+={0,2}$/),
  ),
});
/** `refresh` re-reads usage for connected providers. Optional `slug` scopes
 *  that read to one provider; omitted `slug` means every connected provider
 *  (bare `{}` is that whole-daemon read — it does not clear the usage cache).
 *  `manual` is the explicit Refresh-usage button only: it may native-refresh
 *  an expired stored token. Cache TTL bypass is daemon-internal
 *  (`cachedUsage` `force`), never this wire flag. Absent/false is the
 *  auto/mount path (stored credential, TTL-respecting). */
const RefreshPayload = S.Struct({
  slug: S.optional(SubscriptionProviderSlug),
  account_index: S.optional(AccountIndex),
  manual: S.optional(S.Boolean),
});
/** One `openllm auth …` request run on the device by the same handler the CLI
 *  and MCP reach over loopback (`/local/auth`), so every surface shares one
 *  contract and one reply. The paste-back code never travels in clear:
 *  `sealed_code` is an X25519 sealed box to the daemon's pubkey. The daemon
 *  re-validates the opened request with `parseLocalAuthRequest`. */
const AuthPayload = S.Struct({
  operation: S.Literals(AUTH_OPERATIONS),
  provider: S.optional(S.String.check(S.isPattern(/^[a-z][a-z0-9_]{0,63}$/))),
  method: S.optional(S.Literals(["browser", "device"])),
  flow_id: S.optional(S.String.check(S.isPattern(/^[a-zA-Z0-9_-]{1,128}$/))),
  account: S.optional(AccountIndex),
  label: S.optional(S.String.check(S.isMinLength(1), S.isMaxLength(64))),
  since: S.optional(S.String.check(S.isPattern(/^[a-f0-9]{1,64}$/))),
  wait_ms: S.optional(
    S.Int.check(
      S.isGreaterThanOrEqualTo(0),
      S.isLessThanOrEqualTo(AUTH_RELAY_WAIT_MAX_MS),
    ),
  ),
  sealed_code: S.optional(Base64Blob),
});
export type TAuthPayload = S.Schema.Type<typeof AuthPayload>;
/** Decoding strips unknown keys, so enqueue boundaries also refuse any raw
 *  key outside this set — a plaintext `code` never transits the relay. */
export const AUTH_PAYLOAD_KEYS: ReadonlySet<string> = new Set(
  Object.keys(AuthPayload.fields),
);
export const authPayloadKeysAllowed = (payload: unknown): boolean =>
  payload !== null &&
  typeof payload === "object" &&
  !Array.isArray(payload) &&
  Object.keys(payload).every((key) => AUTH_PAYLOAD_KEYS.has(key));

/** Payload-less commands (`status` / `update`): accept an absent payload or a
 *  bare `{}` so every union member carries the field (uniform access). */
const EmptyPayload = S.Struct({});

/**
 * The CLOSED control-command vocabulary — one struct per kind, literal-
 * discriminated, every payload field a constrained scalar (a provider-slug
 * enum, a charset-pinned artifact slug, a boolean, an opaque base64 blob).
 * NO field may carry a command string, script body, args array, URL, or
 * free filesystem path — adding one is a deliberate, reviewable schema
 * change, not something `S.Unknown` admits. A command outside this set
 * fails decode at the parse boundary on BOTH ends (cloud/relay enqueue +
 * the daemon's relay socket) before any handler runs. See
 * `docs/proposals/daemon-os-sandbox-and-typed-control.md` §2.
 *
 * Built once and addressed three ways so the vocabularies can never drift:
 * bare (enqueue validation), `id` (relay delivery wire), `key_id`
 * (dashboard enqueue wire).
 */
const commandVariants = <F extends S.Struct.Fields>(addressing: F) =>
  [
    S.Struct({
      ...addressing,
      kind: S.Literals(["auth"]),
      payload: AuthPayload,
    }),
    S.Struct({
      ...addressing,
      kind: S.Literals(["connect"]),
      payload: ProviderPayload,
    }),
    S.Struct({
      ...addressing,
      kind: S.Literals(["connect_device_code"]),
      payload: ProviderPayload,
    }),
    S.Struct({
      ...addressing,
      kind: S.Literals(["cancel_connect"]),
      payload: CancelConnectPayload,
    }),
    S.Struct({
      ...addressing,
      kind: S.Literals(["logout"]),
      payload: ProviderPayload,
    }),
    S.Struct({
      ...addressing,
      kind: S.Literals(["submit_login_code"]),
      payload: SubmitLoginCodePayload,
    }),
    S.Struct({
      ...addressing,
      kind: S.Literals(["add_account"]),
      payload: AddAccountPayload,
    }),
    S.Struct({
      ...addressing,
      kind: S.Literals(["remove_account"]),
      payload: RemoveAccountPayload,
    }),
    S.Struct({
      ...addressing,
      kind: S.Literals(["pin_account"]),
      payload: PinAccountPayload,
    }),
    S.Struct({
      ...addressing,
      kind: S.Literals(["set_auto_update"]),
      payload: SetAutoUpdatePayload,
    }),
    S.Struct({
      ...addressing,
      kind: S.Literals(["refresh"]),
      payload: S.optional(RefreshPayload),
    }),
    S.Struct({
      ...addressing,
      kind: S.Literals(["status"]),
      payload: S.optional(EmptyPayload),
    }),
    S.Struct({
      ...addressing,
      kind: S.Literals(["update"]),
      payload: S.optional(EmptyPayload),
    }),
    // Drop every cached signed plan tuple NOW. The dashboard enqueues this
    // after a successful chain/config save so the very next request bounces
    // through the cloud and picks up the new chain instead of replaying the
    // old one for up to the cache TTL (the "app feels unresponsive to chain
    // reorders" friction). Payload-less and idempotent.
    S.Struct({
      ...addressing,
      kind: S.Literals(["bust_plan_cache"]),
      payload: S.optional(EmptyPayload),
    }),
    // Force a live model-list re-report NOW. The daemon's model-report
    // throttle mirrors the cloud's 30m `MODEL_CACHE_TTL_MS` — without this
    // command the only way to re-discover models mid-TTL is `openllmd
    // restart`. The dashboard's "Available models" refresh button enqueues
    // this; the executor clears the throttle, re-fetches every connected
    // delegate's list, and POSTs to `/api/daemon/models` BEFORE acking so
    // the subsequent `/v1/models` refetch the dashboard does after the
    // lifecycle frame lands sees the fresh rows. Payload-less and
    // idempotent.
    S.Struct({
      ...addressing,
      kind: S.Literals(["refresh_models"]),
      payload: S.optional(EmptyPayload),
    }),
    // Automatic, non-force model discovery. Distinct kind — never an
    // optional flag on `refresh_models`, because an older daemon would
    // strip unknown fields and run a throttle-resetting, auth-capable
    // list. Empty payload. Quiet `done` even when every provider skips
    // or fails; the dashboard only sends this when `control_caps`
    // advertises the kind.
    S.Struct({
      ...addressing,
      kind: S.Literals(["refresh_models_due"]),
      payload: S.optional(EmptyPayload),
    }),
    // List vendor-local sessions on this machine for one device CLI
    // (history stores + ~/.openllm/run live.json + in-memory PTYs). Result
    // rides on the command ack / lifecycle.result for the picker.
    S.Struct({
      ...addressing,
      kind: S.Literals(["list_local_sessions"]),
      payload: ListLocalSessionsPayload,
    }),
    // Re-probe well-known (and user-added) local model-server ports NOW.
    // Result is the current `TLocalServerState[]` on the command ack.
    // Payload-less and idempotent; older daemons ignore the unknown kind.
    S.Struct({
      ...addressing,
      kind: S.Literals(["local_rescan"]),
      payload: S.optional(EmptyPayload),
    }),
    // Set or clear the API key for one local model-server port. The key is
    // sealed to the daemon's X25519 pubkey in the browser; the relay never
    // sees plaintext. Empty `sealed` clears. Older daemons ignore the kind.
    S.Struct({
      ...addressing,
      kind: S.Literals(["set_local_key"]),
      payload: SetLocalKeyPayload,
    }),
    // Add / replace / remove a `local_key` provider key slot (OpenCode Go,
    // Z.AI, MiniMax). Sent only when `control_caps` advertises
    // LOCAL_KEY_PROVIDERS_CONTROL_CAP; older daemons ignore the kind.
    S.Struct({
      ...addressing,
      kind: S.Literals(["set_provider_key"]),
      payload: SetProviderKeyPayload,
    }),
    S.Struct({
      ...addressing,
      kind: S.Literals(["set_team_key"]),
      payload: SetTeamKeyPayload,
    }),
    S.Struct({
      ...addressing,
      kind: S.Literals(["delete_team_key"]),
      payload: DeleteTeamKeyPayload,
    }),
    // Control-key-signed device-sessions DISABLE. Older daemons ignore the
    // kind; the dashboard sends it only when `control_caps` advertises it.
    // There is no remote enable — re-enable is install/update/login/desktop
    // with the sessions toggle on (writes the anchor again).
    S.Struct({
      ...addressing,
      kind: S.Literals(["set_device_sessions"]),
      payload: SetDeviceSessionsPayload,
    }),
  ] as const;

/** The bare `{ kind, payload }` vocabulary — what an enqueue boundary (the
 *  relay's watcher `enqueue` frame, `enqueueCommand` in `packages/api`)
 *  validates before writing a `daemon_commands` row. */
export const DaemonCommandBody = S.Union([...commandVariants({})]);
export type TDaemonCommandBody = S.Schema.Type<typeof DaemonCommandBody>;

/** Every kind in the closed vocabulary (the union's discriminants). */
export type TDaemonCommandKind = TDaemonCommandBody["kind"];

/** Runtime literal of the closed command vocabulary — the discriminant only,
 *  no payload. Used by `control-channel.ts`'s `CommandLifecycle` to echo which
 *  command a lifecycle frame is reporting on. The `_kindDriftGuard` below makes
 *  this fail to compile if it ever drifts from the `commandVariants` union, so
 *  the two stay in lockstep without duplicating the payload mapping. */
export const DaemonCommandKind = S.Literals([
  "auth",
  "connect",
  "connect_device_code",
  "cancel_connect",
  "logout",
  "submit_login_code",
  "add_account",
  "remove_account",
  "pin_account",
  "set_auto_update",
  "refresh",
  "status",
  "update",
  "bust_plan_cache",
  "refresh_models",
  "refresh_models_due",
  "list_local_sessions",
  "local_rescan",
  "set_local_key",
  "set_provider_key",
  "set_team_key",
  "delete_team_key",
  "set_device_sessions",
]);
type TDaemonCommandKindLiteral = S.Schema.Type<typeof DaemonCommandKind>;
// Bidirectional assignability assertion: the literal and the union's
// discriminant must be the SAME set. Adding a kind to `commandVariants` without
// adding it here (or vice-versa) breaks this line at compile time.
type _AssertSameKinds = [TDaemonCommandKind] extends [TDaemonCommandKindLiteral]
  ? [TDaemonCommandKindLiteral] extends [TDaemonCommandKind]
    ? true
    : never
  : never;
const _kindDriftGuard: _AssertSameKinds = true;
void _kindDriftGuard;

/** One control command delivered to the daemon over its relay socket.
 *  `id` is `daemon_commands.id` (bigserial), stringified for the wire. */
export const DaemonCommand = S.Union([
  ...commandVariants({
    id: S.String,
    replay_session_id: S.optional(ReplaySessionId),
  }),
]);
export type TDaemonCommand = S.Schema.Type<typeof DaemonCommand>;

/** POST /api/daemon/cmd (dashboard → cloud) — enqueue for a target key
 *  (`key_id` must belong to the session user). */
export const DaemonCmdRequest = S.Union([
  ...commandVariants({ key_id: S.String }),
]);
export type TDaemonCmdRequest = S.Schema.Type<typeof DaemonCmdRequest>;

/** A command result the daemon reports back over its relay socket (the
 *  `ack`/`status` frames in `relay.ts` carry these). */
export const DaemonCommandAck = S.Struct({
  id: S.String,
  /** `ack` confirms that the daemon dequeued the command. Terminal outcomes
   * retain the previous ack shape for older relay binaries. */
  status: S.Literals(["ack", "done", "not_done", "error"]),
  result: S.optional(S.Unknown),
});
export type TDaemonCommandAck = S.Schema.Type<typeof DaemonCommandAck>;

// ─── Daemon control surface (browser → daemon, on localhost) ─────────

/** Per-provider auth-status on the daemon wire.
 *  `connected` = signed in; `disconnected` = unexpected loss; `signed_out` =
 *  user-initiated logout (sticky until the next successful login). */
export const DaemonProviderAuthStatus = S.Literals([
  "connected",
  "disconnected",
  "signed_out",
]);
export type TDaemonProviderAuthStatus = S.Schema.Type<
  typeof DaemonProviderAuthStatus
>;

/** Latest model-list outcome for a connected oauth provider (UI live signal). */
export const DaemonModelsStatus = S.Literals(["ok", "unavailable"]);
export type TDaemonModelsStatus = S.Schema.Type<typeof DaemonModelsStatus>;

/**
 * Closed reasons for `models_status: "unavailable"`. Matches the daemon's
 * listModels null tokens; unknown `http_*` collapses to `http_error` on the
 * wire. Never paths, bodies, or headers.
 */
export const DaemonModelsReason = S.Literals([
  "token_unavailable",
  "version_unresolved",
  "empty_after_filter",
  "error",
  "http_401",
  "http_403",
  "http_404",
  "http_429",
  "http_500",
  "http_502",
  "http_503",
  "http_error",
]);
export type TDaemonModelsReason = S.Schema.Type<typeof DaemonModelsReason>;

export const DaemonProviderConnection = S.Struct({
  provider: S.String,
  /**
   * Auth-status literal — the single source of truth.
   * `connected` = signed in; `disconnected` = unexpected loss;
   * `signed_out` = user-initiated logout (sticky until the next login).
   */
  status: DaemonProviderAuthStatus,
  /**
   * Typed observation. Optional so old daemons and persisted blobs remain
   * valid. When present it wins over legacy `status` / `detail` classifiers.
   * `unknown` is never logout and never proven serviceability.
   */
  observation: S.optional(DaemonProviderObservation),
  /** Machine-readable cause for a non-connected observation. Display copy stays on `detail`. */
  reason_code: S.optional(DaemonProviderReasonCode),
  /** The vendor CLI the daemon runs is installed on the machine. The daemon
   *  never installs it — installs are user-run (the daemon install script or by
   *  hand); the daemon lazily auto-links its isolated run-view
   *  (~/.openllm/cli/<provider>/) to the host binary. When false the dashboard
   *  prompts the user to (re-)run the daemon installer. Absent means a status
   *  probe failed before it could determine installation state; consumers must
   *  not treat absence as not installed. */
  cli_installed: S.optional(S.Boolean),
  /** Progress of an OpenLLM-started background vendor installer. Independent
   *  of authentication and CLI presence; absent on older daemons or externally
   *  managed installations. Contains no logs, process identity or host paths. */
  cli_install: S.optional(VendorCliInstall),
  /** Version of the isolated CLI, when installed + readable. */
  cli_version: S.optional(S.String),
  /** The user appears signed in to this vendor's CLI in their OWN home on the
   *  daemon's machine (e.g. `~/.codex/auth.json` holds a ChatGPT login). A
   *  read-only, secret-free presence hint so onboarding can put that provider
   *  first with a one-tap Connect. It is never a connection: the daemon does
   *  not copy, import or use that credential, and Connect still runs the
   *  vendor login inside the daemon's isolated home. Absent = unknown (an
   *  older daemon, a provider whose host store sits in an OS keychain the
   *  daemon will not touch, or an unreadable store); consumers must not read
   *  absence as signed out. */
  host_signed_in: S.optional(S.Boolean),
  detail: S.optional(S.String),
  last_login_at_ms: S.optional(S.NullOr(S.Number)),
  /** Wall-clock time of the latest real provider status observation. */
  last_probed_at_ms: S.optional(S.Number),
  /** A LIVE device-code flow awaiting the user (codex/kimi on a remote box):
   *  the verification URL + one-time code to surface so the dashboard can
   *  render a synced "open this link, enter this code" panel. Present only
   *  while a flow is pending; cleared the moment the credential lands. The
   *  card flips to Connected automatically on the next status push.
   *
   *  The actionable `url`/`code` are OPTIONAL because the relay REDACTS them
   *  from the broadcast + persisted status for every dashboard EXCEPT the one
   *  that started the login (issue #3 — otherwise the OAuth secret fans out to
   *  every same-user browser). A redacted / marker snapshot is the non-secret
   *  owner shape `{ pending: true, flow_id?, started_at_ms?, cancel_requested?,
   *  mode? }` with no url/code — not a new `mode` value. The initiating
   *  dashboard receives `{ url, code, mode? }` on `auth.login.prompt` only.
   *  UIs must treat a missing/empty `url` as non-actionable (never auto-open).
   *  A cached HTTP/DB marker is unconfirmed until a current-session ordered
   *  live `status_push` is applied; TTL does not evict that live owner. */
  pending_auth: S.optional(
    S.NullOr(
      S.Struct({
        url: S.optional(S.String),
        code: S.optional(S.String),
        /** True on a REDACTED snapshot (non-origin watcher / persisted row):
         *  a login is in progress but the actionable url/code were stripped. */
        pending: S.optional(S.Boolean),
        /** `device_code` (codex/kimi: surface URL + one-time code to enter in
         *  the browser, then poll) or `paste_code` (claude headless login:
         *  surface URL, then a paste-back input for the code the hosted
         *  callback page displays). Absent ⇒ `device_code`. */
        mode: S.optional(S.Literals(["device_code", "paste_code"])),
        /** Relay command id of the login that produced this snapshot (same
         *  value as `auth.login.*` `flow_id`). The browser `req_id` lives on
         *  `command_lifecycle`, not here. Absent on daemons predating auth
         *  events. */
        flow_id: S.optional(S.String),
        /** Epoch ms when this pending flow was created. Carried on both the
         *  actionable and the REDACTED snapshot so every consumer can expire a
         *  STALE entry (older than {@link PENDING_AUTH_TTL_MS}) without needing
         *  the daemon to re-push. The daemon persists its whole status snapshot
         *  to `api_key_activity.daemon_status_json`; an abandoned/never-completed
         *  login (or a daemon restart that drops the live child) would otherwise
         *  leave a dead `pending_auth` in that row forever, and the dashboard
         *  would re-surface + auto-open a sign-in flow that no longer exists on
         *  every cold load. Absent on daemons predating this field. */
        started_at_ms: S.optional(S.Number),
        /** Slot-derived: cancel was accepted but the owner is still
         *  contained. Additive; older decoders ignore it. Not a new mode. */
        cancel_requested: S.optional(S.Boolean),
      }),
    ),
  ),
  /** Metadata-only usage snapshot for a CONNECTED provider, read locally by
   *  the daemon and pushed with its status. Absent when not connected or the
   *  read failed. */
  usage: S.optional(S.NullOr(ProviderUsageSnapshot)),
  /**
   * Live local hop cooldown with reason `auth` (any model of this provider).
   * Visibility only — does not change `status` / `observation` / `reason_code`.
   * Transient; not remembered as last-known.
   */
  upstream_auth_cooldown: S.optional(DaemonProviderUpstreamAuthCooldown),
  /** Obscured vendor-account identity for a CONNECTED provider:
   *  sha256("openllm-account-v1:<provider>:<stable-account-id>") over the
   *  stable account id the vendor CLI stores locally (Anthropic's
   *  accountUuid, ChatGPT's account_id, Kimi's user_id, Grok's user_id).
   *  Lets the cloud key usage-meter series per ACCOUNT — two devices on the
   *  same account share the hash; a second account on the same provider gets
   *  its own — without ever shipping the raw vendor id off-box. Absent when
   *  not connected or unreadable, and on daemons predating it. See
   *  docs/proposals/inferred-subscription-usage-calibration.md §10. */
  account_hash: S.optional(S.String),
  /** Device-local account slot this row describes (multi-account). Several
   *  rows may share one `provider` with distinct indexes. Absent ⇒ 0. */
  account_index: S.optional(AccountIndex),
  /** User label for the account slot, when set. */
  account_label: S.optional(S.String.check(S.isMaxLength(64))),
  /** True on the slot the user pinned first in routing for this provider. */
  account_pinned: S.optional(S.Boolean),
  /** `local_key` slots only: the last four characters of the stored key, so
   *  the user can tell keys apart. Never more of the secret. */
  key_hint: S.optional(S.String.check(S.isMaxLength(4))),
  /**
   * Latest live model-list / discover outcome for this provider (UI signal for
   * "Connected, but this device hasn't reported models yet"). Optional +
   * omitted when never attempted so older daemons and older clients stay
   * compatible. Mirror of how {@link LocalServerState} carries models.
   */
  models_status: S.optional(DaemonModelsStatus),
  /** Closed null-reason when `models_status` is `unavailable`. Omitted on `ok`. */
  models_reason: S.optional(DaemonModelsReason),
});
export type TDaemonProviderConnection = S.Schema.Type<
  typeof DaemonProviderConnection
>;

/** `control_caps` entry: the daemon understands `account_index` on auth
 *  commands and the `add_account` / `remove_account` / `pin_account` kinds.
 *  Senders must not address account n >= 1 without it (old daemons strip the
 *  field and would act on account 0). */
export const MULTI_ACCOUNT_CONTROL_CAP = "multi_account";
/** Control cap: the daemon runs the unified `auth` command (kind `"auth"`).
 *  Older daemons drop an unknown kind silently; the browser must refuse with
 *  `daemon_outdated` when this cap is absent rather than waiting out a timeout. */
export const AUTH_CONTROL_CAP = "auth";
/** Control cap: the daemon stores `local_key` provider keys
 *  (`set_provider_key`) and reports each slot as a `connections` row. */
export const LOCAL_KEY_PROVIDERS_CONTROL_CAP = "local_key_providers_v1";
/** Control cap: the daemon executes the signed `set_device_sessions` disable. */
export const DEVICE_SESSIONS_CONTROL_CAP = "device_sessions_v1";
/** Control cap: the daemon holds team keys (`set_team_key` /
 *  `delete_team_key`) and reports them in `team_psk`. */
export const TEAM_KEY_CUSTODY_CONTROL_CAP = "team_key_custody_v1";

/** One team key this device holds — the epoch only, never the key. */
export const DaemonTeamKeyEpoch = S.Struct({
  team_id: S.String,
  epoch: S.Int.check(S.isGreaterThanOrEqualTo(0)),
});
export type TDaemonTeamKeyEpoch = S.Schema.Type<typeof DaemonTeamKeyEpoch>;

/**
 * A `pending_auth` self-expires after this **on cached / unconfirmed
 * snapshots**. The login ceiling (`DEFAULT_LOGIN_TIMEOUT_MS`, 5 min) reaps
 * the live child and matching-flow finalization clears the marker; this TTL
 * is the BACKSTOP for abandoned HTTP/DB rows. A current-session live marker
 * beats its age — replacement Connect stays forbidden while ownership is
 * confirmed. Shared by the daemon (in-memory expiry) and the browser. */
export const PENDING_AUTH_TTL_MS = 10 * 60_000;

// Outcome of the daemon's last cloud bootstrap — drives the dashboard's
// Providers UI: needs a key (`no_key`/`invalid_key`) → show the API-key
// picker; `unreachable` → retry hint; `connecting` → first bootstrap still
// in flight (key is configured, outcome unknown); `ok` → provider cards.
export const DaemonCloudState = S.Literals([
  "ok",
  "no_key",
  "invalid_key",
  "unreachable",
  "connecting",
]);
export type TDaemonCloudState = S.Schema.Type<typeof DaemonCloudState>;

/**
 * The openllm CLI's presence on this box, as the daemon already knows it from
 * its device-state probe (`device-state.ts`) — no probe scripts, no per-client
 * walk. This is the ONLY install state the dashboard needs now: clients are
 * configured at RUN time by `openllm <client>`, so there is nothing per-client
 * to install, stamp, or diverge.
 */
export const DaemonCliState = S.Struct({
  installed: S.Boolean,
  /** Version the installed binary reports; absent when it can't be read. */
  version: S.optional(S.NullOr(S.String)),
});
export type TDaemonCliState = S.Schema.Type<typeof DaemonCliState>;

/**
 * An update replacing the `openllm` binary right now — the body of the
 * cross-process update lease (`packages/cli/src/update-lease.ts`, which a
 * parity test pins to this shape). `source` is who is updating (`app` = the
 * desktop app), `received`/`total` the download bytes when known.
 */
export const DaemonUpdateState = S.Struct({
  pid: S.Number,
  source: S.Literals(["daemon", "cli", "installer", "app"]),
  version: S.NullOr(S.String),
  phase: S.Literals(["download", "verify", "install", "restart"]),
  received: S.NullOr(S.Number),
  total: S.NullOr(S.Number),
  started_at: S.Number,
  updated_at: S.Number,
});
export type TDaemonUpdateState = S.Schema.Type<typeof DaemonUpdateState>;

// GET /status
export const DaemonStatus = S.Struct({
  /** The RUNNING daemon's version. The dashboard shows this. */
  daemon_version: S.String,
  /** The installed binary's version on disk. One binary is both CLI and
   *  daemon, and a swap whose daemon code is unchanged does not restart the
   *  daemon, so this can be ahead of `daemon_version` until the next restart.
   *  Absent on daemons too old to report it. */
  installed_version: S.optional(S.NullOr(S.String)),
  /** Whether an sk-llm key is set (the daemon installs keyless). */
  key_configured: S.Boolean,
  /** Whether automatic self-update is enabled (OPT-OUT, default on). Drives the
   *  dashboard's auto-update switch; toggled via the `set_auto_update` command.
   *  Absent on daemons too old to report it — those always self-updated, so the
   *  switch then reads as on. See `packages/cli/daemon/src/auto-update-pref.ts`. */
  auto_update: S.optional(S.Boolean),
  /** Result of the last bootstrap — see `DaemonCloudState`. */
  cloud_state: DaemonCloudState,
  /** This daemon's X25519 public key (SPKI DER, base64). Lets ANOTHER of the
   *  user's daemons SEAL a Claude setup-token to it for cross-machine copy
   *  (`/api/daemon/relay-credential`) — the cloud only ever relays ciphertext.
   *  Absent on daemons too old to publish one. */
  pubkey: S.optional(S.String),
  /** True when the cloud's immutable daemon X25519 pin differs from this
   * daemon's local key. A browser session must reset the pin before RTC can
   * connect; absent on daemons that have not observed this conflict. */
  identity_conflict: S.optional(S.Boolean),
  /** The device-control pin this daemon verifies grants against: `fp` is the
   *  key's fingerprint (`keyFingerprint` in `@openllmsh/sdk/tunnel`), `via` the
   *  path that set it. Whether it is agent-eligible is reported once, in
   *  `device_sessions.enabled`. Absent when unpinned or on older daemons. */
  device_access_pin: S.optional(DeviceAccessPinReport),
  /** Device sessions readiness + the dpk proof (`DeviceSessionsReport`).
   *  `enabled` == sessions on (anchor present, sessions flag not off, not a
   *  routing box). Absent on daemons too old to report it — treat as off. */
  device_sessions: S.optional(DeviceSessionsReport),
  /** The loopback port this daemon's `/v1/*` + `/whoami` surface listens on
   *  (`OPENLLM_DAEMON_PORT`, default 8787). Reported in `daemon_status_json`
   *  for display; routing never uses it (origin reaches devices over the
   *  relay, not loopback). Absent on daemons too old to publish it. */
  port: S.optional(S.Number),
  /** The OS-sandbox posture this daemon booted with (`sandbox/landlock.ts`):
   *  `enforced` (Landlock active), `off` (kill switch / dev opt-out),
   *  `unsupported` (non-Linux, or a kernel without Landlock — the systemd
   *  unit hardening may still confine the service), `error` (setup failed —
   *  fail-open, surfaced so an unconfined daemon is visible, not silent).
   *  Absent on daemons too old to report it. */
  sandbox: S.optional(S.Literals(["enforced", "off", "unsupported", "error"])),
  connections: S.Array(DaemonProviderConnection),
  /** Team keys this device holds for team tunnels' PSK handshake, so the
   *  browser can tell which teams still need T sealed here. Absent on daemons
   *  without `TEAM_KEY_CUSTODY_CONTROL_CAP`. */
  team_psk: S.optional(S.Array(DaemonTeamKeyEpoch)),
  /** The openllm CLI on this box. Absent on daemons too old to report it. */
  cli: S.optional(DaemonCliState),
  /** The update replacing the binary right now, or null when none is.
   *  Absent on daemons too old to report it. */
  update: S.optional(S.NullOr(DaemonUpdateState)),
  /** Advertised transport capabilities, retained in fleet status telemetry. */
  caps: S.optional(S.Array(S.String)),
  /** Current and maximum concurrently-served tunneled requests. Optional for
   * older daemons; origin uses it only as an additive target-ranking signal. */
  served_tunnels: S.optional(
    S.Struct({
      active: S.Number,
      capacity: S.Number,
    }),
  ),
  /**
   * Control-plane capabilities this daemon implements (distinct from
   * mux/RTC `caps`). Open strings so a future daemon can advertise an
   * extra cap without the cloud rejecting the whole status. Optional so
   * older daemons omit it; the dashboard sends `refresh_models_due` only
   * when this array includes that exact literal. Command vocabulary stays
   * closed independently of this list.
   */
  control_caps: S.optional(S.Array(S.String)),
  /** Whether this daemon can host device chat sessions (PTY — POSIX only;
   *  false on win32). Absent on daemons too old to report it — the
   *  dashboard then hides the device variant for this box. */
  pty_supported: S.optional(S.Boolean),
  /** Live/dormant device sessions hosted on this box (feature §2.2) —
   *  lets the dashboard mark which sessions can `attach` vs `continue`. */
  sessions: S.optional(
    S.Array(
      S.Struct({
        /** Local daemon session id; independent of the mux SessionId validator. */
        id: S.String.check(S.isMinLength(1), S.isMaxLength(128)),
        // Same closed vocabulary as the local `LocalSessionOpenPayload.cli`.
        cli: DeviceSessionCli,
        started_at_ms: S.Number,
        /** A consumer channel is currently bound. */
        attached: S.Boolean,
        /** The PTY is still running (attach re-binds; false → continue). */
        live: S.Boolean,
        /** Best-effort process-tree activity signal for dormant sessions. */
        busy: S.optional(S.Boolean),
        /** User-visible session label, bounded for presence snapshots. */
        title: S.optional(SessionTitleField),
        /** Terminal reason retained for a dead resumable session. */
        last_exit_reason: S.optional(SessionExitReason),
        /** Vendor resume id when known (local history / resume spawn). */
        vendor_session_id: S.optional(
          S.NullOr(S.String.check(S.isMaxLength(128))),
        ),
      }),
    ).check(S.isMaxLength(32)),
  ),
  /**
   * Local model servers discovered on this device (no key material —
   * `has_key` only). Absent on daemons too old to probe. Bounded so a
   * noisy scan cannot bloat fleet status.
   */
  local_servers: S.optional(S.Array(LocalServerState).check(S.isMaxLength(64))),
});
export type TDaemonStatus = S.Schema.Type<typeof DaemonStatus>;

/**
 * Canonical payload the cloud HMAC-signs for a daemon plan
 * (`/api/daemon/plan`), and the daemon re-derives to verify it. Order +
 * separators are load-bearing — both sides MUST assemble it identically, so
 * it lives here, shared. Covers: the ordered `plan` (provider/model ids), the
 * parallel `pmids` (concrete upstream `provider_model_id`s, so the daemon
 * serves catalog-free), and the `origin` (the deployment that issued the
 * plan, so the daemon forwards +
 * records back to it). Signing the lot makes the upstream ids and the
 * forward/record target tamper-evident.
 */
export const daemonPlanSigningPayload = (
  plan: string,
  providerModelIds: string,
  origin: string,
  contextOverflowStrategy?: TContextOverflowStrategy | null,
  holdNonce?: string | null,
  maxOutputTokens?: number | null,
): string => {
  if (holdNonce != null && !HOLD_NONCE_PATTERN.test(holdNonce)) {
    throw new Error("Invalid hold nonce");
  }
  if (
    maxOutputTokens != null &&
    (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0)
  ) {
    throw new Error("Invalid max output tokens");
  }
  const base =
    contextOverflowStrategy === undefined || contextOverflowStrategy === null
      ? `${plan}\n${providerModelIds}\n${origin}`
      : `${plan}\n${providerModelIds}\n${origin}\n${contextOverflowStrategy}`;
  // A capped key's one-hop plan binds its cap hold. The `hold:` prefix can't
  // collide with a strategy line, which is always a fixed literal.
  const held =
    holdNonce === undefined || holdNonce === null
      ? base
      : `${base}\nhold:${holdNonce}`;
  // The output budget only rides a held plan; `out:` can't collide either.
  return maxOutputTokens === undefined || maxOutputTokens === null
    ? held
    : `${held}\nout:${maxOutputTokens}`;
};

// ─── GET /api/daemon/plan (daemon → cloud) ───────────────────────────
//
// The local-first gateway's plan fetch: the signed plan tuple, returned as
// JSON so a daemon serving a DIRECT client request can obtain a plan without
// the request body transiting the cloud. The daemon verifies `sig` with the
// bootstrap-delivered per-user key (`planSignatureOk`) before caching or
// executing. See
// `docs/proposals/local-first-gateway.md` §4.1. For capped keys, repeated
// `exclude=<model>` query parameters skip already-failed hops; uncapped keys
// ignore them.
export const DaemonPlanResponse = S.Struct({
  /** Comma-joined ordered `provider/model` chain. */
  plan: S.String,
  /** Parallel concrete `provider_model_id`s. */
  pmids: S.String,
  /** The issuing deployment's origin. */
  origin: S.String,
  /** Context-overflow strategy for this plan. Absent means hop-to-larger-context. */
  context_overflow_strategy: S.optional(ContextOverflowStrategy),
  /** Reservation for a capped one-hop plan, included in the signed payload. */
  hold_nonce: S.optional(HoldNonce),
  /** Largest output the hold allows (held plans only; signed). The daemon
   *  lowers the request's output limit to it before dispatch. */
  max_output_tokens: S.optional(S.Number.check(S.isInt(), S.isGreaterThan(0))),
  /** Revision of the key's access policy this plan was built under; a
   *  change drops the daemon's plan cache (see bootstrap `key_policy_rev`).
   *  Optional so a plan from a cloud that predates it still decodes; absent
   *  keeps the revision the daemon already knows. */
  policy_rev: S.optional(S.String),
  /** HMAC over the canonical payload; null when the cloud has no signing
   *  secret configured (dev) — the daemon then treats it as unsigned. */
  sig: S.NullOr(S.String),
});
export type TDaemonPlanResponse = S.Schema.Type<typeof DaemonPlanResponse>;

/** Header that carries the opaque held-tool continuation between client turns. */
export const TOOL_SESSION_HEADER = "x-openllm-tool-session";

/** Headers the daemon stamps on EVERY cloud control call (poll/status/bootstrap
 *  /requests/relay/search) so the cloud can record which device a key's daemon
 *  runs on — `api_key_activity.device_id`/`device_label`. The id is the daemon's
 *  stable opaque per-machine UUID (`OPENLLM_DEVICE_ID` in `~/.openllm/.env`); the label is the
 *  host's `os.hostname()` for the dashboard to show. Both metadata-only (no
 *  token, no content). Lets the dashboard tell two daemons behind one NAT apart
 *  — device code + IP, not IP alone. See
 *  `docs/proposals/daemon-device-aware-this-machine.md`. */
export const DAEMON_DEVICE_ID_HEADER = "x-openllm-device-id";
export const DAEMON_DEVICE_LABEL_HEADER = "x-openllm-device-label";

/**
 * Optional OS platform the daemon reports on control-plane calls
 * (`process.platform`: `darwin` / `linux` / `win32` / `freebsd` /
 * `openbsd` / `android` / `aix` / `sunos`). Metadata only —
 * used for `daemon_connected` analytics. Absent on older binaries.
 */
export const DAEMON_PLATFORM_HEADER = "x-openllm-platform";

/**
 * Header a daemon sends on control-plane calls (chiefly
 * `GET /api/daemon/bootstrap`) listing the open-vocabulary decode
 * capabilities it supports — e.g. `MODEL_CAPABILITIES_OPEN_CAP` from
 * `./models`. Comma-joined; absent/empty on an old compiled daemon, which
 * the bootstrap encoder MUST treat as "closed literal decoder only" —
 * never inferred from a version string, which an unbumped daemon build
 * would leave stale.
 */
export const DAEMON_BOOTSTRAP_CAPS_HEADER = "x-openllm-daemon-caps";

/**
 * Parse the comma-joined {@link DAEMON_BOOTSTRAP_CAPS_HEADER} value into a
 * capability list. A null/empty header (old daemon, or the header simply
 * absent) decodes to an empty list — no negotiated capability.
 */
export const parseDaemonBootstrapCapsHeader = (
  value: string | null,
): string[] =>
  value === null || value.trim() === ""
    ? []
    : value
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

// POST /config/api-key — set/update the daemon's sk-llm key after install.
export const DaemonSetApiKeyRequest = S.Struct({
  api_key: S.String,
});
export type TDaemonSetApiKeyRequest = S.Schema.Type<
  typeof DaemonSetApiKeyRequest
>;

export const DaemonSetApiKeyResponse = S.Struct({
  key_configured: S.Boolean,
  cloud_state: DaemonCloudState,
});
export type TDaemonSetApiKeyResponse = S.Schema.Type<
  typeof DaemonSetApiKeyResponse
>;

// POST /connect/:slug
export const DaemonConnectResponse = S.Struct({
  provider: S.String,
  connected: S.Boolean,
  detail: S.optional(S.String),
  /**
   * True when `connect` kicked off an async flow that hasn't finished yet
   * (Kimi's device-code login: browser opened, daemon polling in the
   * background). `detail` is then INFORMATIONAL guidance, not an error —
   * the UI renders it neutrally and the status stream flips to connected
   * when the flow completes. Absent/false on terminal results.
   */
  pending: S.optional(S.Boolean),
});
export type TDaemonConnectResponse = S.Schema.Type<
  typeof DaemonConnectResponse
>;

// GET /usage/:slug — reuses the existing snapshot shape verbatim.
export const DaemonUsageResponse = S.Struct({
  provider: S.String,
  snapshot: ProviderUsageSnapshot,
});
export type TDaemonUsageResponse = S.Schema.Type<typeof DaemonUsageResponse>;

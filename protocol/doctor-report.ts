import { Schema as S } from "effect";
import type * as Result from "effect/Result";
import type { SchemaError } from "effect/Schema";
import type { TAuthLoginFailedCode } from "./auth";
import { AuthLoginFailedCode } from "./auth";
import type {
  TDaemonProviderObservation,
  TDaemonProviderReasonCode,
} from "./provider-status";
import {
  DaemonProviderObservation,
  DaemonProviderReasonCode,
} from "./provider-status";
import { ReplaySessionId } from "./replay-session";
import { sha256Hex } from "./sha256-hex";
import type { TSubscriptionProviderSlug } from "./subscription-provider";
import { SubscriptionProviderSlug } from "./subscription-provider";

/**
 * Incremental daemon doctor-report wire contract.
 *
 * Closed allowlists only — never a free-form `properties`/`meta` map, never
 * raw log text, stacks, argv, credentials, account hashes, hostnames, or
 * prompt/completion content. Unknown keys and unknown schema versions fail
 * decode. Per-event `daemon_version` is stamped at observation time and is
 * immutable on the wire.
 */

export const DOCTOR_REPORT_SCHEMA_VERSION = 3 as const;

export const DoctorReportSchemaVersion = S.Literals([
  DOCTOR_REPORT_SCHEMA_VERSION,
]);
export type TDoctorReportSchemaVersion = S.Schema.Type<
  typeof DoctorReportSchemaVersion
>;

export const STRICT_DOCTOR_PARSE = {
  errors: "all",
  onExcessProperty: "error",
} as const;

/** UUID or 16–64 lowercase hex. Rejects `sk-llm-`, URLs, and prefixed labels. */
export const DOCTOR_OPAQUE_ID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,64})$/;

export const OpaqueId = S.String.check(S.isPattern(DOCTOR_OPAQUE_ID_PATTERN));
export type TOpaqueId = S.Schema.Type<typeof OpaqueId>;

export const DOCTOR_SCOPE_HASH_PREFIX = "openllm-doctor-scope-v1" as const;
export const DoctorScopeLabel = S.Literals(["origin", "account"]);
export type TDoctorScopeLabel = S.Schema.Type<typeof DoctorScopeLabel>;

/** Opaque origin/account scope: sha256 hex truncated to 32 chars. */
export const doctorReportingScopeId = (
  label: TDoctorScopeLabel,
  value: string,
): TOpaqueId => {
  const digest = sha256Hex(
    `${DOCTOR_SCOPE_HASH_PREFIX}:${label}:${value}`,
  ).slice(0, 32);
  return S.decodeUnknownSync(OpaqueId)(digest, STRICT_DOCTOR_PARSE);
};

export const opaqueDoctorScope = doctorReportingScopeId;

/** Bare semver, optional prerelease (`2.6.25`, `2.6.25-dev`). No leading `v`. */
export const DOCTOR_VERSION_STAMP_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]{1,32})?$/;

export const VersionStamp = S.String.check(
  S.isMaxLength(64),
  S.isPattern(DOCTOR_VERSION_STAMP_PATTERN),
);
export type TVersionStamp = S.Schema.Type<typeof VersionStamp>;

export const DOCTOR_EPOCH_MS_MAX = 4_102_444_800_000;

export const EpochMs = S.Number.check(
  S.isFinite(),
  S.isInt(),
  S.isGreaterThanOrEqualTo(0),
  S.isLessThanOrEqualTo(DOCTOR_EPOCH_MS_MAX),
);
const FiniteMs = S.Number.check(
  S.isFinite(),
  S.isGreaterThanOrEqualTo(0),
  S.isLessThanOrEqualTo(86_400_000),
);
const FiniteCount = S.Number.check(
  S.isFinite(),
  S.isInt(),
  S.isGreaterThanOrEqualTo(0),
  S.isLessThanOrEqualTo(1_000_000),
);
const BoundedExitCode = S.Number.check(
  S.isFinite(),
  S.isInt(),
  S.isGreaterThanOrEqualTo(-1),
  S.isLessThanOrEqualTo(255),
);

export const DoctorPlatform = S.Literals(["darwin", "linux", "win32"]);
export type TDoctorPlatform = S.Schema.Type<typeof DoctorPlatform>;

export const DoctorArchitecture = S.Literals(["arm64", "x64"]);
export type TDoctorArchitecture = S.Schema.Type<typeof DoctorArchitecture>;

export const DoctorSeverity = S.Literals(["info", "warn", "error"]);
export type TDoctorSeverity = S.Schema.Type<typeof DoctorSeverity>;

export const DOCTOR_SCOPE_FALLBACK = "daemon" as const;

/** Allowlisted finite timings/counts/booleans. All optional; absent ≠ zero. */
export const DoctorEventTimings = S.Struct({
  configured_timeout_ms: S.optional(FiniteMs),
  /** Per-request tunnel channel-open latency. */
  open_ms: S.optional(FiniteMs),
  /** Per-request tunnel serving admission latency. */
  admission_ms: S.optional(FiniteMs),
  /** Per-request tunnel time to response head. */
  res_head_ms: S.optional(FiniteMs),
  spawn_elapsed_ms: S.optional(FiniteMs),
  budget_remaining_ms_at_spawn: S.optional(FiniteMs),
  timeout_callback_lateness_ms: S.optional(FiniteMs),
  cleanup_ms: S.optional(FiniteMs),
  elapsed_ms: S.optional(FiniteMs),
  reconnect_episode_ms: S.optional(FiniteMs),
  reconnect_count: S.optional(FiniteCount),
  unknown_probe_streak: S.optional(FiniteCount),
  repeat_count: S.optional(FiniteCount),
  root_exit_code: S.optional(BoundedExitCode),
  stdout_closed: S.optional(S.Boolean),
  stderr_closed: S.optional(S.Boolean),
  root_exited: S.optional(S.Boolean),
  /** Login-start: host CLI is a shebang script (vs native binary). */
  cli_is_script: S.optional(S.Boolean),
  /** Login-start: shebang interpreter resolves on the daemon spawn PATH. */
  interpreter_resolved: S.optional(S.Boolean),
  /**
   * Privacy-safe: resolved launcher sits under a known manager install/shim
   * root (mise/asdf/volta/proto). Never a raw path.
   */
  launcher_under_manager_root: S.optional(S.Boolean),
});
export type TDoctorEventTimings = S.Schema.Type<typeof DoctorEventTimings>;

/** Closed launcher-kind vocabulary for doctor (no raw paths). */
export const DoctorLauncherKind = S.Literals([
  "binary",
  "script",
  "shim",
  "wrapper",
]);
export type TDoctorLauncherKind = S.Schema.Type<typeof DoctorLauncherKind>;

/**
 * Closed adapter ids we may attribute a shim resolution to. Single source
 * for doctor + daemon manager adapters — consumers must reference this
 * const (not re-list the four ids). NOTE for manager-resolution /
 * launcher-roots owners: derive shim adapter ids from
 * {@link DOCTOR_LAUNCHER_ADAPTERS} so doctor + spawn PATH cannot drift.
 */
export const DOCTOR_LAUNCHER_ADAPTERS = [
  "mise",
  "asdf",
  "volta",
  "proto",
] as const;
export const DoctorLauncherAdapter = S.Literals(DOCTOR_LAUNCHER_ADAPTERS);
export type TDoctorLauncherAdapter = (typeof DOCTOR_LAUNCHER_ADAPTERS)[number];

export const DoctorCachedHealth = S.Struct({
  connected_providers: FiniteCount,
  degraded_providers: FiniteCount,
  unknown_providers: FiniteCount,
});
export type TDoctorCachedHealth = S.Schema.Type<typeof DoctorCachedHealth>;

/**
 * Closed auth-lifecycle ledger. Optional on schema 3 so a report that omits
 * them still parses. A *strict* schema-3 origin that does not yet list these
 * keys still rejects them (`onExcessProperty: error`) — uploaders must strip
 * on 422 rather than treating keep-v3 as fully backward compatible.
 */
export const DoctorAuthOperationKind = S.Literals([
  "login",
  "logout",
  "verify",
  "status_probe",
  "status_publish",
]);
export type TDoctorAuthOperationKind = S.Schema.Type<
  typeof DoctorAuthOperationKind
>;

export const DoctorAuthPhase = S.Literals([
  "readiness_wait",
  "readiness",
  "start",
  "child_wait",
  "child",
  /** A sign-in URL/code was surfaced to the user (stream/device logins). */
  "prompt",
  "prep_wait",
  "prep",
  "verify_wait",
  "verify",
  "terminal",
]);
export type TDoctorAuthPhase = S.Schema.Type<typeof DoctorAuthPhase>;

export const DoctorAuthOutcome = S.Literals([
  "succeeded",
  "failed",
  "cancelled",
  "abandoned",
  "timeout",
  "unknown",
]);
export type TDoctorAuthOutcome = S.Schema.Type<typeof DoctorAuthOutcome>;

/**
 * How a browser-applied live status snapshot relates to an auth terminal.
 * `temporal_same_session` is not causal: the snapshot was applied on the same
 * live daemon session after the operation's seq floor, with this flow no
 * longer on `pending_auth`. Status may precede the terminal frame.
 */
export const DoctorAuthStatusCorrelation = S.Literal("temporal_same_session");
export type TDoctorAuthStatusCorrelation = S.Schema.Type<
  typeof DoctorAuthStatusCorrelation
>;

const DoctorStatusSeq = S.Number.check(
  S.isFinite(),
  S.isInt(),
  S.isGreaterThanOrEqualTo(0),
  S.isLessThanOrEqualTo(1_000_000_000),
);

/**
 * Closed credential-store operation ledger. Optional on schema 3; strict old
 * origins reject these keys (`onExcessProperty: error`) so uploaders strip on
 * 422 alongside the auth outcome ledger. Never raw stderr/path/meta.
 */
export const DoctorStoreOperation = S.Literals([
  "create",
  "settings",
  "unlock",
  "install",
  "restore",
  "grant",
  "recreate",
]);
export type TDoctorStoreOperation = S.Schema.Type<typeof DoctorStoreOperation>;

export const DoctorStoreStage = S.Literals(["staging", "final", "recovery"]);
export type TDoctorStoreStage = S.Schema.Type<typeof DoctorStoreStage>;

export const DoctorStoreResult = S.Literals([
  "succeeded",
  "failed",
  "timed_out",
  "aborted",
  "peer_won",
  "skipped",
]);
export type TDoctorStoreResult = S.Schema.Type<typeof DoctorStoreResult>;

/** macOS product version (`27.0.1`) / build (`26A434`), read from
 *  SystemVersion.plist. Platform facts only — same sensitivity as `platform`. */
export const DoctorOsVersion = S.String.check(
  S.isPattern(/^\d{1,3}(?:\.\d{1,3}){0,2}$/),
);
export const DoctorOsBuild = S.String.check(S.isPattern(/^[0-9A-Za-z]{1,16}$/));

export const DoctorStoreExitCode = S.Number.check(
  S.isFinite(),
  S.isInt(),
  S.isGreaterThanOrEqualTo(0),
  S.isLessThanOrEqualTo(255),
);
export type TDoctorStoreExitCode = S.Schema.Type<typeof DoctorStoreExitCode>;

/** Mapped from local classifier tokens (`-25293`, `-25295`, passphrase). */
export const DoctorStoreClassifier = S.Literals([
  "auth_failed",
  "invalid_keychain",
  "passphrase_refused",
]);
export type TDoctorStoreClassifier = S.Schema.Type<
  typeof DoctorStoreClassifier
>;

/**
 * Closed classification of a failed child process's output (vendor CLI login,
 * version probe, version-manager resolution). Computed LOCALLY from the
 * captured stdout/stderr by `classifyFailureOutput`; the text itself never
 * leaves the machine. Lets a remote diagnosis separate "the sandbox denied a read
 * of the user's mise config" and "the CLI crashed" without raw stderr.
 */
export const DoctorFailureSignature = S.Literals([
  "mise_permission_denied",
  "mise_error",
  "launcher_write_denied",
  "launcher_interpreter_missing",
  "launcher_unresolved",
  "permission_denied",
  "sandbox_denied",
  "not_found",
  "network",
  "manager_unresolved",
  "no_output",
  "unclassified",
]);
export type TDoctorFailureSignature = S.Schema.Type<
  typeof DoctorFailureSignature
>;

/**
 * Signatures a schema-3 origin that pre-dates the launcher_* mechanism
 * classes already accepts. Used by {@link wireCompatibleFailureSignature}
 * so a newer daemon can fall back on the wire without waiting for a cloud
 * capability bit; local classification still uses the full vocabulary.
 */
export const DOCTOR_LEGACY_FAILURE_SIGNATURES = [
  "mise_permission_denied",
  "mise_error",
  "permission_denied",
  "sandbox_denied",
  "not_found",
  "network",
  "manager_unresolved",
  "no_output",
  "unclassified",
] as const satisfies ReadonlyArray<TDoctorFailureSignature>;

export type TDoctorLegacyFailureSignature =
  (typeof DOCTOR_LEGACY_FAILURE_SIGNATURES)[number];

/** Map a full {@link DoctorFailureSignature} onto the closest legacy value
 *  an older strict origin will accept on the wire. Identity for already-
 *  legacy signatures. */
export const wireCompatibleFailureSignature = (
  signature: TDoctorFailureSignature,
): TDoctorLegacyFailureSignature => {
  switch (signature) {
    case "launcher_write_denied":
      return "permission_denied";
    case "launcher_interpreter_missing":
      return "not_found";
    case "launcher_unresolved":
      return "manager_unresolved";
    default:
      return signature;
  }
};

/** Map captured child output onto a {@link DoctorFailureSignature}. Pure;
 *  order matters (most specific first). Manager-specific `mise_*` signatures
 *  keep precedence over the generic `launcher_*` mechanism classes. */
export const classifyFailureOutput = (
  captured: string,
): TDoctorFailureSignature => {
  const text = captured.toLowerCase();
  if (text.trim().length === 0) return "no_output";
  const denied = /permission denied|os error 13|eacces/.test(text);
  if (/\bmise\b/.test(text)) {
    return denied ? "mise_permission_denied" : "mise_error";
  }
  // `env: node: No such file or directory` / `/usr/bin/env: 'python3': ...`
  // / prefixed `login failed: env: node: …` / nix `…/bin/env:` — shebang
  // interpreter missing on the spawn PATH (npm globals, etc.).
  // Require the `: no such file` clause so a CLI status line like
  // `env: production` is not misclassified. Loosen the start anchor so
  // `/bin/env:` and any `…/env:` path prefix still match.
  if (/(?:^|[\s/])env:\s*['"]?[\w.+-]+['"]?:\s*no such file/.test(text)) {
    return "launcher_interpreter_missing";
  }
  // Write denied by confinement / read-only FS — generic across launchers.
  // Require a write verb (word-bounded). Bare `open '/path'` stays
  // `permission_denied` — `open` alone is not proof of a write
  // (CodeRabbit 4341596192). Avoid bare `writ` — it matched
  // `written`/`writable`.
  const writeVerb =
    /\b(?:write|writes|writing|wrote|create|creates|creating|created|truncate|truncating|truncated|mkdir|unlink|rename|renames|renaming|renamed)\b/.test(
      text,
    );
  if (
    /erofs|read-only file system/.test(text) ||
    (denied && writeVerb) ||
    (/eperm|operation not permitted/.test(text) && writeVerb)
  ) {
    return "launcher_write_denied";
  }
  // DNS / transport failures before the generic "could not resolve" launcher
  // branch — otherwise curl's `Could not resolve host:` becomes
  // `launcher_unresolved`. Also catch urllib3 / wget / glibc DNS phrasing
  // (`Failed to resolve '…'`, `unable to resolve host`, `name resolution`)
  // before the broader launcher_unresolved `failed to resolve` / `unable to
  // resolve` match.
  if (
    /could not resolve host|unable to resolve host|failed to resolve '|name or service not known|name resolution|nodename nor servname|no such host|getaddrinfo|enotfound|econnrefused|econnreset|etimedout|network/.test(
      text,
    )
  ) {
    return "network";
  }
  if (
    /unresolved|could not resolve|failed to resolve|unable to resolve/.test(
      text,
    )
  ) {
    return "launcher_unresolved";
  }
  if (denied) return "permission_denied";
  if (/eperm|operation not permitted|posix_spawn/.test(text)) {
    return "sandbox_denied";
  }
  if (/enoent|no such file|not found/.test(text)) return "not_found";
  return "unclassified";
};

export const DOCTOR_OUTCOME_LEDGER_KEYS = [
  "provider",
  "operation_kind",
  "phase",
  "outcome",
  "observation",
  "reason_code",
  "status_seq",
  "store_operation",
  "store_stage",
  "store_result",
  "store_exit_code",
  "store_classifier",
  "login_failure_code",
  "failure_signature",
  "recovery_created",
  "recovery_unlocked",
  "recovery_replaced",
  "store_staging_unlocked",
  "os_version",
  "os_build",
  "launcher_kind",
  "launcher_adapter",
] as const;

export type TDoctorOutcomeLedger = {
  readonly provider?: TSubscriptionProviderSlug;
  readonly operation_kind?: TDoctorAuthOperationKind;
  readonly phase?: TDoctorAuthPhase;
  readonly outcome?: TDoctorAuthOutcome;
  readonly observation?: TDaemonProviderObservation;
  readonly reason_code?: TDaemonProviderReasonCode;
  readonly status_seq?: number;
  readonly store_operation?: TDoctorStoreOperation;
  readonly store_stage?: TDoctorStoreStage;
  readonly store_result?: TDoctorStoreResult;
  readonly store_exit_code?: TDoctorStoreExitCode;
  readonly store_classifier?: TDoctorStoreClassifier;
  readonly login_failure_code?: TAuthLoginFailedCode;
  readonly failure_signature?: TDoctorFailureSignature;
  readonly recovery_created?: boolean;
  readonly recovery_unlocked?: boolean;
  readonly recovery_replaced?: boolean;
  /** On a final-store failure: the same store unlocked under its staging
   *  name moments earlier (so the NAME, not the password, is the variable). */
  readonly store_staging_unlocked?: boolean;
  readonly os_version?: string;
  readonly os_build?: string;
  /** Privacy-safe launcher profile kind (audit L4). */
  readonly launcher_kind?: TDoctorLauncherKind;
  /** Privacy-safe manager adapter id when kind is shim. */
  readonly launcher_adapter?: TDoctorLauncherAdapter;
};

const decodeOptionalLiteral = <A>(
  schema: S.ConstraintDecoder<A>,
  value: unknown,
): A | undefined => {
  if (value === undefined) return undefined;
  try {
    return S.decodeUnknownSync(schema)(value, STRICT_DOCTOR_PARSE);
  } catch {
    return undefined;
  }
};

/** Producer-side projection: invalid enums are omitted, the event is kept. */
export const projectDoctorOutcomeLedger = (
  input: unknown,
): TDoctorOutcomeLedger => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {};
  }
  const raw = input as Record<string, unknown>;
  const ledger: {
    -readonly [K in keyof TDoctorOutcomeLedger]?: TDoctorOutcomeLedger[K];
  } = {};
  const provider = decodeOptionalLiteral(
    SubscriptionProviderSlug,
    raw.provider,
  );
  if (provider !== undefined) ledger.provider = provider;
  const operation_kind = decodeOptionalLiteral(
    DoctorAuthOperationKind,
    raw.operation_kind,
  );
  if (operation_kind !== undefined) ledger.operation_kind = operation_kind;
  const phase = decodeOptionalLiteral(DoctorAuthPhase, raw.phase);
  if (phase !== undefined) ledger.phase = phase;
  const outcome = decodeOptionalLiteral(DoctorAuthOutcome, raw.outcome);
  if (outcome !== undefined) ledger.outcome = outcome;
  const observation = decodeOptionalLiteral(
    DaemonProviderObservation,
    raw.observation,
  );
  if (observation !== undefined) ledger.observation = observation;
  const reason_code = decodeOptionalLiteral(
    DaemonProviderReasonCode,
    raw.reason_code,
  );
  if (reason_code !== undefined) ledger.reason_code = reason_code;
  if (raw.status_seq !== undefined) {
    try {
      ledger.status_seq = S.decodeUnknownSync(DoctorStatusSeq)(
        raw.status_seq,
        STRICT_DOCTOR_PARSE,
      );
    } catch {
      /* omit */
    }
  }
  const store_operation = decodeOptionalLiteral(
    DoctorStoreOperation,
    raw.store_operation,
  );
  if (store_operation !== undefined) ledger.store_operation = store_operation;
  const store_stage = decodeOptionalLiteral(DoctorStoreStage, raw.store_stage);
  if (store_stage !== undefined) ledger.store_stage = store_stage;
  const store_result = decodeOptionalLiteral(
    DoctorStoreResult,
    raw.store_result,
  );
  if (store_result !== undefined) ledger.store_result = store_result;
  if (raw.store_exit_code !== undefined) {
    try {
      ledger.store_exit_code = S.decodeUnknownSync(DoctorStoreExitCode)(
        raw.store_exit_code,
        STRICT_DOCTOR_PARSE,
      );
    } catch {
      /* omit */
    }
  }
  const store_classifier = decodeOptionalLiteral(
    DoctorStoreClassifier,
    raw.store_classifier,
  );
  if (store_classifier !== undefined)
    ledger.store_classifier = store_classifier;
  const login_failure_code = decodeOptionalLiteral(
    AuthLoginFailedCode,
    raw.login_failure_code,
  );
  if (login_failure_code !== undefined)
    ledger.login_failure_code = login_failure_code;
  const failure_signature = decodeOptionalLiteral(
    DoctorFailureSignature,
    raw.failure_signature,
  );
  if (failure_signature !== undefined)
    ledger.failure_signature = failure_signature;
  if (typeof raw.recovery_created === "boolean") {
    ledger.recovery_created = raw.recovery_created;
  }
  if (typeof raw.recovery_unlocked === "boolean") {
    ledger.recovery_unlocked = raw.recovery_unlocked;
  }
  if (typeof raw.recovery_replaced === "boolean") {
    ledger.recovery_replaced = raw.recovery_replaced;
  }
  if (typeof raw.store_staging_unlocked === "boolean") {
    ledger.store_staging_unlocked = raw.store_staging_unlocked;
  }
  const os_version = decodeOptionalLiteral(DoctorOsVersion, raw.os_version);
  if (os_version !== undefined) ledger.os_version = os_version;
  const os_build = decodeOptionalLiteral(DoctorOsBuild, raw.os_build);
  if (os_build !== undefined) ledger.os_build = os_build;
  const launcher_kind = decodeOptionalLiteral(
    DoctorLauncherKind,
    raw.launcher_kind,
  );
  if (launcher_kind !== undefined) ledger.launcher_kind = launcher_kind;
  const launcher_adapter = decodeOptionalLiteral(
    DoctorLauncherAdapter,
    raw.launcher_adapter,
  );
  if (launcher_adapter !== undefined)
    ledger.launcher_adapter = launcher_adapter;
  return ledger;
};

export const doctorEventHasOutcomeLedger = (
  event: TDoctorOutcomeLedger,
): boolean =>
  DOCTOR_OUTCOME_LEDGER_KEYS.some((key) => event[key] !== undefined);

/**
 * Timing keys introduced after the schema-3 baseline that a strict older
 * origin rejects via `onExcessProperty: error`. Stripped alongside the
 * outcome ledger on the 422 compat retry — otherwise a report that only
 * carries `timings.launcher_under_manager_root` still fails the retry.
 */
export const DOCTOR_FORWARD_COMPAT_TIMING_KEYS = [
  "launcher_under_manager_root",
] as const;

export const stripDoctorOutcomeLedger = (report: {
  readonly events: ReadonlyArray<TDoctorReportEvent>;
  readonly schema_version: TDoctorReportSchemaVersion;
  readonly report_id: TOpaqueId;
  readonly emitted_at_ms: number;
  readonly reporter_cli_version?: TVersionStamp;
  readonly cursor_gap_count: number;
  readonly suppressed_event_count: number;
  readonly health?: TDoctorCachedHealth;
}): TDoctorReport => {
  const events = report.events.map((event) => {
    const next: Record<string, unknown> = { ...event };
    for (const key of DOCTOR_OUTCOME_LEDGER_KEYS) {
      delete next[key];
    }
    if (
      typeof next.timings === "object" &&
      next.timings !== null &&
      !Array.isArray(next.timings)
    ) {
      const timings: Record<string, unknown> = {
        ...(next.timings as Record<string, unknown>),
      };
      for (const key of DOCTOR_FORWARD_COMPAT_TIMING_KEYS) {
        delete timings[key];
      }
      if (Object.keys(timings).length === 0) delete next.timings;
      else next.timings = timings;
    }
    return next as TDoctorReportEvent;
  });
  return {
    schema_version: report.schema_version,
    report_id: report.report_id,
    emitted_at_ms: report.emitted_at_ms,
    ...(report.reporter_cli_version !== undefined
      ? { reporter_cli_version: report.reporter_cli_version }
      : {}),
    cursor_gap_count: report.cursor_gap_count,
    suppressed_event_count: report.suppressed_event_count,
    events,
    ...(report.health !== undefined ? { health: report.health } : {}),
  };
};

const BuildRevision = S.String.check(S.isPattern(/^[0-9a-f]{7,64}$/));

/** Closed, content-free tunnel request diagnostic dimensions. */
export const TunnelRequestPath = S.Literals([
  "fleet",
  "browser",
  "origin",
  "team",
]);
export type TTunnelRequestPath = S.Schema.Type<typeof TunnelRequestPath>;

export const TunnelRequestTransport = S.Literals(["rtc", "mux"]);
export type TTunnelRequestTransport = S.Schema.Type<
  typeof TunnelRequestTransport
>;

export const TunnelRequestFallbackReason = S.Literals([
  "none",
  "rtc_failed",
  "rtc_unavailable",
  "mux_unavailable",
  "channel_open_failed",
]);
export type TTunnelRequestFallbackReason = S.Schema.Type<
  typeof TunnelRequestFallbackReason
>;

export const TunnelRequestPlanCache = S.Literals(["hit", "miss", "soft"]);
export type TTunnelRequestPlanCache = S.Schema.Type<
  typeof TunnelRequestPlanCache
>;

export const DoctorReportEvent = S.Struct({
  event_id: OpaqueId,
  observed_at_ms: EpochMs,
  daemon_version: VersionStamp,
  daemon_build_revision: S.optional(BuildRevision),
  platform: DoctorPlatform,
  architecture: DoctorArchitecture,
  severity: DoctorSeverity,
  scope: S.String.check(S.isMaxLength(32), S.isMinLength(1)),
  message: S.String.check(S.isMaxLength(240), S.isMinLength(1)),
  correlation_id: S.optional(OpaqueId),
  replay_session_id: S.optional(ReplaySessionId),
  timings: S.optional(DoctorEventTimings),
  tunnel_path: S.optional(TunnelRequestPath),
  tunnel_transport: S.optional(TunnelRequestTransport),
  rung_fallback_reason: S.optional(TunnelRequestFallbackReason),
  channel_reused: S.optional(S.Boolean),
  plan_cache: S.optional(TunnelRequestPlanCache),
  serving_inflight: S.optional(FiniteCount),
  provider: S.optional(SubscriptionProviderSlug),
  operation_kind: S.optional(DoctorAuthOperationKind),
  phase: S.optional(DoctorAuthPhase),
  outcome: S.optional(DoctorAuthOutcome),
  observation: S.optional(DaemonProviderObservation),
  reason_code: S.optional(DaemonProviderReasonCode),
  status_seq: S.optional(DoctorStatusSeq),
  store_operation: S.optional(DoctorStoreOperation),
  store_stage: S.optional(DoctorStoreStage),
  store_result: S.optional(DoctorStoreResult),
  store_exit_code: S.optional(DoctorStoreExitCode),
  store_classifier: S.optional(DoctorStoreClassifier),
  login_failure_code: S.optional(AuthLoginFailedCode),
  failure_signature: S.optional(DoctorFailureSignature),
  recovery_created: S.optional(S.Boolean),
  recovery_unlocked: S.optional(S.Boolean),
  recovery_replaced: S.optional(S.Boolean),
  store_staging_unlocked: S.optional(S.Boolean),
  os_version: S.optional(DoctorOsVersion),
  os_build: S.optional(DoctorOsBuild),
  launcher_kind: S.optional(DoctorLauncherKind),
  launcher_adapter: S.optional(DoctorLauncherAdapter),
});
export type TDoctorReportEvent = S.Schema.Type<typeof DoctorReportEvent>;

export const DOCTOR_REPORT_MAX_EVENTS = 32;

export const DoctorReport = S.Struct({
  schema_version: DoctorReportSchemaVersion,
  report_id: OpaqueId,
  emitted_at_ms: EpochMs,
  reporter_cli_version: S.optional(VersionStamp),
  cursor_gap_count: FiniteCount,
  suppressed_event_count: FiniteCount,
  events: S.Array(DoctorReportEvent).check(
    S.isMinLength(1),
    S.isMaxLength(DOCTOR_REPORT_MAX_EVENTS),
  ),
  health: S.optional(DoctorCachedHealth),
});
export type TDoctorReport = S.Schema.Type<typeof DoctorReport>;

export const DoctorReportAck = S.Struct({
  report_id: OpaqueId,
  accepted_event_ids: S.Array(OpaqueId).check(
    S.isMinLength(1),
    S.isMaxLength(DOCTOR_REPORT_MAX_EVENTS),
  ),
});
export type TDoctorReportAck = S.Schema.Type<typeof DoctorReportAck>;

export const DoctorReportRejectCode = S.Literals([
  "diagnostics_disabled",
  "unauthorized",
  "invalid",
  "oversize",
  "rate_limited",
  "unavailable",
]);
export type TDoctorReportRejectCode = S.Schema.Type<
  typeof DoctorReportRejectCode
>;

export const DoctorReportReject = S.Struct({
  code: DoctorReportRejectCode,
  report_id: S.optional(OpaqueId),
});
export type TDoctorReportReject = S.Schema.Type<typeof DoctorReportReject>;

const doctorMessageFallback = (severity: TDoctorSeverity): string => {
  if (severity === "error") return "Daemon error.";
  if (severity === "warn") return "Daemon warning.";
  return "Daemon notice.";
};

/** Defense in depth for log scope. No catalog — invalid values fall back. */
export const sanitizeDoctorScope = (scope: unknown): string => {
  if (typeof scope !== "string" || scope.length === 0 || scope.length > 32) {
    return DOCTOR_SCOPE_FALLBACK;
  }
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(scope)) {
    return DOCTOR_SCOPE_FALLBACK;
  }
  if (
    /\b(?:password|secret|token|bearer|cookie|authorization|credential)\b/i.test(
      scope,
    )
  ) {
    return DOCTOR_SCOPE_FALLBACK;
  }
  return scope;
};

/** Defense in depth for wire messages, not a grant of trust to runtime prose. */
export const sanitizeDoctorMessage = (
  message: unknown,
  severity: TDoctorSeverity,
): string => {
  const fallback = doctorMessageFallback(severity);
  if (
    typeof message !== "string" ||
    message.length === 0 ||
    message.length > 240
  )
    return fallback;
  if (!/^[A-Za-z][A-Za-z :;_,.'!?()-]*$/.test(message)) return fallback;
  if (/\b[A-Za-z_-]+\.[A-Za-z]{2,}\b/.test(message)) return fallback;
  if (
    /\b(?:password|secret|token|bearer|cookie|authorization|credential value|login code|device code)\b/i.test(
      message,
    )
  )
    return fallback;
  if (message.split(/[^A-Za-z]+/).some((word) => word.length > 24))
    return fallback;
  return message;
};

export const projectDoctorTimings = (
  input: unknown,
): TDoctorEventTimings | undefined => {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return undefined;
  const result: Record<string, number | boolean> = {};
  for (const key of Object.keys(DoctorEventTimings.fields)) {
    try {
      const value = (input as Record<string, unknown>)[key];
      if (value === undefined) continue;
      const decoded = S.decodeUnknownSync(DoctorEventTimings)(
        { [key]: value },
        STRICT_DOCTOR_PARSE,
      );
      Object.assign(result, decoded);
    } catch {
      /* Optional measurement failure must not remove an incident. */
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

/**
 * Normalize only optional measurements and message text. Excess keys still
 * fail under {@link STRICT_DOCTOR_PARSE} (fail-closed). Launcher wire compat
 * is narrow: the schema lists launcher_kind / launcher_adapter /
 * timings.launcher_under_manager_root and the three launcher_* signatures
 * explicitly; daemons map unknown-to-legacy signatures on the wire and the
 * 422 retry strips those launcher fields via {@link stripDoctorOutcomeLedger}.
 */
const prepareEvent = (input: unknown): unknown => {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return input;
  const event = input as Record<string, unknown>;
  const next = { ...event };
  if (
    (event.severity === "info" ||
      event.severity === "warn" ||
      event.severity === "error") &&
    typeof event.message === "string"
  ) {
    next.message = sanitizeDoctorMessage(event.message, event.severity);
  }
  if (Object.hasOwn(event, "scope")) {
    next.scope = sanitizeDoctorScope(event.scope);
  }
  if (
    typeof event.timings === "object" &&
    event.timings !== null &&
    !Array.isArray(event.timings)
  ) {
    // Keep excess keys for strict validation, but drop malformed known values individually.
    const extras = Object.fromEntries(
      Object.entries(event.timings).filter(
        ([key]) => !Object.hasOwn(DoctorEventTimings.fields, key),
      ),
    );
    next.timings = { ...extras, ...projectDoctorTimings(event.timings) };
  } else if (event.timings !== undefined) {
    delete next.timings;
  }
  if (
    event.correlation_id !== undefined &&
    !S.is(OpaqueId)(event.correlation_id)
  )
    delete next.correlation_id;
  if (
    event.daemon_build_revision !== undefined &&
    !S.is(BuildRevision)(event.daemon_build_revision)
  )
    delete next.daemon_build_revision;
  return next;
};
const prepareReport = (input: unknown): unknown => {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return input;
  const report = input as Record<string, unknown>;
  return Array.isArray(report.events)
    ? { ...report, events: report.events.map(prepareEvent) }
    : input;
};
export const parseDoctorReport = (input: unknown): TDoctorReport =>
  S.decodeUnknownSync(DoctorReport)(prepareReport(input), STRICT_DOCTOR_PARSE);
export const parseDoctorReportEvent = (input: unknown): TDoctorReportEvent =>
  S.decodeUnknownSync(DoctorReportEvent)(
    prepareEvent(input),
    STRICT_DOCTOR_PARSE,
  );

export const parseDoctorReportAck = (input: unknown): TDoctorReportAck =>
  S.decodeUnknownSync(DoctorReportAck)(input, STRICT_DOCTOR_PARSE);

export const parseDoctorReportReject = (input: unknown): TDoctorReportReject =>
  S.decodeUnknownSync(DoctorReportReject)(input, STRICT_DOCTOR_PARSE);

/** Effect result success-first: `Result<A, E>` = Success<A> | Failure<E>. */
export type TDoctorReportDecode = Result.Result<TDoctorReport, SchemaError>;
export type TDoctorReportEventDecode = Result.Result<
  TDoctorReportEvent,
  SchemaError
>;

export const decodeDoctorReportResult = (input: unknown): TDoctorReportDecode =>
  S.decodeUnknownResult(DoctorReport)(
    prepareReport(input),
    STRICT_DOCTOR_PARSE,
  );
export const decodeDoctorReportEventResult = (
  input: unknown,
): TDoctorReportEventDecode =>
  S.decodeUnknownResult(DoctorReportEvent)(
    prepareEvent(input),
    STRICT_DOCTOR_PARSE,
  );

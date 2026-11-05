import { Schema as S } from "effect";

/**
 * Uniform usage snapshot — THE canonical struct every provider's usage
 * read reduces into, at the daemon delegation boundary.
 *
 * Each OAuth-backed provider reports usage in a wildly different shape,
 * and vendors RESHAPE those payloads without notice (OpenAI has already
 * collapsed Codex's 5h-primary + weekly-secondary pair into a single
 * weekly primary window mid-flight):
 *
 *   - Anthropic Pro/Max ("claude_code"): OAuth usage endpoint with
 *     `utilization` + `resets_at` per rolling window (5h, 7d, and
 *     model-scoped 7d windows).
 *   - ChatGPT Codex ("chatgpt"): `backend-api/wham/usage` with
 *     `used_percent` + `limit_window_seconds` + `reset_at` windows under
 *     `rate_limit`.
 *   - Kimi Code: `{ usage, limits[] }` rows; Grok: a monthly quota.
 *
 * Rather than push that variance into the client, each delegate reduces
 * its vendor payload into this ONE discriminated union as early as
 * possible — everything downstream (relay persistence, the calibration
 * estimator, the UI) only ever sees this shape, so a vendor-side change
 * is absorbed entirely inside that provider's reducer.
 */
/** One quota window — e.g. Claude's 5h + 7d, Codex's weekly. */
export const ProviderUsageWindow = S.Struct({
  /**
   * Human-readable window label — "5-hour", "7-day", "Sonnet 7-day", etc.
   * Doubles as the window's IDENTITY downstream (the calibration series
   * key), so reducers derive it from the window's DURATION whenever the
   * vendor states one — vendor-positional names ("Primary") survive a
   * reshape with a different meaning; a duration label re-keys instead.
   */
  label: S.String,
  /**
   * Stable machine identity for pool → catalog-meter matching, distinct from
   * the display `label`. Windows that are not metered pools omit it.
   */
  meter_id: S.optional(S.String),
  /** 0–100 used percentage in this window. */
  percent_used: S.Number,
  /** Unix epoch milliseconds when this window resets, when known. */
  reset_at_ms: S.NullOr(S.Number),
  /**
   * Window length in milliseconds, when the vendor states one (e.g.
   * Codex's `limit_window_seconds`, Claude's key-implied 5h/7d). Absent
   * when the vendor only names the window.
   */
  window_ms: S.optional(S.Number),
});
export type TProviderUsageWindow = S.Schema.Type<typeof ProviderUsageWindow>;

/** Percent-used threshold for `allowed_warning` quota status. */
export const QUOTA_WARN_PERCENT = 80;
/** Percent-used threshold for `rejected` quota status. */
export const QUOTA_REJECT_PERCENT = 100;

/**
 * Bounded codes for a failed usage refresh while last-good quota is still
 * served. The only values that may appear on `refresh_failure.reason` —
 * never vendor prose, HTTP bodies, URLs, or exception text.
 */
export const ProviderUsageRefreshFailureReason = S.Literals([
  "credential_expired",
  "account_changed",
  "rate_limited",
  "authorization_failed",
  "subscription_inactive",
  "fetch_failed",
]);
export type TProviderUsageRefreshFailureReason = S.Schema.Type<
  typeof ProviderUsageRefreshFailureReason
>;

export const ProviderUsageRefreshFailure = S.Struct({
  reason: ProviderUsageRefreshFailureReason,
  /** Unix epoch ms of the failed attempt, when known. */
  at_ms: S.optional(S.Number),
});
export type TProviderUsageRefreshFailure = S.Schema.Type<
  typeof ProviderUsageRefreshFailure
>;

/**
 * Map an `unavailable.reason` (wire code or provider sentence) onto a
 * {@link TProviderUsageRefreshFailureReason}. Exact known codes first;
 * otherwise keyword / HTTP-status classification. Returns null for empty
 * or placeholder (`loading`) reasons. Never returns the input string.
 */
export const classifyUsageRefreshFailureReason = (
  reason: string,
): TProviderUsageRefreshFailureReason | null => {
  const trimmed = reason.trim();
  if (trimmed.length === 0 || trimmed === "loading") return null;
  if (S.is(ProviderUsageRefreshFailureReason)(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  if (/\b429\b/.test(trimmed) || /rate[\s-]limit/.test(lower)) {
    return "rate_limited";
  }
  if (
    /\b401\b/.test(trimmed) ||
    /authorization was rejected/.test(lower) ||
    /not signed in/.test(lower)
  ) {
    return "authorization_failed";
  }
  if (
    /\b403\b/.test(trimmed) ||
    /no active/.test(lower) ||
    /isn't available on this plan/.test(lower) ||
    /subscription may be inactive/.test(lower)
  ) {
    return "subscription_inactive";
  }
  return "fetch_failed";
};

/**
 * The structural meter shape the quota gate + pool matcher accept — the
 * `meter_id` identity plus its exact vendor aliases. Structurally satisfied by
 * the schema-derived `TSubscriptionMeter`, kept as a hand-written alias so
 * `wire`/`core` can type a meter arg without importing the catalog schema.
 */
export type TSubscriptionMeterMatch = {
  readonly meter_id: string;
  readonly aliases?: ReadonlyArray<string>;
};

/**
 * Match a subscription catalog meter to the vendor identity emitted on a
 * display-only usage pool. Aliases are exact vendor identities only.
 */
export const matchesSubscriptionMeter = (
  meter: TSubscriptionMeterMatch | undefined,
  poolMeterId: string | undefined,
): boolean => {
  if (meter === undefined || poolMeterId === undefined) return false;
  if (poolMeterId === meter.meter_id) return true;
  return meter.aliases?.includes(poolMeterId) ?? false;
};

export const ProviderUsageSnapshot = S.Union([
  /**
   * One or more quota windows + an overall status. Claude's
   * shared plan meters (`five_hour` + `seven_day`) and Codex's
   * `rate_limit` windows both flatten into this list. Model-scoped
   * Claude caps (Fable / Opus / Sonnet) and Codex promo pools (Spark)
   * ride on `extra_pools` instead — they meter different usage and
   * must not drive status or the tightest-window face.
   */
  S.Struct({
    kind: S.Literal("quota"),
    status: S.Literals(["allowed", "allowed_warning", "rejected"]),
    /** Optional plan/tier shown alongside the bars. */
    plan: S.optional(S.String),
    /** Tags tier provenance as `official`, `documented-experimental`, or `private-client`. */
    plan_source: S.optional(S.String),
    windows: S.Array(ProviderUsageWindow),
    /** Short human-readable note ("Pro plan — 5h window"). */
    note: S.String,
    /**
     * Unix epoch ms when these figures were last fetched LIVE from the
     * vendor. Stamped by the daemon's usage cache when it serves a cached
     * snapshot; lets the UI show "updated Xm ago". Absent on a fresh read.
     */
    as_of_ms: S.optional(S.Number),
    /**
     * True when these are the LAST KNOWN GOOD figures, served because a
     * live refresh failed (typically the vendor usage endpoint is
     * rate-limited, which is independent of inference). The numbers are
     * still meaningful — just not this-instant — so the UI renders them
     * with a "cached" badge rather than an error. Absent/false on a fresh
     * read. See `packages/cli/daemon/src/usage-cache.ts`.
     */
    stale: S.optional(S.Boolean),
    /**
     * Last live refresh failure while these good figures are still served.
     * Observation time (`as_of_ms`) stays the successful fetch. Cleared on
     * the next usable snapshot. `reason` is a bounded code only.
     */
    refresh_failure: S.optional(ProviderUsageRefreshFailure),
    /**
     * Feature-scoped pools metering DIFFERENT usage than `windows` (e.g.
     * Codex's per-model promo pools under `additional_rate_limits`).
     * DISPLAY-ONLY: the relay persists only `windows` for calibration —
     * a separate pool priced against the main meter's K̂ would be wrong,
     * and pools must never become the card's tightest-window meter.
     */
    extra_pools: S.optional(S.Array(ProviderUsageWindow)),
    /**
     * Vendor credit state, when reported (Codex's `credits` +
     * `rate_limit_reset_credits`). Display-only — lets the card account
     * for capacity that exists OUTSIDE the quota windows.
     */
    credits: S.optional(
      S.Struct({
        /** Raw balance string as the vendor reports it ("0", "1250"). */
        balance: S.String,
        /** Vendor reports the balance as unlimited. */
        unlimited: S.optional(S.Boolean),
        /** Limit-reset credits available (each lifts a hit limit). */
        reset_credits: S.optional(S.Number),
      }),
    ),
  }),
  /**
   * Subscription plan / entitlements snapshot. No live quota number;
   * just "you're on plan X" — for a provider whose usage endpoint
   * exposes no per-window quota.
   */
  S.Struct({
    kind: S.Literal("plan"),
    plan: S.String,
    note: S.String,
  }),
  /**
   * Provider returned an error or doesn't surface anything usable — e.g. not
   * signed in, the stored access token is expired (`reason: "credential_expired"`,
   * no native refresh on this path), the vendor usage endpoint rejected the token,
   * or the plan exposes no quota window the daemon can read. The UI shows
   * `reason`, plus an optional `link` rendered as a button to the provider's own
   * usage / billing page when the figures can only be checked there.
   */
  S.Struct({
    kind: S.Literal("unavailable"),
    reason: S.String,
    link: S.optional(S.String),
  }),
]);
export type TProviderUsageSnapshot = S.Schema.Type<
  typeof ProviderUsageSnapshot
>;

/**
 * Response shape for `GET /api/credentials/{provider}/blob`. Returns
 * the user's OWN ciphertext + nonce so the browser can decrypt
 * locally and forward the plaintext token to the usage endpoint
 * above. Gated on session auth; the caller can only ever fetch
 * blobs they themselves wrote.
 */
export const CredentialBlobResponse = S.Struct({
  provider: S.String,
  ciphertext: S.String,
  nonce: S.String,
  /** Source stamp used to detect stale team credential-share envelopes. */
  updated_at: S.optional(S.String),
  /** Source vault generation used to detect stale credential-share envelopes. */
  vault_version: S.optional(S.Number),
});

/**
 * Keep team credential-share wrapping independent from rollout order: older
 * blob handlers omit source stamps, and the browser simply avoids stamping
 * rather than inventing one.
 */
export type TCredentialBlobSourceStamp = {
  readonly updated_at?: string;
  readonly vault_version?: number;
};
export type TCredentialBlobResponse = S.Schema.Type<
  typeof CredentialBlobResponse
>;

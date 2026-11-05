import { Effect, Schema as S } from "effect";
import { PROVIDER_TIER_METHODOLOGY_VERSION } from "./provider-tier";

/**
 * Public usage index — OpenLLM's own aggregate projection of gateway activity,
 * published as exact figures. This is our analytics, not a re-release of any
 * upstream vendor's data: raw counts, projected per-tier value, and period-over-
 * period change, with no suppression, bucketing, floors, or noise. Rows are
 * recomputed and OVERWRITTEN each rollup run (live, never frozen).
 */

/**
 * Explicit value-methodology id on the public response. Same string as
 * {@link PROVIDER_TIER_METHODOLOGY_VERSION} / public value `metric_version`.
 * Cross-deployment merge MUST compare this literally — never default a peer
 * that omits it to the local current version.
 */
export const PUBLIC_USAGE_VALUE_METHODOLOGY_VERSION =
  PROVIDER_TIER_METHODOLOGY_VERSION;

export const PublicUsageMetric = S.Literals([
  "model_popularity",
  "provider_popularity",
  "value",
]);
export type TPublicUsageMetric = S.Schema.Type<typeof PublicUsageMetric>;

export const PublicUsagePopularityMetrics = S.Struct({
  users: S.Number,
  user_days: S.Number,
  requests: S.Number,
  prev_users: S.NullOr(S.Number),
});
export type TPublicUsagePopularityMetrics = S.Schema.Type<
  typeof PublicUsagePopularityMetrics
>;

export const PublicUsageValueMetrics = S.Struct({
  value_usd_30d: S.Number,
  accounts: S.Number,
  /** Valid meter-delta pairs supporting the selected value estimate. */
  pair_count: S.Number,
  /** Ratio clustering quality for the selected value estimate. */
  tightness: S.Number,
  prev_value_usd_30d: S.NullOr(S.Number),
});
export type TPublicUsageValueMetrics = S.Schema.Type<
  typeof PublicUsageValueMetrics
>;

/** The exact figures stored per non-marker rollup row in `metrics` jsonb. */
export const PublicUsageIndexMetrics = S.Union([
  PublicUsagePopularityMetrics,
  PublicUsageValueMetrics,
]);
export type TPublicUsageIndexMetrics = S.Schema.Type<
  typeof PublicUsageIndexMetrics
>;

/** Metadata marker that represents an otherwise empty completed bucket. */
export const PUBLIC_USAGE_INDEX_BUCKET_MARKER = "__bucket__";

/**
 * Internal payload used only by the `__bucket__` completion marker. The value
 * bucket's marker carries a fingerprint of the eligible (provider, account,
 * tier) set it was derived from, so a reader can distinguish changed inputs
 * against mere elapsed time and refresh the bucket in place. Optional: markers
 * written before the field existed (and popularity markers) omit it.
 */
export const PublicUsageIndexMarkerMetrics = S.Struct({
  tier_set_fingerprint: S.optional(S.String),
  evidence_stamp: S.optional(S.String),
});
export type TPublicUsageIndexMarkerMetrics = S.Schema.Type<
  typeof PublicUsageIndexMarkerMetrics
>;

/**
 * The metric-specific portion of a stored row. This makes a row's sibling
 * `metric` column the discriminator for its otherwise unrelated JSON payload.
 */
export const PublicUsageIndexStoredMetric = S.Union([
  S.Struct({
    metric: S.Literals(["model_popularity"]),
    subject: S.String,
    metrics: PublicUsagePopularityMetrics,
  }),
  S.Struct({
    metric: S.Literals(["provider_popularity"]),
    subject: S.String,
    metrics: PublicUsagePopularityMetrics,
  }),
  S.Struct({
    metric: S.Literals(["value"]),
    subject: S.String,
    metrics: PublicUsageValueMetrics,
  }),
  S.Struct({
    metric: PublicUsageMetric,
    subject: S.Literals([PUBLIC_USAGE_INDEX_BUCKET_MARKER]),
    metrics: PublicUsageIndexMarkerMetrics,
  }),
]);
export type TPublicUsageIndexStoredMetric = S.Schema.Type<
  typeof PublicUsageIndexStoredMetric
>;

const PublicUsageIndexRowBase = S.Struct({
  metric_version: S.String,
  provider: S.String,
  label: S.String,
  period_start: S.String,
  period_end: S.String,
  updated_at: S.String,
});

/** One rollup row, matching the `public_usage_index` table. */
export const PublicUsageIndexRow = S.Union([
  S.Struct({
    ...PublicUsageIndexRowBase.fields,
    metric: S.Literals(["model_popularity"]),
    subject: S.String,
    metrics: PublicUsagePopularityMetrics,
  }),
  S.Struct({
    ...PublicUsageIndexRowBase.fields,
    metric: S.Literals(["provider_popularity"]),
    subject: S.String,
    metrics: PublicUsagePopularityMetrics,
  }),
  S.Struct({
    ...PublicUsageIndexRowBase.fields,
    metric: S.Literals(["value"]),
    subject: S.String,
    metrics: PublicUsageValueMetrics,
  }),
  S.Struct({
    ...PublicUsageIndexRowBase.fields,
    metric: PublicUsageMetric,
    subject: S.Literals([PUBLIC_USAGE_INDEX_BUCKET_MARKER]),
    metrics: PublicUsageIndexMarkerMetrics,
  }),
]);
export type TPublicUsageIndexRow = S.Schema.Type<typeof PublicUsageIndexRow>;

/** Factual caption describing what the figures measure (not a legal hedge). */
export const PUBLIC_USAGE_INDEX_CAPTION =
  "Trends measured across OpenLLM gateway activity";

export const PublicModelPopularity = S.Struct({
  /** The provider's registry `displayName` — a rendered label, not a key. */
  provider: S.String,
  /**
   * The stable provider slug (`claude_code`, `openai`, …) behind that label.
   * Same role as `PublicValueByTier.provider_slug`: anything rendering a logo,
   * a tint or a public brand name keys off THIS, since `provider` above is a
   * display string. Empty only for a legacy label the registry no longer knows.
   *
   * Decoded with a default — see the note on cross-deployment merging below.
   */
  provider_slug: S.String.pipe(
    S.optional,
    S.withDecodingDefault(Effect.succeed("")),
  ),
  model: S.String,
  users: S.Number,
  user_days: S.Number,
  requests: S.Number,
  /**
   * Percent change in distinct users vs the previous window; null when there
   * is no prior period, or when the prior is too small to divide by — see
   * `is_new` for the third state and the reader's floors for the threshold.
   */
  pct_change: S.NullOr(S.Number),
  /**
   * The row arrived this period: it carries real activity now and the prior
   * window had none worth comparing against. Only ever true while
   * `pct_change` is null — the two together are a tri-state, since a percent
   * off a negligible base is a number, not a measurement.
   *
   * Decoded with a default — see the note on cross-deployment merging below.
   */
  is_new: S.Boolean.pipe(
    S.optional,
    S.withDecodingDefault(Effect.succeed(false)),
  ),
});
export type TPublicModelPopularity = S.Schema.Type<
  typeof PublicModelPopularity
>;

export const PublicProviderPopularity = S.Struct({
  /** The provider's registry `displayName` — a rendered label, not a key. */
  provider: S.String,
  /**
   * The stable provider slug (`claude_code`, `openai`, …) behind that label.
   * Unlike the model rows, a provider row already stores the slug as its
   * SUBJECT, so this is carried straight through rather than recovered from
   * the registry. Anything rendering a logo, a tint or a public brand name
   * keys off THIS, since `provider` above is a display string.
   *
   * Decoded with a default — see the note on cross-deployment merging below.
   */
  provider_slug: S.String.pipe(
    S.optional,
    S.withDecodingDefault(Effect.succeed("")),
  ),
  users: S.Number,
  user_days: S.Number,
  requests: S.Number,
  pct_change: S.NullOr(S.Number),
  /** See `PublicModelPopularity.is_new`. */
  is_new: S.Boolean.pipe(
    S.optional,
    S.withDecodingDefault(Effect.succeed(false)),
  ),
});
export type TPublicProviderPopularity = S.Schema.Type<
  typeof PublicProviderPopularity
>;

/**
 * One period's reading for a tier, for the value trend series.
 *
 * Deliberately only the two fields a line needs. The calibration figures
 * (`accounts`, `pair_count`, `tightness`) describe how well a SINGLE estimate
 * is supported and are published on the current reading; repeating them for
 * every historical point would multiply the payload by the number of retained
 * buckets to say something no line can draw.
 */
export const PublicValuePoint = S.Struct({
  /** ISO period end, and the x value of the point. */
  period_end: S.String,
  value_usd_30d: S.Number,
});
export type TPublicValuePoint = S.Schema.Type<typeof PublicValuePoint>;

/**
 * A field added to the public response AFTER deployments began reading each
 * other's copies.
 *
 * `mergeConfiguredPublicUsageIndex` fetches a PEER deployment's
 * `/api/public/usage-index` and decodes it with this schema, so a field that
 * is merely required would make every merge fail — a permitted local fallback
 * that is not cacheable — for the whole window in which the two deployments
 * disagree. Decoded with a default instead: the property stays non-optional
 * for consumers, and an older peer still parses.
 */
export const PublicValueByTier = S.Struct({
  /**
   * The provider's registry `displayName` — a sign-in-flow label ("Claude
   * (Pro/Max sign-in)"), kept for callers that already read it.
   */
  provider: S.String,
  /**
   * The stable provider slug (`claude_code`, `chatgpt`, …), split off the
   * row's `provider:tier` subject. `provider` above is a display string and so
   * cannot key a brand map; anything rendering a logo, a tint or a public
   * brand name keys off THIS.
   *
   * Decoded with a default — see the note on cross-deployment merging below.
   */
  provider_slug: S.String.pipe(
    S.optional,
    S.withDecodingDefault(Effect.succeed("")),
  ),
  tier: S.String,
  /** Projected API-equivalent value of the best-calibrated subscription per 30 days. */
  value_usd_30d: S.Number,
  /** Eligible calibrated accounts in the tier; the figure is the best-calibrated one of them. */
  accounts: S.Number,
  /** Valid meter-delta pairs supporting the selected account's estimate. */
  pair_count: S.Number,
  /** Ratio clustering quality for the selected account's estimate. */
  tightness: S.Number,
  /**
   * Percent change vs the previous window; null when there is no prior, or
   * when the prior is a negligible fraction of the period's leading tier. A
   * tier worth a few dollars swings by thousands of percent on one account's
   * ordinary week, which says nothing about the tier and crowds out the
   * figures that do. See `is_new` for the third state.
   */
  pct_change: S.NullOr(S.Number),
  /** See `PublicModelPopularity.is_new`. */
  is_new: S.Boolean.pipe(
    S.optional,
    S.withDecodingDefault(Effect.succeed(false)),
  ),
  /**
   * Every retained period for this tier, oldest first, INCLUDING the current
   * one — so a consumer plots `history` alone rather than stitching it to the
   * top-level reading and risking a duplicated or missing final point.
   *
   * The buckets were always kept (`public_usage_index` is keyed on
   * `(metric_version, metric, subject, period_start)`); it was the reader that
   * dropped them. A tier measured for the first time has a single point, which
   * is a fact a chart has to render rather than an error.
   */
  history: S.Array(PublicValuePoint).pipe(
    S.optional,
    S.withDecodingDefault(Effect.succeed([])),
  ),
});
export type TPublicValueByTier = S.Schema.Type<typeof PublicValueByTier>;

export const PeriodWindow = S.Struct({
  period_start: S.NullOr(S.String),
  period_end: S.NullOr(S.String),
});
export type TPeriodWindow = S.Schema.Type<typeof PeriodWindow>;

/**
 * Public usage artifact: exact aggregate figures grouped for display. The
 * top-level period is the min/max envelope across metric-specific windows,
 * retained for backward compatibility.
 *
 * `value_methodology_version` identifies the recurring-value economics behind
 * `value_by_tier`. Unlike fields decoded with defaults for mixed-version peers,
 * this one is required on every response we emit, and a configured mandatory
 * merge rejects a peer that omits it or reports a different string — never
 * assume an old peer shares the local methodology, and never fall back to
 * local-only value figures when the merge URL is set.
 */
export const PublicUsageIndexResponse = S.Struct({
  period_start: S.NullOr(S.String),
  period_end: S.NullOr(S.String),
  windows: S.Struct({
    model: PeriodWindow,
    provider: PeriodWindow,
    value: PeriodWindow,
  }),
  caption: S.Literals([PUBLIC_USAGE_INDEX_CAPTION]),
  /**
   * Shared with {@link PUBLIC_USAGE_VALUE_METHODOLOGY_VERSION}. Emit the
   * constant; merge compares it literally before combining `value_by_tier`.
   */
  value_methodology_version: S.String,
  model_popularity: S.Array(PublicModelPopularity),
  provider_popularity: S.Array(PublicProviderPopularity),
  value_by_tier: S.Array(PublicValueByTier),
});
export type TPublicUsageIndexResponse = S.Schema.Type<
  typeof PublicUsageIndexResponse
>;

export function hasPublicUsageIndexData(
  response: TPublicUsageIndexResponse,
): boolean {
  return (
    response.model_popularity.length > 0 ||
    response.provider_popularity.length > 0 ||
    response.value_by_tier.length > 0
  );
}

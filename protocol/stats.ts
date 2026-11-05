import { Schema as S } from "effect";

export const RequestStatus = S.Literals([
  "success",
  "error",
  "timeout",
  "rate_limited",
]);
export type TRequestStatus = S.Schema.Type<typeof RequestStatus>;

export const RequestRow = S.Struct({
  id: S.String,
  user_id: S.String,
  key_id: S.String,
  model: S.String,
  provider: S.String,
  /** Canonical prompt tokens — INCLUDES the two cache columns below. */
  tokens_in: S.Number,
  tokens_out: S.Number,
  /**
   * Cache split of `tokens_in`. Kept so a row can be re-priced at the cache
   * rates (`cache_read_per_million` / `cache_write_per_million`) rather than
   * the full input rate — see `priceSubscriptionUsage` in `handlers/stats.ts`.
   * Rows written before these columns existed carry 0.
   */
  cached_tokens: S.Number,
  cache_creation_tokens: S.Number,
  cost_usd: S.Number,
  latency_ms: S.Number,
  status: RequestStatus,
  error: S.NullOr(S.String),
  idempotency_key: S.NullOr(S.String),
  ts: S.String,
  /**
   * Teams attribution (docs/plan/2026-10-26-teams.md §5 / §14 phase 5).
   * Nullable — personal hops omit both. No FK: deleting a team must not
   * rewrite history.
   */
  team_id: S.NullOr(S.String),
  served_by_user_id: S.NullOr(S.String),
});
export type TRequestRow = S.Schema.Type<typeof RequestRow>;

export const ModelBreakdown = S.Struct({
  model: S.String,
  provider: S.String,
  requests: S.Number,
  tokens_in: S.Number,
  tokens_out: S.Number,
  cost_usd: S.Number,
});
export type TModelBreakdown = S.Schema.Type<typeof ModelBreakdown>;

export const DailyBucket = S.Struct({
  day: S.String,
  requests: S.Number,
  tokens_in: S.Number,
  tokens_out: S.Number,
  cost_usd: S.Number,
});
export type TDailyBucket = S.Schema.Type<typeof DailyBucket>;

/**
 * All-device subscription usage INFERRED from the vendor quota meter, per
 * provider — the calibration estimator's output (docs/proposals/
 * inferred-subscription-usage-calibration.md). Every dollar figure is a
 * LOWER bound by construction (censored one-sided estimator), so the UI
 * may present them as "≥ $X"; `tightness` near 1 means the estimate has
 * converged and can read as "≈".
 */
export const InferredWindowUsage = S.Struct({
  window_label: S.String,
  percent_used: S.Number,
  used_usd: S.Number,
  headroom_usd: S.Number,
  bracket_usd: S.Number,
});
export type TInferredWindowUsage = S.Schema.Type<typeof InferredWindowUsage>;

/**
 * THE uniform usage index — every provider reduces to this one 30-day
 * forecast, no matter how the vendor meters (Claude's 5h/7d, Codex's
 * weekly, Kimi's daily, Grok's monthly). It is scoped to ONE window chunk
 * — the most recent POPULATED window of the largest live calibrated series
 * (the closest earlier populated window stands in when the current one is
 * still empty) — and never an integral over past windows or a sum of
 * exceptional grants:
 *
 *   - `used_usd`     — that window's own API-eq usage, scaled to 30 days by
 *                      30d / the resolved NOMINAL window duration, across all
 *                      devices.
 *   - `bracket_usd`  — that window's bracket, scaled by the same factor.
 *                      Nominal duration is stated vendor duration first, then
 *                      a known window label, otherwise the conservative
 *                      maximum of 30 days and observed remaining horizons —
 *                      never an adjacent reset-deadline difference alone.
 *                      Guarantees used ≤ bracket (same positive scale on both).
 *   - `headroom_usd` — max(0, bracket − used).
 *
 * Methodology `account-owned-v2` (see `PROVIDER_TIER_METHODOLOGY_VERSION`):
 * recurring capacity estimated from the selected window. A one-off early
 * reset is still detected for epoch continuity, but does not shorten the
 * recurring 30-day projection. Historical `account-owned-v1` cache/public
 * rows stay stored and are unread as current until on-demand regeneration.
 */
export const InferredMonthlyIndex = S.Struct({
  used_usd: S.Number,
  headroom_usd: S.Number,
  bracket_usd: S.Number,
});
export type TInferredMonthlyIndex = S.Schema.Type<typeof InferredMonthlyIndex>;

/**
 * One vendor ACCOUNT's inferred figures — the per-account detail behind a
 * provider's rollup when several accounts are calibrated at once (two
 * machines on two logins). Note an account's figures are ACCOUNT-level:
 * every openllm user linked to the same vendor account sees the same
 * numbers — that is by design, not double counting to be "fixed" (the
 * meter is the account's).
 */
/**
 * One persistent (provider, account, plan) bucket's inferred figures.
 * Reused under a single-account provider payload and under each
 * `accounts[]` entry — never by duplicating `accounts[]` per tier.
 *
 * `current_window` / `monthly_index` are live only for the ACTIVE visit
 * of this plan; inactive visits keep historical `off_gateway_usd` and
 * leave those fields null.
 */
export const InferredTierUsage = S.Struct({
  /** Trimmed upstream plan (`pro`, `prolite`, …). Null = unclassified. */
  plan: S.NullOr(S.String),
  off_gateway_usd: S.Number,
  current_window: S.NullOr(InferredWindowUsage),
  monthly_index: S.NullOr(InferredMonthlyIndex),
  pair_count: S.Number,
  tightness: S.Number,
});
export type TInferredTierUsage = S.Schema.Type<typeof InferredTierUsage>;

export const InferredAccountUsage = S.Struct({
  /** Obscured account identity (`sha256("openllm-account-v1:…")`), or null
   *  for the legacy assumed-single-account series. */
  account_hash: S.NullOr(S.String),
  /**
   * Active plan for live capacity (latest unambiguous observation, or the
   * caller-supplied selection). Null when the latest samples conflict or
   * the plan is unknown. Top-level window/index/pairs/tightness describe
   * this plan only.
   */
  plan: S.optional(S.NullOr(S.String)),
  off_gateway_usd: S.Number,
  current_window: S.NullOr(InferredWindowUsage),
  /** The uniform 30-day forecast for this account. NULL until a LIVE
   *  window series is calibrated (cold start / just after a vendor
   *  window reshape). */
  monthly_index: S.NullOr(InferredMonthlyIndex),
  pair_count: S.Number,
  tightness: S.Number,
  /** Per-plan buckets for this account. Absent when only the active
   *  unclassified series exists (legacy no-plan callers). */
  tiers: S.optional(S.Array(InferredTierUsage)),
});
export type TInferredAccountUsage = S.Schema.Type<typeof InferredAccountUsage>;

export const InferredProviderUsage = S.Struct({
  provider: S.String,
  /** For a SINGLE-account provider, that account's obscured hash — the
   *  top-level figures are its own. Absent (undefined) when several accounts
   *  are calibrated; read `accounts[].account_hash` instead. */
  account_hash: S.optional(S.NullOr(S.String)),
  /** API-eq value of 30-day usage the gateway never saw (other devices /
   *  raw CLI / vendor apps). Lower bound; with several accounts, the sum
   *  of their independent lower bounds. */
  off_gateway_usd: S.Number,
  /** The in-progress window's figures, when a calibrated series has a
   *  current reading — drives the providers-page headroom line. NULL when
   *  several accounts are calibrated (each has its own in-progress window;
   *  read `accounts` instead). */
  current_window: S.NullOr(InferredWindowUsage),
  /** The uniform 30-day forecast — forecasts sum soundly, so with several
   *  accounts this is the SUM of their forecasts (unlike `current_window`,
   *  which goes null). NULL when no account has a live calibrated series
   *  yet. */
  monthly_index: S.NullOr(InferredMonthlyIndex),
  /** Valid calibration pairs behind K̂ — 0 pairs never reaches here. With
   *  several accounts: the SUM across accounts (evidence volume). */
  pair_count: S.Number,
  /** 0–1; ≥ ~0.8 reads as converged ("≈" instead of "≥"). With several
   *  accounts: the MIN across accounts, so the conservative "≥" rendering
   *  wins whenever any account is still loose. */
  tightness: S.Number,
  /**
   * Active plan when this payload is a SINGLE account. Absent when several
   * accounts are calibrated — read `accounts[].plan` instead.
   */
  plan: S.optional(S.NullOr(S.String)),
  /** Per-account detail, present only when ≥2 accounts calibrated for this
   *  provider. Absent in the single-account case — the top-level fields
   *  ARE that account's. Never one entry per tier of the same account. */
  accounts: S.optional(S.Array(InferredAccountUsage)),
  /** Per-plan buckets when this payload is a SINGLE account. Absent when
   *  several accounts are calibrated — read `accounts[].tiers` instead. */
  tiers: S.optional(S.Array(InferredTierUsage)),
});
export type TInferredProviderUsage = S.Schema.Type<
  typeof InferredProviderUsage
>;

export const UserStats = S.Struct({
  total_requests: S.Number,
  /** Inclusive input: uncached prompt + cache read + cache write. */
  total_tokens_in: S.Number,
  total_tokens_out: S.Number,
  /** Reported cache-read subset of total_tokens_in; legacy rows carry 0. */
  total_cached_tokens: S.Number,
  /** Reported cache-write subset of total_tokens_in; legacy rows carry 0. */
  total_cache_creation_tokens: S.Number,
  total_cost_usd: S.Number,
  /**
   * What the same window's usage would have cost at pure metered API
   * pricing: non-subscription rows contribute their real `cost_usd`;
   * subscription rows (which log cost 0) are re-priced from the static
   * catalog pricing at API-equivalent per-token rates — PLUS the inferred
   * off-gateway subscription usage below (usage on other devices moves the
   * same quota meter the plan fee bought). Drives the overview savings bar
   * (`total_api_equivalent_cost_usd - total_cost_usd` = what the
   * subscriptions saved).
   */
  total_api_equivalent_cost_usd: S.Number,
  /**
   * Per-provider inferred all-device usage (absent providers had no
   * calibrated meter series — their contribution is 0, the pre-inference
   * behaviour). The sum of `off_gateway_usd` here is exactly the inferred
   * term inside `total_api_equivalent_cost_usd`.
   */
  inferred_subscription_usage: S.optional(S.Array(InferredProviderUsage)),
  by_model: S.Array(ModelBreakdown),
  daily: S.Array(DailyBucket),
});
export type TUserStats = S.Schema.Type<typeof UserStats>;

export const KeyStats = S.Struct({
  key_id: S.String,
  total_requests: S.Number,
  total_tokens_in: S.Number,
  total_tokens_out: S.Number,
  total_cost_usd: S.Number,
  daily: S.Array(DailyBucket),
});
export type TKeyStats = S.Schema.Type<typeof KeyStats>;

export const AdminStats = S.Struct({
  total_users: S.Number,
  active_users_7d: S.Number,
  total_requests: S.Number,
  total_cost_usd: S.Number,
  by_model: S.Array(ModelBreakdown),
  daily: S.Array(DailyBucket),
});
export type TAdminStats = S.Schema.Type<typeof AdminStats>;

// ─── Stacked / grouped requests for the overview "Recent Requests" table ─────

/**
 * A horizontal grouping of recent requests by (provider, model) within a
 * sliding window. Ephemeral `local_port_<n>` providers are collapsed to the
 * stable `local_port` bucket with model `local_port/<leaf>`. The overview
 * table renders one row per group with an `N×` badge; expanding fans out
 * the individual rows via `requestItems`, each carrying its own endpoint.
 */
/**
 * Side of a team-attributed request group, derived (no DB column):
 * - `consumer` — `provider` starts with `team:`
 * - `supplier` — `team_id` set and provider is the real upstream
 */
export const TeamRequestSide = S.Literals(["consumer", "supplier"]);
export type TTeamRequestSide = S.Schema.Type<typeof TeamRequestSide>;

export const GroupedRequest = S.Struct({
  id: S.String,
  provider: S.String,
  model: S.NullOr(S.String),
  /** Distinct endpoints inside the bucket (empty when all rows had none). */
  endpoints: S.Array(S.String),
  count: S.Number,
  tokens_in: S.Number,
  tokens_out: S.Number,
  total_tokens: S.Number,
  /**
   * What this group actually cost on metered API billing — the summed
   * `requests.cost_usd`. Subscription groups log cost 0, so this is 0
   * for them; their price story lives in `api_equivalent_cost_usd`.
   */
  cost_usd: S.Number,
  /**
   * What this group's usage would cost at metered API pricing — set only
   * for subscription-provider groups (which log `cost_usd = 0`), re-priced
   * from the static catalog via `priceSubscriptionUsage` (same calculator
   * as the overview savings bar, cache-read/cache-write split included).
   * `null` for metered groups, whose real cost already lives in `cost_usd`.
   */
  api_equivalent_cost_usd: S.NullOr(S.Number),
  first_timestamp: S.String,
  last_timestamp: S.String,
  /**
   * Teams attribution for the overview "for team X" / "via team X" label.
   * Null when the group is personal (no `team_id`).
   */
  team_id: S.optional(S.NullOr(S.String)),
  team_slug: S.optional(S.NullOr(S.String)),
  team_name: S.optional(S.NullOr(S.String)),
  team_side: S.optional(S.NullOr(TeamRequestSide)),
});
export type TGroupedRequest = S.Schema.Type<typeof GroupedRequest>;

export const GroupedRequestsPagination = S.Struct({
  page: S.Number,
  page_size: S.Number,
  total_groups: S.Number,
  has_more: S.Boolean,
  has_exact_total: S.Boolean,
});
export type TGroupedRequestsPagination = S.Schema.Type<
  typeof GroupedRequestsPagination
>;

export const GroupedRequestsResponse = S.Struct({
  groups: S.Array(GroupedRequest),
  pagination: GroupedRequestsPagination,
});
export type TGroupedRequestsResponse = S.Schema.Type<
  typeof GroupedRequestsResponse
>;

/** A single request row inside an expanded group. */
export const RequestItem = S.Struct({
  id: S.String,
  model: S.NullOr(S.String),
  endpoint: S.NullOr(S.String),
  prompt_tokens: S.Number,
  completion_tokens: S.Number,
  total_tokens: S.Number,
  ts: S.String,
  /**
   * Present when the items query is in failed mode (`failed=1`). Success
   * expansions leave these null so the recent-requests sub-rows stay lean.
   */
  status: S.optional(S.NullOr(RequestStatus)),
  error: S.optional(S.NullOr(S.String)),
  team_id: S.optional(S.NullOr(S.String)),
  team_slug: S.optional(S.NullOr(S.String)),
  team_name: S.optional(S.NullOr(S.String)),
  team_side: S.optional(S.NullOr(TeamRequestSide)),
});
export type TRequestItem = S.Schema.Type<typeof RequestItem>;

export const RequestItemsResponse = S.Struct({
  items: S.Array(RequestItem),
});
export type TRequestItemsResponse = S.Schema.Type<typeof RequestItemsResponse>;

/**
 * A (provider, model) bucket of failed hops for the overview debug table —
 * same grouping shape as Recent requests, but only
 * `status ∈ {error, timeout, rate_limited}`. Expanding loads individual
 * rows via `requestItems?failed=1`.
 */
export const FailedRequestGroup = S.Struct({
  id: S.String,
  provider: S.String,
  model: S.NullOr(S.String),
  endpoints: S.Array(S.String),
  count: S.Number,
  /** Most recent non-null error message in the bucket (preview in the row). */
  last_error: S.NullOr(S.String),
  first_timestamp: S.String,
  last_timestamp: S.String,
  team_id: S.optional(S.NullOr(S.String)),
  team_slug: S.optional(S.NullOr(S.String)),
  team_name: S.optional(S.NullOr(S.String)),
  team_side: S.optional(S.NullOr(TeamRequestSide)),
});
export type TFailedRequestGroup = S.Schema.Type<typeof FailedRequestGroup>;

export const FailedRequestsResponse = S.Struct({
  groups: S.Array(FailedRequestGroup),
  pagination: GroupedRequestsPagination,
});
export type TFailedRequestsResponse = S.Schema.Type<
  typeof FailedRequestsResponse
>;

/**
 * Acknowledgement for `DELETE /api/stats/requests` — drops every row
 * inside one (model, endpoint, time window) group for the authed user.
 * The overview table calls this when the user clicks the trash icon
 * on a group row.
 */
export const DeleteRequestGroupResponse = S.Struct({
  ok: S.Boolean,
  deleted: S.Number,
});
export type TDeleteRequestGroupResponse = S.Schema.Type<
  typeof DeleteRequestGroupResponse
>;

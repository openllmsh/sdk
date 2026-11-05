import { Schema as S } from "effect";
import { OpaqueId } from "./doctor-report";
import { ModelSettingsOverrides } from "./model-settings";
import { DefaultTier, ExtendedModel } from "./models";

/**
 * Wire format a custom-API endpoint speaks. Reuses the same two
 * canonical formats the registry tracks today; the proxy dispatches
 * through `openaiProvider` or `anthropicProvider` accordingly.
 *
 * Used ONLY for the one-shot `/v1/models` discovery probe — the
 * credential blob no longer stores it and the per-user catalog no
 * longer attaches it to entries (wire format is now derived per
 * MODEL via `CustomApiModelKind` below).
 *
 * Defined here (not in `./credentials`) to keep the dependency
 * direction one-way (`credentials.ts` may depend on `./config`).
 */
export const CustomApiWireFormat = S.Literals(["openai", "anthropic"]);
export type TCustomApiWireFormat = S.Schema.Type<typeof CustomApiWireFormat>;

/**
 * Per-model surface + wire choice. One endpoint can serve a mix of
 * chat / embeddings / image models, and chat models can speak either
 * the OpenAI or the Anthropic wire — packed into one tagged value
 * the dashboard collects via a single per-row select.
 *
 * - `chat_openai`    /v1/chat/completions, OpenAI canonical wire
 * - `chat_anthropic` /v1/messages or canonical chat, Anthropic wire
 * - `embeddings`     /v1/embeddings, OpenAI wire (the only embeddings
 *                    surface upstream specs implement)
 * - `image_openai`   /v1/images/generations, OpenAI-compatible image
 *                    gen — what aggregating gateways (LiteLLM,
 *                    openllm itself, OpenRouter, …) expose,
 *                    regardless of the underlying model.
 *
 * Native Google AI Studio (`generateContent`) is intentionally
 * absent: its model list is at `/v1beta/models` with a different
 * envelope shape than the OpenAI-style `/v1/models` our discovery
 * probe expects, so it cannot be reached via the discover-then-pick
 * flow. Use the built-in `google/*` catalog entries on the API-keys
 * tab when you want direct Google AI Studio access.
 */
export const CustomApiModelKind = S.Literals([
  "chat_openai",
  "chat_anthropic",
  "embeddings",
  "image_openai",
]);
export type TCustomApiModelKind = S.Schema.Type<typeof CustomApiModelKind>;

export const FallbackGroup = S.Struct({
  name: S.String,
  models: S.Array(S.String),
});
export type TFallbackGroup = S.Schema.Type<typeof FallbackGroup>;

/** LiteLLM-style `[trigger, alternateModels]` rows (`*` = default alternates). */
export const ModelFallbackBinding = S.Tuple([S.String, S.Array(S.String)]);
export type TModelFallbackBinding = S.Schema.Type<typeof ModelFallbackBinding>;

/**
 * The dashboard's `/v1/models` probe returns upstream ids plus any reported
 * token limits. The user picks which rows to enable and assigns a `kind`; we
 * deliberately do not auto-include a gateway's entire catalogue.
 */
/** Canonical input/output limits reported by compatible model lists. */
export const CustomApiModelLimits = S.Struct({
  /** Prompt/context budget, normalized from any upstream alias. */
  max_input_tokens: S.optional(S.Number),
  /** Completion ceiling when the upstream reports one. */
  max_output_tokens: S.optional(S.Number),
});

/** One model returned by the transient custom-endpoint discovery probe. */
export const CustomApiDiscoveredModel = S.Struct({
  id: S.String,
  ...CustomApiModelLimits.fields,
});
export type TCustomApiDiscoveredModel = S.Schema.Type<
  typeof CustomApiDiscoveredModel
>;

export const CustomApiCatalogModel = S.Struct({
  id: S.String,
  kind: CustomApiModelKind,
  ...CustomApiModelLimits.fields,
});
export type TCustomApiCatalogModel = S.Schema.Type<
  typeof CustomApiCatalogModel
>;

/**
 * Per-user catalog entry for a custom OpenAI/Anthropic-compatible
 * endpoint the user has registered on the `/providers` page. The
 * SECRET half (base URL + api key) lives encrypted in
 * `public.credentials` under provider slug `custom:<name>` — only
 * the opt-in model list (id, kind, and discovered token limits) is stored here
 * so the dashboard can populate fallback dropdowns without unlocking the vault.
 */
export const CustomApiCatalogEntry = S.Struct({
  name: S.String,
  models: S.Array(CustomApiCatalogModel),
});
export type TCustomApiCatalogEntry = S.Schema.Type<
  typeof CustomApiCatalogEntry
>;

/**
 * One subscription the user has told us they pay for. `plan` is a plan id
 * from the app's per-provider plan catalog, or `custom` — the escape hatch
 * for regional pricing / seats / a plan we don't list, where `monthly_usd`
 * carries the amount the user typed.
 */
export const SubscriptionPlanSelection = S.Struct({
  provider: S.String,
  plan: S.String,
  monthly_usd: S.optional(S.Number),
});
export type TSubscriptionPlanSelection = S.Schema.Type<
  typeof SubscriptionPlanSelection
>;

export const ContextOverflowStrategy = S.Literals([
  "hop_to_larger_context",
  "compact_in_place",
]);
export type TContextOverflowStrategy = S.Schema.Type<
  typeof ContextOverflowStrategy
>;

/** The thresholds a usage alert can be set to, in percent of the budget. */
export const UsageAlertThresholdPct = S.Literals([50, 80, 90]);
export type TUsageAlertThresholdPct = S.Schema.Type<
  typeof UsageAlertThresholdPct
>;
export const USAGE_ALERT_DEFAULT_THRESHOLD_PCT: TUsageAlertThresholdPct = 80;

export const ExtraConfig = S.Struct({
  model_settings: S.optional(ModelSettingsOverrides),
  search_provider: S.optional(S.String),
  context_overflow_strategy: S.optional(ContextOverflowStrategy),
  custom_apis: S.optional(S.Array(CustomApiCatalogEntry)),
  notification_prefs: S.optional(
    S.Struct({
      auth_loss_email: S.optional(S.Boolean),
      quota_email: S.optional(S.Boolean),
      daemon_idle_email: S.optional(S.Boolean),
      /** Onboarding tips and Pro trial nudges (lifecycle cron). */
      lifecycle_email: S.optional(S.Boolean),
      /**
       * Free-plan usage alerts: one mail at `usage_alert_threshold_pct` of the
       * monthly token budget and one when it is spent.
       */
      usage_alert_email: S.optional(S.Boolean),
      /** One mail three days before a key, device or app connection's
       *  access expires (`policy.expires_at`). */
      key_expiry_email: S.optional(S.Boolean),
    }),
  ),
  /** Percent of the Free plan's monthly tokens that triggers the first usage
   *  alert. Absent = {@link USAGE_ALERT_DEFAULT_THRESHOLD_PCT}. */
  usage_alert_threshold_pct: S.optional(UsageAlertThresholdPct),
  /**
   * Subscription-OAuth providers (`claude_code` / `chatgpt` / `kimi_code`)
   * the user has connected via SOME local daemon. These have no cloud
   * credential row — the daemon holds the credential — so this per-user
   * marker is how `/v1/models` knows to LIST their models, making them
   * configurable (fallback chains, prefs) from ANY machine. Live
   * runnability is gated separately per-machine on daemon reachability
   * (the dashboard shows "reconfigure on this machine" when the local
   * daemon isn't connected). Set on connect; never auto-removed.
   */
  subscription_providers: S.optional(S.Array(S.String)),
  /**
   * Per-provider model picks for {@link MODEL_SELECTABLE_PROVIDERS}
   * (provider → `provider_model_id`s). Absent entry = the curated catalog
   * models only; present = exactly these ids. Listing only — routing an
   * explicit id is unaffected.
   */
  provider_models: S.optional(S.Record(S.String, S.Array(S.String))),
  /**
   * What the user pays each month for the subscriptions above — declared
   * by hand on the overview savings card, one row per connected provider.
   * There is no vendor API that reports a plan tier, so the user picks it
   * (`plan` is a catalog id like `max_5x`, or `custom` when they type the
   * amount). `monthly_usd` is read only for `custom`; catalogued plans
   * resolve their list price from the app's plan catalog so a price change
   * ships as a code change. Drives the savings math: subscription spend is
   * a COST, netted against what the same usage would have cost at metered
   * API rates.
   */
  subscription_plans: S.optional(S.Array(SubscriptionPlanSelection)),
  /**
   * Default tier aliases (`ultra` / `plus` / `lite`) the user explicitly
   * DELETED from the chains editor. Derivation of virtual default chains
   * skips these — without the marker, a deleted derived chain would
   * silently reappear on the next load. Removing the marker (re-adding
   * the alias via the editor) reverts it to auto-derived.
   */
  disabled_default_aliases: S.optional(S.Array(DefaultTier)),
  /**
   * Opts the account out of contributing to the public aggregate usage index.
   * Omitted means opted in.
   */
  public_usage_index_opt_out: S.optional(S.Boolean),
  /**
   * Account preference for daemon diagnostic reports. Omission defaults enabled
   * after current cookie consent. Preserve on full-config writes; mutate only via the
   * narrow `/api/user/daemon-diagnostics` contract.
   */
  daemon_diagnostics_opt_in: S.optional(S.Boolean),
  /**
   * Opaque policy epoch (UUID/hex). Minted on opt-in/opt-out and cookie-consent
   * changes so a later enablement is a new reporting window. Full-config writes
   * must preserve it.
   */
  daemon_diagnostics_policy_generation: S.optional(OpaqueId),
});
export type TExtraConfig = S.Schema.Type<typeof ExtraConfig>;

export const UserConfig = S.Struct({
  fallback_groups: S.Array(FallbackGroup),
  model_fallback_bindings: S.optional(S.Array(ModelFallbackBinding)),
  extra: ExtraConfig,
});
export type TUserConfig = S.Schema.Type<typeof UserConfig>;

export const RequiredProviderTerm = S.Struct({
  provider: S.String,
  url: S.String,
  version: S.String,
  display_name: S.String,
});
export type TRequiredProviderTerm = S.Schema.Type<typeof RequiredProviderTerm>;

/**
 * Admin-managed automatic chains, per tier, in the order they are tried.
 * A tier that is absent (or empty) falls back to the catalog's
 * `default_tiers` derivation. Each user still only gets the models whose
 * provider they have connected.
 */
export const DefaultTierChains = S.Struct({
  ultra: S.optional(S.Array(S.String)),
  plus: S.optional(S.Array(S.String)),
  lite: S.optional(S.Array(S.String)),
});
export type TDefaultTierChains = S.Schema.Type<typeof DefaultTierChains>;

export const GlobalConfig = S.Struct({
  terms_version: S.String,
  terms_url: S.String,
  privacy_url: S.String,
  required_provider_terms: S.Array(RequiredProviderTerm),
  default_aliases: S.Record(S.String, S.String),
  model_catalog: S.Array(ExtendedModel),
  search_provider: S.String,
  plugin_allow_list: S.Array(S.String),
  default_tier_chains: S.optional(DefaultTierChains),
});
export type TGlobalConfig = S.Schema.Type<typeof GlobalConfig>;

// All stored credentials are API-key (BYOK); subscription OAuth lives on
// the local daemon, never the DB — so there's no kind/expiry/refresh here.
export const ProviderCredential = S.Struct({
  provider: S.String,
  has_credential: S.Boolean,
});
export type TProviderCredential = S.Schema.Type<typeof ProviderCredential>;

/**
 * Body of `PATCH /api/config/user`: only what the caller changed.
 *
 * Omitted fields keep their stored value; an explicit `null` removes an
 * optional field. `extra` is keyed loosely here because each field's
 * schema already lives on {@link ExtraConfig}: the merged result is decoded
 * as a whole {@link UserConfig}, so an unknown key or a bad value still
 * fails the write.
 */
export const UserConfigPatch = S.Struct({
  fallback_groups: S.optional(S.Array(FallbackGroup)),
  model_fallback_bindings: S.optional(S.NullOr(S.Array(ModelFallbackBinding))),
  extra: S.optional(S.Record(S.String, S.Unknown)),
});
export type TUserConfigPatch = S.Schema.Type<typeof UserConfigPatch>;

const decodeUserConfig = S.decodeUnknownSync(UserConfig);

const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** Merge a patch onto the stored config; throws when the result is invalid. */
export const applyUserConfigPatch = (
  stored: TUserConfig,
  patch: TUserConfigPatch,
): TUserConfig => {
  const extra: Record<string, unknown> = { ...stored.extra };
  for (const [key, value] of Object.entries(patch.extra ?? {})) {
    if (value === null) delete extra[key];
    else extra[key] = value;
  }
  const merged: Record<string, unknown> = {
    ...stored,
    ...(patch.fallback_groups !== undefined
      ? { fallback_groups: patch.fallback_groups }
      : {}),
    extra,
  };
  if (patch.model_fallback_bindings === null) {
    delete merged.model_fallback_bindings;
  } else if (patch.model_fallback_bindings !== undefined) {
    merged.model_fallback_bindings = patch.model_fallback_bindings;
  }
  return decodeUserConfig(merged);
};

/**
 * The patch that turns `base` into `next`: changed fields only, removed
 * optional fields as `null`. Callers edit a full config view and send this,
 * so a stale page never overwrites fields it didn't touch.
 */
export const diffUserConfig = (
  base: TUserConfig,
  next: TUserConfig,
): TUserConfigPatch => {
  const extra: Record<string, unknown> = {};
  const keys = new Set([
    ...Object.keys(base.extra),
    ...Object.keys(next.extra),
  ]);
  for (const key of keys) {
    const before = (base.extra as Record<string, unknown>)[key];
    const after = (next.extra as Record<string, unknown>)[key];
    if (sameValue(before, after)) continue;
    extra[key] = after === undefined ? null : after;
  }
  return {
    ...(sameValue(base.fallback_groups, next.fallback_groups)
      ? {}
      : { fallback_groups: next.fallback_groups }),
    ...(sameValue(base.model_fallback_bindings, next.model_fallback_bindings)
      ? {}
      : { model_fallback_bindings: next.model_fallback_bindings ?? null }),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
};

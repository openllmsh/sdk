import { Schema as S } from "effect";
import { LocalProviderVariant } from "./local-provider";
import { OptionalVideoReferences } from "./media-input";
import { ModelSettingDefinitions } from "./model-settings";

export const ModelCapability = S.Literals([
  "chat",
  "embedding",
  "transcription",
  "speech",
  "image_generation",
  "image_editing",
  "video_generation",
  "realtime",
  "vision",
  "tools",
  "json_mode",
  "streaming",
  "reasoning",
]);
export type TModelCapability = S.Schema.Type<typeof ModelCapability>;

/**
 * Capability literals published before image_editing/realtime. Bootstrap
 * payloads sent to older daemons MUST be filtered to this set — a closed
 * `ModelCapability` decoder rejects the entire catalog if it sees an
 * unknown string.
 */
export const BOOTSTRAP_SAFE_MODEL_CAPABILITIES = [
  "chat",
  "embedding",
  "transcription",
  "speech",
  "image_generation",
  "video_generation",
  "vision",
  "tools",
  "json_mode",
  "streaming",
  "reasoning",
] as const satisfies ReadonlyArray<TModelCapability>;

export const isBootstrapSafeModelCapability = (
  capability: string,
): capability is (typeof BOOTSTRAP_SAFE_MODEL_CAPABILITIES)[number] =>
  (BOOTSTRAP_SAFE_MODEL_CAPABILITIES as ReadonlyArray<string>).includes(
    capability,
  );

export const toBootstrapSafeCapabilities = (
  capabilities: ReadonlyArray<string>,
): TModelCapability[] => capabilities.filter(isBootstrapSafeModelCapability);

/**
 * Advertises that the requesting daemon's `DaemonCatalogEntry.capabilities`
 * decoder accepts the OPEN string array (post image_editing/realtime
 * widening) rather than the older closed {@link ModelCapability} literal
 * set. Sent as the value of `DAEMON_BOOTSTRAP_CAPS_HEADER` (see
 * `./daemon`) by a daemon binary compiled after the widening landed. An
 * old compiled daemon never sends this — the bootstrap encoder MUST treat
 * its absence as "closed literal decoder only" and filter via
 * {@link toBootstrapSafeCapabilities}. Never inferred from a package/binary
 * version string, which an unbumped daemon build would leave stale.
 */
export const MODEL_CAPABILITIES_OPEN_CAP = "model-capabilities-open1";

/** Returns whether a negotiated capability list includes {@link MODEL_CAPABILITIES_OPEN_CAP}. */
export const hasOpenModelCapabilitiesCap = (
  caps: readonly string[] | undefined,
): boolean => caps?.includes(MODEL_CAPABILITIES_OPEN_CAP) ?? false;

export const isKnownModelCapability = (
  capability: string,
): capability is TModelCapability =>
  (ModelCapability.literals as ReadonlyArray<string>).includes(capability);

/**
 * Discoverable audio/realtime option metadata. Presence on a catalog
 * card is not a billing claim — subscription media may still consume
 * vendor quota.
 */
export const ModelAudioSupport = S.Struct({
  input_formats: S.optional(S.Array(S.String)),
  output_formats: S.optional(S.Array(S.String)),
  voices: S.optional(S.Array(S.String)),
  /**
   * Verified realtime operations only. Grok currently advertises
   * `text_to_audio`; microphone / interruption legs are omitted until
   * verified.
   */
  realtime_operations: S.optional(S.Array(S.String)),
});
export type TModelAudioSupport = S.Schema.Type<typeof ModelAudioSupport>;

/** Canonical reference fields shared by request schemas. */
export const VideoReferenceInputs = S.Struct({
  input_image: S.optionalKey(
    S.String.check(S.isMinLength(1)).pipe(
      S.annotate({
        description:
          "Starting-frame image as an HTTPS URL or base64 image data URL (for example data:image/png;base64,...). Not subject guidance. MIME is detected from PNG, JPEG, GIF, or WebP bytes; the provider validates its accepted formats.",
      }),
    ),
  ),
  reference_images: OptionalVideoReferences.pipe(
    S.annotate({
      description:
        "Optional ordered subject-reference images as HTTPS URLs or base64 image data URLs. Omit when unused; do not send a dummy empty array. References guide identity/appearance, not the first frame. Every input is preserved; the provider validates format and count limits.",
    }),
  ),
  reference_voices: OptionalVideoReferences.pipe(
    S.annotate({
      description:
        "Optional provider voice IDs for reference guidance. Omit when unused; do not send a dummy empty array.",
    }),
  ),
});

/** Finite receipt vocabulary; not an author-maintained model allowlist. */
export const VideoInputMode = S.Literals([
  "text",
  "starting_image",
  "subject_images",
  "voices",
  "starting_image+subject_images",
  "starting_image+voices",
  "subject_images+voices",
  "starting_image+subject_images+voices",
]);
export type TVideoInputMode = S.Schema.Type<typeof VideoInputMode>;

// Built-in default-chain tiers. When a user has no fallback group with
// one of these names, the gateway derives a virtual chain from catalog
// entries flagged `default_tiers`, filtered to the user's available
// providers — configuration that works out of the gate with no
// onboarding step. Ordered best → cheapest; pickers prefer earlier
// entries.
export const DEFAULT_TIER_ALIASES = ["ultra", "plus", "lite"] as const;

export const DefaultTier = S.Literals([...DEFAULT_TIER_ALIASES]);
export type TDefaultTier = S.Schema.Type<typeof DefaultTier>;

/** Chat tiers plus the one implicit media default class (not a user alias). */
export const MEDIA_DEFAULT_CLASS = "media";
export const DEFAULT_CHAIN_CLASSES = [
  ...DEFAULT_TIER_ALIASES,
  MEDIA_DEFAULT_CLASS,
] as const;
export const DefaultChainClass = S.Literals([...DEFAULT_CHAIN_CLASSES]);
export type TDefaultChainClass = S.Schema.Type<typeof DefaultChainClass>;

/**
 * Canonical classification of a *direct* catalog/live/custom card.
 * `subscription` still consumes vendor quota (oauth variant). `api_key` is
 * BYOK auth — not a claim that usage is metered. `local` is a
 * device-discovered loopback server (cost 0, live-only). Omit on fallback
 * aliases: mixed chains are neither a subscription guarantee nor
 * API-key-only.
 */
export const ModelProviderType = S.Literals([
  "subscription",
  "api_key",
  "local",
]);
export type TModelProviderType = S.Schema.Type<typeof ModelProviderType>;

export const ModelCard = S.Struct({
  id: S.String,
  object: S.Literals(["model"]),
  created: S.Number,
  owned_by: S.String,
});
export type TModelCard = S.Schema.Type<typeof ModelCard>;

export const ModelList = S.Struct({
  object: S.Literals(["list"]),
  data: S.Array(ModelCard),
});
export type TModelList = S.Schema.Type<typeof ModelList>;

// `/v1/models` envelope as openllm actually serves it: an OpenAI-shape
// `ModelCard` carrying the extra metadata the dashboard's selectors
// need (display_name, capability gating). OpenAI/Anthropic SDK clients
// ignore the extra fields and parse only `id` + `object`; the dashboard
// gets a strongly-typed list it can group/filter without a second
// network round-trip against /api/credentials + the global catalog.
export const ExtendedModelCard = S.Struct({
  ...ModelCard.fields,
  provider: S.String,
  provider_model_id: S.String,
  display_name: S.String,
  settings: S.optional(ModelSettingDefinitions),
  capabilities: S.Array(ModelCapability),
  /**
   * Optional audio/realtime support advertised on `/v1/models`. Catalog
   * capability is access, not billing inclusion.
   */
  audio_support: S.optional(ModelAudioSupport),
  // Curated list of dim presets to show in the endpoint picker on
  // `/config`. Catalog-defined so the UI doesn't have to know which
  // values are "interesting" — `text-embedding-3-large` could
  // technically request any dim ≤ 3072, but most users only care
  // about 256 / 1024 / 1536 / 3072.
  dimension_presets: S.optional(S.Array(S.Number)),
  // Token budgets aligned with LiteLLM `model_prices_and_context_window.json`
  // (`max_input_tokens` / `max_output_tokens`). Exposed on `/v1/models` so
  // CLI clients (e.g. Claude Code) can size context before auto-compact.
  max_input_tokens: S.optional(S.Number),
  max_output_tokens: S.optional(S.Number),
  /**
   * Direct-card auth class. Absent on fallback aliases. `api_key` is
   * not necessarily usage-billed.
   */
  provider_type: S.optional(ModelProviderType),
  /**
   * Daemon-only variant when `provider_type` is `subscription` (`oauth`)
   * or `local` (`local`). Absent on API-key cards and mixed aliases.
   */
  provider_variant: S.optional(LocalProviderVariant),
  /**
   * Catalog default-chain membership + rank, so clients can apply the
   * same ordering policy as the server without importing the catalog.
   */
  default_tiers: S.optional(S.Array(DefaultChainClass)),
  tier_rank: S.optional(S.Number),
  /** Prompt/context budget; equals `max_input_tokens` when present. */
  context_window: S.optional(S.Number),
  // llama.cpp/Ollama-style context hint mirrored under `meta.n_ctx`.
  // Some OpenAI-compatible clients read ONLY `meta.n_ctx` for a model's
  // context window during dynamic model discovery (e.g. goose's declarative
  // provider engine), ignoring `context_window`/`max_input_tokens`. Mirror
  // the same value here so those clients get per-model limits with no
  // bespoke provider. Equals `max_input_tokens` when present.
  meta: S.optional(S.Struct({ n_ctx: S.optional(S.Number) })),
});
export type TExtendedModelCard = S.Schema.Type<typeof ExtendedModelCard>;

export const ExtendedModelList = S.Struct({
  object: S.Literals(["list"]),
  data: S.Array(ExtendedModelCard),
});
export type TExtendedModelList = S.Schema.Type<typeof ExtendedModelList>;

export const ModelPricing = S.Struct({
  input_per_million: S.optional(S.Number),
  output_per_million: S.optional(S.Number),
  cache_read_per_million: S.optional(S.Number),
  cache_write_per_million: S.optional(S.Number),
  image_input_per_unit: S.optional(S.Number),
  audio_input_per_minute: S.optional(S.Number),
});
export type TModelPricing = S.Schema.Type<typeof ModelPricing>;

export const PricingEntry = S.Struct({
  ...ModelPricing.fields,
  model_id: S.String,
  provider: S.String,
});
export type TPricingEntry = S.Schema.Type<typeof PricingEntry>;

export const SubscriptionMeter = S.Struct({
  /**
   * Stable provider-namespaced machine id — "claude_code:fable",
   * "chatgpt:codex-spark". Never a display label.
   */
  meter_id: S.String,
  /**
   * Exact vendor-payload identities that resolve to this meter (Claude
   * scope display_name + legacy key; Codex limit_name + metered_feature).
   * Matched exactly, never fuzzy.
   */
  aliases: S.optional(S.Array(S.String)),
});
export type TSubscriptionMeter = S.Schema.Type<typeof SubscriptionMeter>;

/**
 * Per-model / per-family facts an adapter cannot derive from the wire.
 *
 * This is the ONE carrier: it already rides `ExtendedModel.caps` to chat
 * (`TBuildUpstreamRequestInput.caps`, `TResolvedHop.caps`) AND to media
 * (`TResolvedModel.caps`), so adapters consume resolved traits instead
 * of matching model ids themselves. Do not add a parallel structure.
 *
 * EVERY field is optional and absent means UNKNOWN, which must behave as
 * ALLOW/ATTEMPT — never inferred-unsupported. A model we do not
 * recognise (a custom endpoint, a passthrough vendor, something the
 * provider ships tomorrow) is forwarded untouched. Populate only from a
 * vendor's published contract, never from an observed upstream error: a
 * rejection can mean a malformed body rather than a missing capability.
 *
 * Provider-WIDE request domains (enums, integer ranges, array bounds)
 * belong in the shared schema layer, not here. This struct carries only
 * facts that genuinely vary BY MODEL within a provider.
 */
export const ModelCaps = S.Struct({
  deniedParams: S.optional(S.Array(S.String)),
  maxTokensField: S.optional(
    S.Literals(["max_tokens", "max_completion_tokens"]),
  ),
  temperature: S.optional(S.Literals(["only-1", "clamp-0-1", "drop"])),

  // ─── Chat ──────────────────────────────────────────────────────────
  /**
   * Thinking modes this model accepts. Support is non-monotonic within a
   * family (4.5 extended-only → 4.6 both → 4.7+ adaptive-only), so a
   * boolean or a name prefix cannot encode it.
   *
   * `supportsAdaptiveThinking` = includes("adaptive");
   * `rejectsExtendedThinking` = present AND !includes("enabled").
   * Absent/empty stays permissive on BOTH, so an unknown model never
   * manufactures a local validation error the upstream might accept.
   */
  thinkingModes: S.optional(
    S.Array(S.Literals(["enabled", "adaptive", "disabled"])),
  ),

  /**
   * Values this model accepts for the Responses `reasoning.context` knob.
   *
   * The Codex `spark` family 400s on `all_turns` and accepts only `auto` /
   * `current_turn`; every other Codex model REQUIRES `all_turns`. The knob is
   * nested under `reasoning`, so `deniedParams` (which addresses top-level
   * keys) cannot express it — hence a trait of its own.
   *
   * An accepted-VALUE LIST rather than a boolean, matching `thinkingModes` /
   * `videoResolutions`: absent = unknown = PERMISSIVE, so an un-catalogued id
   * keeps the `all_turns` every non-spark Codex model needs and no adapter
   * invents a restriction the upstream might not have.
   */
  reasoningContexts: S.optional(
    S.Array(S.Literals(["auto", "current_turn", "all_turns"])),
  ),

  /**
   * Whether this model accepts a `tool_addition` block inline in an
   * inline system turn (`inline-tools-2026-09-15`, sent by Claude Code when a
   * tool appears mid-session). Not derivable from family or version — measured
   * live by `tests/server/inline-system-capability.e2e.test.ts`. When false the
   * passthrough moves the tool definition into top-level `tools` instead
   * (one cache rebuild per added tool). Absent = unknown = PERMISSIVE: the
   * block is forwarded as the client sent it.
   */
  inlineToolAdditions: S.optional(S.Boolean),

  /**
   * Whether this model accepts a mid-conversation `role: "system"` turn in
   * `messages` natively (Anthropic "mid-conversation system messages"; no
   * beta header). When true the anthropic passthrough forwards those turns
   * untouched, which is what keeps the prompt cache warm: the cache prefix is
   * `tools → system → messages`, so hoisting a NEW inline turn into top-level
   * `system` invalidates every cached message after it (a full-conversation
   * cache rewrite each time Claude Code appends a reminder). Measured live by
   * `tests/server/inline-system-capability.e2e.test.ts`; the API docs list the
   * supporting models. Absent = unknown = HOIST: the inline turns move into
   * top-level `system`, which every Anthropic model accepts — correct but
   * cache-hostile, so mark every model that accepts the inline form.
   */
  inlineSystemMessages: S.optional(S.Boolean),

  // ─── Image ─────────────────────────────────────────────────────────
  /**
   * Whether `response_format` is a real knob on this model's upstream.
   * When false the adapter OMITS the field — this is NOT a refusal: the
   * gateway persists every image and builds `data[]` itself, so the
   * caller's choice is still honoured.
   */
  upstreamAcceptsResponseFormat: S.optional(S.Boolean),
  /**
   * Whether `stream` is a real knob on this model's upstream image request.
   * When false the adapter OMITS the field — NOT a refusal: the gateway wraps
   * the final JSON in one genuine SSE completion event itself, so a streaming
   * caller is still served.
   *
   * DISTINCT from `nativeProgressiveImages`, deliberately. That trait says
   * whether real partial frames exist; this one says whether the request field
   * is accepted at all. A vendor can accept `stream` and answer with a single
   * final frame, and a model can emit partials on a wire that spells the knob
   * differently — so conflating them would either leak an unknown param into a
   * guaranteed 400 or silently stop streaming for a provider that streams.
   */
  upstreamAcceptsStream: S.optional(S.Boolean),
  /** `style` (vivid|natural). False is a genuine pre-dispatch refusal. */
  supportsStyle: S.optional(S.Boolean),
  /** GPT-image output group: output_format, output_compression, moderation, background. */
  supportsGptImageOutputOptions: S.optional(S.Boolean),
  /** Upstream always returns base64, which is what makes omitting `response_format` safe. */
  alwaysReturnsBase64: S.optional(S.Boolean),
  /**
   * Whether the model emits genuinely PROGRESSIVE image bytes upstream.
   *
   * This does NOT gate whether the gateway will stream: the gateway
   * always supports an honest SSE response and emits a single real
   * completion event for a final-only provider. This trait only says
   * whether real partial frames can be forwarded — so a provider that
   * cannot produce them degrades honestly instead of us fabricating
   * partials from a buffered final image.
   */
  nativeProgressiveImages: S.optional(S.Boolean),
  /** Upper bound on genuine partial frames, when the model emits them. */
  maxNativePartialImages: S.optional(S.Number),

  // ─── Native wire / media ───────────────────────────────────────────
  /**
   * Which upstream wire serves this model, when one provider exposes
   * more than one. Lets an adapter refuse a model it structurally
   * cannot carry (a `predict`-family id handed to a `generateContent`
   * adapter) WITHOUT any claim about that model's availability.
   */
  nativeWire: S.optional(S.Literals(["generateContent", "predict"])),
  /**
   * Output resolutions this specific model serves.
   */
  videoResolutions: S.optional(S.Array(S.String)),

  // ─── Media accepted-value sets (catalog-owned FACT DATA) ───────────
  //
  // The provider's own declared domain for a media request: which
  // durations, ratios, tiers and counts it accepts. These are DATA, not
  // code — they drift with a vendor's fleet — so they live on the card
  // (or a provider default) and never as constants in an adapter.
  //
  // Every one is optional and ABSENT MEANS UNKNOWN, never "unsupported":
  // a model with no metadata is forwarded untouched and the provider's
  // own error is the authority. An adapter may only refuse a value when
  // a set is PRESENT and the value is outside it.
  //
  // The request SHAPE (field names, JSON layout, which key carries image
  // bytes) stays in the protocol wire schemas — that is structure, not a
  // per-model fact.

  /** Exact clip lengths accepted, e.g. Veo's [4, 6, 8]. */
  mediaVideoDurationsSeconds: S.optional(S.Array(S.Number)),
  /** Inclusive duration bounds, for a surface that takes a range. */
  mediaVideoDurationRange: S.optional(
    S.Struct({ min: S.Number, max: S.Number }),
  ),
  /**
   * Duration this model REQUIRES when the request carries reference
   * images or a high resolution. Applies only to a duration the caller
   * actually sent: an omitted duration stays omitted so the provider's
   * own default applies.
   */
  mediaVideoDurationWithReferences: S.optional(S.Number),
  /** Accepted output aspect ratios, in the provider's own spelling. */
  mediaVideoAspectRatios: S.optional(S.Array(S.String)),
  /** Upper bound on subject-reference images. */
  mediaVideoMaxReferenceImages: S.optional(S.Number),
  /** Upper bound on voice/audio references. */
  mediaVideoMaxReferenceVoices: S.optional(S.Number),
  /** Reference-type discriminator this surface accepts (e.g. "asset"). */
  mediaVideoReferenceType: S.optional(S.String),
  /** True when a starting frame and subject references are exclusive. */
  mediaVideoStartingImageExclusiveWithReferences: S.optional(S.Boolean),

  /** Accepted image aspect ratios, in the provider's own spelling. */
  mediaImageAspectRatios: S.optional(S.Array(S.String)),
  /** Accepted image resolution tier names, e.g. ["1k", "2k", "1.5k"]. */
  mediaImageResolutions: S.optional(S.Array(S.String)),
  /**
   * Published pixel meaning of a tier, e.g. 1k = ~1024 long edge. Only
   * tiers with a DOCUMENTED size belong here: a tier the vendor names
   * without defining is left out so no caller size maps onto it.
   */
  mediaImageResolutionTiers: S.optional(
    S.Array(S.Struct({ resolution: S.String, longEdge: S.Number })),
  ),
  /** Tier applied when the caller sends no size. */
  mediaImageDefaultResolution: S.optional(S.String),
  /**
   * Canonical `WIDTHxHEIGHT` → provider aspect-ratio map, for a surface
   * that takes a ratio rather than pixels.
   */
  mediaImageSizeAspectRatios: S.optional(S.Record(S.String, S.String)),
  /** Inclusive bounds on the image count per request. */
  mediaImageCountRange: S.optional(S.Struct({ min: S.Number, max: S.Number })),

  // ─── Tokenization ──────────────────────────────────────────────────
  /**
   * Which ruler counts this model's tokens. One model fact that is
   * currently re-derived three different ways — by client surface
   * (`canonical/encoding-select`), by upstream wire (the daemon walker),
   * and by `provider === "anthropic"` (`handlers/count-tokens`). That
   * last one misses subscription twins: a `claude_code/*` hop is a
   * Claude model with provider `claude_code`, so it is counted with
   * o200k against a Claude ruler.
   *
   * Absent keeps each consumer's existing default, so adopting this is
   * incremental and never changes a count until a card declares one.
   */
  tokenizer: S.optional(S.Literals(["claude", "o200k"])),
});
export type TModelCaps = S.Schema.Type<typeof ModelCaps>;

/**
 * A catalog-owned DEFAULT for models that have no card.
 *
 * The un-catalogued set is open-ended — every dated snapshot, every id a
 * user pins, everything a vendor ships next — so it cannot be covered by
 * cards without becoming the exhaustive allowlist we deliberately do not
 * keep. These rules close that gap without one: the catalog owns the
 * DATA (which family, which caps) and every consumer runs the same
 * generic matcher, so no adapter matches a model id itself.
 *
 * `pattern` is a regular-expression SOURCE matched case-insensitively
 * against the bare `provider_model_id`. Rules are consulted in order and
 * the FIRST match wins; a card, when one exists, always outranks them.
 * Absent/no-match stays UNKNOWN, preserving default-allow.
 */
export const ModelCapsDefaultRule = S.Struct({
  provider: S.String,
  pattern: S.String,
  caps: ModelCaps,
});
export type TModelCapsDefaultRule = S.Schema.Type<typeof ModelCapsDefaultRule>;

/**
 * Resolve family defaults for an un-catalogued `provider/model`.
 *
 * Pure and total: an invalid pattern is skipped rather than thrown, so a
 * bad rule can never take down resolution for every model. Shared by the
 * cloud resolver and the daemon walker so the two cannot drift.
 */
export const resolveDefaultModelCaps = (
  rules: ReadonlyArray<TModelCapsDefaultRule>,
  provider: string,
  providerModelId: string,
): TModelCaps | undefined => {
  for (const rule of rules) {
    if (rule.provider !== provider) continue;
    let re: RegExp;
    try {
      re = new RegExp(rule.pattern, "i");
    } catch {
      continue;
    }
    if (re.test(providerModelId)) return rule.caps;
  }
  return undefined;
};

/**
 * Fold a LIVE OBSERVATION into authored caps.
 *
 * Some facts are only knowable from a vendor's own live model list (an
 * xAI row that omits `supports_reasoning_effort`). They are expressed in
 * this same vocabulary so a consumer never learns a second policy shape,
 * and they may only NARROW: `deniedParams` is a union (deduped, authored
 * order first), so an observation can add a denial and can never clear
 * one the catalog authored. Every other field takes the observation only
 * where the authored caps said nothing.
 *
 * Pure, and the caller re-derives it per request — an observation is a
 * snapshot, never accumulated state.
 */
export const mergeObservedModelCaps = (
  authored: TModelCaps | undefined,
  observed: TModelCaps | null | undefined,
): TModelCaps | undefined => {
  if (observed === null || observed === undefined) return authored;
  if (authored === undefined) return observed;
  const denied =
    authored.deniedParams === undefined && observed.deniedParams === undefined
      ? undefined
      : [
          ...new Set([
            ...(authored.deniedParams ?? []),
            ...(observed.deniedParams ?? []),
          ]),
        ];
  return {
    ...observed,
    ...authored,
    ...(denied === undefined ? {} : { deniedParams: denied }),
  };
};

/**
 * Per-plan-tier monthly allowance for a model OpenLLM serves on its own key,
 * as ONE budget in input-token units. Output and cache-read tokens are
 * weighted by their price relative to fresh input — read from the model's
 * `api_equivalent_pricing` by {@link includedWeights}, never authored
 * separately — so the budget tracks what the tokens actually cost. Any
 * input/output mix fits: all-input gets the full budget, all-output gets
 * `budget / output weight`; output-heavy use can't beat the price ratio and
 * input-heavy use is never cut early by an unused output cap.
 * Tier keys mirror the billing tiers (`free` / `trial` / `pro`).
 */
export const IncludedUsage = S.Struct({
  free: S.Int.check(S.isGreaterThanOrEqualTo(0)),
  trial: S.Int.check(S.isGreaterThanOrEqualTo(0)),
  pro: S.Int.check(S.isGreaterThanOrEqualTo(0)),
});
export type TIncludedUsage = S.Schema.Type<typeof IncludedUsage>;

/** Cost of one output / cache-read token, in fresh-input-token units. */
export type TIncludedWeights = {
  readonly output: number;
  readonly cacheRead: number;
};

/**
 * Weights from a price sheet: `output_per_million / input_per_million` and
 * `cache_read_per_million / input_per_million`. A missing price — or no
 * positive input price to divide by — weighs 1 (charged like fresh input),
 * which never under-charges.
 */
export const includedWeights = (
  pricing: TModelPricing | undefined,
): TIncludedWeights => {
  const input = pricing?.input_per_million;
  const ratio = (price: number | undefined): number =>
    input === undefined || input <= 0 || price === undefined
      ? 1
      : price / input;
  return {
    output: ratio(pricing?.output_per_million),
    cacheRead: ratio(pricing?.cache_read_per_million),
  };
};

/** Token counts one spend is computed from. */
export type TIncludedSpendTokens = {
  /** Fresh (uncached) input tokens. */
  readonly input: number;
  readonly cachedInput: number;
  readonly output: number;
};

/** Budget units spent, each token class at its price-derived weight. */
export const includedSpend = (
  pricing: TModelPricing | undefined,
  tokens: TIncludedSpendTokens,
): number => {
  const w = includedWeights(pricing);
  return (
    tokens.input + tokens.cachedInput * w.cacheRead + tokens.output * w.output
  );
};

export const ExtendedModel = S.Struct({
  settings: S.optional(ModelSettingDefinitions),
  id: S.String,
  provider: S.String,
  provider_model_id: S.String,
  display_name: S.String,
  capabilities: S.Array(ModelCapability),
  /** @deprecated Prefer `max_input_tokens`; kept for older dashboard reads. */
  context_window: S.optional(S.Number),
  max_input_tokens: S.optional(S.Number),
  max_output_tokens: S.optional(S.Number),
  caps: S.optional(ModelCaps),
  /**
   * Catalog-internal: optional alternate input budgets a model can be
   * configured to use (e.g. Codex dual-window Sol/Astra at 272k / 1.05M).
   * Own list wins; absent inherits from the appropriate same-family donor;
   * explicit `[]` blocks inheritance. Not a live observation and not part of
   * the public `/v1/models` card — the card projects the effective window.
   */
  alternative_input_limits: S.optional(
    S.Array(S.Int.check(S.isGreaterThan(0))),
  ),
  /**
   * Codex v2 multi-agent models (gpt-5.6 sol/terra) emit a hierarchical
   * subagent-spawn shape that Claude Code materializes into isolated git
   * worktrees and loops. When true, the core `strip-subagent-isolation`
   * feature removes the `isolation`/`cwd` args from Task/Agent tool calls in
   * the response. Catalog-owned; not part of the public `/v1/models` card.
   */
  strip_subagent_isolation: S.optional(S.Boolean),
  pricing: S.optional(ModelPricing),
  /**
   * Subscription models only: what the same tokens would cost at
   * metered API pricing. Distinct from `pricing` — subscription usage
   * bills $0 per token (flat vendor subscription), so `pricing` stays
   * unset while this field feeds the overview savings computation.
   * Derived from the metered sibling's `pricing` where one exists
   * (see `subscriptionTwin` in the api catalog).
   */
  api_equivalent_pricing: S.optional(ModelPricing),
  /**
   * Subscription models only: the vendor usage meter this model draws on
   * beyond the shared plan windows, so routing can skip a model whose own
   * pool is exhausted while the shared window is open (Fable, Codex Spark).
   * Omitted for models metered only by the shared window.
   */
  subscription_meter: S.optional(SubscriptionMeter),
  /**
   * Host-paid included models only: the monthly token allowance each plan
   * tier gets on OpenLLM's own key. Catalog-owned so a limit change ships
   * with a catalog update. An included model TRAILS every default chain it
   * belongs to (see `compareDefaultChainMembers`): the user's own
   * subscriptions, local servers and keys answer first.
   */
  included_usage: S.optional(IncludedUsage),
  deprecated: S.optional(S.Boolean),
  // Embedding-only metadata — see ExtendedModelCard for semantics.
  dimension_presets: S.optional(S.Array(S.Number)),
  audio_support: S.optional(ModelAudioSupport),
  // Membership in derived default chains (`DEFAULT_CHAIN_CLASSES`).
  // Chat uses ultra/plus/lite; media uses the single `media` class.
  // ARRAY ORDER is priority — index 0 is primary. `tier_rank` breaks
  // ties (lower = tried first), not catalog array order.
  default_tiers: S.optional(S.Array(DefaultChainClass)),
  tier_rank: S.optional(S.Number),
  /**
   * Auth class of this catalog/live entry. Subscription twins must set
   * `subscription` even if derived from an API-key sibling. Omitted on
   * mixed aliases.
   */
  provider_type: S.optional(ModelProviderType),
  /**
   * Daemon-only variant when `provider_type` is `subscription` (`oauth`)
   * or `local` (`local`). Absent on API-key cards and mixed aliases.
   */
  provider_variant: S.optional(LocalProviderVariant),
});
export type TExtendedModel = S.Schema.Type<typeof ExtendedModel>;

export const AliasMap = S.Record(S.String, S.String);
export type TAliasMap = S.Schema.Type<typeof AliasMap>;

// One model as reported by a provider's own list endpoint (e.g. OpenAI
// `GET /v1/models`, Moonshot `GET /coding/v1/models`). Deliberately
// minimal — only what upstreams actually report. Everything else
// (capabilities, tier chains, pricing, limits) stays catalog-owned and
// is hybrid-merged at read time (docs/proposals/live-provider-model-catalog.md).
// String/array bounds are defense-in-depth on the authenticated write
// paths (`POST /api/daemon/models`, the cloud refresher) so a
// misbehaving upstream or client can't bloat `model_cache` payloads:
// id cap matches the proxy's `MAX_MODEL_ID_LENGTH` (128); the largest
// real list observed is OpenAI's at ~122 entries.
export const ProviderModelEntry = S.Struct({
  /** Upstream model id, e.g. `gpt-5.2` — NOT the catalog `provider/model` id. */
  provider_model_id: S.String.check(S.isMinLength(1), S.isMaxLength(128)),
  display_name: S.optional(S.String.check(S.isMaxLength(256))),
  created: S.optional(S.Number),
  context_window: S.optional(S.Number),
  /**
   * Vendor-reported completion (output) ceiling for this model, when the
   * provider's own list endpoint exposes one. Mirrors `context_window`'s
   * role for the input side — optional because most list endpoints only
   * report the input/context budget. A writer that never populates this
   * field leaves request output-cap backfill fail-open. Static catalog limits
   * remain display/config metadata only.
   */
  max_output_tokens: S.optional(S.Number),
});
export type TProviderModelEntry = S.Schema.Type<typeof ProviderModelEntry>;

// Payload of one `model_cache` row: the live model list one writer
// (daemon for subscription providers, cloud for API-key providers)
// observed for a single provider.
export const ProviderModelList = S.Array(ProviderModelEntry).check(
  S.makeFilter(
    (models: ReadonlyArray<TProviderModelEntry>): boolean =>
      models.length <= 1000,
    { message: "must contain at most 1000 entries" },
  ),
);
export type TProviderModelList = S.Schema.Type<typeof ProviderModelList>;

/**
 * Bound on any model-list fetch against a provider's own list endpoint
 * — shared by the cloud refresher (`packages/api`) and the daemon
 * delegates (`packages/cli/daemon`), which can't import each other, so the
 * constant lives on the wire package both depend on.
 */
export const MODEL_LIST_FETCH_TIMEOUT_MS = 10_000;

import { Schema as S } from "effect";

export const ServiceTier = S.Literals(["auto", "default", "flex", "priority"]);
export type TServiceTier = S.Schema.Type<typeof ServiceTier>;

/** Positive token-count budget (user pin or catalog alternative). */
export const InputTokenLimit = S.Int.check(S.isGreaterThan(0));
export type TInputTokenLimit = S.Schema.Type<typeof InputTokenLimit>;

/**
 * Reasoning-effort floor a user can pin per model. A request asking for less
 * (or omitting effort) is raised to it; a request asking for more keeps its
 * own. Exists because clients pick effort for the model they THINK they talk
 * to (Claude Code sends `low` for an unrecognised alias), which can starve a
 * model that quits early at low effort.
 */
export const MinReasoningEffort = S.Literals([
  "low",
  "medium",
  "high",
  "xhigh",
]);
export type TMinReasoningEffort = S.Schema.Type<typeof MinReasoningEffort>;

/** Ascending effort order used to compare a request against the floor. */
const EFFORT_RANK: Readonly<Record<string, number>> = {
  none: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  max: 6,
};

/**
 * Raise `effort` to `floor`. `undefined` effort (provider default) is raised
 * too; an explicit `none` is the caller turning reasoning off and is kept.
 */
export const applyReasoningEffortFloor = <TEffort extends string>(
  effort: TEffort | undefined,
  floor: TMinReasoningEffort | undefined,
): TEffort | TMinReasoningEffort | undefined => {
  if (floor === undefined || effort === "none") return effort;
  if (effort === undefined) return floor;
  return (EFFORT_RANK[effort] ?? 0) < (EFFORT_RANK[floor] ?? 0)
    ? floor
    : effort;
};

/** Sparse user overrides. Add named, schema-checked settings here as they ship. */
export const ModelSettings = S.Struct({
  service_tier: S.optional(ServiceTier),
  /**
   * Exact selected input budget. Absence means "Provider default" (latest
   * provider report, else authored/inherited fallback) — never a snapshot
   * written into config.
   */
  input_token_limit: S.optional(InputTokenLimit),
  min_reasoning_effort: S.optional(MinReasoningEffort),
});
export type TModelSettings = S.Schema.Type<typeof ModelSettings>;

export const ModelSettingsOverrides = S.Record(S.String, ModelSettings);
export type TModelSettingsOverrides = S.Schema.Type<
  typeof ModelSettingsOverrides
>;

export const ServiceTierSetting = S.Struct({
  label: S.String,
  description: S.String,
  options: S.Array(S.Struct({ value: ServiceTier, label: S.String })),
  default: S.optional(ServiceTier),
  /** Catalog opt-in: matched same-provider successor models may borrow this control. */
  inherit_to_successors: S.optional(S.Boolean),
});

export const InputTokenLimitSetting = S.Struct({
  label: S.String,
  description: S.String,
  options: S.Array(S.Struct({ value: InputTokenLimit, label: S.String })),
  /**
   * Latest provider-reported window for UI "Provider default" labelling
   * only — never a pin option and never written into config.
   */
  reported: S.optional(InputTokenLimit),
});

export const MinReasoningEffortSetting = S.Struct({
  label: S.String,
  description: S.String,
  options: S.Array(S.Struct({ value: MinReasoningEffort, label: S.String })),
});

/** Catalog-owned controls and defaults, shared by discovery, UI and dispatch. */
export const ModelSettingDefinitions = S.Struct({
  service_tier: S.optional(ServiceTierSetting),
  input_token_limit: S.optional(InputTokenLimitSetting),
  min_reasoning_effort: S.optional(MinReasoningEffortSetting),
});
export type TModelSettingDefinitions = S.Schema.Type<
  typeof ModelSettingDefinitions
>;

const isSupportedServiceTier = (
  setting: TModelSettingDefinitions["service_tier"],
  value: TServiceTier | undefined,
): value is TServiceTier =>
  value !== undefined &&
  setting?.options.some((option) => option.value === value) === true;

const isSupportedInputTokenLimit = (
  setting: TModelSettingDefinitions["input_token_limit"],
  value: number | undefined,
): value is number =>
  value !== undefined &&
  setting?.options.some((option) => option.value === value) === true;

export const resolveModelSettings = (
  definitions: TModelSettingDefinitions | undefined,
  overrides: TModelSettings | undefined,
): TModelSettings => {
  const resolved: {
    -readonly [K in keyof TModelSettings]: TModelSettings[K];
  } = {};

  const tierSetting = definitions?.service_tier;
  if (tierSetting !== undefined) {
    const override = overrides?.service_tier;
    const value = isSupportedServiceTier(tierSetting, override)
      ? override
      : tierSetting.default;
    if (isSupportedServiceTier(tierSetting, value)) {
      resolved.service_tier = value;
    }
  }

  const limitSetting = definitions?.input_token_limit;
  if (limitSetting !== undefined) {
    const override = overrides?.input_token_limit;
    if (isSupportedInputTokenLimit(limitSetting, override)) {
      resolved.input_token_limit = override;
    }
  }

  const effortSetting = definitions?.min_reasoning_effort;
  const effortOverride = overrides?.min_reasoning_effort;
  if (
    effortSetting !== undefined &&
    effortOverride !== undefined &&
    effortSetting.options.some((option) => option.value === effortOverride)
  ) {
    resolved.min_reasoning_effort = effortOverride;
  }

  return resolved;
};

export const updateModelSettings = (
  overrides: TModelSettingsOverrides | undefined,
  modelId: string,
  patch: {
    readonly service_tier?: TServiceTier | undefined;
    readonly input_token_limit?: number | undefined;
    readonly clearServiceTier?: boolean;
    readonly clearInputTokenLimit?: boolean;
    readonly min_reasoning_effort?: TMinReasoningEffort | undefined;
    readonly clearMinReasoningEffort?: boolean;
  },
): TModelSettingsOverrides => {
  const next = { ...overrides };
  const previous = next[modelId] ?? {};
  const updated: {
    -readonly [K in keyof TModelSettings]: TModelSettings[K];
  } = { ...previous };

  if (patch.clearServiceTier === true) {
    delete updated.service_tier;
  } else if (patch.service_tier !== undefined) {
    updated.service_tier = patch.service_tier;
  }

  if (patch.clearInputTokenLimit === true) {
    delete updated.input_token_limit;
  } else if (patch.input_token_limit !== undefined) {
    updated.input_token_limit = patch.input_token_limit;
  }

  if (patch.clearMinReasoningEffort === true) {
    delete updated.min_reasoning_effort;
  } else if (patch.min_reasoning_effort !== undefined) {
    updated.min_reasoning_effort = patch.min_reasoning_effort;
  }

  if (Object.keys(updated).length > 0) {
    next[modelId] = updated;
  } else {
    delete next[modelId];
  }
  return next;
};

/** Codex config calls this "fast"; its request/app-server tier is "priority". */
export const codexServiceTier = (value: unknown): string | null => {
  if (value === "fast" || value === "priority") return "priority";
  if (value === "flex") return "flex";
  return null;
};

/**
 * Pure precedence for the gateway/native input budget.
 *
 * 1. exact valid user pin (supported by the model's current options)
 * 2. latest provider report
 * 3. authored/inherited fallback
 *
 * Never min/max a valid pin with discovery. Stale pins fall through.
 */
export const resolveEffectiveInputTokenLimit = (params: {
  readonly userLimit?: number | undefined;
  readonly reportedLimit?: number | null | undefined;
  readonly fallbackLimit?: number | null | undefined;
  readonly supportedLimits?: ReadonlyArray<number> | undefined;
}): number | null => {
  const supported = params.supportedLimits;
  if (
    params.userLimit !== undefined &&
    (supported === undefined || supported.includes(params.userLimit))
  ) {
    return params.userLimit;
  }
  if (params.reportedLimit != null) return params.reportedLimit;
  if (params.fallbackLimit != null) return params.fallbackLimit;
  return null;
};

/** Deduplicate positive token counts while preserving first-seen order. */
export const dedupeTokenLimits = (
  values: ReadonlyArray<number | null | undefined>,
): ReadonlyArray<number> => {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const value of values) {
    if (value == null || !Number.isInteger(value) || value <= 0) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
};

export const formatTokenLimitLabel = (value: number): string => {
  if (value >= 1_000_000 && value % 1_000 === 0) {
    return `${value / 1_000_000}M tokens`;
  }
  if (value >= 1_000 && value % 1_000 === 0) {
    const thousands = value / 1_000;
    return Number.isInteger(thousands)
      ? `${thousands}K tokens`
      : `${value.toLocaleString("en-US")} tokens`;
  }
  return `${value.toLocaleString("en-US")} tokens`;
};

/**
 * Synthesize the context-window control from authored alternatives only.
 * Transient provider reports are observation for the Provider-default label,
 * never pin options (a 275k report must not become a sticky invalid pin after
 * the next report drifts). Definitions are never inherited as part of the
 * `settings` bag (service tiers stay entitlement-gated).
 */
export const synthesizeInputTokenLimitSetting = (params: {
  readonly alternativeInputLimits?: ReadonlyArray<number> | undefined;
  readonly reportedLimit?: number | null | undefined;
}): TModelSettingDefinitions["input_token_limit"] | undefined => {
  // Authored/inherited alternatives are what make the control exist. A bare
  // provider report without alternatives is observation only — not a setting.
  // Explicit `[]` is "own empty list" and yields no control (and blocks
  // inheritance upstream).
  if (
    params.alternativeInputLimits === undefined ||
    params.alternativeInputLimits.length === 0
  ) {
    return undefined;
  }
  const options = dedupeTokenLimits([...params.alternativeInputLimits]).map(
    (value) => ({
      value,
      label: formatTokenLimitLabel(value),
    }),
  );
  if (options.length === 0) return undefined;
  const reported =
    params.reportedLimit != null &&
    Number.isInteger(params.reportedLimit) &&
    params.reportedLimit > 0
      ? params.reportedLimit
      : undefined;
  return {
    label: "Context window",
    description:
      "Sets the gateway/native context budget and overflow threshold for this model. It is not a provider wire parameter or a capacity upgrade. Provider default follows the latest reported window.",
    options,
    ...(reported !== undefined ? { reported } : {}),
  };
};

const MIN_REASONING_EFFORT_SETTING: TModelSettingDefinitions["min_reasoning_effort"] =
  {
    label: "Minimum effort",
    description:
      "Default uses whatever effort the caller requested. Pick a level to raise lower requests to it; a request asking for more keeps its own, and one turning reasoning off is left alone.",
    options: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "xhigh", label: "Extra high" },
    ],
  };

/** The effort-floor control exists on every reasoning-capable model. */
export const synthesizeMinReasoningEffortSetting = (
  capabilities: ReadonlyArray<string> | undefined,
): TModelSettingDefinitions["min_reasoning_effort"] | undefined =>
  capabilities?.includes("reasoning") === true
    ? MIN_REASONING_EFFORT_SETTING
    : undefined;

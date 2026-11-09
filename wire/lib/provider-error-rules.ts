import type { TCooldownReason } from "@openllmsh/sdk/protocol";

/**
 * Optional per-provider overrides for hop-error classification. Pure data —
 * a rule returns only a reason (never abort). Custom providers (`custom:*`)
 * and unknown names get the empty list so they always use the shared
 * defaults; never accept user-supplied rules.
 */
export type TProviderErrorRule = {
  readonly statuses?: readonly number[];
  readonly code?: string;
  readonly message?: RegExp;
  readonly reason: TCooldownReason;
};

/** Ships empty. Built-in providers use the shared defaults until a rule is added. */
export const PROVIDER_ERROR_RULES: Readonly<
  Record<string, readonly TProviderErrorRule[]>
> = {};

export const errorRulesFor = (
  provider: string | undefined,
  rules: Readonly<
    Record<string, readonly TProviderErrorRule[]>
  > = PROVIDER_ERROR_RULES,
): readonly TProviderErrorRule[] => {
  if (provider === undefined || provider.length === 0) return [];
  if (provider.startsWith("custom:")) return [];
  return rules[provider] ?? [];
};

export const providerRuleMatches = (
  rule: TProviderErrorRule,
  input: {
    readonly status: number;
    readonly code?: string | undefined;
    readonly message: string;
  },
): boolean => {
  if (rule.statuses !== undefined && !rule.statuses.includes(input.status)) {
    return false;
  }
  if (rule.code !== undefined && input.code !== rule.code) return false;
  if (rule.message !== undefined && !rule.message.test(input.message)) {
    return false;
  }
  return true;
};

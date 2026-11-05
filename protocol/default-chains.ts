import type {
  TDefaultChainClass,
  TExtendedModel,
  TModelCapability,
} from "./models";
import { MEDIA_DEFAULT_CLASS } from "./models";

/**
 * Shared catalog default-chain ranking. Browser-safe (no DB/HTTP).
 * Trail: host-paid included models (`included_usage`) come LAST in every
 * chain they belong to — a user's own providers are tried first, and a
 * fresh user with none still lands on what OpenLLM gives them.
 * Primary: `tier_rank` ascending — the provider bands (subscriptions
 * 10–79, free-tier APIs 100–199, metered APIs 200+).
 * Tie-break: index of `chainClass` in `default_tiers`, then catalog order.
 */
export type TDefaultChainRankable = Pick<
  TExtendedModel,
  | "default_tiers"
  | "tier_rank"
  | "capabilities"
  | "deprecated"
  | "provider"
  | "included_usage"
>;

export const compareDefaultChainMembers = (
  a: TDefaultChainRankable,
  b: TDefaultChainRankable,
  chainClass: TDefaultChainClass,
): number => {
  const trailA = a.included_usage === undefined ? 0 : 1;
  const trailB = b.included_usage === undefined ? 0 : 1;
  if (trailA !== trailB) return trailA - trailB;
  const rankA = a.tier_rank ?? Number.MAX_SAFE_INTEGER;
  const rankB = b.tier_rank ?? Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) return rankA - rankB;
  return (
    (a.default_tiers?.indexOf(chainClass) ?? Number.MAX_SAFE_INTEGER) -
    (b.default_tiers?.indexOf(chainClass) ?? Number.MAX_SAFE_INTEGER)
  );
};

export const orderDefaultChainMembers = <T extends TDefaultChainRankable>(
  catalog: ReadonlyArray<T>,
  available: ReadonlySet<string> | undefined,
  chainClass: TDefaultChainClass,
  capability: TModelCapability,
): ReadonlyArray<T> =>
  catalog
    .filter(
      (m) =>
        (m.default_tiers?.includes(chainClass) ?? false) &&
        m.capabilities.includes(capability) &&
        m.deprecated !== true &&
        (available === undefined || available.has(m.provider)),
    )
    .sort((a, b) => compareDefaultChainMembers(a, b, chainClass));

/** Ordered catalog media defaults for one capability. Empty if none qualify. */
export const deriveMediaDefaultModels = (
  catalog: ReadonlyArray<TExtendedModel>,
  available: ReadonlySet<string>,
  capability: TModelCapability,
): ReadonlyArray<TExtendedModel> =>
  orderDefaultChainMembers(catalog, available, MEDIA_DEFAULT_CLASS, capability);

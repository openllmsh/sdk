import type { TOAuthProviderSlug } from "./local-provider";
import {
  isLocalKeyProviderSlug,
  isLocalServerSlug,
  isOAuthProviderSlug,
  OAuthProviderSlug,
} from "./local-provider";
import type { TModelProviderType } from "./models";

/**
 * @deprecated Prefer {@link OAuthProviderSlug} from `./local-provider`.
 * Re-exported so existing imports keep compiling for one release.
 */
export const SubscriptionProviderSlug = OAuthProviderSlug;
/**
 * @deprecated Prefer {@link TOAuthProviderSlug}.
 */
export type TSubscriptionProviderSlug = TOAuthProviderSlug;

/** Catalog tagging only — execution still uses registry `authKind`. */
export const isSubscriptionProviderSlug = (
  provider: string,
): provider is TSubscriptionProviderSlug => isOAuthProviderSlug(provider);

/** Catalog tagging only — execution still uses registry `authKind`. */
export const catalogProviderType = (provider: string): TModelProviderType => {
  if (isLocalServerSlug(provider)) return "local";
  // local_key plans are subscriptions too: $0 per token, savings vs list.
  if (isSubscriptionProviderSlug(provider) || isLocalKeyProviderSlug(provider))
    return "subscription";
  return "api_key";
};

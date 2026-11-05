import { isLocalProvider } from "./local-provider";

/**
 * Team shareability gate (docs/plan/2026-10-26-teams.md §8).
 *
 * Checked at origin (catalog + share selection + upsert) and again on the
 * contributor daemon at grant admit. Shared here so api and daemon cannot
 * drift.
 *
 * Allows:
 * - daemon-only classes — oauth subscription and local server providers
 *   (`isLocalProvider`) — served via device tunnel;
 * - API-key / custom endpoint providers (`isApiKeyShareProvider`) — served
 *   as a cloud credential share under the two-layer K_cred / K_srv envelope.
 *
 * Vendor-terms rules plug in later as an additional conjunct without a
 * protocol change.
 */

/**
 * Built-in BYOK providers that may be contributed as a `credential` share.
 * OAuth / local slugs are excluded (they use `device_model`). Non-chat
 * surfaces (search, embed-only) are filtered at the catalog/UI layer.
 */
const API_KEY_SHARE_PROVIDERS: ReadonlySet<string> = new Set([
  "openai",
  "anthropic",
  "alibaba",
  "nvidia",
  "mistral",
  "groq",
  "cerebras",
  "opencode_zen",
  "ollama_cloud",
  "openrouter",
  "cloudflare",
  "sambanova",
  "google",
  "zai",
  "minimax",
]);

const CUSTOM_PROVIDER_RE = /^custom:[a-z0-9][a-z0-9-]{0,62}$/;

/** True for built-in BYOK chat providers and `custom:<name>` endpoints. */
export const isApiKeyShareProvider = (provider: string): boolean => {
  if (isLocalProvider(provider)) return false;
  if (CUSTOM_PROVIDER_RE.test(provider)) return true;
  return API_KEY_SHARE_PROVIDERS.has(provider);
};

/** True when a provider may be shared on a team (any share kind). */
export const teamShareable = (provider: string): boolean =>
  isLocalProvider(provider) || isApiKeyShareProvider(provider);

/** Provider slug of a model id (`provider/model`), or the bare id itself. */
export const providerOfModel = (model: string): string => {
  const slash = model.indexOf("/");
  if (slash <= 0) return model;
  return model.slice(0, slash);
};

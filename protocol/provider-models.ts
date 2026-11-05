/**
 * Providers whose live catalogs are large enough that the user picks which
 * of their models are LISTED (`config.extra.provider_models`). Selection is
 * a listing filter only: an explicit request for an unselected id still
 * resolves and routes. Declared once here so api and dashboard agree.
 */
export const MODEL_SELECTABLE_PROVIDERS: ReadonlySet<string> = new Set([
  "openrouter",
  "nvidia",
  "cloudflare",
  "ollama_cloud",
  "opencode_zen",
]);

export const isModelSelectableProvider = (provider: string): boolean =>
  MODEL_SELECTABLE_PROVIDERS.has(provider);

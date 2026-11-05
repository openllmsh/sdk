import { Schema as S } from "effect";

/**
 * The three daemon-only provider variants. All are served only by a local
 * daemon (never by the hosted gateway); they differ in how the device
 * authenticates and talks upstream:
 *  - `oauth` — today's subscription providers (vendor-CLI login)
 *  - `local` — loopback model servers (Ollama, LM Studio, …)
 *  - `local_key` — subscription plans that issue only a static API key
 *    (OpenCode Go, Z.AI GLM Coding Plan, MiniMax Coding Plan). The key is
 *    pasted in the browser, sealed to the device and stored only there; the
 *    daemon calls the vendor's hosted endpoint directly.
 */
export const LocalProviderVariant = S.Literals(["oauth", "local", "local_key"]);
export type TLocalProviderVariant = S.Schema.Type<typeof LocalProviderVariant>;

/**
 * Closed set of OAuth / subscription-provider slugs a control command may
 * address — the ONLY values that can ever reach a daemon delegate or the
 * isolated-CLI installer. The daemon's `TCliProvider` derives from this.
 */
export const OAuthProviderSlug = S.Literals([
  "claude_code",
  "chatgpt",
  "kimi_code",
  // xAI Grok ("Grok Build", x.ai/cli) — SuperGrok / X Premium+ subscription
  // OAuth, delegated to the official `grok` CLI by the daemon.
  "grok",
  // Cursor subscription, delegated to the official `cursor-agent` CLI.
  "cursor",
  // Meta Muse Code subscription — daemon bridge to the official `muse`
  // CLI / SDK only. No direct Meta Model API-key fallback on this slug.
  "muse",
  // Google Antigravity subscription — daemon bridge to Google's official
  // `agy_acp_server` ACP agent and its own Google sign-in. Never a metered
  // Gemini API key; the BYOK `google` provider is a separate slug.
  "antigravity",
]);
export type TOAuthProviderSlug = S.Schema.Type<typeof OAuthProviderSlug>;

/**
 * Closed set of `local_key` provider slugs: subscription plans whose only
 * credential is an API key. Keys live on the device (multi-account, one slot
 * per key) and are never stored by the cloud.
 */
export const LocalKeyProviderSlug = S.Literals([
  "opencode_go",
  "zai_coding",
  "minimax_coding",
]);
export type TLocalKeyProviderSlug = S.Schema.Type<typeof LocalKeyProviderSlug>;

export type TLocalKeyProviderPreset = {
  readonly slug: TLocalKeyProviderSlug;
  readonly label: string;
  /** OpenAI-compatible base URL (`<base>/chat/completions`). */
  readonly baseUrl: string;
  /** Where the user obtains the key. */
  readonly keyUrl: string;
  /** Placeholder for the paste field. */
  readonly keyHint: string;
};

/** Vendor endpoints for each `local_key` provider. */
export const LOCAL_KEY_PROVIDER_PRESETS: ReadonlyArray<TLocalKeyProviderPreset> =
  [
    {
      slug: "opencode_go",
      label: "OpenCode Go",
      baseUrl: "https://opencode.ai/zen/go/v1",
      keyUrl: "https://opencode.ai/auth",
      keyHint: "OpenCode API key",
    },
    {
      slug: "zai_coding",
      label: "Z.AI GLM Coding Plan",
      baseUrl: "https://api.z.ai/api/coding/paas/v4",
      keyUrl: "https://z.ai/manage-apikey/apikey-list",
      keyHint: "Z.AI API key",
    },
    {
      slug: "minimax_coding",
      label: "MiniMax Coding Plan",
      baseUrl: "https://api.minimax.io/v1",
      keyUrl:
        "https://platform.minimax.io/user-center/basic-information/interface-key",
      keyHint: "MiniMax Coding Plan key",
    },
  ] as const;

export const isLocalKeyProviderSlug = (
  slug: string,
): slug is TLocalKeyProviderSlug =>
  (LocalKeyProviderSlug.literals as ReadonlyArray<string>).includes(slug);

export const localKeyProviderPreset = (
  slug: string,
): TLocalKeyProviderPreset | null =>
  LOCAL_KEY_PROVIDER_PRESETS.find((preset) => preset.slug === slug) ?? null;

/** Base URL of a `local_key` provider (every slug has a preset). */
export const localKeyBaseUrl = (slug: TLocalKeyProviderSlug): string => {
  const preset = localKeyProviderPreset(slug);
  if (preset === null) throw new Error(`no local_key preset for ${slug}`);
  return preset.baseUrl;
};

/** Well-known local model-server preset slugs (`local_<product>`). */
export const LocalServerPresetSlug = S.Literals([
  "local_ollama",
  "local_lmstudio",
  "local_llamacpp",
  "local_localai",
  "local_vllm",
  "local_jan",
  "local_textgen",
]);
export type TLocalServerPresetSlug = S.Schema.Type<
  typeof LocalServerPresetSlug
>;

export type TLocalServerPreset = {
  readonly slug: TLocalServerPresetSlug;
  readonly label: string;
  /** Vendor-documented default loopback port. */
  readonly defaultPort: number;
  readonly docsUrl: string;
};

/**
 * Popular local OpenAI-compatible servers and their default ports.
 * A port that answers but matches no preset falls back to
 * {@link localPortSlug}.
 */
export const LOCAL_SERVER_PRESETS: ReadonlyArray<TLocalServerPreset> = [
  {
    slug: "local_ollama",
    label: "Ollama",
    defaultPort: 11434,
    docsUrl: "https://docs.ollama.com",
  },
  {
    slug: "local_lmstudio",
    label: "LM Studio",
    defaultPort: 1234,
    docsUrl: "https://lmstudio.ai/docs/developer/rest/quickstart",
  },
  {
    slug: "local_llamacpp",
    label: "llama.cpp",
    defaultPort: 8080,
    docsUrl: "https://github.com/ggerganov/llama.cpp",
  },
  {
    slug: "local_localai",
    label: "LocalAI",
    defaultPort: 8080,
    docsUrl: "https://localai.io",
  },
  {
    slug: "local_vllm",
    label: "vLLM",
    defaultPort: 8000,
    docsUrl: "https://docs.vllm.ai",
  },
  {
    slug: "local_jan",
    label: "Jan",
    defaultPort: 1337,
    docsUrl: "https://jan.ai/docs/desktop/api-server",
  },
  {
    slug: "local_textgen",
    label: "text-generation-webui",
    defaultPort: 5000,
    docsUrl: "https://github.com/oobabooga/text-generation-webui",
  },
] as const;

const LOCAL_PORT_SLUG_RE = /^local_port_(\d{1,5})$/;

/** Fallback slug for a discovered port that matched no preset. */
export const localPortSlug = (port: number): string => `local_port_${port}`;

/** Parse `local_port_<port>`; returns null when the slug is not that shape. */
export const parseLocalPortSlug = (slug: string): number | null => {
  const match = LOCAL_PORT_SLUG_RE.exec(slug);
  if (match === null) return null;
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
};

export const isLocalPortSlug = (slug: string): boolean =>
  parseLocalPortSlug(slug) !== null;

/**
 * Stable overview-group provider for ephemeral `local_port_<n>` rows.
 * Custom-port / test servers each mint a unique slug; collapsing them here
 * lets Recent requests stack as `tiny N×` instead of one row per port.
 */
export const LOCAL_PORT_GROUP_PROVIDER = "local_port" as const;

/** Overview grouping provider: ephemeral ports share {@link LOCAL_PORT_GROUP_PROVIDER}. */
export const requestGroupProvider = (provider: string): string =>
  isLocalPortSlug(provider) ? LOCAL_PORT_GROUP_PROVIDER : provider;

/**
 * Overview grouping model id for a request row. Ephemeral local ports keep the
 * `local_port/<leaf>` shape so `shortName` still shows the leaf model.
 */
export const requestGroupModel = (
  provider: string,
  model: string | null,
): string | null => {
  if (!isLocalPortSlug(provider)) return model;
  if (model === null || model.length === 0) return model;
  const slash = model.lastIndexOf("/");
  const leaf = slash >= 0 ? model.slice(slash + 1) : model;
  if (leaf.length === 0) return model;
  return `${LOCAL_PORT_GROUP_PROVIDER}/${leaf}`;
};

export const isLocalServerPresetSlug = (
  slug: string,
): slug is TLocalServerPresetSlug =>
  (LocalServerPresetSlug.literals as ReadonlyArray<string>).includes(slug);

/** True for a preset slug or a `local_port_<n>` fallback. */
export const isLocalServerSlug = (slug: string): boolean =>
  isLocalServerPresetSlug(slug) || isLocalPortSlug(slug);

export const isOAuthProviderSlug = (
  provider: string,
): provider is TOAuthProviderSlug =>
  (OAuthProviderSlug.literals as ReadonlyArray<string>).includes(provider);

/**
 * Providers with device-local account slots, routed BY PROVIDER: oauth (one
 * slot per vendor login) ∪ local_key (one slot per pasted key). A device
 * reports each slot as a `connections` row.
 */
export const isAccountProviderSlug = (provider: string): boolean =>
  isOAuthProviderSlug(provider) || isLocalKeyProviderSlug(provider);

/**
 * Daemon-only providers: OAuth ∪ local_key ∪ local server slugs.
 * Replaces `isSubscriptionProvider` at routing / plan / walker sites that
 * mean "cloud never serves this hop".
 */
export const isLocalProvider = (slug: string): boolean =>
  isAccountProviderSlug(slug) || isLocalServerSlug(slug);

/** Variant for a daemon-only slug, or null when the slug is neither. */
export const localProviderVariant = (
  slug: string,
): TLocalProviderVariant | null => {
  if (isOAuthProviderSlug(slug)) return "oauth";
  if (isLocalServerSlug(slug)) return "local";
  if (isLocalKeyProviderSlug(slug)) return "local_key";
  return null;
};

export const localServerPresetBySlug = (
  slug: string,
): TLocalServerPreset | null =>
  LOCAL_SERVER_PRESETS.find((preset) => preset.slug === slug) ?? null;

export const localServerPresetByPort = (
  port: number,
): TLocalServerPreset | null => {
  const matches = LOCAL_SERVER_PRESETS.filter(
    (preset) => preset.defaultPort === port,
  );
  // Colliding defaults (8080 ×2) are ambiguous — caller fingerprints instead.
  return matches.length === 1 ? (matches[0] ?? null) : null;
};

/** OAuth hop with no online daemon — keep the historical wire string. */
export const SUBSCRIPTION_REQUIRES_DAEMON_ERROR_CODE =
  "subscription_requires_daemon";

/** Local-server hop with no online daemon that lists the model. */
export const LOCAL_REQUIRES_DAEMON_ERROR_CODE = "local_requires_daemon";

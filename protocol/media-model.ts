import { Schema as S } from "effect";
import { DEFAULT_TIER_ALIASES } from "./models";

/**
 * One shared rule for a media request's `model` field — used by the cloud
 * media handlers, the daemon plan endpoint, and the daemon front door.
 *
 * Pure: no I/O, no catalog, no plan fetch. Hosts still expand family names,
 * walk default chains, and load credentials; this only decides whether the
 * field means "omit → default", "resolve this id/family", or "refuse: chat
 * alias on a media surface".
 */

/**
 * Surfaces that participate in media model decisions. Embeddings is included
 * even though its default chain is curated differently from the `media`
 * default class — an omitted embeddings model still means "walk the default
 * chain", and a chat alias on `/v1/embeddings` is still refused.
 */
export const MediaModelSurface = S.Literals([
  "image",
  "image_edit",
  "transcription",
  "speech",
  "video",
  "embeddings",
]);
export type TMediaModelSurface = S.Schema.Type<typeof MediaModelSurface>;

export const CHAT_ALIAS_ON_MEDIA_SURFACE_CODE =
  "chat_alias_on_media_surface" as const;

/** Wire / decode shape for the optional `model` field on a media request. */
export type TMediaModelField =
  | { readonly kind: "absent" }
  | { readonly kind: "invalid" }
  | { readonly kind: "explicit"; readonly value: string };

export type TMediaModelDecision =
  | { readonly kind: "omit_default"; readonly surface: TMediaModelSurface }
  | {
      readonly kind: "resolve_family";
      readonly surface: TMediaModelSurface;
      readonly rawId: string;
    }
  | {
      readonly kind: "refuse_chat_alias";
      readonly surface: TMediaModelSurface;
      readonly alias: string;
      readonly code: typeof CHAT_ALIAS_ON_MEDIA_SURFACE_CODE;
      readonly message: string;
    }
  | { readonly kind: "invalid_model_field" };

/** Built-in chat tier aliases — always refused on a media surface. */
export const isDefaultChatTierAlias = (raw: string): boolean =>
  (DEFAULT_TIER_ALIASES as ReadonlyArray<string>).includes(raw);

const EXAMPLE_MODEL: Record<TMediaModelSurface, string> = {
  embeddings: "openai/text-embedding-3-small",
  image: "google/nano-banana-pro",
  image_edit: "chatgpt/gpt-image-1",
  transcription: "openai/whisper-1",
  speech: "openai/tts-1",
  video: "google/veo-3.1-fast-generate-preview",
};

/**
 * Example catalog id for a surface — used in the refuse message so the
 * caller sees what a concrete media model looks like.
 */
export const mediaModelSurfaceExample = (surface: TMediaModelSurface): string =>
  EXAMPLE_MODEL[surface];

export const chatAliasOnMediaSurfaceMessage = (
  alias: string,
  surface: TMediaModelSurface,
): string =>
  `"${alias}" is a chat alias; pass a ${surface} model (e.g. "${mediaModelSurfaceExample(surface)}") or omit model`;

/**
 * Names that are chat-only aliases for this surface: the built-in tiers
 * always, plus any user fallback group whose chain has no model with the
 * surface's capability. Family names (`grok`) are never in this set.
 */
export const mediaChatOnlyAliasNames = (params: {
  readonly fallbackGroups: ReadonlyArray<{
    readonly name: string;
    readonly models: ReadonlyArray<string>;
  }>;
  readonly modelHasSurfaceCapability: (modelId: string) => boolean;
}): ReadonlySet<string> => {
  const names = new Set<string>(DEFAULT_TIER_ALIASES);
  for (const group of params.fallbackGroups) {
    if (!group.models.some(params.modelHasSurfaceCapability)) {
      names.add(group.name);
    }
  }
  return names;
};

const nameSetOf = (
  names: ReadonlySet<string> | ReadonlyArray<string>,
): ReadonlySet<string> => (names instanceof Set ? names : new Set(names));

/**
 * Classify a media request's `model` field before dispatch / plan expansion.
 *
 * `chatOnlyAliasNames` must include at least {@link DEFAULT_TIER_ALIASES};
 * hosts build the full set with {@link mediaChatOnlyAliasNames}. A family
 * name that resolves per surface (`grok` on images) is never in that set
 * and falls through to `resolve_family`.
 */
export const decideMediaModelField = (args: {
  readonly surface: TMediaModelSurface;
  readonly field: TMediaModelField;
  readonly chatOnlyAliasNames: ReadonlySet<string> | ReadonlyArray<string>;
}): TMediaModelDecision => {
  if (args.field.kind === "invalid") return { kind: "invalid_model_field" };
  if (args.field.kind === "absent") {
    return { kind: "omit_default", surface: args.surface };
  }
  const aliasNames = nameSetOf(args.chatOnlyAliasNames);
  // Tiers are refused even if a host forgot to put them in the set.
  if (
    isDefaultChatTierAlias(args.field.value) ||
    aliasNames.has(args.field.value)
  ) {
    return {
      kind: "refuse_chat_alias",
      surface: args.surface,
      alias: args.field.value,
      code: CHAT_ALIAS_ON_MEDIA_SURFACE_CODE,
      message: chatAliasOnMediaSurfaceMessage(args.field.value, args.surface),
    };
  }
  return {
    kind: "resolve_family",
    surface: args.surface,
    rawId: args.field.value,
  };
};

import { Schema as S } from "effect";
import { OptionalMediaModel } from "./media-input";
import { TUNNEL_MEDIA_MAX_BODY_BYTES } from "./mux";

/** Image-edit request body bound; matches tunneled media HTTP max. */
export const IMAGE_EDIT_MAX_BODY_BYTES = TUNNEL_MEDIA_MAX_BODY_BYTES;

export const ImageSize = S.String;
export type TImageSize = S.Schema.Type<typeof ImageSize>;

/** Output container for the GPT-image families. DALL·E models reject it. */
export const ImageOutputFormat = S.Literals(["png", "jpeg", "webp"]);
export type TImageOutputFormat = S.Schema.Type<typeof ImageOutputFormat>;

/** Content-moderation level; GPT-image families only. */
export const ImageModeration = S.Literals(["low", "auto"]);
export type TImageModeration = S.Schema.Type<typeof ImageModeration>;

export const ImageGenerationRequest = S.Struct({
  model: S.String,
  prompt: S.String,
  n: S.optional(S.Int.check(S.isGreaterThan(0))),
  size: S.optional(ImageSize),
  quality: S.optional(S.String),
  style: S.optional(S.Literals(["vivid", "natural"])),
  response_format: S.optional(S.Literals(["url", "b64_json"])),
  background: S.optional(S.Literals(["transparent", "opaque", "auto"])),
  user: S.optional(S.String),
  /**
   * GPT-image output controls. Previously unmodelled, so Effect's default
   * `onExcessProperty: "ignore"` dropped them before dispatch — a caller
   * asking `gpt-image-1` for WebP silently received PNG. Which family accepts
   * which of these is enforced at dispatch, not here, so OpenAI-compatible
   * vendors with their own model ids stay unvalidated and keep working.
   */
  output_format: S.optional(ImageOutputFormat),
  output_compression: S.optional(S.Int),
  moderation: S.optional(ImageModeration),
  /**
   * Streaming controls. The gateway serves BOTH modes: `stream: true` answers
   * `text/event-stream` with the spec's named events, `false`/absent answers
   * the JSON body unchanged.
   *
   * `partial_images` is a provider-wide PUBLISHED request domain (0-3,
   * default 0 — "when set to 0, the response will be a single image sent in
   * one streaming event"), so it is validated here as structural input, not
   * as a per-model capability table.
   */
  stream: S.optional(S.Boolean),
  partial_images: S.optional(
    S.Int.check(S.isGreaterThanOrEqualTo(0), S.isLessThanOrEqualTo(3)),
  ),
});
export type TImageGenerationRequest = S.Schema.Type<
  typeof ImageGenerationRequest
>;

/** A named, pre-dispatch refusal for an image option we cannot serve. */
export type TImageRequestRejection = {
  readonly param: string;
  readonly message: string;
};

/**
 * SUPERSEDED REFUSAL — kept as validation, deliberately not deleted.
 *
 * This used to refuse `stream` / `partial_images` outright as unimplemented.
 * That was wrong: image streaming is a universally supported gateway feature
 * and refusing it to make a schema audit pass is not a contract. Both modes
 * are now served.
 *
 * What survives is the reason the check ran on the RAW body in the first
 * place: these fields must be TYPE-validated BEFORE the schema decode, because
 * a malformed value would otherwise be discarded by `onExcessProperty:
 * "ignore"` and the caller would silently get a different response mode than
 * they asked for. Unknown fields are still NOT rejected — only these two are
 * inspected, so vendor extensions on OpenAI-compatible endpoints keep flowing.
 */
export const assertImageRequestSupported = (
  raw: unknown,
): TImageRequestRejection | null => {
  if (raw === null || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  if (Object.hasOwn(body, "stream")) {
    const value = body.stream;
    if (value !== undefined && typeof value !== "boolean") {
      return {
        param: "stream",
        message: `"stream" must be a boolean; received ${JSON.stringify(value)}.`,
      };
    }
  }
  if (Object.hasOwn(body, "partial_images")) {
    const value = body.partial_images;
    if (
      value !== undefined &&
      value !== null &&
      (typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > 3)
    ) {
      return {
        param: "partial_images",
        message: `"partial_images" must be an integer between 0 and 3; received ${JSON.stringify(value)}.`,
      };
    }
  }
  return null;
};

const { model: _imageGenerationModel, ...imageGenerationInputFields } =
  ImageGenerationRequest.fields;
export const ImageGenerationInput = S.Struct({
  ...imageGenerationInputFields,
  model: OptionalMediaModel,
});
export type TImageGenerationInput = S.Schema.Type<typeof ImageGenerationInput>;

const ImageData = S.Struct({
  url: S.optional(S.String),
  b64_json: S.optional(S.String),
  revised_prompt: S.optional(S.String),
});

/**
 * Token accounting for an image generation. Modelled so the usage row can
 * record REAL counts: without it the response decode dropped `usage` and
 * every image request was logged as `tokens_in: 0, tokens_out: 0`. Pricing
 * itself stays on the existing catalog path (`costFor`), which returns 0
 * for an unpriced model — image tokens are NOT priced as chat text here.
 * Detail objects stay open (`S.Record`) because the spec keeps adding
 * breakdown keys and a closed struct would drop them.
 */
const ImageUsageCommon = {
  input_tokens: S.Number,
  output_tokens: S.Number,
  total_tokens: S.Number,
  input_tokens_details: S.optional(S.Record(S.String, S.Unknown)),
} as const;

/**
 * Usage on the NON-streaming response (spec: `ImageGenUsage`). Carries
 * `output_tokens_details`, which its streaming sibling does not.
 */
export const ImageGenUsage = S.Struct({
  ...ImageUsageCommon,
  output_tokens_details: S.optional(S.Record(S.String, S.Unknown)),
});
export type TImageGenUsage = S.Schema.Type<typeof ImageGenUsage>;

export const ImageGenerationResponse = S.Struct({
  created: S.Number,
  data: S.Array(ImageData),
  /** Optional per the spec — DALL·E responses carry no usage block. */
  usage: S.optional(ImageGenUsage),
  /** Echoes of the settings actually used; preserved rather than dropped. */
  background: S.optional(S.Literals(["transparent", "opaque"])),
  output_format: S.optional(ImageOutputFormat),
  size: S.optional(ImageSize),
  quality: S.optional(S.String),
});
export type TImageGenerationResponse = S.Schema.Type<
  typeof ImageGenerationResponse
>;

/**
 * Usage on a STREAMED completion (spec: `ImagesUsage`).
 *
 * These were briefly aliased on the assumption they were the same shape under
 * two names. The spec-surface fixture disproved it: `ImagesUsage` has NO
 * `output_tokens_details`. They share the four common fields — factored into
 * `ImageUsageCommon` so the overlap is declared once — and each is asserted
 * against its OWN spec schema, so a future divergence in either direction is
 * a failing test rather than a silent mismatch.
 */
export const ImagesUsage = S.Struct({ ...ImageUsageCommon });
export type TImagesUsage = S.Schema.Type<typeof ImagesUsage>;

/**
 * The two streaming events.
 *
 * FRAMING is spec-exact: NAMED SSE events (`event: image_generation.…`) and
 * NO `[DONE]` sentinel — that is chat framing and does not appear in the
 * images spec. `completed` is the terminator.
 *
 * FIELD REQUIREDNESS IS A DELIBERATE, DOCUMENTED RELAXATION — this is NOT
 * spec-exact and must not be described as such. The spec marks `size`,
 * `quality`, `background`, `output_format` (and `usage` on `completed`)
 * REQUIRED, because it describes one provider that always reports them. This
 * gateway serves many, and a provider that answers `stream: true` with a
 * finished image often reports none of them.
 *
 * The choice was: fabricate values to satisfy a required set, or omit what
 * the provider did not tell us. Omitting is the only honest option — a
 * synthesized `size` or a zeroed `usage` is a lie about the generation, and
 * `usage` in particular feeds billing. So these are optional HERE while
 * remaining required on OpenAI's own wire, and a native OpenAI stream passes
 * every field through untouched. `tests/protocol/openai-spec-surface.test.ts`
 * asserts this divergence explicitly, so it stays a recorded decision rather
 * than drift.
 */
export const ImageStreamPartialEvent = S.Struct({
  type: S.Literals(["image_generation.partial_image"]),
  b64_json: S.String,
  created_at: S.Number,
  size: S.optional(ImageSize),
  quality: S.optional(S.String),
  background: S.optional(S.String),
  output_format: S.optional(S.String),
  partial_image_index: S.Number,
});
export type TImageStreamPartialEvent = S.Schema.Type<
  typeof ImageStreamPartialEvent
>;

export const ImageStreamCompletedEvent = S.Struct({
  type: S.Literals(["image_generation.completed"]),
  b64_json: S.String,
  created_at: S.Number,
  size: S.optional(ImageSize),
  quality: S.optional(S.String),
  background: S.optional(S.String),
  output_format: S.optional(S.String),
  /** Present on the GPT-image families; absent elsewhere. */
  usage: S.optional(ImagesUsage),
  /**
   * OpenLLM EXTENSION, not in the OpenAI spec: the durable media-library URL
   * for the finished image. Emitted only AFTER persistence has succeeded, so
   * its presence is a guarantee the bytes are stored — never a promise made
   * ahead of the fact. The non-streaming path already rewrites `data[].url`
   * this way; without it the streaming path would be the one route that
   * silently loses the library link.
   */
  url: S.optional(S.String),
});
export type TImageStreamCompletedEvent = S.Schema.Type<
  typeof ImageStreamCompletedEvent
>;

export const ImageStreamEvent = S.Union([
  ImageStreamPartialEvent,
  ImageStreamCompletedEvent,
]);
export type TImageStreamEvent = S.Schema.Type<typeof ImageStreamEvent>;

/** SSE event NAME for an image stream event — the spec frames by `type`. */
export const imageStreamEventName = (event: TImageStreamEvent): string =>
  event.type;

/**
 * Canonical single-reference image edit. Generation (`ImageGenerationRequest`)
 * must not be used as a silent stand-in — edits require an explicit image
 * and reject masks / extra references.
 */
export const ImageEditReference = S.Struct({
  url: S.String,
});
export type TImageEditReference = S.Schema.Type<typeof ImageEditReference>;

export const ImageEditRequest = S.Struct({
  model: S.String,
  prompt: S.String,
  image: ImageEditReference,
  n: S.optional(S.Int.check(S.isGreaterThan(0))),
  size: S.optional(ImageSize),
  quality: S.optional(S.String),
  response_format: S.optional(S.Literals(["url", "b64_json"])),
});
export type TImageEditRequest = S.Schema.Type<typeof ImageEditRequest>;

const { model: _imageEditModel, ...imageEditInputFields } =
  ImageEditRequest.fields;
export const ImageEditInput = S.Struct({
  ...imageEditInputFields,
  model: OptionalMediaModel,
});
export type TImageEditInput = S.Schema.Type<typeof ImageEditInput>;

export const ImageEditParseErrorCode = S.Literals([
  "image_edit_mask_unsupported",
  "image_edit_multi_reference_unsupported",
  "image_edit_invalid",
]);
export type TImageEditParseErrorCode = S.Schema.Type<
  typeof ImageEditParseErrorCode
>;

export type TImageEditParseFailure = {
  readonly code: TImageEditParseErrorCode;
  readonly message: string;
};

export type TImageEditParseResult =
  | { readonly ok: true; readonly request: TImageEditRequest }
  | { readonly ok: false; readonly error: TImageEditParseFailure };

export const decodeImageEditRequest = S.decodeUnknownResult(ImageEditRequest);

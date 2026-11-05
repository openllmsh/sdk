import { Schema as S } from "effect";
import { parseVideoGenerationInput } from "./videos";

/**
 * Metadata-only media-default selection contract. Used by the cloud
 * resolver and the daemon's local-first plan fetch. Never carries
 * prompts, images, audio bytes, or speech text.
 */

export const MediaDefaultSurface = S.Literals([
  "image",
  "image_edit",
  "transcription",
  "speech",
  "video",
]);
export type TMediaDefaultSurface = S.Schema.Type<typeof MediaDefaultSurface>;

/**
 * Bounded audio encodings the default selector may match against
 * catalog `audio_support.input_formats`. `unknown` means the caller
 * did not positively prove a compatible encoding — restricted
 * subscription models must not be assumed compatible.
 */
export const MediaAudioInputFormat = S.Literals([
  "pcm_s16le_16khz_mono",
  "wav_pcm16_16khz_mono",
  "webm_opus",
  "unknown",
]);
export type TMediaAudioInputFormat = S.Schema.Type<
  typeof MediaAudioInputFormat
>;

export const MEDIA_DEFAULT_CONSTRAINT_STRING_MAX = 64;
export const MEDIA_DEFAULT_PLAN_JSON_MAX_BYTES = 2048;

const BoundedConstraintString = S.String.check(
  S.isMinLength(1),
  S.isMaxLength(MEDIA_DEFAULT_CONSTRAINT_STRING_MAX),
);

export const MediaDefaultConstraints = S.Struct({
  input_format: S.optional(MediaAudioInputFormat),
  voice: S.optional(BoundedConstraintString),
  response_format: S.optional(BoundedConstraintString),
  size: S.optional(BoundedConstraintString),
  quality: S.optional(BoundedConstraintString),
  seconds: S.optional(BoundedConstraintString),
});
export type TMediaDefaultConstraints = S.Schema.Type<
  typeof MediaDefaultConstraints
>;

export const MediaDefaultRequest = S.Struct({
  surface: MediaDefaultSurface,
  constraints: S.optional(MediaDefaultConstraints),
});
export type TMediaDefaultRequest = S.Schema.Type<typeof MediaDefaultRequest>;

export const MEDIA_DEFAULT_PLAN_QUERY_KEY = "media_default";

const decodeConstraints = S.decodeUnknownResult(MediaDefaultConstraints);
const decodeRequest = S.decodeUnknownResult(MediaDefaultRequest);

const utf8ByteLength = (value: string): number =>
  new TextEncoder().encode(value).byteLength;

const looksLikeWav = (bytes: Uint8Array): boolean =>
  bytes.length >= 12 &&
  bytes[0] === 0x52 &&
  bytes[1] === 0x49 &&
  bytes[2] === 0x46 &&
  bytes[3] === 0x46 &&
  bytes[8] === 0x57 &&
  bytes[9] === 0x41 &&
  bytes[10] === 0x56 &&
  bytes[11] === 0x45;

const asciiAt = (view: DataView, offset: number, len: number): string => {
  let out = "";
  for (let i = 0; i < len; i++)
    out += String.fromCharCode(view.getUint8(offset + i));
  return out;
};

const containsAscii = (
  bytes: Uint8Array,
  needle: string,
  maxBytes = 8192,
): boolean => {
  const limit = Math.min(bytes.length, maxBytes);
  const n = needle.length;
  if (n === 0 || n > limit) return false;
  outer: for (let i = 0; i <= limit - n; i++) {
    for (let j = 0; j < n; j++) {
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return true;
  }
  return false;
};

/** Strict PCM16 16 kHz mono WAV: bounded chunks, fmt size >= 16, data present. */
const wavIsPcm16kMono16 = (bytes: Uint8Array): boolean => {
  if (!looksLikeWav(bytes)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = view.getUint32(4, true);
  if (riffSize + 8 > bytes.length) return false;
  let offset = 12;
  let formatTag: number | null = null;
  let channels: number | null = null;
  let sampleRate: number | null = null;
  let byteRate: number | null = null;
  let blockAlign: number | null = null;
  let bitsPerSample: number | null = null;
  let hasData = false;
  while (offset + 8 <= bytes.length) {
    const chunkId = asciiAt(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const bodyStart = offset + 8;
    if (bodyStart > bytes.length) return false;
    if (chunkSize > bytes.length - bodyStart) return false;
    if (chunkId === "fmt ") {
      if (chunkSize < 16) return false;
      formatTag = view.getUint16(bodyStart, true);
      channels = view.getUint16(bodyStart + 2, true);
      sampleRate = view.getUint32(bodyStart + 4, true);
      byteRate = view.getUint32(bodyStart + 8, true);
      blockAlign = view.getUint16(bodyStart + 12, true);
      bitsPerSample = view.getUint16(bodyStart + 14, true);
    } else if (chunkId === "data") {
      if (chunkSize === 0) return false;
      hasData = true;
    }
    offset = bodyStart + chunkSize + (chunkSize % 2);
  }
  if (
    formatTag !== 1 ||
    channels !== 1 ||
    sampleRate !== 16_000 ||
    bitsPerSample !== 16 ||
    !hasData
  ) {
    return false;
  }
  const expectedAlign = (channels * bitsPerSample) / 8;
  const expectedRate = sampleRate * expectedAlign;
  return blockAlign === expectedAlign && byteRate === expectedRate;
};

const looksLikeWebm = (bytes: Uint8Array): boolean =>
  bytes.length >= 4 &&
  bytes[0] === 0x1a &&
  bytes[1] === 0x45 &&
  bytes[2] === 0xdf &&
  bytes[3] === 0xa3;

const parseContentTypeParams = (
  contentType: string | undefined,
): { readonly type: string; readonly params: Record<string, string> } => {
  if (contentType === undefined || contentType.length === 0) {
    return { type: "", params: {} };
  }
  const parts = contentType.split(";").map((p) => p.trim().toLowerCase());
  const type = parts[0] ?? "";
  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    let value = part.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    params[key] = value;
  }
  return { type, params };
};

const declaredLittleEndianPcm16kMono = (contentType?: string): boolean => {
  const { type, params } = parseContentTypeParams(contentType);
  if (type === "audio/l16" || type.endsWith("/l16")) return false;
  if (type !== "audio/pcm" && !type.endsWith("/pcm")) return false;
  const rate = params.rate ?? params.samplerate;
  const channels = params.channels;
  const bits = params.bits ?? params.bitspersample;
  const endian = params.endian ?? params.endianness;
  return (
    rate === "16000" &&
    channels === "1" &&
    bits === "16" &&
    (endian === "little" || endian === "le" || endian === "little-endian")
  );
};

const codecsIndicateOpus = (codecs: string | undefined): boolean => {
  if (codecs === undefined || codecs.length === 0) return false;
  const tokens = codecs
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((t) => t.length > 0);
  if (tokens.some((t) => t === "vorbis")) return false;
  return tokens.some((t) => t === "opus");
};

const bytesAreWebmOpus = (bytes: Uint8Array): boolean => {
  if (!looksLikeWebm(bytes) && !containsAscii(bytes, "webm")) return false;
  if (containsAscii(bytes, "A_VORBIS") || containsAscii(bytes, "vorbis")) {
    return false;
  }
  return containsAscii(bytes, "A_OPUS") || containsAscii(bytes, "OpusHead");
};

export type TMediaAudioInspectInput = {
  readonly bytes?: Uint8Array;
  readonly contentType?: string;
  readonly filename?: string;
  /** Positive encoding claim from a trusted parser — never inferred from .pcm/.raw. */
  readonly encoding?: TMediaAudioInputFormat;
};

/**
 * Classify caller audio for compatibility matching. Extensions and
 * generic PCM/L16 MIME types are not encodings.
 */
export const inspectMediaAudioInputFormat = (
  input: TMediaAudioInspectInput,
): TMediaAudioInputFormat => {
  if (
    input.encoding === "pcm_s16le_16khz_mono" ||
    input.encoding === "wav_pcm16_16khz_mono" ||
    input.encoding === "webm_opus"
  ) {
    return input.encoding;
  }
  if (input.bytes !== undefined && wavIsPcm16kMono16(input.bytes)) {
    return "wav_pcm16_16khz_mono";
  }
  if (input.bytes !== undefined && looksLikeWav(input.bytes)) {
    return "unknown";
  }
  const { type, params } = parseContentTypeParams(input.contentType);
  const webmType = type.includes("webm");
  if (codecsIndicateOpus(params.codecs) && webmType) return "webm_opus";
  if (input.bytes !== undefined && bytesAreWebmOpus(input.bytes)) {
    return "webm_opus";
  }
  if (declaredLittleEndianPcm16kMono(input.contentType)) {
    return "pcm_s16le_16khz_mono";
  }
  return "unknown";
};

const pickConstraints = (
  rec: Record<string, unknown>,
  audio?: TMediaAudioInspectInput,
): TMediaDefaultConstraints | "invalid" | undefined => {
  const parsed = decodeConstraints({
    ...(rec.voice !== undefined ? { voice: rec.voice } : {}),
    ...(rec.response_format !== undefined
      ? { response_format: rec.response_format }
      : {}),
    ...(rec.size !== undefined ? { size: rec.size } : {}),
    ...(rec.quality !== undefined ? { quality: rec.quality } : {}),
    ...(rec.seconds !== undefined ? { seconds: rec.seconds } : {}),
    ...(audio !== undefined
      ? { input_format: inspectMediaAudioInputFormat(audio) }
      : rec.input_format !== undefined
        ? { input_format: rec.input_format }
        : {}),
  });
  if (parsed._tag === "Failure") return "invalid";
  const value = parsed.success;
  return Object.keys(value).length > 0 ? value : undefined;
};

export const sanitizeMediaDefaultConstraints = (
  surface: TMediaDefaultSurface,
  body: unknown,
  audio?: TMediaAudioInspectInput,
): TMediaDefaultConstraints | undefined => {
  const result = mediaDefaultRequestFromBody(surface, body, audio);
  return result === null ? undefined : result.constraints;
};

export const mediaDefaultRequestFromBody = (
  surface: TMediaDefaultSurface,
  body: unknown,
  audio?: TMediaAudioInspectInput,
): TMediaDefaultRequest | null => {
  if (surface === "video") {
    try {
      const input = parseVideoGenerationInput(body);
      const constraints = pickConstraints(input);
      if (constraints === "invalid") return null;
      return {
        surface,
        ...(constraints === undefined ? {} : { constraints }),
      };
    } catch {
      return null;
    }
  }
  const audioForSurface = surface === "transcription" ? audio : undefined;
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    const constraints = pickConstraints(
      body as Record<string, unknown>,
      audioForSurface,
    );
    if (constraints === "invalid") return null;
    const request: TMediaDefaultRequest =
      constraints === undefined ? { surface } : { surface, constraints };
    return decodeRequest(request)._tag === "Success" ? request : null;
  }
  if (audioForSurface !== undefined) {
    const constraints = pickConstraints({}, audioForSurface);
    if (constraints === "invalid") return null;
    const request: TMediaDefaultRequest =
      constraints === undefined ? { surface } : { surface, constraints };
    return decodeRequest(request)._tag === "Success" ? request : null;
  }
  return { surface };
};

export const encodeMediaDefaultPlanQuery = (
  request: TMediaDefaultRequest,
): string | null => {
  const decoded = decodeRequest(request);
  if (decoded._tag === "Failure") return null;
  const json = JSON.stringify(decoded.success);
  if (utf8ByteLength(json) > MEDIA_DEFAULT_PLAN_JSON_MAX_BYTES) return null;
  return `${MEDIA_DEFAULT_PLAN_QUERY_KEY}=${encodeURIComponent(json)}`;
};

export const decodeMediaDefaultPlanQuery = (
  params: URLSearchParams,
): TMediaDefaultRequest | null => {
  const raw = params.get(MEDIA_DEFAULT_PLAN_QUERY_KEY);
  if (raw === null || raw.length === 0) return null;
  if (utf8ByteLength(raw) > MEDIA_DEFAULT_PLAN_JSON_MAX_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const decoded = decodeRequest(parsed);
  if (decoded._tag === "Failure") return null;
  const json = JSON.stringify(decoded.success);
  if (utf8ByteLength(json) > MEDIA_DEFAULT_PLAN_JSON_MAX_BYTES) return null;
  return decoded.success;
};

import * as Result from "effect/Result";
import type {
  TImageEditParseFailure,
  TImageEditParseResult,
  TImageEditRequest,
} from "./images";
import { decodeImageEditRequest, IMAGE_EDIT_MAX_BODY_BYTES } from "./images";

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const fail = (
  code: TImageEditParseFailure["code"],
  message: string,
): TImageEditParseResult => ({ ok: false, error: { code, message } });

const isPresent = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  return true;
};

const referenceCount = (body: Record<string, unknown>): number => {
  let count = 0;
  if (isPresent(body.image)) {
    if (Array.isArray(body.image)) count += body.image.length;
    else count += 1;
  }
  if (Array.isArray(body.images)) count += body.images.length;
  return count;
};

// Strict `data:[<mime>][;charset=<x>];base64,<payload>` matcher. The base64
// group is validated for charset AND padding shape (0-2 trailing `=`, only at
// the end) — a loose regex would let a malformed/truncated payload through to
// byte-size math that silently under-counts it.
const DATA_URL_PATTERN =
  /^data:([-\w.+]+\/[-\w.+]+)?(;charset=[-\w]+)?;base64,([A-Za-z0-9+/]*={0,2})$/;

/**
 * Estimate the decoded byte size of a `data:` URL from its base64 payload
 * length, without decoding it. Non-data URLs (a remote `https://` reference)
 * return 0 — there is no local byte estimate to make; a fetched remote
 * reference is bounded when it actually transits the tunnel
 * (`TUNNEL_MEDIA_MAX_BODY_BYTES`), not here. A `data:` URL that fails the
 * strict base64 shape returns `null` so the caller rejects it explicitly
 * instead of silently under-counting a malformed payload.
 */
const estimateDataUrlBytes = (url: string): number | null => {
  if (!url.startsWith("data:")) return 0;
  const match = DATA_URL_PATTERN.exec(url);
  if (match === null) return null;
  const base64 = match[3] ?? "";
  if (base64.length === 0 || base64.length % 4 !== 0) return null;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
};

const referenceUrl = (body: Record<string, unknown>): string | null => {
  const image = body.image;
  if (typeof image === "string" && image.length > 0) return image;
  const imageObj = asRecord(image);
  if (imageObj !== null) {
    if (typeof imageObj.url === "string") return imageObj.url;
    if (typeof imageObj.image_url === "string") return imageObj.image_url;
  }
  const images = body.images;
  if (Array.isArray(images) && images.length === 1) {
    const first = asRecord(images[0]);
    if (first !== null) {
      if (typeof first.image_url === "string") return first.image_url;
      if (typeof first.url === "string") return first.url;
    }
    if (typeof images[0] === "string") return images[0];
  }
  return null;
};

/**
 * Normalize documented multipart fields and a narrow JSON convenience into
 * the canonical single-image {@link TImageEditRequest}. Masks and extra
 * references fail explicitly — they are never dropped.
 */
export const parseImageEditInput = (raw: unknown): TImageEditParseResult => {
  const body = asRecord(raw);
  if (body === null) {
    return fail("image_edit_invalid", "Image edit body must be an object.");
  }

  if (isPresent(body.mask)) {
    return fail(
      "image_edit_mask_unsupported",
      "Image edit masks are not supported.",
    );
  }

  if (isPresent(body.style) || isPresent(body.background)) {
    return fail(
      "image_edit_invalid",
      "Image edits do not support style or background options.",
    );
  }

  const count = referenceCount(body);
  if (count > 1) {
    return fail(
      "image_edit_multi_reference_unsupported",
      "Image edits accept exactly one reference image.",
    );
  }

  const url = referenceUrl(body);
  if (url === null) {
    return fail(
      "image_edit_invalid",
      "Image edits require exactly one reference image.",
    );
  }

  const dataUrlBytes = estimateDataUrlBytes(url);
  if (dataUrlBytes === null) {
    return fail(
      "image_edit_invalid",
      "Image edit reference is not a valid base64 data URL.",
    );
  }
  if (dataUrlBytes > IMAGE_EDIT_MAX_BODY_BYTES) {
    return fail(
      "image_edit_invalid",
      `Image edit reference exceeds ${IMAGE_EDIT_MAX_BODY_BYTES} bytes.`,
    );
  }

  const candidate: Record<string, unknown> = {
    model: body.model,
    prompt: body.prompt,
    image: { url },
  };
  if (body.n !== undefined) candidate.n = body.n;
  if (body.size !== undefined) candidate.size = body.size;
  if (body.quality !== undefined) candidate.quality = body.quality;
  if (body.response_format !== undefined) {
    candidate.response_format = body.response_format;
  }

  const decoded = decodeImageEditRequest(candidate);
  if (Result.isFailure(decoded)) {
    return fail(
      "image_edit_invalid",
      "Image edit request is missing required fields or has invalid types.",
    );
  }
  return { ok: true, request: decoded.success };
};

export type TImageEditMultipartFile = {
  readonly fieldName: string;
  readonly bytes: Uint8Array;
  readonly contentType?: string;
};

// `String.fromCharCode(...bytes)` on the WHOLE array blows the call-stack /
// argument-count limit on a large image (spreads one argument per byte); a
// per-byte `+=` loop avoids that but is slow. Converting in bounded chunks
// gets the portable, allocation-cheap middle: each chunk is small enough for
// a safe spread, and the chunk strings are joined once at the end.
const BASE64_CHUNK_BYTES = 8192;

export const bytesToDataUrl = (
  bytes: Uint8Array,
  contentType: string | undefined,
): string => {
  const mime = contentType?.split(";")[0]?.trim() || "image/png";
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + BASE64_CHUNK_BYTES);
    chunks.push(String.fromCharCode(...chunk));
  }
  return `data:${mime};base64,${btoa(chunks.join(""))}`;
};

// Multipart form fields arrive as bare strings; the shared schema
// (`ImageEditRequest.n: S.Number.pipe(S.int(), S.positive())`) requires a
// real number and does not coerce strings, so a multipart `n` must be
// normalized before it reaches `decodeImageEditRequest` — otherwise every
// multipart request that sets `n` (even a valid "1") fails with a generic
// schema error instead of the field actually being honored. Only a strict,
// bare positive-integer string is accepted: no `parseInt` (stops at the
// first non-digit, so "1abc" would silently become `1`) and no `Number()`
// coercion (`Number("")` and `Number(" ")` are both `0`, which would
// silently satisfy a blank/whitespace field). Anything else — empty,
// signed, fractional, hex, whitespace-padded, or non-numeric — is rejected
// explicitly here rather than passed through.
const POSITIVE_INTEGER_FIELD_PATTERN = /^[1-9][0-9]*$/;

const parseMultipartNField = (raw: string): number | null =>
  POSITIVE_INTEGER_FIELD_PATTERN.test(raw) ? Number(raw) : null;

/**
 * Map OpenAI-style multipart edits (`image` file + string fields) onto the
 * same canonical parser as JSON.
 */
export const parseImageEditMultipart = (input: {
  readonly fields: Readonly<Record<string, string>>;
  readonly files: ReadonlyArray<TImageEditMultipartFile>;
}): TImageEditParseResult => {
  const imageFiles = input.files.filter(
    (file) => file.fieldName === "image" || file.fieldName === "images",
  );
  const maskFiles = input.files.filter((file) => file.fieldName === "mask");
  if (maskFiles.length > 0 || isPresent(input.fields.mask)) {
    return fail(
      "image_edit_mask_unsupported",
      "Image edit masks are not supported.",
    );
  }
  if (imageFiles.length > 1) {
    return fail(
      "image_edit_multi_reference_unsupported",
      "Image edits accept exactly one reference image.",
    );
  }
  // A file field AND an inline `image`/`images` string field together are an
  // ambiguous duplicate reference (which one wins?) — reject explicitly
  // rather than silently letting the file overwrite the string field below.
  if (
    imageFiles.length === 1 &&
    (isPresent(input.fields.image) || isPresent(input.fields.images))
  ) {
    return fail(
      "image_edit_multi_reference_unsupported",
      "Image edits accept exactly one reference image; do not combine an image file with an inline image field.",
    );
  }

  const raw: Record<string, unknown> = { ...input.fields };
  if (imageFiles.length === 1) {
    const file = imageFiles[0];
    if (file !== undefined) {
      raw.image = bytesToDataUrl(file.bytes, file.contentType);
    }
  }
  if (typeof input.fields.n === "string") {
    const n = parseMultipartNField(input.fields.n);
    if (n === null) {
      return fail(
        "image_edit_invalid",
        'Image edit "n" must be a positive integer.',
      );
    }
    raw.n = n;
  }
  return parseImageEditInput(raw);
};

export const isImageEditRequest = (
  value: TImageEditParseResult,
): value is { readonly ok: true; readonly request: TImageEditRequest } =>
  value.ok;

/** Kinds of stored media (mirrors `MediaKind` in `@openllm/schema`). */
export type TMediaTypeKind = "image" | "audio" | "video" | "document";

/**
 * Allowed content types → { extension, media kind }. A closed list so the
 * store cannot be used as a generic file host. Blobs are PUBLIC, so nothing
 * a browser would run on the blob origin (HTML, SVG, JS) is on it. The chat
 * composer's picker and the daemon's attachment store read this same list.
 */
export const MEDIA_TYPES: Readonly<
  Record<string, { readonly ext: string; readonly kind: TMediaTypeKind }>
> = {
  "image/png": { ext: "png", kind: "image" },
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
  "image/gif": { ext: "gif", kind: "image" },
  "image/avif": { ext: "avif", kind: "image" },
  "image/heic": { ext: "heic", kind: "image" },
  "image/heif": { ext: "heif", kind: "image" },
  "image/bmp": { ext: "bmp", kind: "image" },
  "image/tiff": { ext: "tiff", kind: "image" },
  "application/pdf": { ext: "pdf", kind: "document" },
  "text/plain": { ext: "txt", kind: "document" },
  "text/markdown": { ext: "md", kind: "document" },
  "text/csv": { ext: "csv", kind: "document" },
  "application/json": { ext: "json", kind: "document" },
  "application/rtf": { ext: "rtf", kind: "document" },
  "application/msword": { ext: "doc", kind: "document" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    ext: "docx",
    kind: "document",
  },
  "application/vnd.ms-excel": { ext: "xls", kind: "document" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    ext: "xlsx",
    kind: "document",
  },
  "application/vnd.ms-powerpoint": { ext: "ppt", kind: "document" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    ext: "pptx",
    kind: "document",
  },
  "audio/mpeg": { ext: "mp3", kind: "audio" },
  "audio/mp3": { ext: "mp3", kind: "audio" },
  "audio/wav": { ext: "wav", kind: "audio" },
  "audio/x-wav": { ext: "wav", kind: "audio" },
  "audio/ogg": { ext: "ogg", kind: "audio" },
  "audio/aac": { ext: "aac", kind: "audio" },
  "audio/flac": { ext: "flac", kind: "audio" },
  "audio/opus": { ext: "opus", kind: "audio" },
  "audio/mp4": { ext: "m4a", kind: "audio" },
  "audio/x-m4a": { ext: "m4a", kind: "audio" },
  "audio/webm": { ext: "weba", kind: "audio" },
  "audio/aiff": { ext: "aiff", kind: "audio" },
  "video/mp4": { ext: "mp4", kind: "video" },
  "video/webm": { ext: "webm", kind: "video" },
  "video/quicktime": { ext: "mov", kind: "video" },
  "video/x-m4v": { ext: "m4v", kind: "video" },
  "video/x-matroska": { ext: "mkv", kind: "video" },
  "video/x-msvideo": { ext: "avi", kind: "video" },
  "video/mpeg": { ext: "mpeg", kind: "video" },
};

/** Extension → MIME, inverting `MEDIA_TYPES` (first MIME per extension). */
export const MIME_BY_MEDIA_EXT: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(MEDIA_TYPES)
      .reverse()
      .map(([mime, { ext }]): [string, string] => [ext, mime]),
  );

import { Schema as S } from "effect";

/**
 * Metadata-only signed plan for an existing video job (poll/content/cancel).
 * Carries the job id's signed fields only — never the prompt, never aliases,
 * never cooldown/default derivation. The cloud verifies `sig` before planning.
 */
export const VIDEO_JOB_PLAN_QUERY_KEY = "video_job";
export const VIDEO_JOB_PLAN_JSON_MAX_BYTES = 1024;

export const VideoJobPlanRequest = S.Struct({
  model: S.String.check(S.isMinLength(1), S.isMaxLength(128)),
  provider: S.String.check(S.isMinLength(1), S.isMaxLength(64)),
  upstream_id: S.String.check(S.isMinLength(1), S.isMaxLength(256)),
  created_at: S.Number,
  sig: S.String.check(S.isPattern(/^[a-f0-9]{64}$/)),
});
export type TVideoJobPlanRequest = S.Schema.Type<typeof VideoJobPlanRequest>;

const decodeRequest = S.decodeUnknownResult(VideoJobPlanRequest);

const utf8ByteLength = (value: string): number =>
  new TextEncoder().encode(value).byteLength;

export const encodeVideoJobPlanQuery = (
  request: TVideoJobPlanRequest,
): string | null => {
  const decoded = decodeRequest(request);
  if (decoded._tag === "Failure") return null;
  const json = JSON.stringify(decoded.success);
  if (utf8ByteLength(json) > VIDEO_JOB_PLAN_JSON_MAX_BYTES) return null;
  return `${VIDEO_JOB_PLAN_QUERY_KEY}=${encodeURIComponent(json)}`;
};

export const decodeVideoJobPlanQuery = (
  params: URLSearchParams,
): TVideoJobPlanRequest | null => {
  const raw = params.get(VIDEO_JOB_PLAN_QUERY_KEY);
  if (raw === null || raw.length === 0) return null;
  if (utf8ByteLength(raw) > VIDEO_JOB_PLAN_JSON_MAX_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const decoded = decodeRequest(parsed);
  if (decoded._tag === "Failure") return null;
  return decoded.success;
};

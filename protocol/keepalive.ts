/**
 * Keepalive responses for slow whole-body endpoints (transcription).
 *
 * The edge proxy in front of the gateway (Cloudflare, ~100 s) drops a
 * response that sends nothing for that long, so a long transcription
 * came back as a 524. A client that sends {@link KEEPALIVE_REQUEST_HEADER}
 * agrees to this instead: an answer ready before
 * {@link KEEPALIVE_FIRST_BYTE_MS} is sent exactly as usual (real status,
 * real headers); a slower one gets `200` headers at once, a space every
 * {@link KEEPALIVE_INTERVAL_MS}, then a {@link TKeepaliveEnvelope} carrying
 * the real status, the `x-openllm-*` headers and the body. Leading spaces
 * are valid JSON, so the body still parses as one document.
 */

export const KEEPALIVE_REQUEST_HEADER = "x-openllm-keepalive";
/** Set on a response that switched to the envelope. */
export const KEEPALIVE_RESPONSE_HEADER = "x-openllm-keepalive";
/** Well inside the edge's ~100 s; every pre-dispatch refusal answers sooner. */
export const KEEPALIVE_FIRST_BYTE_MS = 60_000;
export const KEEPALIVE_INTERVAL_MS = 20_000;

export type TKeepaliveEnvelope = {
  readonly openllm_keepalive: 1;
  /** The status the response would have had. */
  readonly status: number;
  /** Its `x-openllm-*` headers (attribution, media urls). */
  readonly headers: Readonly<Record<string, string>>;
  /** Its body: parsed JSON when it was JSON, otherwise the text. */
  readonly body: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isKeepaliveEnvelope = (
  value: unknown,
): value is TKeepaliveEnvelope =>
  isRecord(value) &&
  value.openllm_keepalive === 1 &&
  typeof value.status === "number" &&
  isRecord(value.headers) &&
  Object.values(value.headers).every((v) => typeof v === "string") &&
  "body" in value;

/**
 * The response a keepalive envelope stands for, so a client handles it
 * exactly like an answer that arrived in time. Anything that is not an
 * envelope response is returned unchanged.
 */
export const unwrapKeepaliveResponse = async (
  res: Response,
): Promise<Response> => {
  if (res.headers.get(KEEPALIVE_RESPONSE_HEADER) !== "1") return res;
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new Response(text, { status: 502 });
  }
  if (!isKeepaliveEnvelope(parsed)) return new Response(text, { status: 502 });
  const headers = new Headers(parsed.headers);
  const body =
    typeof parsed.body === "string" ? parsed.body : JSON.stringify(parsed.body);
  if (typeof parsed.body !== "string")
    headers.set("content-type", "application/json");
  return new Response(body, { status: parsed.status, headers });
};

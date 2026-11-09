import type { TErrorEnvelope } from "@openllmsh/sdk/protocol";

/** Short single-line snippet from an upstream body (max chars, with ellipsis). */
const bodySnippet = (raw: string, max = 200): string => {
  const line = raw.replace(/\s+/g, " ").trim();
  if (line.length === 0) return "";
  return line.length > max ? `${line.slice(0, max)}…` : line;
};

/**
 * Best-effort error-envelope extraction for reason tagging. Parsing is never
 * a routing gate: an unknown provider body still represents an uncommitted
 * candidate failure and therefore walks.
 *
 * A STRING-valued `error` is lifted into the canonical envelope: xAI's CLI
 * proxy answers an exhausted balance with `{"error":"Grok Build usage balance
 * exhausted"}`, and dropping that prose left the classifier with an empty
 * message — tagging the hop `payment` (60s) instead of `quota_exhausted`.
 * Non-JSON bodies become a truncated snippet with type `upstream_error`.
 */
export const errorEnvelopeFrom = (raw: string): TErrorEnvelope | undefined => {
  try {
    const json = JSON.parse(raw) as { error?: unknown };
    if (typeof json.error === "string") {
      return { error: { message: json.error, type: "upstream_error" } };
    }
    return json.error !== null && typeof json.error === "object"
      ? { error: json.error as TErrorEnvelope["error"] }
      : undefined;
  } catch {
    const message = bodySnippet(raw);
    return message.length > 0
      ? { error: { message, type: "upstream_error" } }
      : undefined;
  }
};

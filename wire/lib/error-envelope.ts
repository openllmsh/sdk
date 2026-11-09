import type { TErrorEnvelope } from "@openllmsh/sdk/protocol";

/** Keep enough of a non-JSON body for classification (quota phrases can sit
 *  past a short display snippet). Display/header callers pass their own max. */
const CLASSIFY_BODY_SNIPPET_CHARS = 500;

/**
 * Short single-line snippet from an upstream body (max chars, with ellipsis).
 * Shared by the envelope parser (classification) and the daemon walker
 * (trail/UI headers) so the trim/ellipsis rules cannot drift.
 */
export const bodySnippet = (raw: string, max = 200): string => {
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
 * Non-JSON bodies become a truncated snippet with type `upstream_error`
 * (500 chars so a late quota phrase still classifies).
 */
export const errorEnvelopeFrom = (raw: string): TErrorEnvelope | undefined => {
  try {
    const json = JSON.parse(raw) as { error?: unknown };
    if (typeof json.error === "string") {
      return { error: { message: json.error, type: "upstream_error" } };
    }
    if (json.error === null || typeof json.error !== "object") {
      return undefined;
    }
    const e = json.error as Record<string, unknown>;
    return {
      error: {
        message:
          typeof e.message === "string"
            ? e.message
            : "upstream error (unparseable message)",
        type: typeof e.type === "string" ? e.type : "upstream_error",
        ...(typeof e.code === "string" ? { code: e.code } : {}),
      },
    };
  } catch {
    const message = bodySnippet(raw, CLASSIFY_BODY_SNIPPET_CHARS);
    return message.length > 0
      ? { error: { message, type: "upstream_error" } }
      : undefined;
  }
};

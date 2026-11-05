/**
 * Lower a wire request's output limit to a cap hold's budget — the one
 * field-level operation the cloud tunnel path and the daemon walker share
 * (review round 3, E1). Every output spelling present is clamped; when none
 * is, the surface's own spelling is added. The core dispatch chain clamps
 * its canonical request separately, because it is also bounded by the
 * client's own fields after model settings and output backfill.
 */
export type TOutputLimitSurface = "chat_completions" | "messages" | "responses";

const OUTPUT_FIELDS = [
  "max_tokens",
  "max_completion_tokens",
  "max_output_tokens",
] as const;

/** A copy of `body` with its output limit at most `limit`. */
export const clampOutputLimitFields = (
  body: Readonly<Record<string, unknown>>,
  surface: TOutputLimitSurface,
  limit: number,
): Record<string, unknown> => {
  const result: Record<string, unknown> = { ...body };
  let lowest = limit;
  for (const key of OUTPUT_FIELDS) {
    const value = result[key];
    if (value === undefined || value === null) continue;
    const clamped =
      typeof value === "number" && Number.isFinite(value)
        ? Math.min(value, limit)
        : limit;
    result[key] = clamped;
    lowest = Math.min(lowest, clamped);
  }
  const target = surface === "responses" ? "max_output_tokens" : "max_tokens";
  const hasTarget =
    result[target] != null ||
    (surface === "chat_completions" && result.max_completion_tokens != null);
  if (!hasTarget) result[target] = lowest;
  return result;
};

export const isOutputLimitSurface = (
  surface: string,
): surface is TOutputLimitSurface =>
  surface === "chat_completions" ||
  surface === "messages" ||
  surface === "responses";

/** Parse and clamp a JSON wire body, rejecting malformed or non-object input. */
export const clampOutputLimitBytes = (
  body: Uint8Array,
  surface: TOutputLimitSurface,
  limit: number,
): Uint8Array => {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid team request body");
  return new TextEncoder().encode(
    JSON.stringify(
      clampOutputLimitFields(parsed as Record<string, unknown>, surface, limit),
    ),
  );
};

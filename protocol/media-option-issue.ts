/**
 * ONE shared shape for "this media request carries options the resolved model
 * cannot honour", used by every media adapter that validates before dispatch.
 *
 * It lives in `protocol` because the OpenAI image adapter, the Google image
 * adapter and the daemon's walkers all answer the same question and each used
 * to answer it with its own ad-hoc `{ param, message }` record — unreadable
 * uniformly by a caller, and flattened to a string by the handlers. Sharing
 * the SHAPE is not sharing a capability table: every adapter still derives its
 * own issues from its own catalog facts / published wire schema.
 *
 * Two guarantees: all known issues in ONE failure (a first-failure validator
 * turns a five-field request into a five-round-trip staircase, each trip a
 * fresh model guess), and the refusal stays ACTIONABLE — `supported` carries
 * alternatives that came from a FACT, never an invented suggestion.
 */

/** Why a single option cannot be served. */
export type TMediaOptionIssueCode =
  /** The model/wire has no such knob at all. */
  | "unsupported_param"
  /** The knob exists, but not with the value that was sent. */
  | "unsupported_value";

/** One structured, machine-readable reason a media option cannot be served. */
export type TMediaOptionIssue = {
  /** Request field name, exactly as the caller spelled it on the wire. */
  readonly param: string;
  /** Caller-facing sentence; safe to echo verbatim. */
  readonly message: string;
  readonly code: TMediaOptionIssueCode;
  /**
   * Values/alternatives this model DOES accept for `param`, when a catalog or
   * published-wire fact states them. Omitted rather than guessed — an empty
   * or invented list is worse than no list, because it reads as authoritative.
   */
  readonly supported?: ReadonlyArray<string>;
};

/**
 * A complete pre-dispatch refusal. `issues` is the whole locally-known set;
 * `param`/`message` are the flattened view for the error envelope.
 */
export type TMediaOptionRejection = {
  readonly param: string;
  readonly message: string;
  readonly issues: ReadonlyArray<TMediaOptionIssue>;
};

/**
 * Flatten a collected issue list into a rejection, or `null` when the request
 * is clean. The aggregate `message` concatenates EVERY issue message so a
 * text-only client still learns about all of them — the staircase this whole
 * shape exists to end would otherwise reappear for exactly those clients.
 */
export const mediaOptionRejection = (
  issues: ReadonlyArray<TMediaOptionIssue>,
): TMediaOptionRejection | null => {
  const first = issues[0];
  if (first === undefined) return null;
  return {
    param: first.param,
    message: issues.map((issue) => issue.message).join(" "),
    issues,
  };
};

/**
 * Standard sentence for an option the resolved model has no field for.
 * Centralised so every adapter's refusal reads the same way and any
 * `supported` alternatives are appended in one place.
 */
export const unsupportedParamIssue = (params: {
  readonly param: string;
  readonly reason: string;
  readonly supported?: ReadonlyArray<string>;
}): TMediaOptionIssue => {
  const supported =
    params.supported !== undefined && params.supported.length > 0
      ? ` Supported here: ${params.supported.join(", ")}.`
      : "";
  return {
    param: params.param,
    code: "unsupported_param",
    message: `"${params.param}" ${params.reason}${supported}`,
    ...(params.supported !== undefined && params.supported.length > 0
      ? { supported: params.supported }
      : {}),
  };
};

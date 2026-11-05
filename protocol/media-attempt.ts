/**
 * Media chain advance vs terminal — no chat-style timeout/5xx retry.
 */

export const MEDIA_ADVANCE_ERROR_CODES = [
  "missing_credential",
  "model_unavailable",
  "auth_error",
  "quota_exhausted",
  "rate_limited",
  "adapter_input_unmapped",
  /**
   * A DECLARED adapter refusal raised while building the request body,
   * i.e. strictly BEFORE dispatch: the caller's exact options cannot be
   * expressed on THIS provider's wire. Nothing was submitted and nothing
   * is billable, so the chain may try a provider whose wire does accept
   * them — with the body unchanged.
   *
   * Advance-eligible ONLY while `dispatched === false` (enforced below).
   * The same code after submission stays terminal, because a request
   * that reached a provider may have been accepted and retrying it
   * risks a duplicate generation. An internal adapter BUG is NOT this
   * code — it is an `adapter_fault`, which is never advance-eligible,
   * so a defect in our own code surfaces instead of silently walking
   * the whole chain.
   */
  "adapter_input_rejected",
  "provider_validation",
] as const;
export type TMediaAdvanceErrorCode = (typeof MEDIA_ADVANCE_ERROR_CODES)[number];

export type TMediaAdvanceReason = TMediaAdvanceErrorCode;
export type TMediaTerminalReason =
  | "cancelled"
  | "timeout_after_submit"
  | "network_after_submit"
  | "uncertain_server_failure"
  | "accepted_success"
  | "output_delivered"
  | "persistence_after_success"
  | "caller_error";

export type TMediaAttemptFacts = {
  readonly dispatched: boolean;
  readonly cancelled?: boolean;
  readonly timeout?: boolean;
  readonly networkReset?: boolean;
  readonly httpStatus?: number;
  readonly errorCode?: string;
  readonly accepted?: boolean;
  readonly outputDelivered?: boolean;
  readonly persistenceFailed?: boolean;
};

export type TMediaAdvanceDecision =
  | { readonly action: "advance"; readonly reason: TMediaAdvanceReason }
  | { readonly action: "terminal"; readonly reason: TMediaTerminalReason };

const isAdvanceCode = (code: string | undefined): code is TMediaAdvanceReason =>
  code !== undefined &&
  (MEDIA_ADVANCE_ERROR_CODES as ReadonlyArray<string>).includes(code);

export const decideMediaChainAdvance = (
  facts: TMediaAttemptFacts,
): TMediaAdvanceDecision => {
  if (facts.cancelled === true) {
    return { action: "terminal", reason: "cancelled" };
  }
  if (facts.outputDelivered === true) {
    return { action: "terminal", reason: "output_delivered" };
  }
  const accepted =
    facts.accepted === true ||
    (facts.httpStatus !== undefined &&
      facts.httpStatus >= 200 &&
      facts.httpStatus < 300);
  if (accepted) {
    return {
      action: "terminal",
      reason:
        facts.persistenceFailed === true
          ? "persistence_after_success"
          : "accepted_success",
    };
  }
  if (facts.dispatched && facts.timeout === true) {
    return { action: "terminal", reason: "timeout_after_submit" };
  }
  if (facts.dispatched && facts.networkReset === true) {
    return { action: "terminal", reason: "network_after_submit" };
  }
  if (
    facts.dispatched &&
    facts.httpStatus !== undefined &&
    facts.httpStatus >= 500
  ) {
    return { action: "terminal", reason: "uncertain_server_failure" };
  }
  // Pre-dispatch-only advance codes. Once a request has been dispatched
  // these are terminal: the provider may have accepted it, and a retry
  // could duplicate a generation. This guard is what keeps the new
  // `adapter_input_rejected` bounded to the safe, non-billable case.
  if (
    (facts.errorCode === "adapter_input_unmapped" ||
      facts.errorCode === "adapter_input_rejected") &&
    facts.dispatched
  )
    return { action: "terminal", reason: "caller_error" };
  if (
    facts.errorCode === "provider_validation" &&
    !(
      facts.accepted === false &&
      (facts.httpStatus === 400 || facts.httpStatus === 422)
    )
  )
    return { action: "terminal", reason: "caller_error" };
  if (isAdvanceCode(facts.errorCode)) {
    if (facts.errorCode === "missing_credential" && facts.dispatched) {
      return { action: "terminal", reason: "caller_error" };
    }
    return { action: "advance", reason: facts.errorCode };
  }
  return { action: "terminal", reason: "caller_error" };
};

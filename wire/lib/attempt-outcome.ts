export type TAttemptUsage = {
  readonly in: number;
  readonly out: number;
  /** Cache detail for logging and cost only; `in` already includes it where
   *  the provider counts it separately. Never part of the cap charge. */
  readonly cached?: number;
  readonly cacheCreation?: number;
};

export type TAttemptOutcome = {
  readonly sent: boolean;
  readonly usage: TAttemptUsage | null;
  readonly definiteProviderError: boolean;
};

/** A successfully read nonempty body is evidence, distinct from JSON validity. */
export const isReadableProviderBody = (text: string): boolean =>
  text.trim().length > 0;

/** Classify an attempt only after validating any reported usage. */
export const classifyAttemptOutcome = (
  sent: boolean,
  status: number | null,
  bodyRead: boolean,
  usage: TAttemptUsage | null,
): TAttemptOutcome => ({
  sent,
  usage,
  definiteProviderError:
    bodyRead &&
    status !== null &&
    [400, 401, 403, 404, 413, 415, 422].includes(status),
});

/** The charge for one attempt; an unsent attempt always refunds its hold. */
export const chargeForAttempt = (
  outcome: TAttemptOutcome,
  reservation: number,
): number => {
  if (!outcome.sent) return 0;
  if (outcome.usage !== null) return outcome.usage.in + outcome.usage.out;
  return outcome.definiteProviderError ? 0 : reservation;
};

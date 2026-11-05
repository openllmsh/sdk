import { Schema as S } from "effect";

/** PostHog's UUIDv7 session ID, not a command ID or proof of session ownership. */
export const ReplaySessionId = S.String.pipe(
  S.check(
    S.isPattern(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    ),
  ),
);
export const isReplaySessionId = S.is(ReplaySessionId);

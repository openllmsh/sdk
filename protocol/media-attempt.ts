/**
 * Media chain advance vs terminal — no chat-style timeout/5xx retry.
 *
 * Cloud and daemon media walks classify each hop with `classifyHopError`
 * and then apply {@link mediaActionFor}, the media overlay on
 * `cooldownPolicyFor` (no re-POST after dispatch, pre-dispatch misses walk).
 */

import type { TCooldownPolicy, TCooldownReason } from "./cooldown-reason";
import { cooldownPolicyFor } from "./cooldown-reason";

/**
 * Pre-dispatch media misses that never hit a provider. Walk without
 * cooling; once `dispatched` they surface (a submit may have been accepted).
 */
export const MEDIA_PRE_DISPATCH_REASONS = [
  "missing_credential",
  "model_unavailable",
  "adapter_input_rejected",
  "adapter_input_unmapped",
] as const;
export type TMediaPreDispatchReason =
  (typeof MEDIA_PRE_DISPATCH_REASONS)[number];

export type TMediaActionReason = TCooldownReason | TMediaPreDispatchReason;

/**
 * Facts the media overlay needs beyond the shared classifier reason.
 * HTTP status / envelope stay with `classifyHopError`; this only carries
 * the billable-safety bits media owns.
 */
export type TMediaActionFacts = {
  readonly dispatched: boolean;
  /**
   * A 2xx (binary audio, undecodable body, created video job) or any other
   * accept that must never be re-sent. Surfaces regardless of `reason`.
   */
  readonly accepted?: boolean;
  readonly cancelled?: boolean;
};

const isPreDispatchReason = (
  reason: TMediaActionReason,
): reason is TMediaPreDispatchReason =>
  (MEDIA_PRE_DISPATCH_REASONS as ReadonlyArray<string>).includes(reason);

const MEDIA_NO_RETRY_REASONS: ReadonlySet<TCooldownReason> = new Set([
  "server_error",
  "timeout",
  "network",
  "upstream_stalled",
]);

/**
 * Media overlay on the shared hop classifier.
 *
 * - Dispatched `server_error` / `timeout` / `network` **surface** (chat would
 *   `retry_in_place` — a media re-POST can duplicate an image, video job, or
 *   audio charge).
 * - `accepted` (2xx / created job) or `cancelled` → surface, never re-sent.
 * - Pre-dispatch misses (`missing_credential`, `model_unavailable`,
 *   adapter input rejected/unmapped) → `walk_no_cool` while undispatched;
 *   surface once dispatched.
 * - Everything else follows {@link cooldownPolicyFor} unchanged.
 */
export const mediaActionFor = (
  reason: TMediaActionReason,
  facts: TMediaActionFacts,
): TCooldownPolicy => {
  if (facts.cancelled === true || facts.accepted === true) {
    return { action: "surface" };
  }
  if (isPreDispatchReason(reason)) {
    return facts.dispatched
      ? { action: "surface" }
      : { action: "walk_no_cool" };
  }
  if (facts.dispatched && MEDIA_NO_RETRY_REASONS.has(reason)) {
    return { action: "surface" };
  }
  return cooldownPolicyFor(reason);
};

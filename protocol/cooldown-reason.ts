import { Schema as S } from "effect";

export const CooldownReason = S.Literals([
  "network",
  "timeout",
  "rate_limit",
  "quota_exhausted",
  "server_error",
  "auth",
  "payment",
  "not_found",
  "payload_too_large",
  "unprocessable",
  "context_overflow",
  "content_filter",
  "upstream_rejection",
]);
export type TCooldownReason = S.Schema.Type<typeof CooldownReason>;

export type THopAction =
  | "retry_in_place"
  | "cool_and_advance"
  | "walk_no_cool"
  | "surface";

/**
 * The routing verb for a classified hop failure:
 *
 * - `retry_in_place` — transient infra fault; retry the SAME model once, then walk.
 * - `cool_and_advance` — this model/account can't serve now (auth/quota/rate);
 *   cool it and hop to the next model. The ONLY cooling action, so whether a
 *   reason cools is exactly `action === "cool_and_advance"`, and `ttlMs` lives
 *   only on this variant.
 * - `walk_no_cool` — the model is unavailable for this request but another might
 *   serve it (model absent / policy refusal); hop without cooling.
 * - `surface` — the MODEL is fine; the REQUEST is malformed/oversized, so every
 *   model would reject it identically. Surface the authentic error on this model
 *   (no hop, no cool, no retry) — hopping would only cold-miss the next model's
 *   cache and re-bill, and the client's corrected retry lands warm on the same
 *   model.
 */
export type TCooldownPolicy =
  | { readonly action: "retry_in_place" | "walk_no_cool" | "surface" }
  | { readonly action: "cool_and_advance"; readonly ttlMs: number };

const cooldownPolicies = {
  network: { action: "retry_in_place" },
  timeout: { action: "retry_in_place" },
  rate_limit: { action: "cool_and_advance", ttlMs: 180_000 },
  quota_exhausted: { action: "cool_and_advance", ttlMs: 180_000 },
  server_error: { action: "retry_in_place" },
  auth: { action: "cool_and_advance", ttlMs: 60_000 },
  payment: { action: "cool_and_advance", ttlMs: 60_000 },
  // Model unavailable for this request, but a sibling may serve it — hop, no cool.
  not_found: { action: "walk_no_cool" },
  content_filter: { action: "walk_no_cool" },
  // Request-deterministic: the model works, the request is bad — surface, no hop.
  payload_too_large: { action: "surface" },
  unprocessable: { action: "surface" },
  upstream_rejection: { action: "surface" },
  // Context overflow is intercepted before the action switch, so this is inert.
  context_overflow: { action: "walk_no_cool" },
} satisfies Record<TCooldownReason, TCooldownPolicy>;

export const cooldownPolicyFor = (reason: TCooldownReason): TCooldownPolicy =>
  cooldownPolicies[reason];

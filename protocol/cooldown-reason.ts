import { Schema as S } from "effect";

export const CooldownReason = S.Literals([
  "network",
  "timeout",
  "upstream_stalled",
  "rate_limit",
  "quota_exhausted",
  "server_error",
  "auth",
  "payment",
  "not_found",
  "payload_too_large",
  "unprocessable",
  "request_invalid",
  "accepted_unreadable",
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
 *   serve it (model absent / policy refusal / capability miss / oversized for
 *   THIS model); hop without cooling.
 * - `surface` — stop on this hop (no hop, no cool, no retry). Covers
 *   request-deterministic failures (`request_invalid`, `unprocessable`) where
 *   every model would reject the request identically, and
 *   `accepted_unreadable` where the provider already accepted a 2xx the runner
 *   could not use (it may have billed — never re-send). On the cloud's ordered
 *   cloud↔device segment walk a `surface` reason ends the whole request, not
 *   only the current segment.
 */
export type TCooldownPolicy =
  | { readonly action: "retry_in_place" | "walk_no_cool" | "surface" }
  | { readonly action: "cool_and_advance"; readonly ttlMs: number };

const cooldownPolicies = {
  network: { action: "retry_in_place" },
  timeout: { action: "retry_in_place" },
  // Streaming hop went silent before any client byte (headers or body). Cool
  // briefly so a dead provider isn't retried immediately for the same turn.
  upstream_stalled: { action: "cool_and_advance", ttlMs: 60_000 },
  rate_limit: { action: "cool_and_advance", ttlMs: 180_000 },
  quota_exhausted: { action: "cool_and_advance", ttlMs: 180_000 },
  server_error: { action: "retry_in_place" },
  auth: { action: "cool_and_advance", ttlMs: 60_000 },
  payment: { action: "cool_and_advance", ttlMs: 60_000 },
  // Model unavailable for this request, but a sibling may serve it — hop, no cool.
  not_found: { action: "walk_no_cool" },
  content_filter: { action: "walk_no_cool" },
  // Oversized for THIS model; a larger-context sibling may still accept it.
  payload_too_large: { action: "walk_no_cool" },
  // Capability / unfamiliar 4xx: hop-local — another model may accept the same
  // canonical request. Walk without cooling.
  upstream_rejection: { action: "walk_no_cool" },
  // Request-deterministic: the model works, the request is bad — surface, no hop.
  unprocessable: { action: "surface" },
  request_invalid: { action: "surface" },
  // The provider answered with a non-error status we couldn't use: it accepted
  // (and may have billed) the request, so another hop would bill it twice.
  accepted_unreadable: { action: "surface" },
  // Context overflow is intercepted before the action switch, so this is inert.
  context_overflow: { action: "walk_no_cool" },
} satisfies Record<TCooldownReason, TCooldownPolicy>;

export const cooldownPolicyFor = (reason: TCooldownReason): TCooldownPolicy =>
  cooldownPolicies[reason];

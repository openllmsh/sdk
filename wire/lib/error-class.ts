import type { TCooldownReason, TErrorEnvelope } from "@openllmsh/sdk/protocol";
import {
  errorRulesFor,
  providerRuleMatches,
  type TProviderErrorRule,
} from "./provider-error-rules";

/**
 * Classifies an uncommitted upstream hop failure. Lives in
 * `@openllmsh/sdk/wire` so the cloud orchestrator and coreless daemon walker
 * share one policy.
 *
 * Once the gateway has validated the inbound request, an upstream rejection
 * cannot prove that every other provider/model will reject the canonical
 * request. Therefore every non-abort failure is classified as `transient`
 * and the cooldown-policy action (`walk_no_cool` / `cool_and_advance` /
 * `retry_in_place` / `surface`) decides whether the walk continues. Only
 * request-deterministic reasons (`request_invalid`, `unprocessable`) surface
 * immediately; capability / unfamiliar 4xx (`upstream_rejection`) and
 * oversized payloads (`payload_too_large`) walk without cooling so a sibling
 * model can still serve. This decision is deliberately independent of
 * provider names for the defaults; optional `provider` rules may refine the
 * reason tag before those defaults run.
 *
 * A committed response never reaches this classifier. After output has been
 * committed, the serving transport owns any failure and cannot restart on a
 * different model safely.
 *
 * Some Envoy edge-connect failures wear a 5xx status despite describing a
 * network failure between the edge and its upstream. The narrow conjunction
 * below keeps those failures from cooling a model, while ordinary vendor 5xx
 * responses remain `server_error` and retain their cooldown.
 */
export type TFallbackClass =
  | { readonly kind: "transient"; readonly reason: TCooldownReason }
  | { readonly kind: "abort" };

export type TClassifierInput = {
  readonly status: number;
  readonly envelope?: TErrorEnvelope | undefined;
  readonly providerFormat: "openai" | "anthropic";
  readonly aborted: boolean;
  readonly provider?: string | undefined;
};

const QUOTA_BODY =
  /usage limit|usage balance|balance exhausted|quota|billing cycle|upgrade your plan|out of credits|purchase extra usage|insufficient_quota|insufficient (?:credits?|balance|funds)|credit balance|payment required|top[\s-]?up/i;

const REQUEST_INVALID_BODY =
  /missing required parameter|could not parse the json|invalid json body|extra inputs are not permitted|unsupported parameter|unknown parameter/i;

/** True when an error body says the account is out of quota (the same
 *  phrasing that upgrades a 401/402/403/429 to `quota_exhausted`). */
export const isQuotaExhaustedText = (text: string): boolean =>
  QUOTA_BODY.test(text);
/**
 * The vendor error phrasings that mean "request too large for this model's
 * context window". Exported so callers that classify a raw upstream body — e.g.
 * the daemon walker's last-resort compaction trigger — reuse the SAME matcher
 * instead of maintaining a drifting copy.
 */
export const CONTEXT_OVERFLOW_BODY =
  /maximum (prompt|context) length|exceeds the context window|too many tokens|reduce the length of the messages|prompt is too long|exceeds? (?:the )?model token limit|token limit: [\d,]+/i;
// Envoy's first sentence is version-invariant; the trailing reset-reason
// clause drifts between Envoy versions ("reset reason: …" vs "retried and the
// latest reset reason: …"), so the matcher pins only the first sentence.
const ENVOY_CONNECT_ERROR_BODY = [
  /upstream connect error/i,
  /disconnect\/reset before headers/i,
] as const;

const isEnvoyConnectError = (message: string): boolean =>
  ENVOY_CONNECT_ERROR_BODY.every((pattern) => pattern.test(message));

/**
 * Pure reason tagging. Accepts an optional `rules` override so tests can
 * exercise provider rules without mutating the empty shipped table.
 */
export const reasonFor = (
  i: TClassifierInput,
  rules: readonly TProviderErrorRule[] = errorRulesFor(i.provider),
): TCooldownReason => {
  if (i.envelope?.error?.code === "content_filter") return "content_filter";
  // A non-error status the runner still couldn't use (an undecodable 200):
  // the provider ACCEPTED the request and may have billed it, so walking on
  // would send — and bill — it again. Only an explicit in-band refusal
  // (content_filter, above) walks from a 2xx; no body matcher or provider rule
  // may turn an accepted request into a walk.
  if (i.status >= 100 && i.status < 400) return "accepted_unreadable";
  const message = i.envelope?.error?.message ?? "";
  if (CONTEXT_OVERFLOW_BODY.test(message)) return "context_overflow";

  for (const rule of rules) {
    if (
      providerRuleMatches(rule, {
        status: i.status,
        code: i.envelope?.error?.code,
        message,
      })
    ) {
      return rule.reason;
    }
  }

  if (i.status === 0) return "network";
  if (i.status === 408) return "timeout";
  if (i.status === 429) {
    return QUOTA_BODY.test(message) ? "quota_exhausted" : "rate_limit";
  }
  if (i.status >= 500) {
    return isEnvoyConnectError(message) ? "network" : "server_error";
  }
  // 426 Upgrade Required: the upstream refuses THIS client (xAI's CLI proxy
  // gates on the device's installed grok version). Like an auth failure it is
  // hop-local — another provider/device can serve — so it cools and advances
  // instead of falling into a catch-all that used to surface and halt the chain.
  if (
    i.status === 401 ||
    i.status === 403 ||
    i.status === 407 ||
    i.status === 426
  ) {
    return QUOTA_BODY.test(message) ? "quota_exhausted" : "auth";
  }
  if (i.status === 402) {
    return QUOTA_BODY.test(message) ? "quota_exhausted" : "payment";
  }
  if (i.status === 404) return "not_found";
  if (i.status === 413) return "payload_too_large";
  if (i.status === 422) return "unprocessable";
  // Any remaining 4xx: quota / request-invalid body matchers before the
  // catch-all. A credits-exhausted OpenRouter 400 must cool-and-advance, not
  // stop the walk; a missing-parameter 400 still surfaces.
  if (i.status >= 400 && i.status < 500) {
    if (QUOTA_BODY.test(message)) return "quota_exhausted";
    if (REQUEST_INVALID_BODY.test(message)) return "request_invalid";
  }
  return "upstream_rejection";
};

export const classifyHopError = (
  i: TClassifierInput,
  rules?: readonly TProviderErrorRule[],
): TFallbackClass =>
  i.aborted
    ? { kind: "abort" }
    : {
        kind: "transient",
        reason: reasonFor(i, rules ?? errorRulesFor(i.provider)),
      };
